import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultPerformanceOptions,
  performancePresets,
  validatePerformanceOptions,
} from "../.typescript-build/esm/features/performance/model.js";
import { runPerformanceTest } from "../.typescript-build/esm/features/performance/runner.js";

const target = "https://example.test/health";
const flush = async () => {
  for (let count = 0; count < 30; count++) await Promise.resolve();
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function report(duration = 10, status = 200) {
  return {
    report: {
      inputUrl: target,
      finalUrl: target,
      finalStatusCode: status,
      totalDurationMs: duration,
      dnsLookups: [],
      hops: [{ url: target, method: "HEAD", statusCode: status, durationMs: duration }],
      usedGetFallback: false,
    },
  };
}

function fakeClock() {
  let current = 0;
  const timers = new Set();
  return {
    now: () => current,
    get pendingTimers() { return timers.size; },
    sleep(ms, signal) {
      const waiting = deferred();
      const timer = { deadline: current + ms, resolve: waiting.resolve };
      timers.add(timer);
      const abort = () => { timers.delete(timer); waiting.reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      return waiting.promise.finally(() => signal.removeEventListener("abort", abort));
    },
    async advance(ms) {
      current += ms;
      for (const timer of [...timers]) {
        if (timer.deadline <= current) { timers.delete(timer); timer.resolve(); }
      }
      await flush();
    },
  };
}

function controlledRun(overrides = {}) {
  const calls = [];
  const updates = [];
  const clock = overrides.clock ?? fakeClock();
  const handle = runPerformanceTest({
    url: target,
    sampleCount: 5,
    timeoutMs: 3_000,
    options: { ...defaultPerformanceOptions },
    analyze(input) {
      const waiting = deferred();
      calls.push({ ...waiting, input, started: clock.now() });
      return waiting.promise;
    },
    cancel: async () => true,
    onProgress: (progress) => updates.push(progress),
    ...overrides,
    clock,
  });
  return { handle, calls, updates, clock };
}

test("performance options reject invalid bounds and every preset is runnable", () => {
  assert.equal(validatePerformanceOptions({ ...defaultPerformanceOptions }), null);
  for (const [field, values] of Object.entries({
    concurrency: [0, 17, 1.5], warmupSamples: [-1, 51, 1.5],
    rampUpMs: [-1, 60_001, Infinity], delayMs: [-1, 60_001, NaN],
    expectedStatus: [99, 600, 200.1], p95TargetMs: [0, -1, 600_001, Infinity],
    errorBudgetPercent: [-1, 101, NaN],
  })) {
    for (const value of values) {
      assert.equal(validatePerformanceOptions({ ...defaultPerformanceOptions, [field]: value })?.field, field);
    }
  }
  assert.equal(validatePerformanceOptions({ ...defaultPerformanceOptions, p95TargetMs: 1.5, errorBudgetPercent: 0.5, expectedStatus: 599 }), null);
  assert.deepEqual(performancePresets.map(({ id }) => id), ["quick", "baseline", "load", "soak"]);
  for (const preset of performancePresets) {
    assert.equal(validatePerformanceOptions(preset.options), null);
    assert.ok(preset.sampleCount >= 1 && preset.sampleCount <= 1_000);
  }
  assert.throws(() => controlledRun({ sampleCount: 1_001 }), /sample count/);
  assert.throws(() => controlledRun({ timeoutMs: 0 }), /timeout/);
});

test("bounded workers finish warmup before measuring and exclude it from results and elapsed time", { timeout: 1_000 }, async () => {
  const { handle, calls, updates, clock } = controlledRun({
    options: { ...defaultPerformanceOptions, concurrency: 2, warmupSamples: 3 },
  });
  await flush();
  assert.equal(calls.length, 2);
  await clock.advance(100);
  calls[0].resolve(report(900));
  calls[1].resolve(report(800));
  await flush();
  assert.equal(calls.length, 3);
  assert.equal(updates.at(-1).warmupCompleted, 2);
  assert.equal(updates.at(-1).summary, undefined);
  await clock.advance(100);
  calls[2].resolve(report(700));
  await flush();
  assert.equal(calls.length, 5);
  assert.equal(updates.at(-1).elapsedTimeMs, 0);
  for (let index = 3; index < 8; index++) {
    await clock.advance(10);
    calls[index].resolve(report(10));
    await flush();
  }
  const result = await handle.completion;
  assert.equal(result.status, "completed");
  assert.equal(result.completedSamples, 5);
  assert.equal(result.warmupCompleted, 3);
  assert.equal(result.summary.averageMs, 10);
  assert.equal(result.elapsedTimeMs, 50);
  assert.equal(result.summary.elapsedTimeMs, 50);
  assert.equal(Math.max(...updates.map(({ activeRequests }) => activeRequests)), 2);
  assert.equal(new Set(calls.map(({ input }) => input.operationId)).size, 8);
  assert.ok(calls.every(({ input }) => input.url === target && input.timeoutMs === 3_000 && input.insecureSkipVerify === false));
});

test("expected status assertions override default HTTP success without hiding transport errors", async () => {
  for (const [expectedStatus, expectedSuccesses] of [[0, 2], [404, 1]]) {
    const statuses = [200, 302, 404];
    const { handle } = controlledRun({
      sampleCount: 3,
      options: { ...defaultPerformanceOptions, expectedStatus },
      analyze: async () => report(10, statuses.shift()),
    });
    const { summary } = await handle.completion;
    assert.equal(summary.successfulSamples, expectedSuccesses);
    assert.equal(summary.failedSamples, 3 - expectedSuccesses);
    if (expectedStatus === 404) {
      assert.equal(summary.samples.at(-1).success, true);
      assert.equal(summary.samples[0].failureCategory, "unexpected-status");
      assert.match(summary.samples[0].error, /Expected HTTP 404; received 200/);
    }
  }
});

test("missing reports and thrown backend failures count as failed samples with plain-text details", async () => {
  let index = 0;
  const { handle, clock } = controlledRun({
    sampleCount: 3,
    describeFailure: (result) => `Localized: ${result.error.technical}`,
    analyze: async () => {
      await clock.advance(5);
      if (index++ === 0) throw new Error("<img src=x> bridge unavailable");
      if (index === 2) return { error: { code: "tool_timeout", technical: "socket timed out" } };
      return {};
    },
  });
  const { summary } = await handle.completion;
  assert.equal(summary.completedSamples, 3);
  assert.equal(summary.failedSamples, 3);
  assert.deepEqual(summary.samples.map(({ failureCategory }) => failureCategory), ["backend-error", "tool_timeout", "missing-report"]);
  assert.equal(summary.samples[0].error, "<img src=x> bridge unavailable");
  assert.equal(summary.samples[1].error, "Localized: socket timed out");
  assert.ok(summary.samples.every(({ durationMs }) => durationMs >= 5));
});

test("acknowledged stop releases all unresolved requests, preserves partial results, and ignores stale replies", { timeout: 1_000 }, async () => {
  const canceledIDs = [];
  const run = controlledRun({
    options: { ...defaultPerformanceOptions, concurrency: 3 },
    cancel: async (id) => { canceledIDs.push(id); return true; },
  });
  await flush();
  run.calls[0].resolve(report(12));
  await flush();
  assert.equal(run.calls.length, 4);
  assert.equal(await run.handle.stop(), true);
  const result = await run.handle.completion;
  assert.equal(result.status, "canceled");
  assert.equal(result.completedSamples, 1);
  assert.equal(canceledIDs.length, 3);
  assert.deepEqual(canceledIDs.sort(), run.calls.slice(1).map(({ input }) => input.operationId).sort());
  const progressCount = run.updates.length;
  run.calls[1].resolve(report(999));
  run.calls[2].reject(new Error("late rejection"));
  run.calls[3].resolve(report(888));
  const next = controlledRun({ sampleCount: 1, analyze: async () => report(7) });
  assert.equal((await next.handle.completion).summary.averageMs, 7);
  await flush();
  assert.equal(run.updates.length, progressCount);
  assert.equal(result.summary.averageMs, 12);
});

test("rejected cancellation pauses scheduling, keeps active IDs, resumes safely, and allows retry", { timeout: 1_000 }, async () => {
  const cancellations = [];
  const { handle, calls, updates } = controlledRun({
    options: { ...defaultPerformanceOptions, concurrency: 2 },
    cancel: (id) => {
      const waiting = deferred();
      cancellations.push({ id, ...waiting });
      return waiting.promise;
    },
  });
  await flush();
  const firstStop = handle.stop();
  assert.equal(handle.stop(), firstStop);
  calls[0].resolve(report(11));
  await flush();
  assert.equal(calls.length, 2, "no new requests during a pending stop attempt");
  cancellations[0].resolve(false);
  cancellations[1].reject(new Error("bridge cancellation failed"));
  assert.equal(await firstStop, false);
  await flush();
  assert.equal(calls.length, 3, "workers resume after rejection");
  assert.equal(updates.at(-1).completedSamples, 1);
  assert.equal(updates.at(-1).phase, "running");
  const retry = handle.stop();
  await flush();
  assert.ok(cancellations.slice(2).some(({ id }) => id === calls[1].input.operationId));
  cancellations[2].resolve(true);
  cancellations[3].resolve(true);
  assert.equal(await retry, true);
  assert.equal((await handle.completion).completedSamples, 1);
});

test("ramp-up and per-worker pacing use deadlines and cancellation clears every pending delay", { timeout: 1_000 }, async () => {
  const { handle, calls, clock } = controlledRun({
    sampleCount: 6,
    options: { ...defaultPerformanceOptions, concurrency: 3, rampUpMs: 200, delayMs: 50 },
  });
  await flush();
  assert.deepEqual(calls.map(({ started }) => started), [0]);
  await clock.advance(10);
  calls[0].resolve(report(10));
  await flush();
  await clock.advance(49);
  assert.equal(calls.length, 1);
  await clock.advance(1);
  assert.deepEqual(calls.map(({ started }) => started), [0, 60]);
  await clock.advance(40);
  assert.deepEqual(calls.map(({ started }) => started), [0, 60, 100]);
  assert.equal(await handle.stop(), true);
  assert.equal((await handle.completion).status, "canceled");
  assert.equal(clock.pendingTimers, 0);
  await clock.advance(60_000);
  assert.equal(calls.length, 3);
});

test("a request finishing after cancellation rejection does not prevent an otherwise acknowledged stop", { timeout: 1_000 }, async () => {
  const cancellations = [];
  const { handle, calls } = controlledRun({
    options: { ...defaultPerformanceOptions, concurrency: 2 },
    cancel: () => {
      const waiting = deferred();
      cancellations.push(waiting);
      return waiting.promise;
    },
  });
  await flush();
  const stopped = handle.stop();
  await flush();
  cancellations[0].resolve(false);
  await flush();
  calls[0].resolve(report(10));
  await flush();
  cancellations[1].resolve(true);
  assert.equal(await stopped, true);
  assert.equal((await handle.completion).status, "canceled");
  assert.equal(calls.length, 2);
});

test("stop between requests completes immediately without waiting for pacing or canceling an absent operation", { timeout: 1_000 }, async () => {
  let cancellations = 0;
  const { handle, calls, clock } = controlledRun({
    sampleCount: 2,
    options: { ...defaultPerformanceOptions, delayMs: 60_000 },
    cancel: async () => { cancellations++; return true; },
  });
  await flush();
  calls[0].resolve(report(10));
  await flush();
  assert.equal(clock.pendingTimers, 1);
  assert.equal(await handle.stop(), true);
  assert.equal((await handle.completion).completedSamples, 1);
  assert.equal(cancellations, 0);
  assert.equal(clock.pendingTimers, 0);
});

test("a completed run releases unused ramp-up workers and ends timing at the last response", { timeout: 1_000 }, async () => {
  const clock = fakeClock();
  let calls = 0;
  const { handle } = controlledRun({
    clock,
    sampleCount: 4,
    options: { ...defaultPerformanceOptions, concurrency: 4, rampUpMs: 60_000 },
    analyze: async () => {
      calls++;
      await clock.advance(5);
      return report(5);
    },
  });
  const result = await handle.completion;
  assert.equal(calls, 4);
  assert.equal(result.elapsedTimeMs, 20);
  assert.equal(result.summary.elapsedTimeMs, 20);
  assert.equal(clock.pendingTimers, 0);
});

test("stop and dispose cancel sixteen active operations with at most four bridge calls in flight", { timeout: 1_000 }, async () => {
  for (const action of ["stop", "dispose"]) {
    const cancellations = [];
    let active = 0;
    let maximumActive = 0;
    const { handle, calls } = controlledRun({
      sampleCount: 16,
      options: { ...defaultPerformanceOptions, concurrency: 16 },
      cancel: (id) => {
        const waiting = deferred();
        cancellations.push({ id, ...waiting });
        active++;
        maximumActive = Math.max(maximumActive, active);
        return waiting.promise.finally(() => active--);
      },
    });
    await flush();
    assert.equal(calls.length, 16);
    const stopped = handle[action]();
    await flush();
    assert.equal(cancellations.length, 4);
    for (let offset = 0; offset < 16; offset += 4) {
      assert.equal(cancellations.length, offset + 4);
      for (const cancellation of cancellations.slice(offset, offset + 4)) cancellation.resolve(true);
      await flush();
    }
    if (action === "stop") assert.equal(await stopped, true);
    assert.equal((await handle.completion).status, "canceled");
    assert.equal(maximumActive, 4);
    assert.equal(new Set(cancellations.map(({ id }) => id)).size, 16);
  }
});

test("dispose detaches progress and workers even if backend cancellation is rejected", { timeout: 1_000 }, async () => {
  const canceledIDs = [];
  const { handle, calls, updates } = controlledRun({
    options: { ...defaultPerformanceOptions, concurrency: 2 },
    cancel: async (id) => { canceledIDs.push(id); return false; },
  });
  await flush();
  const progressCount = updates.length;
  handle.dispose();
  handle.dispose();
  assert.equal((await handle.completion).status, "canceled");
  assert.equal(canceledIDs.length, 2);
  calls[0].resolve(report(50));
  calls[1].reject(new Error("old disposed operation"));
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(updates.length, progressCount);
});

test("stopping or disposing before startup schedules no backend operation", async () => {
  const stopped = controlledRun();
  assert.equal(await stopped.handle.stop(), true);
  assert.equal((await stopped.handle.completion).status, "canceled");
  assert.equal(stopped.calls.length, 0);
  const disposed = controlledRun();
  disposed.handle.dispose();
  assert.equal((await disposed.handle.completion).status, "canceled");
  assert.equal(disposed.calls.length, 0);
});
