#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFile, cp, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareConsumerProject, readGitState } from './consumer-project.mjs';
import fastAf from './fast-af.fixture.mjs';
import lushly from './lushly.fixture.mjs';
import { apiIdentity, createHeapSampler } from './resources/heap.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index < 0 ? fallback : args[index + 1];
};
const output = resolve(option('--out', `test-results/specimen-heap-${Date.now()}`));
const consumer = option('--consumer', 'fast-af');
const descriptor = [fastAf, lushly].find((entry) => entry.name === consumer);
if (!descriptor) throw new Error('Unknown consumer');
const source = resolve(option('--source', join(homedir(), 'github', consumer)));
const batches = Number(option('--batches', '3'));
if (!Number.isInteger(batches) || batches < 1 || batches > 5)
	throw new Error('--batches must be 1..5');
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Heap output must be empty');
const apiPath = resolve(option('--api', join(import.meta.dirname, '../dist/index.js')));
const runtimeIsolation = option('--isolation', 'in-process');
if (!['in-process', 'process'].includes(runtimeIsolation))
	throw new Error('--isolation must be in-process or process');
const phasesFile = process.env.SPECIMEN_RESOURCE_EVENTS;
const json = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = {
	consumer,
	source,
	apiPath,
	runtimeIsolation,
	batches,
	status: 'failed',
	node: process.version,
	successfulRenders: 0,
	verifiedCaptures: 0,
	conditions: {
		forcedGc: 'Explicit diagnostic checkpoints only',
		allocationSampleIntervalBytes: 32768,
		idleWindowMs: 500,
		retainClosedBenches: true,
		noHeapSnapshots: true,
	},
	points: [],
	apiBefore: await apiIdentity(apiPath),
};
const sampler = await createHeapSampler();
let phaseId = 0;
async function checkpoint(name, { gc = false, weak = [] } = {}) {
	if (gc) await sampler.collectGarbage();
	const id = ++phaseId;
	const phase = async (event) => {
		if (phasesFile)
			await appendFile(
				phasesFile,
				`${JSON.stringify({ type: 'phase', id, name, event, consumer, timestampMs: Date.now() })}\n`
			);
	};
	await phase('start');
	await pause(500);
	const { profile, ...point } = await sampler.sample();
	const result = {
		name,
		gc,
		timestampMs: Date.now(),
		...point,
		weakBenchesAlive: weak.filter((reference) => reference.deref() !== undefined).length,
	};
	report.points.push(result);
	await json(join(output, `${name}.heapprofile.json`), profile);
	await phase('end');
	await json(join(output, 'heap-report.json'), report);
	return result;
}
let root;
const held = [];
const weak = [];
try {
	await checkpoint('before-api-import', { gc: true });
	const { createSpecimenBench } = await import(pathToFileURL(apiPath).href);
	await checkpoint('after-api-import', { gc: true });
	root = await realpath(await mkdtemp(join(tmpdir(), `specimen-heap-${consumer}-`)));
	report.provenance = await prepareConsumerProject(descriptor, source, root);
	for (let batch = 1; batch <= batches; batch++) {
		let bench = await createSpecimenBench({ root, runtimeIsolation });
		try {
			const captures = {};
			for (const entry of descriptor.captures) {
				const capture = await bench.render({ ...entry.request, timeoutMs: 20_000 });
				assert.deepEqual(capture.channels.console.errors, []);
				captures[entry.key] = capture;
				report.successfulRenders++;
			}
			descriptor.verify(captures);
			report.verifiedCaptures += descriptor.captures.length;
			await checkpoint(`batch-${batch}-active`);
		} finally {
			await bench.close();
		}
		held.push(bench);
		weak.push(new WeakRef(bench));
		bench = null;
		await checkpoint(`batch-${batch}-closed-natural`, { weak });
		await checkpoint(`batch-${batch}-closed-gc`, { gc: true, weak });
	}
	held.length = 0;
	await new Promise((resolve) => setImmediate(resolve));
	await checkpoint('all-closed-released-gc', { gc: true, weak });
	report.consumerAfter = await readGitState(source);
	assert.deepEqual(report.consumerAfter, report.provenance.before);
	report.status = 'passed';
} catch (error) {
	report.error = error.stack ?? String(error);
} finally {
	for (const bench of held) await bench.close();
	await sampler.close();
	report.apiAfter = await apiIdentity(apiPath);
	if (JSON.stringify(report.apiBefore) !== JSON.stringify(report.apiAfter)) {
		report.status = 'failed';
		report.apiChanged = true;
	}
	if (root) {
		try {
			await cp(root, join(output, 'project'), { recursive: true });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
	await json(join(output, 'heap-report.json'), report);
}
process.stdout.write(`${consumer}: ${report.status}\n`);
if (report.status !== 'passed') process.exitCode = 1;
