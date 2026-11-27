/**
 * Section 14's P6-H1 ceilings (phase 6 specification, section 14; #1062, #1125), enforced only in
 * `loam.yml`'s `Hosted development profile` job (`CI=true`), the place section 14 measures.
 *
 * - Cold start: the median of `COLD_STARTS` (5) `loam-host dev` cold starts, each from its own empty
 *   directory. Set on 2026-11-22 (#1125) from the 20 most recent `main` runs of `Hosted development
 *   profile` (2026-11-21 to 2026-11-22, runs `44945132562` to `45000027021`): 95th percentile 324 ms
 *   (19th of 20), plus 25%, rounded up = 405 ms (replacing the interim 750 ms from #1062).
 * - Resident memory: three `ubuntu-latest` samples of 93 MB, plus 25%, approved by the coordinator
 *   2026-11-10 (recent 20 `main` runs measure 95 to 97 MB).
 */

/** The 20 `main` `Hosted development profile` cold-start medians (ms), newest first (2026-11-22 to 2026-11-21). */
export const P6_H1_MAIN_MEDIANS_MS = [
	233, 230, 274, 300, 203, 299, 264, 189, 324, 248, 297, 332, 298, 184, 229, 237, 186, 201, 292,
	203,
] as const;

/** Nearest-rank 95th percentile plus 25%, rounded up (section 14); shared with first paint's ceiling, outside the lane. */
export { p95CeilingMs } from '../p95-ceiling';

/** Section 14's CI ceilings for P6-H1 (`CI=true`). */
export const SECTION_14_CEILINGS = { coldStartMs: 405, residentMb: 117 } as const;

/** Cold starts per run, each from its own empty directory; their median is section 14's sample (#1062). */
export const COLD_STARTS = 5;

/** Elsewhere, a developer's machine under any load: resident memory stays asserted; cold start warns above this bound (#2760). */
export const LOCAL_BOUNDS = { coldStartMs: 3_000, residentMb: 300 } as const;

/** Why a cold-start run off CI warns past `LOCAL_BOUNDS.coldStartMs` rather than failing (mirrors `first-paint-budget.ts`, #2760). */
export const COLD_START_LOCAL_NOTE =
	"warned, not failed: off CI a developer's machine under concurrent build load is not the CI runner section 14's ceiling was set on";

/** Whether this run asserts section 14's strict ceilings: the CI runner the samples came from. */
export const assertsSection14Ceilings = (
	env: Record<string, string | undefined> = process.env
): boolean => env.CI === 'true';
