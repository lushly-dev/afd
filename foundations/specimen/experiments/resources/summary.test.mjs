import { describe, expect, it } from 'vitest';
import { summarizeResources } from './summary.mjs';

const process = (pid, overrides = {}) => ({
	pid,
	ppid: 1,
	pgid: 1,
	startId: `start-${pid}`,
	name: 'node',
	userNs: 1e9,
	systemNs: 0.5e9,
	childUserNs: 0,
	childSystemNs: 0,
	rssBytes: 100,
	footprintBytes: 80,
	...overrides,
});
const sample = (timestampMs, processes) => ({
	type: 'sample',
	timestampMs,
	elapsedMs: timestampMs - 1000,
	processes,
	sampledFootprintBytes: processes.reduce((total, p) => total + p.footprintBytes, 0),
});
const start = {
	type: 'start',
	rootPid: 1,
	pgid: 1,
	timestampMs: 1000,
	elapsedMs: 0,
	intervalMs: 100,
	graceMs: 100,
	maxFootprintBytes: 10000,
};
const exit = {
	type: 'exit',
	exitCode: 0,
	signal: null,
	userSeconds: 8,
	systemSeconds: 2,
	waitedDescendantCpuIncluded: true,
	waitAccounting: 'root-and-descendants-reaped-through-root',
	elapsedMs: 2000,
};
const finish = (samples = 2, overrides = {}) => ({
	type: 'summary',
	samplerUserSeconds: 0.2,
	samplerSystemSeconds: 0.1,
	samples,
	readFailures: 0,
	survivorsBeforeCleanup: [],
	survivorsAfterCleanup: [],
	limitExceeded: false,
	interruptedSignal: null,
	trackingLimitations: [],
	elapsedMs: 2000,
	...overrides,
});
const run = (samples, options, finalOverrides) =>
	summarizeResources([start, ...samples, exit, finish(samples.length, finalOverrides)], options);

describe('summarizeResources', () => {
	it('keeps authoritative waited CPU separate from own CPU and rolled-up child CPU', () => {
		const result = run(
			[
				sample(1000, [
					process(1, { childUserNs: 8e9 }),
					process(2, { name: 'Chrome Renderer', userNs: 2e9 }),
				]),
				sample(2000, [process(1, { userNs: 2e9, childUserNs: 12e9 })]),
			],
			{ successfulRenders: 2, verifiedCaptures: 1 }
		);
		expect(result.status).toBe('complete');
		expect(result.cpu.waitedTree).toMatchObject({ totalSeconds: 10, authoritative: true });
		expect(result.cpu.amortizedSecondsPerSuccessfulRender).toBe(5);
		expect(result.cpu.amortizationIncludesWorkflowOverhead).toBe(true);
		expect(result.processes.roles.Node.sampledOwnTotalSecondsLowerBound).toBe(2.5);
		expect(result.processes.roles.renderer.sampledOwnTotalSecondsLowerBound).toBe(2.5);
		expect(result.cpu.sampler.totalSeconds).toBeCloseTo(0.3);
		expect(result.cpu.sampler.ratioOfWaitedCpu).toBeCloseTo(0.03);
		expect(result.limitations.join(' ')).toContain('unseen orphans');
	});

	it('distinguishes reused PIDs by start identity and never creates utilization across reuse', () => {
		const result = run([
			sample(1000, [process(2, { startId: 'old', userNs: 5e9 })]),
			sample(2000, [process(2, { startId: 'new', userNs: 1e9 })]),
		]);
		expect(result.processes.observedIdentities).toBe(2);
		expect(result.processes.roles.Node.sampledOwnTotalSecondsLowerBound).toBe(7);
		expect(result.cpu.sampledUtilization.peakPercent).toBeNull();
	});

	it('uses simultaneous sample sums, separately for footprint and RSS', () => {
		const result = run([
			sample(1000, [
				process(1, { footprintBytes: 100, rssBytes: 200 }),
				process(2, { footprintBytes: 10, rssBytes: 20 }),
			]),
			sample(2000, [
				process(1, { footprintBytes: 10, rssBytes: 20 }),
				process(2, { footprintBytes: 100, rssBytes: 200 }),
			]),
		]);
		expect(result.memory.peakFootprintBytes).toBe(110);
		expect(result.memory.peakRssBytes).toBe(220);
		expect(result.processes.maxSimultaneous).toBe(2);
		expect(result.limitations.join(' ')).toContain('neither is unique physical RAM');
	});

	it('reports absent final accounting as incomplete with null values', () => {
		const result = summarizeResources([start, sample(1000, [process(1)])]);
		expect(result.status).toBe('incomplete');
		expect(result.cpu.waitedTree.totalSeconds).toBeNull();
		expect(result.cpu.sampler.totalSeconds).toBeNull();
		expect(result.collector.survivorsAfterCleanup).toBeNull();
		expect(result.cpu.amortizedSecondsPerSuccessfulRender).toBeNull();
		expect(result.issues).toContain('Missing final exit accounting.');
		expect(result.issues).toContain('Missing collector summary.');
	});

	it.each([
		{ survivorsAfterCleanup: [{ pid: 9 }] },
		{ limitExceeded: true },
		{ interruptedSignal: 'SIGINT' },
	])('fails when cleanup, limits or interruption prevent completion: %j', (overrides) => {
		expect(run([sample(1000, [process(1)])], {}, overrides).status).toBe('failed');
	});

	it('preserves surviving processes before successful cleanup', () => {
		const result = run([sample(1000, [process(1)])], {}, { survivorsBeforeCleanup: [{ pid: 9 }] });
		expect(result.status).toBe('complete');
		expect(result.collector.survivorsBeforeCleanup).toEqual([{ pid: 9 }]);
	});

	it('aligns phase memory and positive self CPU deltas by epoch time', () => {
		const phases = [
			{ type: 'phase', event: 'start', id: 'idle', name: 'idle baseline', timestampMs: 1000 },
			{ type: 'phase', event: 'end', id: 'idle', timestampMs: 1500 },
			{
				type: 'phase',
				event: 'start',
				id: 'render',
				name: 'render',
				consumer: 'demo',
				specimenId: 'button',
				timestampMs: 2000,
			},
			{ type: 'phase', event: 'end', id: 'render', timestampMs: 3000 },
		];
		const result = run(
			[
				sample(1000, [process(1, { userNs: 0, systemNs: 0, footprintBytes: 10 })]),
				sample(2000, [process(1, { userNs: 1e9, systemNs: 0, footprintBytes: 20 })]),
				sample(3000, [
					process(1, { userNs: 3e9, systemNs: 0, footprintBytes: 40 }),
					process(2, { userNs: 9e9 }),
				]),
				sample(4000, [process(1, { userNs: 4e9, systemNs: 0, footprintBytes: 500 })]),
			],
			{ phases }
		);
		expect(result.memory.idleBaseline.medianFootprintBytes).toBe(10);
		expect(result.memory.activeBaseline.medianFootprintBytes).toBe(70);
		expect(result.phases[1]).toMatchObject({
			consumer: 'demo',
			specimenId: 'button',
			sampledOwnCpuSecondsLowerBound: 2,
		});
		expect(result.phases[1].memory.peakFootprintBytes).toBe(120);
		expect(result.cpu.sampledUtilization.peakPercent).toBe(200);
		expect(result.limitations.join(' ')).toContain('non-atomic');
	});

	it('keeps unavailable or invalid values null rather than silently zeroing', () => {
		const result = run([
			sample(1000, [process(1, { userNs: undefined, footprintBytes: NaN, name: 'unrecognized' })]),
		]);
		expect(result.status).toBe('incomplete');
		expect(result.memory.peakFootprintBytes).toBeNull();
		expect(result.processes.roles.unknown.sampledOwnTotalSecondsLowerBound).toBeNull();
		expect(result.cpu.amortizedSecondsPerSuccessfulRender).toBeNull();
	});

	it('does not report an unclosed phase as an exact zero measurement', () => {
		const result = run([sample(1000, [process(1)])], {
			phases: [{ type: 'phase', event: 'start', id: 'open', timestampMs: 1000 }],
		});
		expect(result.status).toBe('incomplete');
		expect(result.phases[0].sampledOwnCpuSecondsLowerBound).toBeNull();
		expect(result.phases[0].memory.peakFootprintBytes).toBeNull();
	});
	it('distinguishes known empty process families from missing process measurements', () => {
		const empty = run([sample(2000, [])]);
		expect(empty.status).toBe('complete');
		expect(empty.memory).toMatchObject({
			peakFootprintBytes: 0,
			peakRssBytes: 0,
			validFootprintSamples: 1,
		});
		expect(empty.processes.maxSimultaneous).toBe(0);
		const missing = run([{ type: 'sample', timestampMs: 2000 }]);
		expect(missing.status).toBe('incomplete');
		expect(missing.memory.peakFootprintBytes).toBeNull();
		expect(missing.processes.maxSimultaneous).toBeNull();
		expect(missing.processes.roles.Node.memory.peakFootprintBytes).toBeNull();
	});

	it('reports per-role simultaneous memory peaks rather than summed lifetime peaks', () => {
		const result = run([
			sample(1000, [
				process(1, { footprintBytes: 100 }),
				process(2, { footprintBytes: 10 }),
				process(3, { name: 'Chromium', footprintBytes: 300, rssBytes: 500 }),
			]),
			sample(2000, [
				process(1, { footprintBytes: 10 }),
				process(2, { footprintBytes: 100 }),
				process(3, { name: 'Chromium', footprintBytes: 200, rssBytes: 400 }),
			]),
		]);
		expect(result.processes.roles.Node.memory).toMatchObject({
			samples: 2,
			peakFootprintBytes: 110,
			medianFootprintBytes: 110,
			peakRssBytes: 200,
		});
		expect(result.processes.roles.browser.memory).toMatchObject({
			peakFootprintBytes: 300,
			medianFootprintBytes: 250,
			peakRssBytes: 500,
		});
	});

	it('separates collection completeness from inherent measurement limitations', () => {
		const result = run([sample(1000, [process(1)])]);
		expect(result.status).toBe('complete');
		expect(result.completeness).toEqual({
			collection: 'complete',
			processCpuAttribution: 'partial-sampled-lower-bound',
			memoryPeak: 'sampled-peak',
			deduplicatedPhysicalRam: 'not-measured',
		});
		expect(summarizeResources([]).completeness.collection).toBe('incomplete');
	});

	it('preserves sampler memory separately and uses null for unsupported measurements', () => {
		const result = run(
			[sample(1000, [process(1)])],
			{},
			{ samplerFootprintBytes: 120, samplerRssBytes: 200, samplerLifetimeMaxFootprintBytes: 250 }
		);
		expect(result.memory.sampler).toEqual({
			footprintBytes: 120,
			rssBytes: 200,
			lifetimeMaxFootprintBytes: 250,
		});
		expect(run([sample(1000, [process(1)])]).memory.sampler).toEqual({
			footprintBytes: null,
			rssBytes: null,
			lifetimeMaxFootprintBytes: null,
		});
	});
	it.each([{ trackingOverflow: true }, { rootEnrollmentFailed: true }])(
		'marks collection incomplete for tracking failures: %j',
		(overrides) => {
			const result = run([sample(1000, [process(1)])], {}, overrides);
			expect(result.status).toBe('incomplete');
			expect(result.completeness.collection).toBe('incomplete');
			expect(result.collector).toMatchObject(overrides);
		}
	);

	it('retains unrelated scan failures and known exit races without failing collection', () => {
		const result = run(
			[sample(1000, [process(1)])],
			{},
			{ processScanFailures: 8, exitedDuringSample: 2 }
		);
		expect(result.status).toBe('complete');
		expect(result.collector).toMatchObject({ processScanFailures: 8, exitedDuringSample: 2 });
		expect(result.limitations.join(' ')).toContain('Known exits or PID reuse');
		const failed = run(
			[sample(1000, [process(1)])],
			{},
			{ processScanFailures: 8, exitedDuringSample: 2, readFailures: 1 }
		);
		expect(failed.status).toBe('incomplete');
	});

	it('classifies identity CPU by final observed executable after preexec enrollment', () => {
		const result = run([
			sample(1000, [process(1, { name: 'specimen-resourc' })]),
			sample(2000, [process(1, { name: 'node', userNs: 2e9 })]),
		]);
		expect(result.processes.roles.Node.observedProcesses).toBe(1);
		expect(result.processes.roles.Node.sampledOwnTotalSecondsLowerBound).toBe(2.5);
		expect(result.processes.roles.unknown.observedProcesses).toBe(0);
	});

	it('retains Mach timebase evidence from final summary or start record', () => {
		const events = [
			{ ...start, timebaseNumer: 125, timebaseDenom: 3 },
			sample(1000, [process(1)]),
			exit,
			finish(1),
		];
		expect(summarizeResources(events).collector).toMatchObject({
			timebaseNumer: 125,
			timebaseDenom: 3,
		});
		events.push(finish(1, { timebaseNumer: 1, timebaseDenom: 1 }));
		expect(summarizeResources(events).collector).toMatchObject({
			timebaseNumer: 1,
			timebaseDenom: 1,
		});
	});
});
