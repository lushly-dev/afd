#!/usr/bin/env node
import assert from 'node:assert/strict';
/** Exploratory native wrappers; this does not execute or compare retained CSF suites. */
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { cpus, freemem, homedir, loadavg, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { createSpecimenBench, diffObservations } from '../dist/index.js';
import fastAf from './fast-af.fixture.mjs';
import lushly from './lushly.fixture.mjs';

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
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function git(root) {
	const run = async (...command) => (await execFile('git', ['-C', root, ...command])).stdout.trim();
	return {
		root,
		revision: await run('rev-parse', 'HEAD'),
		status: await run('status', '--porcelain'),
	};
}
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
async function measuredRender(bench, request) {
	const cpu = process.cpuUsage();
	const start = performance.now();
	const capture = await bench.render(request);
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
async function prepare(descriptor, destination) {
	const source = roots[descriptor.name];
	const before = await git(source);
	if (before.status) throw new Error(`Consumer checkout must be clean: ${source}`);
	await mkdir(destination, { recursive: true });
	for (const path of descriptor.paths) {
		await mkdir(dirname(join(destination, path)), { recursive: true });
		await cp(join(source, path), join(destination, path), { recursive: true });
	}
	const dependencies = [];
	for (const link of descriptor.dependencyLinks) {
		const target = await realpath(join(source, link.from));
		await mkdir(dirname(join(destination, link.to)), { recursive: true });
		await symlink(target, join(destination, link.to), 'dir');
		dependencies.push({ ...link, target });
	}
	await writeFile(join(destination, 'probe.ts'), descriptor.source);
	await json(join(destination, 'specimen.config.json'), { specimens: descriptor.specimens });
	if (descriptor.tsconfig) await json(join(destination, 'tsconfig.json'), descriptor.tsconfig);
	for (const [file, content] of Object.entries(descriptor.generatedFiles ?? {})) {
		await mkdir(dirname(join(destination, file)), { recursive: true });
		await writeFile(join(destination, file), content);
	}
	const installed = [];
	for (const base of [
		'node_modules',
		'apps/web/node_modules',
		'packages/violet-elements/node_modules',
	]) {
		for (const name of [
			'vite',
			'vitest',
			'playwright',
			'storybook',
			'@lushly-dev/fast-element',
			'@microsoft/fast-element',
			'@lushly-dev/violet-elements',
		]) {
			try {
				const file = join(source, base, name, 'package.json');
				const pkg = JSON.parse(await readFile(file, 'utf8'));
				installed.push({ name, version: pkg.version, path: await realpath(file) });
			} catch {
				/* Absent packages are not part of this link's installed graph. */
			}
		}
	}
	const declaredInputs = [];
	for (const file of ['pnpm-lock.yaml', 'package.json', 'apps/web/package.json']) {
		try {
			declaredInputs.push({ file, sha256: hash(await readFile(join(source, file))) });
		} catch {
			/* This consumer may not have a web workspace or pnpm lockfile. */
		}
	}
	return {
		before,
		dependencies,
		installed,
		declaredInputs,
		wrapperSha256: hash(descriptor.source),
	};
}
const report = {
	formatVersion: 1,
	purpose: 'Exploratory native consumer observation; no CSF or performance parity claim',
	createdUtc: new Date().toISOString(),
	afd: await git(resolve(import.meta.dirname, '../../..')),
	runtime: { node: process.version, executable: process.execPath },
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
		performance:
			'pilot timing under shared host load; no incumbent baseline or fixed acceptance tolerances',
	},
	workloadBefore: await workloads(),
	consumers: [],
};
for (const descriptor of descriptors) {
	const directory = join(output, descriptor.name);
	await mkdir(directory);
	const result = { name: descriptor.name, status: 'failed' };
	report.consumers.push(result);
	let root;
	try {
		// A neutral temporary root avoids inheriting AFD's Git and lockfile identities.
		root = await realpath(await mkdtemp(join(tmpdir(), `specimens-${descriptor.name}-`)));
		result.snapshot = { executionRoot: root, retainedRoot: join(directory, 'project') };
		result.provenance = await prepare(descriptor, root);
		await json(join(directory, 'capture-provenance.json'), {
			...result.provenance,
			captureIdentity:
				'neutral copied-source snapshot; raw capture Git/lock identities are unavailable',
			dependencyLimit:
				'declared lock hashes and installed versions are separate; installed links are not a frozen-lockfile installation',
		});
		const captures = {};
		const bench = await createSpecimenBench({ root });
		try {
			for (const item of descriptor.captures) {
				const capture = await bench.render({ ...item.request, timeoutMs: 20_000 });
				captures[item.key] = capture;
				await json(join(directory, `${item.key}.json`), capture);
				assert.deepEqual(capture.channels.console.errors, [], `${item.key}: browser errors`);
			}
			result.findings = descriptor.verify(captures);
			const request = descriptor.captures[0].request;
			const repeat = await bench.render(request);
			result.repeat = diffObservations(captures[descriptor.captures[0].key], repeat);
			await json(join(directory, 'repeat-diff.json'), result.repeat);
			const capture = captures[descriptor.captures[0].key];
			const timings = [];
			for (let index = 0; index < 100; index++) {
				const start = performance.now();
				diffObservations(capture, repeat);
				timings.push(performance.now() - start);
			}
			result.comparison = {
				iterations: 100,
				milliseconds: summary(timings),
				elements: capture.channels.elements.length,
			};
			result.warm = [];
			for (let index = 0; index < samples; index++) {
				result.warm.push((await measuredRender(bench, request)).metrics);
			}
			result.warmMilliseconds = summary(result.warm.map((sample) => sample.elapsedMs));
		} finally {
			await bench.close();
		}
		result.cold = [];
		for (let index = 0; index < samples; index++) {
			const start = performance.now();
			const cold = await createSpecimenBench({ root });
			try {
				const sample = await measuredRender(cold, descriptor.captures[0].request);
				result.cold.push({ ...sample.metrics, startupAndRenderMs: performance.now() - start });
			} finally {
				await cold.close();
			}
		}
		result.coldMilliseconds = summary(result.cold.map((sample) => sample.startupAndRenderMs));
		result.status = 'passed';
	} catch (error) {
		result.error = error instanceof Error ? error.stack : String(error);
	} finally {
		try {
			result.consumerAfter = await git(roots[descriptor.name]);
			if (
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
		if (root) {
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
