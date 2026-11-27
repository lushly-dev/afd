/**
 * Regression test for #1125: P6-H1's section 14 cold-start ceiling is derived from 20 `main`
 * `Hosted development profile` medians (nearest-rank 95th percentile + 25%, rounded up),
 * replacing the interim 750 ms ceiling from #1062.
 */
import { describe, expect, it } from 'vitest';
import hostedConfig, { orderHostedSpecs, ProfileFirstSequencer } from '../../vitest.hosted.config';
import {
	assertsSection14Ceilings,
	COLD_START_LOCAL_NOTE,
	COLD_STARTS,
	LOCAL_BOUNDS,
	P6_H1_MAIN_MEDIANS_MS,
	p95CeilingMs,
	SECTION_14_CEILINGS,
} from './budget';

describe('P6-H1 section 14 cold-start ceiling (#1125)', () => {
	it('computes nearest-rank p95 plus 25%, rounded up, regardless of input order', () => {
		expect(p95CeilingMs([100])).toBe(125);
		expect(p95CeilingMs([101])).toBe(127); // 101 * 1.25 = 126.25 -> 127
		const twenty = [
			233, 230, 274, 300, 203, 299, 264, 189, 324, 248, 297, 332, 298, 184, 229, 237, 186, 201, 292,
			203,
		];
		expect(p95CeilingMs(twenty)).toBe(405);
		expect(p95CeilingMs([...twenty].reverse())).toBe(405);
		expect(() => p95CeilingMs([])).toThrow();
	});

	it('sets SECTION_14_CEILINGS.coldStartMs from the 20 main medians and replaces the interim 750 ms', () => {
		expect(P6_H1_MAIN_MEDIANS_MS.length).toBeGreaterThanOrEqual(20);
		const computed = p95CeilingMs(P6_H1_MAIN_MEDIANS_MS);
		expect(SECTION_14_CEILINGS.coldStartMs).toBe(computed);
		expect(SECTION_14_CEILINGS.coldStartMs).toBe(405);
		expect(SECTION_14_CEILINGS.coldStartMs).toBeLessThan(750);
		expect(SECTION_14_CEILINGS.coldStartMs).toBeGreaterThan(Math.max(...P6_H1_MAIN_MEDIANS_MS));
		expect(COLD_STARTS).toBe(5);
		expect(LOCAL_BOUNDS).toEqual({ coldStartMs: 3_000, residentMb: 300 });
		expect(assertsSection14Ceilings({ CI: 'true' })).toBe(true);
		expect(assertsSection14Ceilings({})).toBe(false);
		expect(assertsSection14Ceilings({ CI: '1' })).toBe(false);
		expect(COLD_START_LOCAL_NOTE).toMatch(/^warned, not failed: /);
	});

	it('schedules profile.test.ts first across POSIX and Windows paths while preserving the rest (#2239)', () => {
		const ordered = orderHostedSpecs([
			{ moduleId: '/repo/endpoints/loam/packages/web/test/hosted/relay.test.ts' },
			{ moduleId: '/repo/endpoints/loam/packages/web/test/hosted/mcp.test.ts' },
			{ moduleId: '/repo/endpoints/loam/packages/web/test/hosted/profile.test.ts' },
			{ moduleId: '/repo/endpoints/loam/packages/web/test/hosted/shell.test.ts' },
		]);
		expect(ordered.map((spec) => spec.moduleId.split('/').at(-1))).toEqual([
			'profile.test.ts',
			'relay.test.ts',
			'mcp.test.ts',
			'shell.test.ts',
		]);

		const winOrdered = orderHostedSpecs([
			{
				moduleId: [
					'repo',
					'endpoints',
					'loam',
					'packages',
					'web',
					'test',
					'hosted',
					'relay.test.ts',
				].join('\\'),
			},
			{
				moduleId: [
					'repo',
					'endpoints',
					'loam',
					'packages',
					'web',
					'test',
					'hosted',
					'profile.test.ts',
				].join('\\'),
			},
		]);
		expect(winOrdered.map((spec) => spec.moduleId.split('\\').at(-1))).toEqual([
			'profile.test.ts',
			'relay.test.ts',
		]);
		expect(hostedConfig.test?.sequence?.sequencer).toBe(ProfileFirstSequencer);
	});
});
