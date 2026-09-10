import assert from "node:assert/strict";
import test from "node:test";

import {
  appendURLPerformanceReport,
} from "../.typescript-build/esm/features/diagnostics/model.js";
import {
  calculateApdex,
  comparePerformance,
  evaluatePerformanceTargets,
  latencyHistogram,
  performanceExportCSV,
  performanceExportJSON,
  performanceSnapshot,
  performanceSummaryText,
} from "../.typescript-build/esm/features/performance/analysis.js";
import {
  performanceInsights,
  renderPerformanceHistory,
} from "../.typescript-build/esm/native/features/performance-insights.js";

const options = { p95TargetMs: 400, errorBudgetPercent: 25 };

function report(durationMs, status = 200, finalURL = "https://example.test/ping") {
  return {
    inputUrl: finalURL,
    finalUrl: finalURL,
    totalDurationMs: durationMs,
    finalStatusCode: status,
    usedGetFallback: false,
    dnsLookups: [{ durationMs: 2 }],
    hops: [{ durationMs, statusCode: status, method: "HEAD" }],
  };
}

function summary(durations, failedIndices = []) {
  return durations.reduce((result, duration, index) =>
    appendURLPerformanceReport(result, report(duration, failedIndices.includes(index) ? 503 : 200)), undefined);
}

test("latency histogram counts boundary values once and ignores invalid durations", () => {
  const buckets = latencyHistogram([0, 10, 20, 30, 40, NaN, Infinity, -5], 4);
  assert.deepEqual(buckets.map((bucket) => bucket.count), [1, 1, 1, 2]);
  assert.deepEqual(buckets.map((bucket) => bucket.lowerMs), [0, 10, 20, 30]);
  assert.deepEqual(buckets.map((bucket) => bucket.includesUpperBound), [false, false, false, true]);
  assert.equal(buckets.reduce((total, bucket) => total + bucket.percentage, 0), 100);
  assert.deepEqual(latencyHistogram([5, 5, 5]), [
    { lowerMs: 5, upperMs: 5, count: 3, percentage: 100, includesUpperBound: true },
  ]);
  assert.deepEqual(latencyHistogram([]), []);
  assert.equal(latencyHistogram([0, 1], 0).length, 1);
  assert.equal(latencyHistogram([0, 1], 99).length, 20);
});

test("Apdex uses inclusive T and 4T boundaries while fast failures remain frustrated", () => {
  const run = summary([10, 100, 400, 401], [0]);
  assert.deepEqual(calculateApdex(run.samples, 100), {
    score: 0.375,
    satisfied: 1,
    tolerating: 1,
    frustrated: 2,
    sampleCount: 4,
    targetMs: 100,
  });
  assert.equal(calculateApdex([], 100).score, null);
  assert.equal(calculateApdex(summary([0]).samples, 0).score, 1);
});

test("targets evaluate measured P95 and whole-run error rate at exact boundaries", () => {
  const run = summary([100, 200, 300, 400], [3]);
  assert.deepEqual(evaluatePerformanceTargets(run, { p95TargetMs: 385, errorBudgetPercent: 25 }), {
    hasSamples: true, p95Passed: true, errorBudgetPassed: true, passed: true,
  });
  assert.deepEqual(evaluatePerformanceTargets(run, { p95TargetMs: 384, errorBudgetPercent: 24.9 }), {
    hasSamples: true, p95Passed: false, errorBudgetPassed: false, passed: false,
  });
  const empty = { ...run, completedSamples: 0, durationValuesMs: [], samples: [], failedSamples: 0 };
  assert.equal(evaluatePerformanceTargets(empty, options).passed, false);
});

test("baseline comparison uses wall-clock throughput and correct improvement direction", () => {
  const baseline = { ...summary([100, 100, 100, 100], [3]), elapsedTimeMs: 1_000 };
  const current = { ...summary([50, 50, 50, 50]), elapsedTimeMs: 500 };
  const comparisons = comparePerformance(current, baseline);
  assert.deepEqual(comparisons.map((metric) => [metric.metric, metric.percentChange, metric.direction]), [
    ["averageMs", -50, "improved"],
    ["p95Ms", -50, "improved"],
    ["throughputPerSecond", 100, "improved"],
    ["errorRate", -100, "improved"],
  ]);
  assert.equal(comparisons.find((metric) => metric.metric === "errorRate").difference, -25);
  assert.ok(comparePerformance(baseline, current).every((metric) => metric.direction === "regressed"));
});

test("baseline zero handling never invents an infinite or 100% relative change", () => {
  const zero = summary([0]);
  const current = summary([100], [0]);
  assert.ok(comparePerformance(current, zero).every((metric) => metric.percentChange === null));
  assert.ok(comparePerformance(zero, zero).every((metric) => metric.percentChange === 0 && metric.direction === "unchanged"));
});

test("exports disclose bounded details while preserving whole-run metrics and percentile scope", () => {
  const run = summary(Array.from({ length: 300 }, (_, index) => index + 1));
  const snapshot = performanceSnapshot(run, options, { url: "https://example.test/ping", startedAt: "2026-09-11T10:00:00Z" });
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.metrics.completedSamples, 300);
  assert.equal(snapshot.metrics.elapsedTimeSource, "sum-of-request-durations");
  assert.equal(snapshot.samples.length, 250);
  assert.equal(snapshot.samples[0].number, 51);
  assert.deepEqual(snapshot.sampleDetails, {
    scope: "latest-retained-samples", count: 250, totalSamples: 300, truncated: true, limit: 250,
  });
  assert.equal(snapshot.apdex.sampleCount, 250);
  assert.equal(snapshot.histogram.sampleCount, 300);
  assert.equal(snapshot.histogram.buckets.reduce((total, bucket) => total + bucket.count, 0), 300);
  assert.equal("durationM2" in snapshot, false);
  assert.equal("durationValuesMs" in snapshot, false);
  const csv = performanceExportCSV(run).trimEnd().split("\r\n");
  assert.equal(csv.length, 251);
  assert.match(csv[1], /^latest-retained-samples,250,300,51,/u);
  assert.equal(JSON.parse(performanceExportJSON(run, options)).metrics.completedSamples, 300);
  assert.match(performanceSummaryText(run, options), /latest 250\/300 samples/u);
  assert.match(performanceSummaryText(run, options), /Percentiles: 300\/300 retained samples/u);
});

test("CSV quotes separators and line breaks and neutralizes untrusted spreadsheet formulas", () => {
  let run = appendURLPerformanceReport(undefined, report(10, 500, '=HYPERLINK("https://bad.test","open")'),
    '  =SUM(1,2)\n"failure"', "@malicious");
  run = appendURLPerformanceReport(run, report(20, 500, "https://example.test/?q=a,b"), "\t+SUM(1,1)");
  const csv = performanceExportCSV(run);
  assert.ok(csv.includes(`'@malicious`));
  assert.ok(csv.includes(`"'  =SUM(1,2)\n""failure"""`));
  assert.ok(csv.includes(`"'=HYPERLINK(""https://bad.test"",""open"")"`));
  assert.ok(csv.includes(`"'\t+SUM(1,1)"`));
  assert.ok(csv.includes('"https://example.test/?q=a,b"'));
  assert.ok(csv.endsWith("\r\n"));
});

test("reports keep chart descriptions accessible and escape history URLs and identifiers", () => {
  const run = summary([100, 400], [1]);
  const output = performanceInsights(run, options, null).value;
  assert.match(output, /role="img"/u);
  assert.match(output, /<desc id="performance-latency-chart-description">/u);
  assert.match(output, /class="performance-chart-failure"/u);
  assert.match(output, /data-performance-target="error-rate" data-passed="false"/u);
  const history = renderPerformanceHistory([{
    id: '\" onclick="alert(1)', startedAt: "invalid date", url: '<script>alert("unsafe")</script>', summary: run,
  }]).value;
  assert.ok(!history.includes("<script>"));
  assert.ok(!history.includes('data-performance-history="" onclick='));
  assert.ok(history.includes("&lt;script&gt;"));
  assert.equal(renderPerformanceHistory([]).value, "");
});
