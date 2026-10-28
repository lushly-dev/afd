const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nullable = (value) => (finite(value) ? value : null);
const sum = (values) => (values.every(finite) ? values.reduce((a, b) => a + b, 0) : null);
const median = (values) => {
	const sorted = values.filter(finite).sort((a, b) => a - b);
	if (!sorted.length) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const peak = (values) => (values.some(finite) ? Math.max(...values.filter(finite)) : null);
const identity = (process) => `${process.pid}:${process.startId}`;
const validIdentity = (process) =>
	Number.isInteger(process.pid) &&
	typeof process.startId === 'string' &&
	process.startId.length > 0;
const roleOf = (name) => {
	if (typeof name !== 'string') return 'unknown';
	if (/gpu/i.test(name)) return 'GPU';
	if (/renderer/i.test(name)) return 'renderer';
	if (/node(?:\b|$)/i.test(name)) return 'Node';
	if (/helper|utility|crashpad/i.test(name)) return 'helper';
	if (/chrom(?:e|ium)|browser|firefox|webkit/i.test(name)) return 'browser';
	return 'unknown';
};
const ownCpu = (process) => sum([process.userNs, process.systemNs]);

function memoryStats(samples) {
	const footprint = samples.map((sample) => sample.footprintBytes);
	const rss = samples.map((sample) => sample.rssBytes);
	return {
		samples: samples.length,
		validFootprintSamples: footprint.filter(finite).length,
		validRssSamples: rss.filter(finite).length,
		peakFootprintBytes: peak(footprint),
		medianFootprintBytes: median(footprint),
		peakRssBytes: peak(rss),
		medianRssBytes: median(rss),
	};
}

function deltas(samples) {
	const intervals = [];
	for (let index = 1; index < samples.length; index++) {
		const previous = samples[index - 1];
		const current = samples[index];
		if (!finite(previous.timestampMs) || !finite(current.timestampMs)) continue;
		const durationMs = current.timestampMs - previous.timestampMs;
		if (durationMs <= 0) continue;
		const before = new Map(
			previous.processes.filter(validIdentity).map((p) => [identity(p), ownCpu(p)])
		);
		let cpuNs = 0;
		let matched = 0;
		for (const process of current.processes.filter(validIdentity)) {
			const earlier = before.get(identity(process));
			const now = ownCpu(process);
			if (!finite(earlier) || !finite(now) || now < earlier) continue;
			cpuNs += now - earlier;
			matched++;
		}
		if (matched)
			intervals.push({
				durationMs,
				cpuSeconds: cpuNs / 1e9,
				normalizedOneCorePercent: (cpuNs / (durationMs * 1e6)) * 100,
			});
	}
	return intervals;
}

/** Summarize collector records without treating absent measurements as zero. */
export function summarizeResources(
	events,
	{ phases = [], successfulRenders = 0, verifiedCaptures = 0 } = {}
) {
	const records = Array.isArray(events) ? events : [];
	const start = records.find((event) => event.type === 'start');
	const exit = records.findLast((event) => event.type === 'exit');
	const final = records.findLast((event) => event.type === 'summary');
	const issues = [];
	const limitations = [
		'Memory is the sampled simultaneous sum of process phys_footprint and, separately, RSS; neither is unique physical RAM. Shared pages may be counted more than once.',
		'CPU attribution is a sampled lower bound: short-lived processes and processes detached before observation can be missed; process snapshots are non-atomic.',
		'Final wait accounting covers the root and descendants reaped through the root, not unseen orphans. Reaped-child CPU counters are never added to self CPU or the final total.',
		'Process roles are inferred from names; ambiguous names remain unknown.',
	];
	if (!start) issues.push('Missing start event.');
	if (!exit) issues.push('Missing final exit accounting.');
	if (!final) issues.push('Missing collector summary.');
	const samples = records
		.filter((event) => event.type === 'sample')
		.map((event) => {
			const processes = Array.isArray(event.processes) ? event.processes : [];
			return {
				timestampMs: nullable(event.timestampMs),
				processCount: Array.isArray(event.processes) ? processes.length : null,
				processes,
				footprintBytes: Array.isArray(event.processes)
					? sum(processes.map((p) => p.footprintBytes))
					: null,
				rssBytes: Array.isArray(event.processes) ? sum(processes.map((p) => p.rssBytes)) : null,
			};
		})
		.sort((a, b) => (a.timestampMs ?? Infinity) - (b.timestampMs ?? Infinity));
	if (!samples.length) issues.push('No process samples.');
	if (
		samples.some(
			(s) =>
				s.timestampMs === null ||
				s.footprintBytes === null ||
				s.rssBytes === null ||
				s.processes.some((p) => !validIdentity(p) || ownCpu(p) === null)
		)
	) {
		issues.push('Some samples contain missing or invalid measurement fields.');
	}
	if (start && !finite(start.timestampMs)) issues.push('Invalid start timestamp.');
	const waitedUser = nullable(exit?.userSeconds);
	const waitedSystem = nullable(exit?.systemSeconds);
	const waitedTotal = sum([waitedUser, waitedSystem]);
	if (
		exit &&
		(waitedTotal === null ||
			!finite(exit.elapsedMs) ||
			(!Number.isInteger(exit.exitCode) && exit.signal == null))
	)
		issues.push('Invalid final exit accounting.');
	if (
		exit &&
		(exit.waitedDescendantCpuIncluded !== true ||
			exit.waitAccounting !== 'root-and-descendants-reaped-through-root')
	)
		issues.push('Waited-tree accounting scope is unverified.');
	const samplerUser = nullable(final?.samplerUserSeconds);
	const samplerSystem = nullable(final?.samplerSystemSeconds);
	const samplerTotal = sum([samplerUser, samplerSystem]);
	if (
		final &&
		(samplerTotal === null ||
			!finite(final.readFailures) ||
			!finite(final.samples) ||
			!finite(final.elapsedMs) ||
			!Array.isArray(final.survivorsAfterCleanup) ||
			!Array.isArray(final.survivorsBeforeCleanup) ||
			typeof final.limitExceeded !== 'boolean')
	)
		issues.push('Invalid collector summary fields.');
	if (final?.readFailures > 0) issues.push('Collector reported process read failures.');
	if (final?.trackingOverflow) issues.push('Collector process tracking overflowed.');
	if (final?.rootEnrollmentFailed) issues.push('Collector failed to enroll the root process.');
	if (final?.exitedDuringSample > 0)
		limitations.push(
			'Known exits or PID reuse during sampling leave CPU and memory attribution as sampled lower bounds.'
		);
	if (final && final.samples !== samples.length)
		issues.push('Collector sample count differs from received sample records.');
	const byIdentity = new Map();
	for (const sample of samples) {
		for (const process of sample.processes.filter(validIdentity)) {
			const key = identity(process);
			const item = byIdentity.get(key) ?? {
				pid: process.pid,
				startId: process.startId,
				role: roleOf(process.name),
				userNs: null,
				systemNs: null,
			};
			item.role = roleOf(process.name);
			if (finite(process.userNs)) item.userNs = Math.max(item.userNs ?? 0, process.userNs);
			if (finite(process.systemNs)) item.systemNs = Math.max(item.systemNs ?? 0, process.systemNs);
			byIdentity.set(key, item);
		}
	}
	const roles = Object.fromEntries(
		['browser', 'renderer', 'GPU', 'Node', 'helper', 'unknown'].map((role) => [
			role,
			{
				observedProcesses: 0,
				sampledOwnUserSecondsLowerBound: 0,
				sampledOwnSystemSecondsLowerBound: 0,
				sampledOwnTotalSecondsLowerBound: 0,
				invalidCpuProcesses: 0,
			},
		])
	);
	for (const process of byIdentity.values()) {
		const role = roles[process.role];
		role.observedProcesses++;
		if (process.userNs === null || process.systemNs === null) {
			role.invalidCpuProcesses++;
			continue;
		}
		role.sampledOwnUserSecondsLowerBound += process.userNs / 1e9;
		role.sampledOwnSystemSecondsLowerBound += process.systemNs / 1e9;
		role.sampledOwnTotalSecondsLowerBound += (process.userNs + process.systemNs) / 1e9;
	}
	for (const [name, role] of Object.entries(roles)) {
		const roleSamples = samples.map((sample) => {
			const members = sample.processes.filter((process) => roleOf(process.name) === name);
			return {
				footprintBytes:
					sample.processCount === null
						? null
						: sum(members.map((process) => process.footprintBytes)),
				rssBytes:
					sample.processCount === null ? null : sum(members.map((process) => process.rssBytes)),
			};
		});
		role.memory = memoryStats(roleSamples);
		if (role.invalidCpuProcesses) {
			role.sampledOwnUserSecondsLowerBound = null;
			role.sampledOwnSystemSecondsLowerBound = null;
			role.sampledOwnTotalSecondsLowerBound = null;
		}
	}
	const phaseRecords = [...records.filter((event) => event.type === 'phase'), ...phases];
	const phaseStarts = phaseRecords.filter((event) => event.event === 'start');
	const phaseResults = phaseStarts.map((phase) => {
		const end = phaseRecords.find(
			(event) =>
				event.event === 'end' &&
				event.id === phase.id &&
				finite(event.timestampMs) &&
				event.timestampMs >= phase.timestampMs
		);
		const complete = finite(phase.timestampMs) && Boolean(end);
		const selected = complete
			? samples.filter(
					(sample) =>
						sample.timestampMs !== null &&
						sample.timestampMs >= phase.timestampMs &&
						sample.timestampMs <= end.timestampMs
				)
			: [];
		const intervals = deltas(selected);
		return {
			id: phase.id,
			name: phase.name,
			consumer: phase.consumer ?? null,
			specimenId: phase.specimenId ?? null,
			complete,
			startTimestampMs: nullable(phase.timestampMs),
			endTimestampMs: nullable(end?.timestampMs),
			memory: memoryStats(selected),
			sampledOwnCpuSecondsLowerBound: intervals.length
				? intervals.reduce((total, interval) => total + interval.cpuSeconds, 0)
				: null,
		};
	});
	if (phaseResults.some((phase) => !phase.complete))
		issues.push('Some phases have missing or invalid bounds.');
	const activeBounds = phaseResults.filter(
		(phase) => phase.complete && !/idle|baseline/i.test(phase.name ?? '')
	);
	const idleBounds = phaseResults.filter(
		(phase) => phase.complete && /idle|baseline/i.test(phase.name ?? '')
	);
	const within = (sample, bounds) =>
		sample.timestampMs !== null &&
		bounds.some(
			(phase) =>
				sample.timestampMs >= phase.startTimestampMs && sample.timestampMs <= phase.endTimestampMs
		);
	const intervals = deltas(samples);
	const failed =
		Boolean(exit && (exit.exitCode !== 0 || exit.signal)) ||
		Boolean(
			final?.limitExceeded || final?.interruptedSignal || final?.survivorsAfterCleanup?.length
		);
	const renderCount =
		Number.isInteger(successfulRenders) && successfulRenders >= 0 ? successfulRenders : null;
	const captureCount =
		Number.isInteger(verifiedCaptures) && verifiedCaptures >= 0 ? verifiedCaptures : null;
	if (renderCount === null || captureCount === null) issues.push('Invalid workflow counts.');
	if (Array.isArray(final?.trackingLimitations)) limitations.push(...final.trackingLimitations);
	const collectionComplete = issues.length === 0;
	if (exit && (exit.exitCode !== 0 || exit.signal))
		issues.push('Workload exited unsuccessfully or was signaled.');
	if (final?.limitExceeded) issues.push('Memory limit was exceeded.');
	if (final?.interruptedSignal) issues.push('Collector was interrupted.');
	if (final?.survivorsAfterCleanup?.length) issues.push('Owned processes survived cleanup.');
	if (!idleBounds.length)
		limitations.push('No explicitly named idle or baseline phase; idle baseline is unavailable.');
	if (!activeBounds.length)
		limitations.push('No explicitly named active phase; active baseline is unavailable.');
	return {
		status: failed ? 'failed' : issues.length ? 'incomplete' : 'complete',
		complete: !failed && issues.length === 0,
		completeness: {
			collection: collectionComplete ? 'complete' : 'incomplete',
			processCpuAttribution: 'partial-sampled-lower-bound',
			memoryPeak: 'sampled-peak',
			deduplicatedPhysicalRam: 'not-measured',
		},
		issues,
		limitations,
		workflow: { successfulRenders: renderCount, verifiedCaptures: captureCount },
		memory: {
			...memoryStats(samples),
			sampler: {
				footprintBytes: nullable(final?.samplerFootprintBytes),
				rssBytes: nullable(final?.samplerRssBytes),
				lifetimeMaxFootprintBytes: nullable(final?.samplerLifetimeMaxFootprintBytes),
			},
			activeBaseline: memoryStats(samples.filter((s) => within(s, activeBounds))),
			idleBaseline: memoryStats(samples.filter((s) => within(s, idleBounds))),
		},
		cpu: {
			waitedTree: {
				userSeconds: waitedUser,
				systemSeconds: waitedSystem,
				totalSeconds: waitedTotal,
				scope: 'root-and-descendants-reaped-through-root',
				authoritative: Boolean(
					exit?.waitedDescendantCpuIncluded === true &&
						exit?.waitAccounting === 'root-and-descendants-reaped-through-root' &&
						waitedTotal !== null
				),
			},
			amortizedSecondsPerSuccessfulRender:
				renderCount > 0 && waitedTotal !== null ? waitedTotal / renderCount : null,
			amortizationIncludesWorkflowOverhead: true,
			sampledUtilization: {
				normalization: 'one core = 100%',
				intervals: intervals.length,
				peakPercent: peak(intervals.map((i) => i.normalizedOneCorePercent)),
				medianPercent: median(intervals.map((i) => i.normalizedOneCorePercent)),
			},
			sampler: {
				userSeconds: samplerUser,
				systemSeconds: samplerSystem,
				totalSeconds: samplerTotal,
				ratioOfWaitedCpu:
					waitedTotal > 0 && samplerTotal !== null ? samplerTotal / waitedTotal : null,
			},
		},
		processes: {
			maxSimultaneous: peak(samples.map((sample) => sample.processCount)),
			observedIdentities: byIdentity.size,
			roles,
		},
		phases: phaseResults,
		collector: {
			trackingOverflow: final?.trackingOverflow ?? null,
			rootEnrollmentFailed: final?.rootEnrollmentFailed ?? null,
			processScanFailures: nullable(final?.processScanFailures),
			exitedDuringSample: nullable(final?.exitedDuringSample),
			timebaseNumer: nullable(final?.timebaseNumer ?? start?.timebaseNumer),
			timebaseDenom: nullable(final?.timebaseDenom ?? start?.timebaseDenom),
			signalFailures: nullable(final?.signalFailures),
			exitCode: exit?.exitCode ?? null,
			signal: exit?.signal ?? null,
			elapsedMs: nullable(final?.elapsedMs),
			readFailures: nullable(final?.readFailures),
			limitExceeded: final?.limitExceeded ?? null,
			interruptedSignal: final?.interruptedSignal ?? null,
			survivorsBeforeCleanup: final?.survivorsBeforeCleanup ?? null,
			survivorsAfterCleanup: final?.survivorsAfterCleanup ?? null,
		},
	};
}
