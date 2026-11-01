#!/usr/bin/env node
import assert from 'node:assert/strict';
/** Exploratory native wrappers; this does not execute or compare retained CSF suites. */
import { execFile as execFileCallback } from 'node:child_process';
import {
	appendFile,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import { cpus, freemem, homedir, loadavg, platform, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readGitState as git, prepareConsumerProject } from './consumer-project.mjs';
import fastAf from './fast-af.fixture.mjs';
import lushly from './lushly.fixture.mjs';

const apiPath = resolve(
	process.env.SPECIMEN_BENCH_API ?? join(import.meta.dirname, '../dist/index.js')
);
const { createSpecimenBench, diffObservations } = await import(pathToFileURL(apiPath).href);
const runtimeIsolation = process.env.SPECIMEN_BENCH_ISOLATION ?? 'in-process';
if (!['in-process', 'process'].includes(runtimeIsolation))
	throw new Error('SPECIMEN_BENCH_ISOLATION must be in-process or process');
// T04 runs each pair on the incumbent's browser build; unset uses Playwright's own.
const executablePath = process.env.SPECIMEN_BENCH_EXECUTABLE || undefined;
const coldProcess = process.env.SPECIMEN_COLD_PROCESS === '1';
// A pair driver prepares the project outside the measured job, so the job holds only the
// tool's own work; its provenance sits beside the root as <root>.provenance.json.
const preparedRoot = process.env.SPECIMEN_PREPARED_ROOT || undefined;

const execFile = promisify(execFileCallback);
const args = process.argv.slice(2);
function option(name, fallback) {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
}
const output = resolve(option('--out', `test-results/specimens-consumers-${Date.now()}`));
const samples = Number(option('--samples', '5'));
if (!Number.isInteger(samples) || samples < 1 || samples > 20) {
	throw new Error('--samples must be an integer from 1 to 20');
}
const resourceEvents = process.env.SPECIMEN_RESOURCE_EVENTS;
const resourceIdleMs = resourceEvents ? Number(process.env.SPECIMEN_RESOURCE_IDLE_MS ?? '1000') : 0;
if (!Number.isInteger(resourceIdleMs) || resourceIdleMs < 0 || resourceIdleMs > 10_000) {
	throw new Error('SPECIMEN_RESOURCE_IDLE_MS must be an integer from 0 to 10000');
}
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
				...details,
				timestampMs: Date.now(),
			})}\n`
		);
	await record('start');
	try {
		return await work();
	} finally {
		await record('end');
	}
}
const idle = (name, consumer) =>
	phase(name, () => new Promise((resolveIdle) => setTimeout(resolveIdle, resourceIdleMs)), {
		consumer,
	});
const roots = {
	'fast-af': resolve(option('--fast-af', join(homedir(), 'github/fast-af'))),
	lushly: resolve(option('--lushly', join(homedir(), 'github/lushly'))),
};
const selected = option('--consumer', 'all');
const descriptors = [fastAf, lushly].filter(
	(entry) => selected === 'all' || entry.name === selected
);
if (!descriptors.length) throw new Error('Unknown --consumer; use fast-af, lushly or all');
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Evidence output must be empty');
const json = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
async function workloads() {
	const { stdout } = await execFile('ps', ['-axo', 'comm=']);
	return {
		loadAverage: loadavg(),
		freeBytes: freemem(),
		nodeProcesses: stdout.split('\n').filter((line) => /(?:^|\/)node$/.test(line.trim())).length,
		chromiumProcesses: stdout.split('\n').filter((line) => /Chromium/.test(line)).length,
	};
}
function summary(values) {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return {
		median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
		min: sorted[0],
		max: sorted.at(-1),
	};
}
async function measuredRender(render) {
	const cpu = process.cpuUsage();
	const start = performance.now();
	const capture = await render();
	const elapsedMs = performance.now() - start;
	const used = process.cpuUsage(cpu);
	return {
		capture,
		metrics: {
			elapsedMs,
			nodeCpuMs: (used.user + used.system) / 1000,
			nodeRssBytes: process.memoryUsage().rss,
		},
	};
}
const report = {
	formatVersion: 1,
	purpose: 'Exploratory native consumer observation; no CSF or performance parity claim',
	createdUtc: new Date().toISOString(),
	afd: await git(resolve(import.meta.dirname, '../../..')),
	runtime: { node: process.version, executable: process.execPath },
	apiPath,
	runtimeIsolation,
	executablePath: executablePath ?? null,
	host: {
		platform: platform(),
		release: release(),
		cpus: cpus().length,
		cpu: cpus()[0]?.model,
		totalBytes: totalmem(),
	},
	conditions: {
		workers: 1,
		samples,
		cold: 'new Vite bench/cache directory and Chromium process; OS/package caches retained',
		warm: 'primed Vite bench/Chromium process; fresh browser context per render',
		memory: 'Node coordinator RSS only; excludes Chromium and is not total suite memory',
		resourceEvents: resourceEvents ?? null,
		resourceIdleMs,
		performance:
			'pilot timing under shared host load; no incumbent baseline or fixed acceptance tolerances',
	},
	workloadBefore: await workloads(),
	consumers: [],
};
for (const descriptor of descriptors) {
	const directory = join(output, descriptor.name);
	await mkdir(directory);
	const result = {
		name: descriptor.name,
		status: 'failed',
		successfulRenders: 0,
		verifiedCaptures: 0,
	};
	report.consumers.push(result);
	const observe = async (bench, request, details = {}) => {
		const capture = await phase('render', () => bench.render(request), {
			consumer: descriptor.name,
			specimenId: request.id,
			...details,
		});
		assert.deepEqual(capture.channels.console.errors, [], `${request.id}: browser errors`);
		result.successfulRenders++;
		return capture;
	};
	let root;
	try {
		if (resourceEvents) await idle('baseline-idle', descriptor.name);
		// A neutral temporary root avoids inheriting AFD's Git and lockfile identities.
		if (preparedRoot) {
			root = await realpath(preparedRoot);
			result.snapshot = { executionRoot: root, preparedOutsideJob: true };
			result.provenance = JSON.parse(await readFile(`${root}.provenance.json`, 'utf8'));
		} else {
			root = await realpath(await mkdtemp(join(tmpdir(), `specimens-${descriptor.name}-`)));
			result.snapshot = { executionRoot: root, retainedRoot: join(directory, 'project') };
			result.provenance = await phase(
				'prepare',
				() => prepareConsumerProject(descriptor, roots[descriptor.name], root),
				{
					consumer: descriptor.name,
				}
			);
		}
		await json(join(directory, 'capture-provenance.json'), {
			...result.provenance,
			captureIdentity:
				'neutral copied-source snapshot; raw capture Git/lock identities are unavailable',
			dependencyLimit:
				'declared lock hashes and installed versions are separate; installed links are not a frozen-lockfile installation',
		});
		const captures = {};
		const bench = await phase(
			'bench-create',
			() => createSpecimenBench({ root, runtimeIsolation, executablePath }),
			{
				consumer: descriptor.name,
				kind: 'warm',
			}
		);
		try {
			for (const item of descriptor.captures) {
				const capture = await observe(
					bench,
					{ ...item.request, timeoutMs: 20_000 },
					{ kind: 'assertion', key: item.key }
				);
				captures[item.key] = capture;
				await json(join(directory, `${item.key}.json`), capture);
				assert.deepEqual(capture.channels.console.errors, [], `${item.key}: browser errors`);
			}
			result.findings = descriptor.verify(captures);
			result.verifiedCaptures = descriptor.captures.length;
			const request = descriptor.captures[0].request;
			const repeat = await observe(bench, request, { kind: 'repeat' });
			result.repeat = diffObservations(captures[descriptor.captures[0].key], repeat);
			await json(join(directory, 'repeat-diff.json'), result.repeat);
			const capture = captures[descriptor.captures[0].key];
			const timings = [];
			await phase(
				'comparison',
				async () => {
					for (let index = 0; index < 100; index++) {
						const start = performance.now();
						diffObservations(capture, repeat);
						timings.push(performance.now() - start);
					}
				},
				{ consumer: descriptor.name }
			);
			result.comparison = {
				iterations: 100,
				milliseconds: summary(timings),
				elements: capture.channels.elements.length,
			};
			result.warm = [];
			for (let index = 0; index < samples; index++) {
				result.warm.push(
					(await measuredRender(() => observe(bench, request, { kind: 'warm', index }))).metrics
				);
			}
			result.warmMilliseconds = summary(result.warm.map((sample) => sample.elapsedMs));
			if (resourceEvents) await idle('warm-idle', descriptor.name);
		} finally {
			await phase('bench-close', () => bench.close(), { consumer: descriptor.name, kind: 'warm' });
		}
		if (resourceEvents) await idle('post-close-idle', descriptor.name);
		result.cold = [];
		for (let index = 0; index < samples && coldProcess; index++) {
			// Policy cold: the first render after process start, so each sample is a new process.
			const start = performance.now();
			const { stdout } = await phase(
				'cold-process',
				() =>
					execFile(process.execPath, [
						join(import.meta.dirname, 'cold-sample.mjs'),
						apiPath,
						root,
						JSON.stringify(descriptor.captures[0].request),
						runtimeIsolation,
						executablePath ?? '',
					]),
				{ consumer: descriptor.name, kind: 'cold', index }
			);
			const sample = JSON.parse(stdout.trim().split('\n').at(-1));
			assert.equal(sample.status, 'passed', `cold sample ${index}: browser errors`);
			result.successfulRenders++;
			result.cold.push({ ...sample, startupAndRenderMs: performance.now() - start });
		}
		for (let index = 0; index < samples && !coldProcess; index++) {
			const start = performance.now();
			const cold = await phase(
				'bench-create',
				() => createSpecimenBench({ root, runtimeIsolation, executablePath }),
				{
					consumer: descriptor.name,
					kind: 'cold',
					index,
				}
			);
			try {
				const sample = await measuredRender(() =>
					observe(cold, descriptor.captures[0].request, { kind: 'cold', index })
				);
				result.cold.push({ ...sample.metrics, startupAndRenderMs: performance.now() - start });
			} finally {
				await phase('bench-close', () => cold.close(), {
					consumer: descriptor.name,
					kind: 'cold',
					index,
				});
			}
		}
		result.coldMilliseconds = summary(result.cold.map((sample) => sample.startupAndRenderMs));
		result.coldMode = coldProcess ? 'new process per sample' : 'new bench in the job process';
		if (resourceEvents) await idle('final-idle', descriptor.name);
		result.status = 'passed';
	} catch (error) {
		result.error = error instanceof Error ? error.stack : String(error);
	} finally {
		// With a prepared root, the driver reads the snapshot back and retains the project.
		try {
			if (!preparedRoot) result.consumerAfter = await git(roots[descriptor.name]);
			if (
				!preparedRoot &&
				result.provenance &&
				JSON.stringify(result.provenance.before) !== JSON.stringify(result.consumerAfter)
			) {
				result.status = 'failed';
				result.checkoutChanged = true;
			}
		} catch (error) {
			result.status = 'failed';
			result.readbackError = error instanceof Error ? error.message : String(error);
		}
		if (root && !preparedRoot) {
			try {
				await cp(root, join(directory, 'project'), { recursive: true });
			} catch (error) {
				result.status = 'failed';
				result.snapshotError = error instanceof Error ? error.message : String(error);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		}
		await json(join(directory, 'receipt.json'), result);
	}
	process.stdout.write(`${descriptor.name}: ${result.status}\n`);
}
report.workloadAfter = await workloads();
await json(join(output, 'report.json'), report);
process.stdout.write(`Evidence: ${output}\n`);
if (report.consumers.some((result) => result.status !== 'passed')) process.exitCode = 1;
