#!/usr/bin/env node
/**
 * One cold candidate sample in a fresh Node process: import the API, create a bench, render one
 * case and close. The policy's cold condition is the first render after process start, which a
 * long-lived job process cannot provide for its later samples. Each stage reports its wall time
 * and this process's CPU, so a cold start can be attributed.
 */
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const [apiPath, root, request, runtimeIsolation, executablePath] = process.argv.slice(2);
const stages = {};
async function stage(name, work) {
	const start = performance.now();
	const cpu = process.cpuUsage();
	try {
		return await work();
	} finally {
		const used = process.cpuUsage(cpu);
		stages[name] = { wallMs: performance.now() - start, cpuMs: (used.user + used.system) / 1000 };
	}
}
// Node's own start-up before this module ran.
const startupMs = performance.now();
const start = performance.now();
const { createSpecimenBench } = await stage('import', () => import(pathToFileURL(apiPath).href));
const bench = await stage('create', () =>
	createSpecimenBench({ root, runtimeIsolation, executablePath: executablePath || undefined })
);
let result;
try {
	const capture = await stage('render', () => bench.render(JSON.parse(request)));
	result = {
		status: capture.channels.console.errors.length ? 'failed' : 'passed',
		consoleErrors: capture.channels.console.errors,
		browser: capture.manifest.browser,
	};
} finally {
	await stage('close', () => bench.close());
}
const total = process.cpuUsage();
process.stdout.write(
	`${JSON.stringify({
		...result,
		stages,
		importMs: stages.import.wallMs,
		renderMs: stages.render.wallMs,
		inProcessMs: performance.now() - start,
		processCpuMs: (total.user + total.system) / 1000,
		uptimeMs: process.uptime() * 1000,
		startupMs,
	})}\n`
);
if (result.status !== 'passed') process.exitCode = 1;
