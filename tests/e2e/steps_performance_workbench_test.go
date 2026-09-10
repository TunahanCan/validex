package e2e

import (
	"fmt"
	"time"

	"github.com/chromedp/chromedp"
	"github.com/cucumber/godog"
)

func registerPerformanceWorkbenchSteps(context *godog.ScenarioContext, world *browserWorld) {
	context.Step(`^I select every performance workload preset$`, world.performanceSelectPresets)
	context.Step(`^each preset configures its documented workload without sending requests$`, world.performancePresetsAreConfigured)
	context.Step(`^a controlled concurrent performance run with one warmup request$`, world.performanceConfigureConcurrentRun)
	context.Step(`^I start the controlled performance run$`, world.performanceStartControlledRun)
	context.Step(`^warmup is shown before two measured requests run concurrently$`, world.performanceWarmupPrecedesMeasuredRun)
	context.Step(`^the first measured performance response arrives$`, world.performanceResolveFirstMeasuredResponse)
	context.Step(`^live results contain only the completed measured response$`, world.performanceLiveMeasuredResultIsShown)
	context.Step(`^the remaining measured performance responses arrive$`, world.performanceResolveRemainingResponses)
	context.Step(`^the completed benchmark excludes warmup and flags unexpected status and target failures$`, world.performanceMeasuredRunIsCorrect)
	context.Step(`^sample filters and ordering preserve the aggregate benchmark$`, world.performanceFiltersPreserveAggregate)
	context.Step(`^a completed performance baseline with two successful samples$`, world.performanceCompleteBaseline)
	context.Step(`^I retain that performance run as a baseline and run a slower benchmark$`, world.performanceRunSlowerComparison)
	context.Step(`^the comparison marks latency regression and retains both runs$`, world.performanceComparisonIsRetained)
	context.Step(`^I copy and export the latest performance report$`, world.performanceCopyAndExportReport)
	context.Step(`^the copied summary and JSON and CSV reports describe the same measured run$`, world.performanceReportsMatchRun)
	context.Step(`^I restore the earlier performance run from history$`, world.performanceRestoreEarlierRun)
	context.Step(`^the earlier samples return without additional network requests$`, world.performanceHistoryDoesNotRunRequests)
	context.Step(`^the retained performance baseline can be cleared$`, world.performanceClearRetainedBaseline)
}

func (w *browserWorld) performanceWait(expression, description string) error {
	if err := w.run(chromedp.Poll(expression, nil,
		chromedp.WithPollingInterval(25*time.Millisecond),
		chromedp.WithPollingTimeout(5*time.Second),
	)); err != nil {
		return fmt.Errorf("%s: %w", description, err)
	}
	return nil
}

func (w *browserWorld) performanceSet(control, value string) error {
	return w.diagnosticsSetControl(`[data-diagnostics-control="`+control+`"]`, value)
}

func (w *browserWorld) performanceClick(action string) error {
	return w.run(chromedp.Click(`[data-diagnostics-action="`+action+`"]`, chromedp.ByQuery))
}

func (w *browserWorld) performanceSelectPresets() error {
	return w.run(
		chromedp.WaitVisible(`[data-performance-profile="quick"]`, chromedp.ByQuery),
		chromedp.Evaluate(`(() => {
		globalThis.__performancePresetSnapshots = [];
		for (const id of ["quick", "baseline", "load", "soak"]) {
			document.querySelector('[data-performance-profile="' + id + '"]').click();
			const read = (name) => Number(document.querySelector('[data-diagnostics-control="' + name + '"]')?.value);
			globalThis.__performancePresetSnapshots.push({
				id,
				selected: document.querySelector('[data-performance-profile="' + id + '"]')?.getAttribute("aria-pressed"),
				samples: read("performance-samples"), timeout: read("performance-timeout"),
				concurrency: read("performance-option-concurrency"),
				warmup: read("performance-option-warmupSamples"),
				ramp: read("performance-option-rampUpMs"), delay: read("performance-option-delayMs")
			});
		}
	})()`, nil))
}

func (w *browserWorld) performancePresetsAreConfigured() error {
	return w.performanceWait(`(() => {
		const snapshots = globalThis.__performancePresetSnapshots;
		const expected = [["quick",5,1,0,0,0],["baseline",25,1,3,0,100],["load",100,5,5,2000,0],["soak",300,2,5,1000,1000]];
		return snapshots.length === 4 && expected.every(([id,samples,concurrency,warmup,ramp,delay], index) => {
			const actual = snapshots[index];
			return actual.id === id && actual.selected === "true" && actual.timeout === 10000 &&
				actual.samples === samples && actual.concurrency === concurrency && actual.warmup === warmup &&
				actual.ramp === ramp && actual.delay === delay;
		}) && !globalThis.__VALIDEX_E2E__.calls.some((call) => call.method === "AnalyzeNetwork");
	})()`, "preset configuration and request isolation")
}

func (w *browserWorld) performanceConfigureConcurrentRun() error {
	for _, field := range [][2]string{
		{"performance-url", diagnosticsPerformanceURL}, {"performance-samples", "3"},
		{"performance-option-concurrency", "2"}, {"performance-option-warmupSamples", "1"},
		{"performance-option-expectedStatus", "200"}, {"performance-option-p95TargetMs", "15"},
		{"performance-option-errorBudgetPercent", "0"},
	} {
		if err := w.performanceSet(field[0], field[1]); err != nil {
			return err
		}
	}
	return w.run(chromedp.Evaluate(`globalThis.__VALIDEX_E2E__.defer("AnalyzeNetwork")`, nil))
}

func (w *browserWorld) performanceStartControlledRun() error {
	return w.performanceClick("performance-run")
}

func (w *browserWorld) performanceWarmupPrecedesMeasuredRun() error {
	if err := w.performanceWait(`(() => {
		const bridge = globalThis.__VALIDEX_E2E__;
		return bridge.pendingCount("AnalyzeNetwork") === 1 &&
			bridge.calls.filter((call) => call.method === "AnalyzeNetwork").length === 1 &&
			document.querySelector("[data-performance-progress]")?.value === 0 &&
			document.querySelector("[data-performance-phase]")?.textContent.toLowerCase().includes("warm") &&
			Boolean(document.querySelector("[data-performance-live]"));
	})()`, "warmup progress before measured requests"); err != nil {
		return err
	}
	if err := w.performanceResolveResponse(900, 200, true); err != nil {
		return err
	}
	return w.performanceWait(`globalThis.__VALIDEX_E2E__.pendingCount("AnalyzeNetwork") === 2 &&
		globalThis.__VALIDEX_E2E__.calls.filter((call) => call.method === "AnalyzeNetwork").length === 3 &&
		document.querySelector("[data-performance-progress]")?.value === 0`, "two concurrent measured requests after warmup")
}

func (w *browserWorld) performanceResolveResponse(duration, status int, keepDeferred bool) error {
	return w.run(chromedp.Evaluate(fmt.Sprintf(`(() => {
		const bridge = globalThis.__VALIDEX_E2E__;
		if (!bridge.resolve("AnalyzeNetwork", %s)) throw new Error("No pending performance request");
		if (%t) bridge.defer("AnalyzeNetwork");
	})()`, automationJSON(diagnosticsPerformanceReport(duration, status)), keepDeferred), nil))
}

func (w *browserWorld) performanceResolveFirstMeasuredResponse() error {
	return w.performanceResolveResponse(10, 200, true)
}

func (w *browserWorld) performanceLiveMeasuredResultIsShown() error {
	return w.performanceWait(`(() => {
		const rows = document.querySelectorAll(".diagnostics-performance-samples tbody tr");
		return document.querySelector("#diagnostics-panel-performance")?.getAttribute("aria-busy") === "true" &&
			document.querySelector("[data-performance-progress]")?.value === 1 &&
			globalThis.__VALIDEX_E2E__.pendingCount("AnalyzeNetwork") === 2 && rows.length === 1 &&
			rows[0].querySelector('[data-performance-field="duration"]')?.textContent.includes("10 ms") &&
			document.querySelector(".diagnostics-performance-cards article")?.textContent.includes("10 ms") &&
			!document.querySelector("[data-performance-results]")?.textContent.includes("900 ms");
	})()`, "live measured-only result during concurrent run")
}

func (w *browserWorld) performanceResolveRemainingResponses() error {
	if err := w.performanceResolveResponse(20, 204, true); err != nil {
		return err
	}
	return w.performanceResolveResponse(30, 200, false)
}

func (w *browserWorld) performanceMeasuredRunIsCorrect() error {
	return w.performanceWait(`(() => {
		const rows = [...document.querySelectorAll(".diagnostics-performance-samples tbody tr")];
		return document.querySelector("#diagnostics-panel-performance")?.getAttribute("aria-busy") === "false" &&
			globalThis.__VALIDEX_E2E__.calls.filter((call) => call.method === "AnalyzeNetwork").length === 4 &&
			rows.length === 3 && rows.map((row) => row.querySelector('[data-performance-field="sample"]')?.textContent.trim()).join(",") === "1,2,3" &&
			rows.filter((row) => row.querySelector(".is-error")).length === 1 &&
			rows[1].querySelector(".is-error")?.textContent.includes("204") &&
			document.querySelector(".diagnostics-performance-cards article")?.textContent.includes("20 ms") &&
			document.querySelector('[data-performance-target="p95"]')?.dataset.passed === "false" &&
			document.querySelector('[data-performance-target="error-rate"]')?.dataset.passed === "false" &&
			!document.querySelector("[data-performance-results]")?.textContent.includes("900 ms");
	})()`, "completed counts, expected status, warmup exclusion, and thresholds")
}

func (w *browserWorld) performanceFiltersPreserveAggregate() error {
	if err := w.performanceSet("performance-filter", "errors"); err != nil {
		return err
	}
	if err := w.performanceWait(`document.querySelectorAll(".diagnostics-performance-samples tbody tr").length === 1 &&
		document.querySelector('.diagnostics-performance-samples [data-performance-field="status"]')?.textContent.includes("204")`, "failed sample filter"); err != nil {
		return err
	}
	if err := w.performanceSet("performance-filter", "slow"); err != nil {
		return err
	}
	if err := w.performanceSet("performance-order", "slowest"); err != nil {
		return err
	}
	return w.performanceWait(`document.querySelectorAll(".diagnostics-performance-samples tbody tr").length === 2 &&
		document.querySelector('.diagnostics-performance-samples [data-performance-field="sample"]')?.textContent.trim() === "3" &&
		document.querySelector(".diagnostics-performance-cards article")?.textContent.includes("20 ms")`, "slow sample filtering and ordering without aggregate changes")
}

func (w *browserWorld) performanceCompleteBaseline() error {
	for _, field := range [][2]string{
		{"performance-url", diagnosticsPerformanceURL}, {"performance-samples", "2"},
		{"performance-option-p95TargetMs", "25"}, {"performance-option-errorBudgetPercent", "0"},
	} {
		if err := w.performanceSet(field[0], field[1]); err != nil {
			return err
		}
	}
	if err := w.diagnosticsConfigure(map[string]any{"overrides": map[string]any{"AnalyzeNetwork": []any{
		diagnosticsPerformanceReport(10, 200), diagnosticsPerformanceReport(20, 200),
	}}}); err != nil {
		return err
	}
	if err := w.diagnosticsRunOperation("test URL performance"); err != nil {
		return err
	}
	if err := w.performanceWait(`document.querySelector('[data-performance-target="p95"]')?.dataset.passed === "true" &&
		document.querySelectorAll("[data-performance-history]").length === 1`, "initial run passes latency target and appears in history"); err != nil {
		return err
	}
	return w.run(chromedp.Evaluate(`globalThis.__performanceEarlierRun = document.querySelector("[data-performance-history]").dataset.performanceHistory`, nil))
}

func (w *browserWorld) performanceRunSlowerComparison() error {
	if err := w.performanceClick("performance-baseline"); err != nil {
		return err
	}
	if err := w.diagnosticsConfigure(map[string]any{"overrides": map[string]any{"AnalyzeNetwork": []any{
		diagnosticsPerformanceReport(30, 200), diagnosticsPerformanceReport(40, 200),
	}}}); err != nil {
		return err
	}
	return w.diagnosticsRunOperation("test URL performance")
}

func (w *browserWorld) performanceComparisonIsRetained() error {
	return w.performanceWait(`document.querySelector('[data-performance-comparison="averageMs"]')?.dataset.direction === "regressed" &&
		document.querySelector('[data-performance-comparison="p95Ms"]')?.dataset.direction === "regressed" &&
		document.querySelector('[data-performance-target="p95"]')?.dataset.passed === "false" &&
		document.querySelector('[data-performance-target="error-rate"]')?.dataset.passed === "true" &&
		document.querySelectorAll("[data-performance-history]").length === 2 &&
		Boolean(document.querySelector(".performance-latency-chart")) &&
		document.querySelectorAll(".performance-histogram-row").length > 0`, "baseline comparison, target checks, charts, and history")
}

func (w *browserWorld) performanceCopyAndExportReport() error {
	if err := w.run(chromedp.Evaluate(`(() => {
		globalThis.__performanceExports = [];
		const create = URL.createObjectURL;
		URL.createObjectURL = function(blob) {
			blob.text().then((text) => globalThis.__performanceExports.push({type: blob.type, text}));
			return create.call(URL, blob);
		};
		const click = HTMLAnchorElement.prototype.click;
		HTMLAnchorElement.prototype.click = function() { if (!this.download) click.call(this); };
	})()`, nil)); err != nil {
		return err
	}
	for _, action := range []string{"performance-copy-summary", "performance-export-json", "performance-export-csv"} {
		if err := w.performanceClick(action); err != nil {
			return err
		}
	}
	return nil
}

func (w *browserWorld) performanceReportsMatchRun() error {
	return w.performanceWait(`(() => {
		const exports = globalThis.__performanceExports;
		if (exports.length !== 2) return false;
		const json = exports.find((item) => item.text.trim().startsWith("{"));
		const csv = exports.find((item) => item.text.startsWith("sample_scope,"));
		if (!json || !csv) return false;
		const report = JSON.parse(json.text);
		const summary = globalThis.__VALIDEX_E2E__.clipboard;
		return report.metrics.completedSamples === 2 && report.metrics.averageMs === 35 &&
			report.metrics.failedSamples === 0 && report.targetChecks.p95Passed === false &&
			report.samples.map((sample) => sample.durationMs).join(",") === "30,40" &&
			csv.text.trim().split(/\r?\n/).length === 3 && csv.text.includes(",30,") && csv.text.includes(",40,") &&
			summary.includes("Requests: 2") && summary.includes("Average: 35.00 ms") && summary.includes("P95 target <= 25 ms: FAIL");
	})()`, "copy summary and exported JSON/CSV agree with measured results")
}

func (w *browserWorld) performanceRestoreEarlierRun() error {
	return w.run(chromedp.Evaluate(`(() => {
		const earlier = [...document.querySelectorAll("[data-performance-history]")].find((item) => item.dataset.performanceHistory === globalThis.__performanceEarlierRun);
		if (!earlier) throw new Error("Earlier performance run is missing");
		earlier.click();
	})()`, nil))
}

func (w *browserWorld) performanceHistoryDoesNotRunRequests() error {
	return w.performanceWait(`document.querySelector(".diagnostics-performance-cards article")?.textContent.includes("15 ms") &&
		document.querySelectorAll(".diagnostics-performance-samples tbody tr").length === 2 &&
		globalThis.__VALIDEX_E2E__.calls.filter((call) => call.method === "AnalyzeNetwork").length === 4`, "history restores earlier results without network activity")
}

func (w *browserWorld) performanceClearRetainedBaseline() error {
	if err := w.performanceClick("performance-clear-baseline"); err != nil {
		return err
	}
	return w.performanceWait(`!document.querySelector(".performance-comparison")`, "baseline comparison clears")
}
