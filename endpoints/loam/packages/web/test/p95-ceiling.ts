/**
 * The ceiling rule two budgets share: phase 6's section 14 for P6-H1's cold start (`hosted/budget.ts`) and first
 * contentful paint's (`browser/first-paint-budget.ts`, Loam's D161). Local code, outside the frozen hosted lane
 * (D162), so the local Chromium suite reads it without importing the lane; the lane lists it as an input.
 */

/** Nearest-rank 95th percentile plus 25%, rounded up to whole milliseconds (phase 6 spec, section 14). */
export function p95CeilingMs(samples: readonly number[]): number {
	if (samples.length === 0) throw new Error('at least one sample is required');
	const sorted = [...samples].sort((a, b) => a - b);
	const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] as number;
	return Math.ceil(p95 * 1.25);
}
