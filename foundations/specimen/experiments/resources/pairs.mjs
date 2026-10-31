/** Host-condition rule from the baseline policy, applied after a session's jobs complete. */

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

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
 * Compare loaded with unloaded jobs per consumer, using only in-band jobs. A consumer whose
 * cells lack an in-band job on either side yields no ratio.
 */
export function loadEffect(jobs, band) {
	const included = new Set(band.jobs.filter((job) => job.inBand).map((job) => job.name));
	const consumers = [...new Set(jobs.map((job) => job.consumer))];
	return consumers.map((consumer) => {
		const cell = (loaded) =>
			jobs
				.filter(
					(job) =>
						job.consumer === consumer && included.has(job.name) && Boolean(job.load) === loaded
				)
				.map((job) => job.cpuSeconds)
				.filter((value) => typeof value === 'number');
		const unloaded = cell(false);
		const loaded = cell(true);
		const ratio = unloaded.length && loaded.length ? median(loaded) / median(unloaded) : null;
		return {
			consumer,
			unloaded,
			loaded,
			unloadedMedian: unloaded.length ? median(unloaded) : null,
			loadedMedian: loaded.length ? median(loaded) : null,
			ratio,
		};
	});
}
