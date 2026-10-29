#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { admission, hostSnapshot } from './resources/host.mjs';
import { buildCollector, readJsonLines, runCollected } from './resources/native.mjs';
import { summarizeResources } from './resources/summary.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index < 0 ? fallback : args[index + 1];
};
const output = resolve(option('--out', `test-results/specimen-heap-profile-${Date.now()}`));
const selected = option('--consumer', 'all');
const runtimeIsolation = option('--isolation', 'in-process');
if (!['in-process', 'process'].includes(runtimeIsolation))
	throw new Error('--isolation must be in-process or process');
const consumers = ['fast-af', 'lushly'].filter((name) => selected === 'all' || name === selected);
if (!consumers.length) throw new Error('Unknown consumer');
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Output must be empty');
const implementationFiles = [
	'run-heap-profile.mjs',
	'profile-heap.mjs',
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
	status: 'failed',
	runtimeIsolation,
	implementationBefore: await implementationDigests(),
	scope:
		'Diagnostic main-isolate allocation sampling with controlled GC, not ordinary latency/resource acceptance',
	consumers: [],
};
const json = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
try {
	report.hostBefore = await hostSnapshot();
	report.admission = admission(report.hostBefore);
	if (!report.admission.admitted)
		throw new Error(`Host admission: ${report.admission.reasons.join(', ')}`);
	const collector = await buildCollector(join(output, 'collector'));
	report.collector = collector;
	for (const consumer of consumers) {
		const directory = join(output, consumer);
		await mkdir(directory);
		const host = await hostSnapshot();
		if (!admission(host).admitted) throw new Error(`Host admission held before ${consumer}`);
		const childArgs = [
			join(import.meta.dirname, 'profile-heap.mjs'),
			'--consumer',
			consumer,
			'--out',
			join(directory, 'probe'),
			'--batches',
			option('--batches', '3'),
			'--isolation',
			runtimeIsolation,
		];
		for (const name of ['--api']) {
			const value = option(name);
			if (value) childArgs.push(name, resolve(value));
		}
		const source = option(`--${consumer}`, option('--source'));
		if (source) childArgs.push('--source', resolve(source));
		const phasesFile = join(directory, 'phases.jsonl');
		const run = await runCollected({
			collector,
			directory,
			command: process.execPath,
			args: childArgs,
			env: { SPECIMEN_RESOURCE_EVENTS: phasesFile },
		});
		const heap = JSON.parse(await readFile(join(directory, 'probe/heap-report.json'), 'utf8'));
		const resources = summarizeResources(run.events, {
			phases: await readJsonLines(phasesFile),
			successfulRenders: heap.successfulRenders,
			verifiedCaptures: heap.verifiedCaptures,
		});
		const result = {
			consumer,
			status:
				run.code === 0 &&
				!run.timedOut &&
				!run.parseError &&
				heap.status === 'passed' &&
				resources.status === 'complete'
					? 'passed'
					: 'failed',
			heap,
			resources,
		};
		report.consumers.push(result);
		await json(join(directory, 'profile.json'), result);
		process.stdout.write(`${consumer}: ${result.status}\n`);
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
	await json(join(output, 'heap-profile-report.json'), report);
}
process.stdout.write(`Heap profile: ${output}\n`);
if (report.status !== 'passed') process.exitCode = 1;
