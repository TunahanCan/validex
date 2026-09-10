import { html, type TrustedHTMLFragment } from "../../core/dom.js";
import { icon, type IconName } from "../../core/icons.js";
import {
  formatURLPerformanceDuration,
  urlPerformanceLimits,
  urlPerformanceStatistics,
  type URLPerformanceSummary,
} from "../../features/diagnostics/model.js";
import {
  calculateApdex,
  comparePerformance,
  evaluatePerformanceTargets,
  latencyHistogram,
  type PerformanceAnalysisOptions,
  type PerformanceMetricComparison,
  type PerformanceRunRecord,
} from "../../features/performance/analysis.js";
import { getLocale, t } from "../../i18n/locale.js";
import type { TranslationKey } from "../../i18n/messages.js";

function action(actionName: string, label: TranslationKey, name: IconName): TrustedHTMLFragment {
  return html`<button type="button" class="button button-secondary button-sm"
    data-diagnostics-action="${actionName}">${icon(name, 14)}${t(label)}</button>`;
}

function number(value: number, digits = 1): string {
  return value.toLocaleString(getLocale(), { maximumFractionDigits: digits });
}

function duration(value: number): string {
  return formatURLPerformanceDuration(value, getLocale());
}

function timeline(summary: URLPerformanceSummary): TrustedHTMLFragment {
  const samples = summary.samples.slice(-urlPerformanceLimits.retainedSampleDetails);
  if (!samples.length) return html`<p>${t("performance.insights.noData")}</p>`;
  const minimum = Math.min(...samples.map((sample) => sample.durationMs));
  const maximum = Math.max(...samples.map((sample) => sample.durationMs));
  const points = samples.map((sample, index) => ({
    sample,
    x: samples.length === 1 ? 300 : 8 + index / (samples.length - 1) * 584,
    y: 138 - sample.durationMs / Math.max(1, maximum) * 124,
  }));
  const path = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  return html`
    <div class="performance-chart-extents"><span>${t("performance.insights.minimum", { value: duration(minimum) })}</span><span>${t("performance.insights.maximum", { value: duration(maximum) })}</span></div>
    <svg class="performance-latency-chart" viewBox="0 0 600 150" role="img"
      aria-labelledby="performance-latency-chart-title performance-latency-chart-description">
      <title id="performance-latency-chart-title">${t("performance.insights.timeline")}</title>
      <desc id="performance-latency-chart-description">${t("performance.insights.timelineAccessible", {
        count: samples.length, minimum: duration(minimum), maximum: duration(maximum),
      })}</desc>
      <path class="performance-chart-grid" d="M8 14H592 M8 76H592 M8 138H592" />
      <polygon class="performance-chart-area" points="${points[0].x},138 ${path} ${points.at(-1)!.x},138" />
      <polyline class="performance-chart-line" points="${path}" />
      ${points.map(({ sample, x, y }) => html`
        <g class="${sample.success ? "performance-chart-point" : "performance-chart-failure"}">
          <title>${t("performance.insights.sampleDuration", { number: sample.number, duration: duration(sample.durationMs),
            status: t(sample.success ? "performance.insights.success" : "performance.insights.requestFailed") })}</title>
          ${sample.success
            ? html`<circle cx="${x}" cy="${y}" r="${samples.length > 80 ? 1.7 : 3}" />`
            : html`<path d="M${x - 3},${y - 3}l6,6m0,-6l-6,6" />`}
        </g>
      `)}
    </svg>
    <div class="performance-chart-extents"><span>${t("performance.insights.sampleNumber", { number: samples[0].number })}</span><span>${t("performance.insights.sampleNumber", { number: samples.at(-1)!.number })}</span></div>
    <div class="performance-chart-legend"><span><i></i>${t("performance.insights.success")}</span><span><b>×</b>${t("performance.insights.requestFailed")}</span></div>
  `;
}

function histogram(summary: URLPerformanceSummary): TrustedHTMLFragment {
  const buckets = latencyHistogram(summary.durationValuesMs);
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return html`<div class="performance-histogram">
    ${buckets.map((bucket) => {
      const range = bucket.lowerMs === bucket.upperMs ? duration(bucket.lowerMs)
        : `${number(bucket.lowerMs)}–${number(bucket.upperMs)} ms`;
      return html`<div class="performance-histogram-row" aria-label="${t("performance.insights.bucket", {
        range, count: bucket.count, percent: number(bucket.percentage),
      })}">
        <span>${range}</span><span class="performance-histogram-track" aria-hidden="true"><i style="width: ${bucket.count / maximum * 100}%"></i></span>
        <strong>${number(bucket.count, 0)} <small>(${number(bucket.percentage)}%)</small></strong>
      </div>`;
    })}
  </div>`;
}

const comparisonLabels: Record<PerformanceMetricComparison["metric"], TranslationKey> = {
  averageMs: "diagnostics.performance.average",
  p95Ms: "diagnostics.performance.p95",
  throughputPerSecond: "diagnostics.performance.throughput",
  errorRate: "diagnostics.performance.errorRate",
};

function comparisonValue(metric: PerformanceMetricComparison["metric"], value: number): string {
  if (metric === "errorRate") return `${number(value, 2)}%`;
  if (metric === "throughputPerSecond") return t("diagnostics.performance.requestsPerSecond", { value: number(value, 2) });
  return duration(value);
}

function comparison(summary: URLPerformanceSummary, baseline: URLPerformanceSummary | null): TrustedHTMLFragment {
  if (!baseline) return html`<p class="performance-baseline-empty">${icon("pin", 22)}${t("performance.insights.baselineEmpty")}</p>`;
  return html`<div class="performance-table-wrap"><table class="performance-comparison">
    <thead><tr><th scope="col">${t("performance.insights.metric")}</th><th scope="col">${t("performance.insights.previous")}</th><th scope="col">${t("performance.insights.current")}</th><th scope="col">${t("performance.insights.change")}</th></tr></thead>
    <tbody>${comparePerformance(summary, baseline).map((metric) => {
      const change = metric.metric === "errorRate"
        ? t("performance.insights.percentagePoints", { value: `${metric.difference > 0 ? "+" : ""}${number(metric.difference, 2)}` })
        : metric.percentChange === null ? t("performance.insights.fromZero")
          : `${metric.percentChange > 0 ? "+" : ""}${number(metric.percentChange, 2)}%`;
      return html`<tr data-performance-comparison="${metric.metric}" data-direction="${metric.direction}">
        <th scope="row">${t(comparisonLabels[metric.metric])}</th><td>${comparisonValue(metric.metric, metric.baseline)}</td><td>${comparisonValue(metric.metric, metric.current)}</td>
        <td><strong class="performance-change is-${metric.direction}">${change}</strong><small>${t(`performance.insights.${metric.direction}`)}</small></td>
      </tr>`;
    })}</tbody>
  </table></div>
  <p class="performance-scope">${t("performance.insights.baselineScope", {
    count: baseline.completedSamples, current: summary.durationValuesMs.length, baseline: baseline.durationValuesMs.length,
  })}</p>`;
}

export function renderPerformanceHistory(history: readonly PerformanceRunRecord[]): TrustedHTMLFragment {
  if (!history.length) return html``;
  return html`<section class="performance-panel performance-history" aria-labelledby="performance-history-title">
    <header><div><h3 id="performance-history-title">${t("performance.insights.history")}</h3><p>${t("performance.insights.historyDescription")}</p></div>${icon("history", 18)}</header>
    <div class="performance-table-wrap"><table>
      <thead><tr><th scope="col">${t("performance.insights.started")}</th><th scope="col">${t("performance.insights.target")}</th><th scope="col">${t("performance.insights.requests")}</th><th scope="col">P95</th><th scope="col">${t("diagnostics.performance.errorRate")}</th><th scope="col"><span class="sr-only">${t("performance.insights.open")}</span></th></tr></thead>
      <tbody>${history.map((record) => {
        const date = new Date(record.startedAt);
        const label = Number.isNaN(date.getTime()) ? record.startedAt : date.toLocaleString(getLocale(), {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
        const stats = urlPerformanceStatistics(record.summary);
        return html`<tr><td><time datetime="${record.startedAt}">${label}</time></td><td class="performance-history-url"><code title="${record.url}">${record.url}</code></td>
          <td>${number(record.summary.completedSamples, 0)}</td><td>${duration(stats.p95Ms)}</td><td>${number(stats.errorRate, 2)}%</td>
          <td><button type="button" class="button button-secondary button-sm" data-performance-history="${record.id}" aria-label="${t("performance.insights.openRun", { date: label })}">${t("performance.insights.open")}</button></td></tr>`;
      })}</tbody>
    </table></div>
  </section>`;
}

export function performanceInsights(
  summary: URLPerformanceSummary,
  options: PerformanceAnalysisOptions,
  baseline: URLPerformanceSummary | null,
  _history: readonly PerformanceRunRecord[] = [],
): TrustedHTMLFragment {
  const stats = urlPerformanceStatistics(summary);
  const checks = evaluatePerformanceTargets(summary, options);
  const samples = summary.samples.slice(-urlPerformanceLimits.retainedSampleDetails);
  const apdex = calculateApdex(samples, options.p95TargetMs);
  const targets = [
    { key: "p95", label: "performance.insights.p95Target", value: duration(stats.p95Ms), target: duration(options.p95TargetMs), passed: checks.p95Passed },
    { key: "error-rate", label: "performance.insights.errorTarget", value: `${number(stats.errorRate, 2)}%`, target: `${number(options.errorBudgetPercent, 2)}%`, passed: checks.errorBudgetPassed },
  ] as const;
  return html`<section class="performance-insights" aria-labelledby="performance-insights-title">
    <header class="performance-insights-header"><div><h2 id="performance-insights-title">${t("performance.insights.title")}</h2><p>${t("performance.insights.description")}</p></div>
      <div class="performance-report-actions">${action("performance-copy-summary", "performance.insights.copySummary", "copy")}${action("performance-export-json", "performance.insights.exportJSON", "download")}${action("performance-export-csv", "performance.insights.exportCSV", "download")}</div>
    </header>
    <p class="performance-scope">${t("performance.insights.exportScope", { shown: samples.length, total: summary.completedSamples })}</p>
    <div class="performance-insights-grid">
      <section class="performance-panel" aria-labelledby="performance-target-title"><header><h3 id="performance-target-title">${t("performance.insights.targets")}</h3>${icon(checks.passed ? "check" : "activity", 18)}</header>
        <div class="performance-targets">${targets.map((target) => html`
          <div class="performance-target-check" data-performance-target="${target.key}" data-passed="${String(target.passed)}">
            <div><span>${t(target.label)}</span><strong>${target.value}</strong><small>${t("performance.insights.threshold", { value: target.target })}</small></div>
            <span class="performance-check-badge ${target.passed ? "is-passed" : "is-failed"}">${icon(target.passed ? "check" : "warning", 13)}${t(!checks.hasSamples ? "performance.insights.pending" : target.passed ? "performance.insights.passed" : "performance.insights.failed")}</span>
          </div>`)}
        </div><p class="performance-scope">${t("performance.insights.targetScope", { count: stats.percentileSampleCount, total: summary.completedSamples })}</p>
      </section>
      <section class="performance-panel" aria-labelledby="performance-apdex-title"><header><h3 id="performance-apdex-title">${t("performance.insights.apdex")}</h3><strong class="performance-apdex-score">${apdex.score === null ? "—" : number(apdex.score, 3)}<small> / 1</small></strong></header>
        <div class="performance-apdex-bar" aria-hidden="true">${(["satisfied", "tolerating", "frustrated"] as const).map((key) => html`<i class="is-${key}" style="width: ${apdex.sampleCount ? apdex[key] / apdex.sampleCount * 100 : 0}%"></i>`)}</div>
        <div class="performance-apdex-legend">${(["satisfied", "tolerating", "frustrated"] as const).map((key) => html`<span><i class="is-${key}"></i>${t(`performance.insights.${key}`)}<strong>${number(apdex[key], 0)}</strong></span>`)}</div>
        <p class="performance-scope">${t("performance.insights.apdexDefinition")}</p><p class="performance-scope">${t("performance.insights.apdexScope", { target: duration(options.p95TargetMs), shown: apdex.sampleCount, total: summary.completedSamples })}</p>
      </section>
      <section class="performance-panel" aria-labelledby="performance-timeline-title"><header><div><h3 id="performance-timeline-title">${t("performance.insights.timeline")}</h3><p>${t("performance.insights.timelineScope", { shown: samples.length, total: summary.completedSamples })}</p></div></header>${timeline(summary)}</section>
      <section class="performance-panel" aria-labelledby="performance-distribution-title"><header><div><h3 id="performance-distribution-title">${t("performance.insights.distribution")}</h3><p>${t("performance.insights.distributionScope", { shown: summary.durationValuesMs.length, total: summary.completedSamples })}</p></div></header>${histogram(summary)}</section>
    </div>
    <section class="performance-panel" aria-labelledby="performance-baseline-title"><header><div><h3 id="performance-baseline-title">${t("performance.insights.baseline")}</h3><p>${t("performance.insights.baselineDescription")}</p></div><div class="performance-report-actions">${action("performance-baseline", "performance.insights.saveBaseline", "pin")}${baseline ? action("performance-clear-baseline", "performance.insights.clearBaseline", "close") : ""}</div></header>${comparison(summary, baseline)}</section>
  </section>`;
}
