#!/usr/bin/env node
/** Exploratory native consumer batches; no retained CSF or performance parity claim. */
import assert from 'node:assert/strict';
import { appendFile, cp, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { prepareConsumerProject, readGitState } from './consumer-project.mjs';
import fastAf from './fast-af.fixture.mjs';
import lushly from './lushly.fixture.mjs';
import { createCpuProfileControl } from './resources/cpu-profile-control.mjs';

const args = process.argv.slice(2);
const supported = new Set([
	'--consumer',
	'--batches',
	'--lifetime',
	'--out',
	'--fast-af',
	'--lushly',
]);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
	const name = args[index];
	const value = args[index + 1];
	if (!supported.has(name) || !value || value.startsWith('--') || options.has(name)) {
		throw new Error(`Invalid or repeated option: ${name}`);
	}
	options.set(name, value);
}
const descriptor = [fastAf, lushly].find((entry) => entry.name === options.get('--consumer'));
if (!descriptor) throw new Error('--consumer must select exactly one of fast-af or lushly');
const batches = Number(options.get('--batches') ?? '5');
if (!Number.isInteger(batches) || batches < 1 || batches > 10) {
	throw new Error('--batches must be an integer from 1 to 10');
}
const lifetime = options.get('--lifetime') ?? 'reuse';
if (!['reuse', 'batch'].includes(lifetime)) throw new Error('--lifetime must be reuse or batch');
const runtimeIsolation = process.env.SPECIMEN_BENCH_ISOLATION ?? 'in-process';
if (!['in-process', 'process'].includes(runtimeIsolation)) {
	throw new Error('SPECIMEN_BENCH_ISOLATION must be in-process or process');
}
const resourceEvents = process.env.SPECIMEN_RESOURCE_EVENTS;
const cpuProfileDirectory = process.env.SPECIMEN_CPU_PROFILE_DIRECTORY;
if (cpuProfileDirectory && (batches < 2 || lifetime !== 'reuse'))
	throw new Error('CPU profiling requires at least two batches and lifetime reuse');
const cpuProfiler = createCpuProfileControl(cpuProfileDirectory, runtimeIsolation);
const resourceIdleMs = resourceEvents ? Number(process.env.SPECIMEN_RESOURCE_IDLE_MS ?? '1000') : 0;
if (!Number.isInteger(resourceIdleMs) || resourceIdleMs < 0 || resourceIdleMs > 10_000) {
	throw new Error('SPECIMEN_RESOURCE_IDLE_MS must be an integer from 0 to 10000');
}
const output = resolve(options.get('--out') ?? `test-results/specimens-batches-${Date.now()}`);
const source = resolve(
	options.get(`--${descriptor.name}`) ?? join(homedir(), `github/${descriptor.name}`)
);
const apiPath = resolve(
	process.env.SPECIMEN_BENCH_API ?? join(import.meta.dirname, '../dist/index.js')
);
const { createSpecimenBench } = await import(pathToFileURL(apiPath).href);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Evidence output must be empty');
const directory = join(output, descriptor.name);
await mkdir(directory);
const json = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const errorText = (error) => {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	return error instanceof AggregateError
		? `${message}\n${error.errors.map(errorText).join('\n')}`
		: message;
};
let phaseId = 0;
async function phase(name, work, details = {}) {
	if (!resourceEvents) return work();
	const id = ++phaseId;
	const record = (event) =>
		appendFile(
			resourceEvents,
			`${JSON.stringify({
				type: 'phase',
				id,
				name,
				event,
				consumer: descriptor.name,
				...details,
				timestampMs: Date.now(),
			})}\n`
		);
	await record('start');
	let primary;
	let failed = false;
	let value;
	try {
		value = await work();
	} catch (error) {
		primary = error;
		failed = true;
	}
	try {
		await record('end');
	} catch (error) {
		if (failed) throw new AggregateError([primary, error], `Phase ${name} and event write failed`);
		throw error;
	}
	if (failed) throw primary;
	return value;
}
const idle = (name, details = {}) =>
	phase(name, () => new Promise((done) => setTimeout(done, resourceIdleMs)), details);
const expectedBenchStarts = lifetime === 'reuse' ? 1 : batches;
const expectedRenders = batches * descriptor.captures.length;
const result = {
	name: descriptor.name,
	status: 'failed',
	batchCount: batches,
	completedBatches: 0,
	expectedBenchStarts,
	actualBenchCreates: 0,
	actualBenchCloses: 0,
	capturesPerBatch: descriptor.captures.length,
	expectedRenders,
	successfulRenders: 0,
	verifiedCaptures: 0,
	batches: [],
	cleanupErrors: [],
};
const report = {
	formatVersion: 1,
	purpose: 'Exploratory repeated native consumer batches; no CSF or performance parity claim',
	createdUtc: new Date().toISOString(),
	afd: await readGitState(resolve(import.meta.dirname, '../../..')),
	runtime: { node: process.version, executable: process.execPath },
	apiPath,
	runtimeIsolation,
	conditions: {
		lifetime,
		batches,
		expectedBenchStarts,
		capturesPerBatch: descriptor.captures.length,
		expectedRenders,
		resourceEvents: resourceEvents ?? null,
		resourceIdleMs,
		memory:
			'Coordinator-only Node process counters; excludes isolated runtime and Chromium; not total suite memory',
		retention:
			'Only the current batch observations are retained in memory; full captures saved for first and last batches',
		context: 'Fresh browser context per render through the bench API',
		cpuProfiling: cpuProfileDirectory
			? 'Diagnostic rounds 2..N only; excluded from ordinary CPU/memory acceptance'
			: 'disabled',
	},
	consumers: [result],
};
let root;
let bench;
async function openBench(batchIndex) {
	await phase(
		'bench-create',
		async () => {
			bench = await createSpecimenBench({ root, runtimeIsolation });
			result.actualBenchCreates++;
		},
		{ batchIndex }
	);
}
async function closeBench(batchIndex) {
	if (!bench) return;
	const closing = bench;
	bench = undefined;
	await phase(
		'bench-close',
		async () => {
			await closing.close();
			result.actualBenchCloses++;
		},
		{ batchIndex }
	);
}
async function runBatch(batchIndex) {
	const captures = {};
	const timings = [];
	const start = performance.now();
	const cpu = process.cpuUsage();
	const retained = batchIndex === 1 || batchIndex === batches;
	const captureDirectory = join(directory, `batch-${batchIndex}`);
	if (retained) await mkdir(captureDirectory);
	for (const item of descriptor.captures) {
		const renderStart = performance.now();
		const capture = await phase(
			'render',
			() => bench.render({ ...item.request, timeoutMs: 20_000 }),
			{
				batchIndex,
				key: item.key,
				specimenId: item.request.id,
			}
		);
		assert.deepEqual(capture.channels.console.errors, [], `${item.key}: browser errors`);
		result.successfulRenders++;
		captures[item.key] = capture;
		timings.push({ key: item.key, elapsedMs: performance.now() - renderStart });
		if (retained) await json(join(captureDirectory, `${item.key}.json`), capture);
	}
	const findings = descriptor.verify(captures);
	result.verifiedCaptures += descriptor.captures.length;
	result.completedBatches++;
	const usedCpu = process.cpuUsage(cpu);
	const memory = process.memoryUsage();
	return {
		batchIndex,
		verifiedCaptures: descriptor.captures.length,
		findings,
		elapsedMs: performance.now() - start,
		renders: timings,
		coordinatorOnly: { cpuMs: (usedCpu.user + usedCpu.system) / 1000, ...memory },
		retainedCaptures: retained ? captureDirectory : null,
	};
}
try {
	if (resourceEvents) await idle('baseline-idle');
	root = await realpath(await mkdtemp(join(tmpdir(), `specimens-batches-${descriptor.name}-`)));
	result.snapshot = { executionRoot: root, retainedRoot: join(directory, 'project') };
	result.provenance = await phase('prepare', () =>
		prepareConsumerProject(descriptor, source, root)
	);
	await json(join(directory, 'capture-provenance.json'), {
		...result.provenance,
		captureIdentity:
			'neutral copied-source snapshot; raw capture Git/lock identities are unavailable',
		dependencyLimit:
			'declared lock hashes and installed versions are separate; installed links are not a frozen-lockfile installation',
	});
	if (lifetime === 'reuse') await openBench(1);
	for (let batchIndex = 1; batchIndex <= batches; batchIndex++) {
		if (cpuProfiler && batchIndex === 2) result.cpuProfileStarted = await cpuProfiler.start();
		if (lifetime === 'batch') await openBench(batchIndex);
		try {
			result.batches.push(await phase('batch', () => runBatch(batchIndex), { batchIndex }));
			if (resourceEvents && [1, 5, 10].includes(batchIndex))
				await idle('batch-idle', { batchIndex });
		} finally {
			if (lifetime === 'batch') {
				try {
					await closeBench(batchIndex);
				} catch (error) {
					result.cleanupErrors.push({
						operation: 'bench-close',
						batchIndex,
						error: errorText(error),
					});
				}
			}
		}
		if (result.cleanupErrors.length) break;
	}
	if (cpuProfiler) result.cpuProfiles = await cpuProfiler.stop();
} catch (error) {
	result.error = errorText(error);
} finally {
	try {
		await closeBench(result.completedBatches);
	} catch (error) {
		result.cleanupErrors.push({ operation: 'bench-close', error: errorText(error) });
	}
	try {
		if (resourceEvents) await idle('post-close-idle');
	} catch (error) {
		result.cleanupErrors.push({ operation: 'post-close-idle', error: errorText(error) });
	}
	try {
		result.consumerAfter = await readGitState(source);
		if (
			result.provenance &&
			JSON.stringify(result.provenance.before) !== JSON.stringify(result.consumerAfter)
		)
			result.checkoutChanged = true;
	} catch (error) {
		result.readbackError = errorText(error);
	}
	if (root) {
		try {
			await cp(root, join(directory, 'project'), { recursive: true });
		} catch (error) {
			result.snapshotError = errorText(error);
		}
		try {
			await rm(root, { recursive: true, force: true });
		} catch (error) {
			result.cleanupErrors.push({ operation: 'remove-project', error: errorText(error) });
		}
	}
	if (
		!result.error &&
		!result.readbackError &&
		!result.snapshotError &&
		!result.checkoutChanged &&
		result.cleanupErrors.length === 0 &&
		result.provenance &&
		result.consumerAfter &&
		result.completedBatches === batches &&
		result.batches.length === batches &&
		result.successfulRenders === expectedRenders &&
		result.verifiedCaptures === expectedRenders &&
		result.actualBenchCreates === expectedBenchStarts &&
		result.actualBenchCloses === expectedBenchStarts
	)
		result.status = 'passed';
	await json(join(directory, 'receipt.json'), result);
	await json(join(output, 'report.json'), report);
}
process.stdout.write(`${descriptor.name}: ${result.status}\nEvidence: ${output}\n`);
if (result.status !== 'passed') process.exitCode = 1;
