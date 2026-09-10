import { html, type TrustedHTMLFragment } from "../../core/dom.js";
import { t } from "../../i18n/locale.js";
import type { TranslationKey } from "../../i18n/messages.js";
import { performancePresets, type PerformanceOptions } from "../../features/performance/model.js";

export const performanceOptionLabels: Record<keyof PerformanceOptions, TranslationKey> = {
  concurrency: "performance.controls.concurrency",
  warmupSamples: "performance.controls.warmupSamples",
  rampUpMs: "performance.controls.rampUpMs",
  delayMs: "performance.controls.delayMs",
  expectedStatus: "performance.controls.expectedStatus",
  p95TargetMs: "performance.controls.p95TargetMs",
  errorBudgetPercent: "performance.controls.errorBudgetPercent",
};

export function performanceControls(
  options: PerformanceOptions,
  profile: string,
  sampleCount: number,
  running: boolean,
): TrustedHTMLFragment {
  const fields: { key: keyof PerformanceOptions; min: number; max: number; step?: number }[] = [
    { key: "concurrency", min: 1, max: 16 },
    { key: "warmupSamples", min: 0, max: 50 },
    { key: "rampUpMs", min: 0, max: 60_000 },
    { key: "delayMs", min: 0, max: 60_000 },
    { key: "p95TargetMs", min: 1, max: 600_000 },
    { key: "errorBudgetPercent", min: 0, max: 100, step: 0.1 },
  ];
  return html`
    <div class="performance-profile-bar">
      <span>${t("performance.controls.profiles")}</span>
      <div role="group" aria-label="${t("performance.controls.profiles")}">
        ${performancePresets.map((preset) => html`
          <button type="button" class="button button-secondary button-sm"
            data-diagnostics-action="performance-profile" data-performance-profile="${preset.id}"
            aria-pressed="${String(profile === preset.id)}" ${running ? html`disabled` : null}
          >${t(`performance.controls.${preset.id}`)}</button>
        `)}
      </div>
      <small>${profile === "custom" ? `${t("performance.controls.custom")} · ` : ""}${t("performance.controls.plan", {
        samples: sampleCount, concurrency: options.concurrency, warmup: options.warmupSamples,
      })}</small>
    </div>
    <fieldset class="performance-load-settings" ${running ? html`disabled` : null}>
      <legend>${t("performance.controls.advanced")}</legend>
      <div class="performance-config-grid">
        ${fields.map(({ key, min, max, step }) => html`
          <label class="diagnostics-field">
            <span>${t(performanceOptionLabels[key])}</span>
            <input type="number" min="${min}" max="${max}" step="${step ?? 1}"
              value="${options[key]}" data-diagnostics-control="performance-option-${key}" />
          </label>
        `)}
        <label class="diagnostics-field">
          <span>${t("performance.controls.expectedStatus")}</span>
          <input type="number" min="0" max="599" step="1" value="${options.expectedStatus}"
            data-diagnostics-control="performance-option-expectedStatus" aria-describedby="performance-status-help" />
          <small id="performance-status-help">0 = ${t("performance.controls.anySuccess")}</small>
        </label>
      </div>
      <p>${t("performance.controls.help")}</p>
    </fieldset>
  `;
}

export type PerformanceSampleFilter = "all" | "errors" | "slow";
export type PerformanceSampleOrder = "original" | "slowest" | "fastest";

export function performanceSampleControls(
  filter: PerformanceSampleFilter,
  order: PerformanceSampleOrder,
): TrustedHTMLFragment {
  return html`<div class="performance-sample-controls">
    <label class="diagnostics-field">${t("performance.controls.filter")}
      <select data-diagnostics-control="performance-filter">
        ${(["all", "errors", "slow"] as const).map((value) => html`
          <option value="${value}" ${filter === value ? html`selected` : null}>${t(`performance.controls.${value}`)}</option>
        `)}
      </select>
    </label>
    <label class="diagnostics-field">${t("performance.controls.order")}
      <select data-diagnostics-control="performance-order">
        ${(["original", "slowest", "fastest"] as const).map((value) => html`
          <option value="${value}" ${order === value ? html`selected` : null}>${t(`performance.controls.${value}`)}</option>
        `)}
      </select>
    </label>
  </div>`;
}
