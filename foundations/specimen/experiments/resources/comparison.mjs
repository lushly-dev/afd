/**
 * Incumbent versus candidate under the baseline policy (T04). Inputs are the per-job records
 * a pair driver keeps; outputs are per-consumer medians, ratios and a verdict per acceptance
 * criterion. Held and out-of-band comparisons supply no verdict.
 */
import { finalAttempts, spreadPercent } from './pairs.mjs';

const median = (values) => {
	const sorted = values.filter((value) => typeof value === 'number').sort((a, b) => a - b);
	if (!sorted.length) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Metrics a job contributes; per-case CPU divides by every verified render or story test. */
export function jobMetrics(job) {
	return {
		cpuSeconds: job.cpuSeconds,
		cpuPerCase: job.cpuSeconds && job.verifiedCases ? job.cpuSeconds / job.verifiedCases : null,
		peakFootprintBytes: job.peakFootprintBytes,
		postCloseFootprintBytes: job.postCloseFootprintBytes,
		coldMs: job.coldMs,
		warmMs: job.warmMs,
	};
}

/** Each criterion: the candidate median compared with the incumbent median. */
export const criteria = [
	{ key: 'cpuPerCase', limit: 1, label: 'CPU per verified case' },
	{ key: 'peakFootprintBytes', limit: 1, label: 'Active peak footprint' },
	{ key: 'postCloseFootprintBytes', limit: 1, label: 'Post-close footprint' },
	{ key: 'coldMs', limit: 1.25, label: 'Cold startup latency' },
	{ key: 'warmMs', limit: 1.25, label: 'Warm render latency' },
];

export function compare(
	jobs,
	band,
	{ maxSpreadPercent, noiseFloorPercent, candidate = 'candidate' }
) {
	const inBand = new Map(band.jobs.map((entry) => [entry.name, entry.inBand]));
	const planned = finalAttempts(jobs);
	return [...new Set(planned.map((job) => job.consumer))].map((consumer) => {
		const own = planned.filter((job) => job.consumer === consumer);
		const held = own
			.filter((job) => !inBand.get(job.name))
			.map(
				(job) =>
					`${job.name}: ${job.status !== 'passed' || job.held ? 'did not pass' : 'probe out of band'}`
			);
		const sides = {
			incumbent: own.filter((job) => job.path === 'incumbent').map(jobMetrics),
			candidate: own.filter((job) => job.path === candidate).map(jobMetrics),
		};
		for (const path of ['incumbent', 'candidate']) {
			const cpu = sides[path].map((metrics) => metrics.cpuSeconds);
			if (cpu.length < 2) held.push(`${path}: fewer than two repetitions`);
			else if (spreadPercent(cpu) > maxSpreadPercent)
				held.push(
					`${path}: CPU spread ${spreadPercent(cpu).toFixed(2)}% exceeds ${maxSpreadPercent}%`
				);
		}
		const results = criteria.map((criterion) => {
			const incumbent = median(sides.incumbent.map((metrics) => metrics[criterion.key]));
			const candidate = median(sides.candidate.map((metrics) => metrics[criterion.key]));
			const ratio = incumbent && candidate !== null ? candidate / incumbent : null;
			let verdict = 'held';
			if (!held.length && ratio !== null) {
				const withinNoise = Math.abs(ratio - 1) * 100 <= noiseFloorPercent;
				if (ratio > criterion.limit && !(criterion.limit === 1 && withinNoise)) verdict = 'fails';
				else verdict = withinNoise ? 'passes, no measurable difference' : 'passes';
			}
			return { ...criterion, incumbent, candidate, ratio, verdict };
		});
		return { consumer, held, results };
	});
}
