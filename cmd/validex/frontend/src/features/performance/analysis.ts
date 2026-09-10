import {
  urlPerformanceLimits,
  urlPerformanceStatistics,
  type URLPerformanceSample,
  type URLPerformanceSummary,
} from "../diagnostics/model.js";

export interface PerformanceAnalysisOptions {
  p95TargetMs: number;
  errorBudgetPercent: number;
}

export interface PerformanceRunRecord {
  id: string;
  startedAt: string;
  url: string;
  summary: URLPerformanceSummary;
}

export interface PerformanceReportMetadata {
  url?: string;
  startedAt?: string;
}

export interface LatencyBucket {
  lowerMs: number;
  upperMs: number;
  count: number;
  percentage: number;
  includesUpperBound: boolean;
}

/** Uses the retained percentile reservoir, independently of the detail limit. */
export function latencyHistogram(
  values: readonly number[],
  bucketCount = 8,
): LatencyBucket[] {
  const durations = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!durations.length) return [];
  const minimum = Math.min(...durations);
  const maximum = Math.max(...durations);
  if (minimum === maximum) {
    return [{ lowerMs: minimum, upperMs: maximum, count: durations.length,
      percentage: 100, includesUpperBound: true }];
  }
  const count = Number.isFinite(bucketCount)
    ? Math.max(1, Math.min(20, Math.floor(bucketCount))) : 8;
  const width = (maximum - minimum) / count;
  const buckets = Array.from({ length: count }, (_, index) => ({
    lowerMs: minimum + index * width,
    upperMs: index === count - 1 ? maximum : minimum + (index + 1) * width,
    count: 0,
    percentage: 0,
    includesUpperBound: index === count - 1,
  }));
  for (const duration of durations) {
    const index = Math.min(count - 1, Math.floor((duration - minimum) / width));
    buckets[index].count += 1;
  }
  for (const bucket of buckets) bucket.percentage = bucket.count / durations.length * 100;
  return buckets;
}

export function calculateApdex(
  samples: readonly URLPerformanceSample[],
  targetMs: number,
) {
  const target = Number.isFinite(targetMs) ? Math.max(0, targetMs) : 0;
  let satisfied = 0;
  let tolerating = 0;
  let frustrated = 0;
  for (const sample of samples) {
    if (!sample.success || !Number.isFinite(sample.durationMs) || sample.durationMs < 0) {
      frustrated += 1;
    } else if (sample.durationMs <= target) {
      satisfied += 1;
    } else if (sample.durationMs <= target * 4) {
      tolerating += 1;
    } else {
      frustrated += 1;
    }
  }
  return {
    score: samples.length > 0 ? (satisfied + tolerating / 2) / samples.length : null,
    satisfied,
    tolerating,
    frustrated,
    sampleCount: samples.length,
    targetMs: target,
  };
}

export function evaluatePerformanceTargets(
  summary: URLPerformanceSummary,
  options: PerformanceAnalysisOptions,
) {
  const statistics = urlPerformanceStatistics(summary);
  const hasSamples = summary.completedSamples > 0 && summary.durationValuesMs.length > 0;
  const p95Passed = hasSamples && statistics.p95Ms <= options.p95TargetMs;
  const errorBudgetPassed = hasSamples && statistics.errorRate <= options.errorBudgetPercent;
  return { hasSamples, p95Passed, errorBudgetPassed, passed: p95Passed && errorBudgetPassed };
}

export interface PerformanceMetricComparison {
  metric: "averageMs" | "p95Ms" | "throughputPerSecond" | "errorRate";
  baseline: number;
  current: number;
  difference: number;
  percentChange: number | null;
  direction: "improved" | "regressed" | "unchanged";
}

export function comparePerformance(
  summary: URLPerformanceSummary,
  baseline: URLPerformanceSummary,
): PerformanceMetricComparison[] {
  const currentStats = urlPerformanceStatistics(summary);
  const baselineStats = urlPerformanceStatistics(baseline);
  const entries = [
    ["averageMs", summary.averageMs, baseline.averageMs, false],
    ["p95Ms", currentStats.p95Ms, baselineStats.p95Ms, false],
    ["throughputPerSecond", currentStats.throughputPerSecond, baselineStats.throughputPerSecond, true],
    ["errorRate", currentStats.errorRate, baselineStats.errorRate, false],
  ] as const;
  return entries.map(([metric, current, previous, higherIsBetter]) => {
    const difference = current - previous;
    return {
      metric,
      baseline: previous,
      current,
      difference,
      percentChange: previous === 0 ? (difference === 0 ? 0 : null) : difference / previous * 100,
      direction: difference === 0 ? "unchanged"
        : (higherIsBetter ? difference > 0 : difference < 0) ? "improved" : "regressed",
    };
  });
}

function retainedSamples(summary: URLPerformanceSummary): URLPerformanceSample[] {
  return summary.samples.slice(-urlPerformanceLimits.retainedSampleDetails);
}

/** Aggregate metrics cover the run; exported details intentionally stay bounded. */
export function performanceSnapshot(
  summary: URLPerformanceSummary,
  options: PerformanceAnalysisOptions,
  metadata: PerformanceReportMetadata = {},
) {
  const samples = retainedSamples(summary);
  return {
    schemaVersion: 1,
    ...(metadata.url === undefined ? {} : { url: metadata.url }),
    ...(metadata.startedAt === undefined ? {} : { startedAt: metadata.startedAt }),
    targets: { p95TargetMs: options.p95TargetMs, errorBudgetPercent: options.errorBudgetPercent },
    targetChecks: evaluatePerformanceTargets(summary, options),
    metrics: {
      completedSamples: summary.completedSamples,
      successfulSamples: summary.successfulSamples,
      failedSamples: summary.failedSamples,
      fastestMs: summary.fastestMs,
      averageMs: summary.averageMs,
      slowestMs: summary.slowestMs,
      elapsedTimeMs: summary.elapsedTimeMs ?? summary.totalDurationMs,
      elapsedTimeSource: summary.elapsedTimeMs === undefined ? "sum-of-request-durations" : "wall-clock",
      totalDurationMs: summary.totalDurationMs,
      totalDNSDurationMs: summary.totalDNSDurationMs,
      totalRequestDurationMs: summary.totalRequestDurationMs,
      redirectedSamples: summary.redirectedSamples,
      fallbackSamples: summary.fallbackSamples,
      ...urlPerformanceStatistics(summary),
      statusCounts: { ...summary.statusCounts },
    },
    apdex: { ...calculateApdex(samples, options.p95TargetMs), scope: "retained-samples" },
    histogram: {
      scope: "retained-percentile-samples",
      sampleCount: summary.durationValuesMs.length,
      buckets: latencyHistogram(summary.durationValuesMs),
    },
    sampleDetails: {
      scope: "latest-retained-samples",
      count: samples.length,
      totalSamples: summary.completedSamples,
      truncated: samples.length < summary.completedSamples,
      limit: urlPerformanceLimits.retainedSampleDetails,
    },
    samples: samples.map((sample) => ({
      number: sample.number,
      statusCode: sample.statusCode,
      durationMs: sample.durationMs,
      dnsDurationMs: sample.dnsDurationMs,
      requestDurationMs: sample.requestDurationMs,
      redirectCount: sample.redirectCount,
      method: sample.method,
      usedGetFallback: sample.usedGetFallback,
      success: sample.success,
      error: sample.error ?? null,
      failureCategory: sample.failureCategory ?? null,
      finalURL: sample.finalURL,
    })),
  };
}

export function performanceExportJSON(
  summary: URLPerformanceSummary,
  options: PerformanceAnalysisOptions,
  metadata: PerformanceReportMetadata = {},
): string {
  return JSON.stringify(performanceSnapshot(summary, options, metadata), null, 2);
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  // Quotes alone do not prevent spreadsheet formula execution. Guard text cells,
  // including formulas preceded by spaces, tabs, or control characters.
  const safe = typeof value === "string" && (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))
    ? `'${text}` : text;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function performanceExportCSV(summary: URLPerformanceSummary): string {
  const samples = retainedSamples(summary);
  const rows: (string | number | boolean)[][] = [[
    "sample_scope", "retained_samples", "total_samples", "sample", "status_code",
    "duration_ms", "dns_ms", "request_ms", "redirects", "method", "get_fallback",
    "success", "failure_category", "error", "final_url",
  ]];
  for (const sample of samples) rows.push([
    "latest-retained-samples", samples.length, summary.completedSamples,
    sample.number, sample.statusCode, sample.durationMs, sample.dnsDurationMs,
    sample.requestDurationMs, sample.redirectCount, sample.method,
    sample.usedGetFallback, sample.success, sample.failureCategory ?? "",
    sample.error ?? "", sample.finalURL,
  ]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function performanceSummaryText(
  summary: URLPerformanceSummary,
  options: PerformanceAnalysisOptions,
  metadata: PerformanceReportMetadata = {},
): string {
  const statistics = urlPerformanceStatistics(summary);
  const checks = evaluatePerformanceTargets(summary, options);
  const apdex = calculateApdex(retainedSamples(summary), options.p95TargetMs);
  return [
    "Validex Performance Report",
    ...(metadata.url ? [`URL: ${metadata.url}`] : []),
    ...(metadata.startedAt ? [`Started: ${metadata.startedAt}`] : []),
    `Requests: ${summary.completedSamples} (${summary.successfulSamples} successful, ${summary.failedSamples} failed)`,
    `Average: ${summary.averageMs.toFixed(2)} ms | P95: ${statistics.p95Ms.toFixed(2)} ms | P99: ${statistics.p99Ms.toFixed(2)} ms`,
    `Throughput: ${statistics.throughputPerSecond.toFixed(2)} req/s | Error rate: ${statistics.errorRate.toFixed(2)}%`,
    `P95 target <= ${options.p95TargetMs} ms: ${checks.p95Passed ? "PASS" : "FAIL"}`,
    `Error budget <= ${options.errorBudgetPercent}%: ${checks.errorBudgetPassed ? "PASS" : "FAIL"}`,
    `Apdex: ${apdex.score === null ? "N/A" : apdex.score.toFixed(3)} (T=${options.p95TargetMs} ms; latest ${apdex.sampleCount}/${summary.completedSamples} samples)`,
    `Percentiles: ${statistics.percentileSampleCount}/${summary.completedSamples} retained samples`,
  ].join("\n");
}
