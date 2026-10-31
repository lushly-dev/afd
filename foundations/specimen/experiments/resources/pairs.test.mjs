import { describe, expect, it } from 'vitest';
import { finalAttempts, loadEffect, probeBand, spreadPercent } from './pairs.mjs';

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
const tolerance = { maxSpreadPercent: 10 };

describe('host-condition pair rule', () => {
	it('bands every completed job against the session quietest probe', () => {
		const jobs = [
			job('01-l-load0-a1', 'lushly', 0, 20, 0.4, 0.41),
			job('02-l-load5-a1', 'lushly', 5, 30, 0.43, 0.45),
			job('03-l-load5-a1', 'lushly', 5, 31, 0.42, 0.5),
			job('04-l-load0-a1', 'lushly', 0, 21, 0.4, 0.42),
			job('05-l-load0-a1', 'lushly', 0, null, 0.2, 0.2, { held: true }),
		];
		const band = probeBand(jobs, 1.1);
		// The held job's faster probes do not set the reference.
		expect(band.quietest).toBe(0.4);
		expect(band.limit).toBeCloseTo(0.44);
		expect(band.jobs.map((entry) => entry.inBand)).toEqual([true, false, false, true, false]);
	});

	it('gives a ratio only when every planned job passed in band and both cells repeat', () => {
		const jobs = [
			job('01-l-load0-a1', 'lushly', 0, 20, 0.4, 0.4),
			job('02-l-load5-a1', 'lushly', 5, 30, 0.4, 0.43),
			job('03-l-load5-a1', 'lushly', 5, 31, 0.41, 0.42),
			job('04-l-load0-a1', 'lushly', 0, 21, 0.4, 0.41),
			job('05-f-load0-a1', 'fast-af', 0, 10, 0.4, 0.4),
			job('06-f-load5-a1', 'fast-af', 5, 15, 0.4, 0.4),
			job('07-f-load5-a1', 'fast-af', 5, 15.5, 0.4, 0.4),
			job('08-f-load0-a1', 'fast-af', 0, 10.2, 0.4, 0.46),
		];
		const [lushly, fastAf] = loadEffect(jobs, probeBand(jobs, 1.1), tolerance);
		expect(lushly).toMatchObject({ unloadedMedian: 20.5, loadedMedian: 30.5, held: [] });
		expect(lushly.ratio).toBeCloseTo(30.5 / 20.5);
		// One out-of-band job holds the whole comparison rather than shrinking a cell.
		expect(fastAf.ratio).toBeNull();
		expect(fastAf.held).toEqual(['08-f-load0-a1: probe out of band']);
	});

	it('uses final attempts and holds unrepeatable cells', () => {
		const jobs = [
			job('01-l-load0-a1', 'lushly', 0, null, 0.4, 0.4, { held: true, status: 'failed' }),
			job('01-l-load0-a2', 'lushly', 0, 20, 0.4, 0.4),
			job('02-l-load5-a1', 'lushly', 5, 30, 0.4, 0.4),
			job('03-l-load5-a1', 'lushly', 5, 36, 0.4, 0.4),
			job('04-l-load0-a1', 'lushly', 0, 20.4, 0.4, 0.4),
		];
		expect(finalAttempts(jobs).map((entry) => entry.name)).toEqual([
			'01-l-load0-a2',
			'02-l-load5-a1',
			'03-l-load5-a1',
			'04-l-load0-a1',
		]);
		const [lushly] = loadEffect(jobs, probeBand(jobs, 1.1), tolerance);
		expect(lushly.held).toEqual(['loaded: spread 20.00% exceeds 10%']);
		expect(spreadPercent([28.883, 29.172])).toBeCloseTo(1.0006, 3);
	});
});
