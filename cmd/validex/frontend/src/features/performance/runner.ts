import {
  appendURLPerformanceReport,
  errorText,
  urlPerformanceLimits,
  type URLPerformanceSummary,
} from "../diagnostics/model.js";
import type {
  NetworkInspectInput,
  NetworkInspectResult,
  NetworkReport,
} from "../../lib/types.js";
import {
  validatePerformanceOptions,
  type PerformanceOptions,
} from "./model.js";

export interface PerformanceRunProgress {
  summary?: URLPerformanceSummary;
  completedSamples: number;
  warmupCompleted: number;
  activeRequests: number;
  phase: "warmup" | "running" | "stopping";
  elapsedTimeMs: number;
}

export interface PerformanceRunResult {
  status: "completed" | "canceled";
  summary?: URLPerformanceSummary;
  completedSamples: number;
  warmupCompleted: number;
  elapsedTimeMs: number;
}

export interface PerformanceClock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface PerformanceRunConfig {
  url: string;
  sampleCount: number;
  timeoutMs: number;
  options: PerformanceOptions;
  analyze(input: NetworkInspectInput): Promise<NetworkInspectResult>;
  cancel(operationId: string): Promise<boolean>;
  onProgress(progress: PerformanceRunProgress): void;
  describeFailure?(result: NetworkInspectResult): string;
  describeUnexpectedStatus?(expected: number, actual: number): string;
  clock?: PerformanceClock;
}

export interface PerformanceRunHandle {
  completion: Promise<PerformanceRunResult>;
  stop(): Promise<boolean>;
  dispose(): void;
}

const realClock: PerformanceClock = {
  now: () => performance.now(),
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      signal.addEventListener("abort", abort, { once: true });
    });
  },
};

interface ActiveRequest {
  id: string;
  acknowledged: boolean;
  release(): void;
}

let sessionSequence = 0;

/** Per-run workers and cancellation tokens isolate late backend replies. */
export function runPerformanceTest(
  config: PerformanceRunConfig,
): PerformanceRunHandle {
  const options = { ...config.options };
  const issue = validatePerformanceOptions(options);
  if (issue) throw new RangeError(`Invalid performance option: ${issue.field}`);
  if (
    !Number.isSafeInteger(config.sampleCount) ||
    config.sampleCount < 1 ||
    config.sampleCount > urlPerformanceLimits.maximumSamples
  ) {
    throw new RangeError("Invalid performance sample count");
  }
  if (
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 1 ||
    config.timeoutMs > urlPerformanceLimits.maximumRepresentableTimeoutMs
  ) {
    throw new RangeError("Invalid performance timeout");
  }
  const clock = config.clock ?? realClock;
  const session = `performance-${Date.now().toString(36)}-${++sessionSequence}`;
  const active = new Map<string, ActiveRequest>();
  const delays = new Set<AbortController>();
  const stateWaiters = new Set<() => void>();
  const pendingCancellations = new Map<string, Promise<boolean>>();
  const cancellationQueue: Array<() => void> = [];
  let activeCancellations = 0;
  let requestSequence = 0;
  let warmupCompleted = 0;
  let summary: URLPerformanceSummary | undefined;
  let measurementStarted: number | undefined;
  let measurementEnded: number | undefined;
  let phase: "warmup" | "running" =
    options.warmupSamples > 0 ? "warmup" : "running";
  let stopping = false;
  let canceled = false;
  let disposed = false;
  let finished = false;
  let stopAttempt: Promise<boolean> | undefined;

  const pumpCancellations = () => {
    while (activeCancellations < 4 && cancellationQueue.length > 0) {
      cancellationQueue.shift()!();
    }
  };
  const cancelRequest = (id: string): Promise<boolean> => {
    const pending = pendingCancellations.get(id);
    if (pending) return pending;
    let resolve!: (accepted: boolean) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<boolean>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    pendingCancellations.set(id, result);
    cancellationQueue.push(() => {
      activeCancellations++;
      void Promise.resolve()
        .then(() => config.cancel(id))
        .then(resolve, reject)
        .finally(() => {
          pendingCancellations.delete(id);
          activeCancellations--;
          pumpCancellations();
        });
    });
    pumpCancellations();
    return result;
  };

  const elapsed = () => measurementStarted === undefined
    ? 0
    : Math.max(0, (measurementEnded ?? clock.now()) - measurementStarted);
  const emit = () => {
    if (disposed) return;
    if (summary) summary = { ...summary, elapsedTimeMs: elapsed() };
    config.onProgress({
      summary,
      completedSamples: summary?.completedSamples ?? 0,
      warmupCompleted,
      activeRequests: active.size,
      phase: stopping ? "stopping" : phase,
      elapsedTimeMs: elapsed(),
    });
  };
  const wake = () => {
    const waiters = [...stateWaiters];
    stateWaiters.clear();
    for (const resolve of waiters) resolve();
  };
  const interruptDelays = () => {
    for (const controller of delays) controller.abort();
  };
  const ready = async (
    deadline = clock.now(),
    phaseFinished = () => false,
  ): Promise<boolean> => {
    while (!canceled && !disposed && !phaseFinished()) {
      if (stopping) {
        await new Promise<void>((resolve) => stateWaiters.add(resolve));
        continue;
      }
      const remaining = deadline - clock.now();
      if (remaining <= 0) return true;
      const controller = new AbortController();
      delays.add(controller);
      try {
        await clock.sleep(remaining, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        delays.delete(controller);
      }
    }
    return false;
  };

  const sample = async (measured: boolean): Promise<boolean> => {
    const started = clock.now();
    const id = `${session}-${++requestSequence}`;
    let release!: () => void;
    const released = new Promise<null>((resolve) => {
      release = () => resolve(null);
    });
    const request: ActiveRequest = { id, acknowledged: false, release };
    active.set(id, request);
    const inspection = (async () => {
      try {
        return {
          result: await config.analyze({
            operationId: id,
            url: config.url,
            timeoutMs: config.timeoutMs,
            maxRedirects: 10,
            insecureSkipVerify: false,
          }),
        };
      } catch (thrown: unknown) {
        return { thrown };
      }
    })();
    emit();
    const outcome = await Promise.race([inspection, released]);
    const completedAt = clock.now();
    active.delete(id);
    if (!outcome || !(await ready()) || request.acknowledged) return false;
    if (!measured) {
      warmupCompleted++;
      emit();
      return true;
    }
    const result = "result" in outcome ? outcome.result : undefined;
    let failure = result?.error
      ? (config.describeFailure?.(result) || errorText(result.error))
      : "thrown" in outcome ? errorText(outcome.thrown) : undefined;
    let category = result?.error?.code
      ?? ("thrown" in outcome ? "backend-error" : undefined);
    if (!result?.report && !failure) {
      failure = "Network analysis returned no report.";
      category = "missing-report";
    }
    const report: NetworkReport = result?.report ?? {
      inputUrl: config.url,
      totalDurationMs: Math.max(0, completedAt - started),
      dnsLookups: [],
      hops: [],
      usedGetFallback: false,
    };
    if (
      !failure &&
      options.expectedStatus !== 0 &&
      report.finalStatusCode !== options.expectedStatus
    ) {
      failure = config.describeUnexpectedStatus?.(
        options.expectedStatus,
        report.finalStatusCode ?? 0,
      ) || `Expected HTTP ${options.expectedStatus}; received ${report.finalStatusCode ?? 0}.`;
      category = "unexpected-status";
    }
    summary = appendURLPerformanceReport(summary, report, failure, category);
    const latest = summary.samples.at(-1)!;
    // An explicitly expected 4xx/5xx response can be a successful assertion.
    if (!failure && options.expectedStatus !== 0 && !latest.success) {
      summary = {
        ...summary,
        successfulSamples: summary.successfulSamples + 1,
        failedSamples: summary.failedSamples - 1,
        samples: [...summary.samples.slice(0, -1), { ...latest, success: true }],
      };
    }
    emit();
    return true;
  };

  const runPhase = async (count: number, measured: boolean) => {
    const workerCount = Math.min(options.concurrency, count);
    const phaseStarted = clock.now();
    let assigned = 0;
    let completed = 0;
    const phaseFinished = () => completed >= count;
    await Promise.all(
      Array.from({ length: workerCount }, async (_, worker) => {
        const rampDelay = measured && workerCount > 1
          ? options.rampUpMs * worker / (workerCount - 1)
          : 0;
        if (!(await ready(phaseStarted + rampDelay, phaseFinished))) return;
        while (await ready(clock.now(), phaseFinished)) {
          if (stopping || canceled || disposed) continue;
          if (assigned >= count) return;
          assigned++;
          const counted = await sample(measured);
          if (!counted) {
            assigned--;
          } else {
            completed++;
            if (phaseFinished()) {
              if (measured) measurementEnded = clock.now();
              interruptDelays();
              wake();
            }
          }
          if (canceled || disposed) return;
          if (assigned >= count) return;
          if (!(await ready(clock.now() + options.delayMs, phaseFinished))) return;
        }
      }),
    );
  };

  const stop = (): Promise<boolean> => {
    if (finished || canceled || disposed) return Promise.resolve(true);
    if (stopAttempt) return stopAttempt;
    stopping = true;
    interruptDelays();
    emit();
    const requests = [...active.values()];
    stopAttempt = (async () => {
      const accepted = await Promise.all(
        requests.map(async (request) => {
          try {
            const acknowledged = await cancelRequest(request.id);
            if (acknowledged) {
              request.acknowledged = true;
              request.release();
              active.delete(request.id);
            }
            return acknowledged || !active.has(request.id);
          } catch {
            return !active.has(request.id);
          }
        }),
      );
      const stopped = disposed || requests.every((request, index) =>
        accepted[index] || !active.has(request.id),
      );
      if (stopped) canceled = true;
      stopping = false;
      stopAttempt = undefined;
      wake();
      emit();
      return stopped;
    })();
    return stopAttempt;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    canceled = true;
    stopping = false;
    interruptDelays();
    wake();
    for (const request of active.values()) {
      request.release();
      void cancelRequest(request.id).catch(() => {});
    }
    active.clear();
  };

  const completion = Promise.resolve().then(async (): Promise<PerformanceRunResult> => {
    if (options.warmupSamples > 0) {
      emit();
      await runPhase(options.warmupSamples, false);
    }
    while (!canceled && !disposed) {
      if (stopping) {
        await ready();
        continue;
      }
      phase = "running";
      measurementStarted = clock.now();
      emit();
      await runPhase(config.sampleCount, true);
      break;
    }
    measurementEnded ??= clock.now();
    finished = true;
    emit();
    return {
      status: canceled || disposed ? "canceled" : "completed",
      summary,
      completedSamples: summary?.completedSamples ?? 0,
      warmupCompleted,
      elapsedTimeMs: elapsed(),
    };
  });

  return { completion, stop, dispose };
}
