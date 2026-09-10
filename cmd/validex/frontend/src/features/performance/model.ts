export interface PerformanceOptions {
  concurrency: number;
  warmupSamples: number;
  rampUpMs: number;
  delayMs: number;
  expectedStatus: number;
  p95TargetMs: number;
  errorBudgetPercent: number;
}

export const defaultPerformanceOptions: Readonly<PerformanceOptions> = {
  concurrency: 1,
  warmupSamples: 0,
  rampUpMs: 0,
  delayMs: 0,
  expectedStatus: 0,
  p95TargetMs: 500,
  errorBudgetPercent: 1,
};

export interface PerformancePreset {
  id: "quick" | "baseline" | "load" | "soak";
  sampleCount: number;
  timeoutMs: number;
  options: Readonly<PerformanceOptions>;
}

export const performancePresets: readonly PerformancePreset[] = [
  {
    id: "quick",
    sampleCount: 5,
    timeoutMs: 10_000,
    options: { ...defaultPerformanceOptions },
  },
  {
    id: "baseline",
    sampleCount: 25,
    timeoutMs: 10_000,
    options: {
      ...defaultPerformanceOptions,
      warmupSamples: 3,
      delayMs: 100,
    },
  },
  {
    id: "load",
    sampleCount: 100,
    timeoutMs: 10_000,
    options: {
      ...defaultPerformanceOptions,
      concurrency: 5,
      warmupSamples: 5,
      rampUpMs: 2_000,
    },
  },
  {
    id: "soak",
    sampleCount: 300,
    timeoutMs: 10_000,
    options: {
      ...defaultPerformanceOptions,
      concurrency: 2,
      warmupSamples: 5,
      rampUpMs: 1_000,
      delayMs: 1_000,
    },
  },
];

export interface PerformanceOptionIssue {
  field: keyof PerformanceOptions;
  min: number;
  max: number;
  integer: boolean;
}

export function validatePerformanceOptions(
  options: PerformanceOptions,
): PerformanceOptionIssue | null {
  const limits: PerformanceOptionIssue[] = [
    { field: "concurrency", min: 1, max: 16, integer: true },
    { field: "warmupSamples", min: 0, max: 50, integer: true },
    { field: "rampUpMs", min: 0, max: 60_000, integer: true },
    { field: "delayMs", min: 0, max: 60_000, integer: true },
    { field: "expectedStatus", min: 100, max: 599, integer: true },
    { field: "p95TargetMs", min: 1, max: 600_000, integer: false },
    { field: "errorBudgetPercent", min: 0, max: 100, integer: false },
  ];
  for (const limit of limits) {
    const value = options[limit.field];
    if (limit.field === "expectedStatus" && value === 0) continue;
    if (
      !Number.isFinite(value) ||
      (limit.integer && !Number.isSafeInteger(value)) ||
      value < limit.min ||
      value > limit.max
    ) {
      return limit;
    }
  }
  return null;
}
