/**
 * First contentful paint's ceiling (D161, #1929; phase 2 specification, 2.5): set from 20 `main` runs of the
 * Chromium job by nearest-rank 95th percentile plus 25%, rounded up, and asserted only on that runner.
 */
import { describe, expect, it } from 'vitest';
import {
	assertsFcp,
	FCP_MAIN_SAMPLES_MS,
	FCP_NOT_ASSERTED,
	fcpCeilingFrom,
	PAINT_CEILINGS,
} from '../browser/first-paint-budget';

describe('P2-E1 first-contentful-paint ceiling (D161, #1929)', () => {
	it('is the 95th percentile of the 20 main samples plus 25%, rounded up, above every sample', () => {
		expect(FCP_MAIN_SAMPLES_MS).toHaveLength(20);
		expect(fcpCeilingFrom(FCP_MAIN_SAMPLES_MS)).toBe(PAINT_CEILINGS.firstContentfulPaintMs);
		expect(PAINT_CEILINGS.firstContentfulPaintMs).toBe(1_275);
		expect(PAINT_CEILINGS.firstContentfulPaintMs).toBeGreaterThan(Math.max(...FCP_MAIN_SAMPLES_MS));
	});

	it('is asserted on CI and recorded with its reason elsewhere', () => {
		expect(assertsFcp({ CI: 'true' })).toBe(true);
		expect(assertsFcp({})).toBe(false);
		expect(assertsFcp({ CI: '1' })).toBe(false);
		expect(FCP_NOT_ASSERTED).toMatch(/^recorded, not asserted: /);
	});
});
