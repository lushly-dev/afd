#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { calibrate } from './resources/calibrate.mjs';
import { apiIdentity } from './resources/heap.mjs';
import { admission, hostSnapshot } from './resources/host.mjs';
import { buildCollector, readJsonLines, runCollected } from './resources/native.mjs';
import { summarizeResources } from './resources/summary.mjs';

const args = process.argv.slice(2);
function option(name, fallback) {
	const index = args.indexOf(name);
	return index < 0 ? fallback : args[index + 1];
}
const directory = resolve(option('--out', `test-results/specimens-resources-${Date.now()}`));
const samples = Number(option('--samples', '5'));
if (!Number.isInteger(samples) || samples < 1 || samples > 20)
	throw new Error('--samples must be 1..20');
const selected = option('--consumer', 'all');
const workload = option('--workload', 'consumer');
if (!['consumer', 'batches'].includes(workload))
	throw new Error('--workload must be consumer or batches');
const batches = Number(option('--batches', '5'));
if (!Number.isInteger(batches) || batches < 1 || batches > 10)
	throw new Error('--batches must be 1..10');
const lifetime = option('--lifetime', 'reuse');
if (!['reuse', 'batch'].includes(lifetime)) throw new Error('--lifetime must be reuse or batch');
const runtimeIsolation = option('--isolation', 'in-process');
if (!['in-process', 'process'].includes(runtimeIsolation))
	throw new Error('--isolation must be in-process or process');
const consumers = ['fast-af', 'lushly'].filter((name) => selected === 'all' || name === selected);
if (!consumers.length) throw new Error('--consumer must be all, fast-af or lushly');
await mkdir(directory, { recursive: true });
if ((await readdir(directory)).length) throw new Error('Resource evidence directory must be empty');
const json = (file, data) => writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
const implementationFiles = [
	'run-resources.mjs',
	'run-consumers.mjs',
	'run-batches.mjs',
	'consumer-project.mjs',
	'fast-af.fixture.mjs',
	'lushly.fixture.mjs',
	...(await readdir(join(import.meta.dirname, 'resources')))
		.filter((file) => /\.(?:mjs|c)$/.test(file))
		.map((file) => `resources/${file}`),
];
async function implementationDigests() {
	return Object.fromEntries(
		await Promise.all(
			implementationFiles.map(async (file) => [
				file,
				createHash('sha256')
					.update(await readFile(join(import.meta.dirname, file)))
					.digest('hex'),
			])
		)
	);
}
const report = {
	formatVersion: 1,
	runtimeIsolation,
	workload,
	...(workload === 'batches' ? { batches, lifetime } : {}),
	createdUtc: new Date().toISOString(),
	status: 'failed',
	purpose: 'Single-job native resource pilot; no incumbent savings or concurrency claim',
	runtime: { node: process.version, executable: process.execPath },
	host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model },
	budgets: {
		concurrentJobs: 1,
		minFreeMemoryPercent: 25,
		reservedCores: 2,
		maxFootprintBytes: 2 * 1024 ** 3,
		intervalMs: 100,
		graceMs: 500,
		idleWindowMs: 1000,
		timeoutMs: 120_000,
	},
	consumers: [],
	implementationBefore: await implementationDigests(),
};
try {
	if (process.platform !== 'darwin') {
		report.status = 'unsupported';
		throw new Error(
			'Whole-process collector requires macOS and Xcode command-line tools; unsupported metrics are not reported as zero.'
		);
	}
	report.hostBefore = await hostSnapshot();
	report.admission = admission(report.hostBefore, report.budgets);
	if (!report.admission.admitted)
		throw new Error(`Host admission: ${report.admission.reasons.join(', ')}`);
	report.collector = await buildCollector(join(directory, 'collector'));
	report.calibration = await calibrate(
		report.collector,
		join(directory, 'calibration'),
		report.budgets
	);
	await json(join(directory, 'calibration.json'), report.calibration);
	for (const consumer of consumers) {
		const profile = { consumer, status: 'failed' };
		report.consumers.push(profile);
		const profileDirectory = join(directory, consumer);
		await mkdir(profileDirectory);
		try {
			profile.hostBefore = await hostSnapshot();
			profile.admission = admission(profile.hostBefore, report.budgets);
			if (!profile.admission.admitted)
				throw new Error(`Host admission: ${profile.admission.reasons.join(', ')}`);
			const probeOutput = join(profileDirectory, 'probe');
			const phasesFile = join(profileDirectory, 'phases.jsonl');
			const childArgs = [
				join(import.meta.dirname, workload === 'batches' ? 'run-batches.mjs' : 'run-consumers.mjs'),
				'--consumer',
				consumer,
				'--out',
				probeOutput,
			];
			if (workload === 'batches')
				childArgs.push('--batches', String(batches), '--lifetime', lifetime);
			else childArgs.push('--samples', String(samples));
			for (const name of ['--fast-af', '--lushly']) {
				const value = option(name);
				if (value) childArgs.push(name, resolve(value));
			}
			const observerCpu = process.cpuUsage();
			const apiPath = resolve(option('--api', join(import.meta.dirname, '../dist/index.js')));
			profile.apiBefore = await apiIdentity(apiPath);
			const run = await runCollected({
				collector: report.collector,
				directory: profileDirectory,
				command: process.execPath,
				args: childArgs,
				env: {
					SPECIMEN_BENCH_ISOLATION: runtimeIsolation,
					...(option('--api') ? { SPECIMEN_BENCH_API: resolve(option('--api')) } : {}),
					SPECIMEN_RESOURCE_EVENTS: phasesFile,
					SPECIMEN_RESOURCE_IDLE_MS: String(report.budgets.idleWindowMs),
				},
				...report.budgets,
			});
			profile.controllerCpu = process.cpuUsage(observerCpu);
			profile.apiAfter = await apiIdentity(apiPath);
			profile.controllerRssBytes = process.memoryUsage().rss;
			profile.collectorExit = {
				code: run.code,
				signal: run.signal,
				timedOut: run.timedOut,
				forcedKill: run.forcedKill,
				parseError: run.parseError,
				timeoutCleanup: run.timeoutCleanup,
			};
			const probeReport = JSON.parse(await readFile(join(probeOutput, 'report.json'), 'utf8'));
			const phases = await readJsonLines(phasesFile);
			const result = probeReport.consumers.find((entry) => entry.name === consumer);
			profile.resources = summarizeResources(run.events, {
				phases,
				successfulRenders: result.successfulRenders,
				verifiedCaptures: result.verifiedCaptures,
			});
			profile.provenance = result.provenance;
			profile.consumerAfter = result.consumerAfter;
			profile.probeStatus = result.status;
			profile.probeReport = join(probeOutput, 'report.json');
			if (workload === 'batches') {
				profile.batchWorkload = {
					batchCount: result.batchCount,
					batches: result.batches,
					lifetime,
					expectedBenchStarts: result.expectedBenchStarts,
					actualBenchCreates: result.actualBenchCreates,
					actualBenchCloses: result.actualBenchCloses,
					capturesPerBatch: result.capturesPerBatch,
				};
			}
			profile.hostAfter = await hostSnapshot();
			profile.hostChanges = {
				swapUsedBytes:
					profile.hostBefore.swapUsedBytes === null || profile.hostAfter.swapUsedBytes === null
						? null
						: profile.hostAfter.swapUsedBytes - profile.hostBefore.swapUsedBytes,
				compressorBytes:
					profile.hostBefore.compressorBytes === null || profile.hostAfter.compressorBytes === null
						? null
						: profile.hostAfter.compressorBytes - profile.hostBefore.compressorBytes,
				attribution: 'Host-wide background activity included; not exclusive bench effects',
			};
			const final = run.events.findLast((event) => event.type === 'summary');
			profile.samplerMemory = {
				footprintBytes: final?.samplerFootprintBytes ?? null,
				rssBytes: final?.samplerRssBytes ?? null,
				lifetimeMaxFootprintBytes: final?.samplerLifetimeMaxFootprintBytes ?? null,
			};
			profile.status =
				run.code === 0 &&
				JSON.stringify(profile.apiBefore) === JSON.stringify(profile.apiAfter) &&
				!run.timedOut &&
				!run.parseError &&
				result.status === 'passed' &&
				profile.resources.status === 'complete'
					? 'passed'
					: 'failed';
		} catch (error) {
			profile.error = error.stack ?? String(error);
		}
		await json(join(profileDirectory, 'resources.json'), profile);
		process.stdout.write(`${consumer}: ${profile.status}\n`);
	}
	report.status = report.consumers.every((entry) => entry.status === 'passed')
		? 'passed'
		: 'failed';
} catch (error) {
	report.error = error.stack ?? String(error);
} finally {
	report.hostAfter = await hostSnapshot();
	report.implementationAfter = await implementationDigests();
	if (JSON.stringify(report.implementationBefore) !== JSON.stringify(report.implementationAfter)) {
		report.status = 'failed';
		report.implementationChanged = true;
	}
	report.driverSha256 = createHash('sha256')
		.update(await readFile(import.meta.filename))
		.digest('hex');
	await json(join(directory, 'resource-report.json'), report);
	process.stdout.write(`Resource evidence: ${directory}\n`);
}
if (report.status !== 'passed') process.exitCode = 1;
