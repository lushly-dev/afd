/** Host-condition and repeatability rules from the baseline policy, applied after a session. */

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Spread of repetitions, as the policy measures it: (max − min) / min. */
export const spreadPercent = (values) =>
	values.length ? ((Math.max(...values) - Math.min(...values)) / Math.min(...values)) * 100 : null;

/** Each planned job's final attempt; attempts are named `<slot>-a<attempt>`. */
export function finalAttempts(jobs) {
	const slots = new Map();
	for (const job of jobs) slots.set(job.name.replace(/-a\d+$/, ''), job);
	return [...slots.values()];
}

/**
 * Mark each completed job in or out of the probe band: both its before and after probes must
 * be at most `maxRatio` times the session's quietest probe. Held and failed jobs never count.
 */
export function probeBand(jobs, maxRatio) {
	const probes = jobs
		.filter((job) => job.status === 'passed' && !job.held)
		.flatMap((job) => [job.probeBefore?.cpuSeconds, job.probeAfter?.cpuSeconds])
		.filter((value) => typeof value === 'number');
	const quietest = probes.length ? Math.min(...probes) : null;
	const limit = quietest === null ? null : quietest * maxRatio;
	return {
		quietest,
		limit,
		jobs: jobs.map((job) => {
			const counted = job.status === 'passed' && !job.held && limit !== null;
			const before = job.probeBefore?.cpuSeconds;
			const after = job.probeAfter?.cpuSeconds;
			const inBand =
				counted &&
				typeof before === 'number' &&
				typeof after === 'number' &&
				before <= limit &&
				after <= limit;
			return { name: job.name, counted, inBand };
		}),
	};
}

/**
 * Compare loaded with unloaded jobs per consumer. The comparison is held, with no ratio, if any
 * planned job did not finally pass in band, or if either cell spreads beyond the repeatability
 * tolerance. Held comparisons keep their values for diagnosis.
 */
export function loadEffect(jobs, band, { maxSpreadPercent }) {
	const inBand = new Map(band.jobs.map((job) => [job.name, job.inBand]));
	const planned = finalAttempts(jobs);
	return [...new Set(planned.map((job) => job.consumer))].map((consumer) => {
		const own = planned.filter((job) => job.consumer === consumer);
		const held = [];
		for (const job of own)
			if (!inBand.get(job.name))
				held.push(
					`${job.name}: ${job.status !== 'passed' || job.held ? 'did not pass' : 'probe out of band'}`
				);
		const cell = (loaded) =>
			own
				.filter((job) => Boolean(job.load) === loaded)
				.map((job) => job.cpuSeconds)
				.filter((value) => typeof value === 'number');
		const unloaded = cell(false);
		const loaded = cell(true);
		for (const [name, values] of [
			['unloaded', unloaded],
			['loaded', loaded],
		]) {
			if (values.length < 2) held.push(`${name}: fewer than two repetitions`);
			else if (spreadPercent(values) > maxSpreadPercent)
				held.push(
					`${name}: spread ${spreadPercent(values).toFixed(2)}% exceeds ${maxSpreadPercent}%`
				);
		}
		const unloadedMedian = unloaded.length ? median(unloaded) : null;
		const loadedMedian = loaded.length ? median(loaded) : null;
		return {
			consumer,
			unloaded,
			loaded,
			unloadedMedian,
			loadedMedian,
			spreadPercent: { unloaded: spreadPercent(unloaded), loaded: spreadPercent(loaded) },
			held,
			ratio: held.length ? null : loadedMedian / unloadedMedian,
		};
	});
}
