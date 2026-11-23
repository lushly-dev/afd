/**
 * First contentful paint's ceiling (Loam's D161, #1929; phase 2 specification, 2.5): the time a person waits for the
 * first frame of hello and tally, under P2-E1's 4x CPU and 8 Mbit/s, 70 ms network. Asserted in `loam.yml`'s
 * `Build, unit and Chromium` job (`CI=true`), the runner the samples come from; elsewhere recorded with its reason.
 *
 * Set on 2026-11-23 from the 20 most recent successful `main` runs of that job (2026-11-23, 00:34 to 06:57 UTC, runs
 * `45089596176` to `45127714416`): 932 to 1,024 ms, 95th percentile 1,020 ms (19th of 20), plus 25%, rounded up,
 * 1,275 ms, the rule section 14 of phase 6 uses for P6-H1's cold start. Ten older runs, back to `45055305707`,
 * read 880 to 1,032 ms. A ceiling raised here is a ceiling raised: `scripts/ceiling-raises.mjs` reads
 * `PAINT_CEILINGS` beside `budget.mjs`'s `CEILINGS`.
 */
import { p95CeilingMs } from '../p95-ceiling';

/** The 20 `main` figures (ms), newest first, from each run's `P2-E1 first-contentful-paint` line. */
export const FCP_MAIN_SAMPLES_MS = [
	1004, 1008, 932, 1008, 1016, 1012, 1012, 1020, 1024, 1016, 968, 944, 1008, 1008, 972, 956, 940,
	948, 956, 940,
] as const;

/** The ceiling `ceiling-raises` guards; written as a literal so a raise is a diff. */
export const PAINT_CEILINGS = {
	firstContentfulPaintMs: 1_275,
} as const;

/** The rule the ceiling is set by, for the unit that holds it to its samples. */
export const fcpCeilingFrom = (samples: readonly number[]): number => p95CeilingMs(samples);

/** Why a run off CI records the figure and does not assert it. */
export const FCP_NOT_ASSERTED =
	"recorded, not asserted: off CI the 4x throttle multiplies a developer's own CPU under whatever else it runs, so the figure is not the CI runner's the ceiling was set on";

/** Whether this run asserts the ceiling: the CI runner the samples came from. */
export const assertsFcp = (env: Record<string, string | undefined> = process.env): boolean =>
	env.CI === 'true';
