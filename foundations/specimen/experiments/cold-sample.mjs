#!/usr/bin/env node
/**
 * One cold candidate sample in a fresh Node process: import the API, create a bench, render one
 * case and close. The policy's cold condition is the first render after process start, which a
 * long-lived job process cannot provide for its later samples.
 */
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const [apiPath, root, request, runtimeIsolation, executablePath] = process.argv.slice(2);
const start = performance.now();
const { createSpecimenBench } = await import(pathToFileURL(apiPath).href);
const imported = performance.now();
const bench = await createSpecimenBench({
	root,
	runtimeIsolation,
	executablePath: executablePath || undefined,
});
let result;
try {
	const before = performance.now();
	const capture = await bench.render(JSON.parse(request));
	result = {
		status: capture.channels.console.errors.length ? 'failed' : 'passed',
		consoleErrors: capture.channels.console.errors,
		importMs: imported - start,
		renderMs: performance.now() - before,
		browser: capture.manifest.browser,
	};
} finally {
	await bench.close();
}
process.stdout.write(`${JSON.stringify({ ...result, inProcessMs: performance.now() - start })}\n`);
if (result.status !== 'passed') process.exitCode = 1;
