import { describe, expect, it } from 'vitest';
import { loadEffect, probeBand } from './pairs.mjs';

const job = (name, consumer, load, cpuSeconds, before, after, extra = {}) => ({
	name,
	consumer,
	load,
	cpuSeconds,
	status: 'passed',
	held: false,
	probeBefore: { cpuSeconds: before },
	probeAfter: { cpuSeconds: after },
	...extra,
});

describe('host-condition pair rule', () => {
	it('bands every completed job against the session quietest probe', () => {
		const jobs = [
			job('a', 'lushly', 0, 20, 0.4, 0.41),
			job('b', 'lushly', 5, 30, 0.43, 0.45),
			job('c', 'lushly', 5, 31, 0.42, 0.5),
			job('d', 'lushly', 0, 21, 0.4, 0.42),
			job('held', 'lushly', 0, null, 0.2, 0.2, { held: true }),
		];
		const band = probeBand(jobs, 1.1);
		// The held job's faster probes do not set the reference.
		expect(band.quietest).toBe(0.4);
		expect(band.limit).toBeCloseTo(0.44);
		expect(band.jobs.map((entry) => [entry.name, entry.inBand])).toEqual([
			['a', true],
			['b', false],
			['c', false],
			['d', true],
			['held', false],
		]);
	});

	it('derives a load ratio only from in-band jobs on both sides', () => {
		const jobs = [
			job('a', 'lushly', 0, 20, 0.4, 0.4),
			job('b', 'lushly', 5, 30, 0.4, 0.43),
			job('c', 'lushly', 5, 34, 0.41, 0.42),
			job('d', 'lushly', 0, 22, 0.4, 0.41),
			job('e', 'fast-af', 0, 10, 0.4, 0.4),
			job('f', 'fast-af', 5, 15, 0.6, 0.6),
		];
		const [lushly, fastAf] = loadEffect(jobs, probeBand(jobs, 1.1));
		expect(lushly).toMatchObject({ unloadedMedian: 21, loadedMedian: 32 });
		expect(lushly.ratio).toBeCloseTo(32 / 21);
		expect(fastAf).toMatchObject({ loaded: [], ratio: null });
	});
});
