import { describe, expect, it } from 'vitest';
import { compare, jobMetrics } from './comparison.mjs';
import { probeBand } from './pairs.mjs';

const job = (name, path, cpuSeconds, extra = {}) => ({
	name,
	consumer: 'lushly',
	path,
	status: 'passed',
	held: false,
	cpuSeconds,
	verifiedCases: path === 'incumbent' ? 80 : 20,
	peakFootprintBytes: path === 'incumbent' ? 900 : 600,
	postCloseFootprintBytes: path === 'incumbent' ? 100 : 120,
	coldMs: path === 'incumbent' ? 6000 : 1500,
	warmMs: path === 'incumbent' ? 5000 : 7000,
	probeBefore: { cpuSeconds: 0.4 },
	probeAfter: { cpuSeconds: 0.41 },
	...extra,
});
const policy = { maxSpreadPercent: 10, noiseFloorPercent: 5 };

describe('incumbent versus candidate comparison', () => {
	it('divides job CPU by verified cases', () => {
		expect(jobMetrics(job('a', 'incumbent', 40)).cpuPerCase).toBe(0.5);
	});

	it('judges each criterion on medians with the policy limits and noise floor', () => {
		const jobs = [
			job('01-lushly-incumbent-a1', 'incumbent', 40),
			job('02-lushly-candidate-a1', 'candidate', 20),
			job('03-lushly-candidate-a1', 'candidate', 20.4),
			job('04-lushly-incumbent-a1', 'incumbent', 41),
		];
		const [result] = compare(jobs, probeBand(jobs, 1.1), policy);
		expect(result.held).toEqual([]);
		const verdict = Object.fromEntries(result.results.map((entry) => [entry.key, entry.verdict]));
		expect(verdict).toEqual({
			// 1.01 / 0.506 per case: more CPU per case, outside the noise floor.
			cpuPerCase: 'fails',
			peakFootprintBytes: 'passes',
			postCloseFootprintBytes: 'fails',
			coldMs: 'passes',
			// 7000 / 5000 = 1.4, beyond the 1.25 latency guardrail.
			warmMs: 'fails',
		});
	});

	it('passes a ratio just above 1 that the noise floor covers, and holds on peak spread', () => {
		const within = [
			job('01-lushly-incumbent-a1', 'incumbent', 40, { verifiedCases: 20 }),
			job('02-lushly-candidate-a1', 'candidate', 41, { peakFootprintBytes: 900 }),
			job('03-lushly-candidate-a1', 'candidate', 41, { peakFootprintBytes: 900 }),
			job('04-lushly-incumbent-a1', 'incumbent', 40, { verifiedCases: 20 }),
		];
		const [result] = compare(within, probeBand(within, 1.1), policy);
		const cpu = result.results.find((entry) => entry.key === 'cpuPerCase');
		// 2.05 / 2.0 = 1.025: above the limit of 1 but inside the 5% noise floor.
		expect(cpu.verdict).toBe('passes, no measurable difference');
		const spread = within.map((entry, index) =>
			index === 1 ? { ...entry, peakFootprintBytes: 1100 } : entry
		);
		const [held] = compare(spread, probeBand(spread, 1.1), policy);
		expect(held.held).toEqual(['candidate: peak spread 22.22% exceeds 10%']);
	});

	it('holds every criterion when a job is out of band or a side does not repeat', () => {
		const jobs = [
			job('01-lushly-incumbent-a1', 'incumbent', 40),
			job('02-lushly-candidate-a1', 'candidate', 20, { probeAfter: { cpuSeconds: 0.6 } }),
			job('03-lushly-candidate-a1', 'candidate', 26),
			job('04-lushly-incumbent-a1', 'incumbent', 41),
		];
		const [result] = compare(jobs, probeBand(jobs, 1.1), policy);
		expect(result.held).toEqual([
			'02-lushly-candidate-a1: probe out of band',
			'candidate: CPU spread 30.00% exceeds 10%',
		]);
		expect(result.results.every((entry) => entry.verdict === 'held')).toBe(true);
	});
});
