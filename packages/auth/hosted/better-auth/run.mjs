import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildFixture } from './build.mjs';
import { deadline, hostedConfig } from './contract.ts';

let directory;
const abort = new AbortController();
const interrupt = () => abort.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
	if (Number(process.versions.node.split('.')[0]) < 24)
		throw new Error('Node 24+ required for opt-in SQLite harness');
	if (process.argv.length !== 3 || !['--local', '--hosted'].includes(process.argv[2]))
		throw new Error('Usage: node hosted/better-auth/run.mjs --local|--hosted');
	const config = process.argv[2] === '--hosted' ? hostedConfig(process.env) : undefined;
	const deadlineMs = config?.deadlineMs ?? deadline(process.env.AFD_BA_DEADLINE_MS);
	const runSignal = AbortSignal.any([abort.signal, AbortSignal.timeout(deadlineMs)]);
	const revision =
		config?.revision ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	const cache = resolve('node_modules/.cache');
	await mkdir(cache, { recursive: true });
	directory = await mkdtemp(resolve(cache, 'afd-better-auth-run-'));
	await buildFixture(directory);
	await build({
		entryPoints: [fileURLToPath(new URL('./run.ts', import.meta.url))],
		bundle: true,
		packages: 'external',
		outfile: resolve(directory, 'runner.mjs'),
		format: 'esm',
		platform: 'node',
		target: 'node24',
		logLevel: 'silent',
	});
	const { runHarness } = await import(pathToFileURL(resolve(directory, 'runner.mjs')).href);
	const packageVersion = async (url) => JSON.parse(await readFile(url, 'utf8')).version;
	const versions = {
		betterAuth: await packageVersion(
			new URL('../package.json', import.meta.resolve('better-auth'))
		),
		afdAuth: await packageVersion(new URL('../../package.json', import.meta.url)),
		playwright: await packageVersion(new URL('./package.json', import.meta.resolve('playwright'))),
		react: await packageVersion(new URL('./package.json', import.meta.resolve('react'))),
	};
	await runHarness({
		directory,
		config,
		revision,
		deadlineMs,
		versions,
		signal: runSignal,
		interrupted: () => abort.signal.aborted,
	});
} catch (error) {
	// All thrown startup errors are authored contract errors; never emit environment values.
	process.stderr.write(
		`Better Auth harness not run: ${error instanceof Error ? error.message : 'preflight failed'}\n`
	);
	process.exitCode = 1;
} finally {
	if (directory) await rm(directory, { recursive: true, force: true });
	process.removeListener('SIGINT', interrupt);
	process.removeListener('SIGTERM', interrupt);
}
