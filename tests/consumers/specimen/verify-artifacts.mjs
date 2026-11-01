#!/usr/bin/env node
/**
 * Specimen packed-artifact consumers (platform migration Phase 3).
 *
 * Packs the Specimen foundation, AFD integration, CLI endpoint and the AFD core/server peers
 * from built workspace packages, then installs them in temporary projects outside the workspace's
 * dependency resolution: native-only (integration absent), requested-but-unavailable integration,
 * integration present, missing peers and incompatible Specimen/AFD peers. Requires Chromium for
 * the native render/build cases. Local tarballs only: this is not registry installation evidence.
 *
 * Usage: pnpm -F @lushly-dev/specimen-cli... build
 *        node tests/consumers/specimen/verify-artifacts.mjs [--output <directory>]
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outputIndex = process.argv.indexOf('--output');
const consumers = await realpath(await mkdtemp(join(tmpdir(), 'afd-specimen-consumers-')));
const output = outputIndex > 0 ? resolve(process.argv[outputIndex + 1]) : consumers;
const artifacts = join(consumers, 'artifacts');
await mkdir(artifacts, { recursive: true });
await mkdir(output, { recursive: true });
const fixtures = join(repository, 'foundations/specimen/fixtures');
// Packaging prebuilt native hosts is publication work; packed consumers use the built one.
process.env.SPECIMEN_HOST_BINARY ??= join(
	repository,
	'foundations/specimen/host/target/release/specimen-host'
);
assert(
	existsSync(process.env.SPECIMEN_HOST_BINARY),
	'build the Specimen host first: cargo build --release --locked in foundations/specimen/host'
);
const tsc = join(repository, 'node_modules/typescript/bin/tsc');
const typeRoots = join(repository, 'node_modules/@types');
const sources = [
	'packages/core',
	'packages/server',
	'foundations/specimen',
	'integrations/specimen-afd',
	'endpoints/specimen-cli',
];
const forbiddenFamilies = /@lushly-dev\+(?:afd|fast|violet|specimen-afd|specimen-cli)/;
const checks = [];
const passed = (name) => {
	checks.push(name);
	console.log(`ok - ${name}`);
};

const packs = {};
for (const path of sources) {
	const manifest = JSON.parse(await readFile(join(repository, path, 'package.json'), 'utf8'));
	assert(existsSync(join(repository, path, 'dist')), `${path} is not built`);
	execFileSync('pnpm', ['pack', '--pack-destination', artifacts], {
		cwd: join(repository, path),
		stdio: 'pipe',
	});
	packs[manifest.name] = join(
		artifacts,
		`${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`
	);
	assert(existsSync(packs[manifest.name]), `missing tarball for ${manifest.name}`);
}
const file = (name) => `file:${packs[name]}`;
const packedManifest = (name) =>
	JSON.parse(
		execFileSync('tar', ['-xzOf', packs[name], 'package/package.json'], { encoding: 'utf8' })
	);

async function install(name, dependencies, { expected = true, overrides = false } = {}) {
	const root = join(consumers, name);
	await mkdir(root, { recursive: true });
	const manifest = { name, private: true, type: 'module', dependencies };
	manifest.pnpm = {
		overrides: overrides
			? Object.fromEntries(Object.keys(packs).map((key) => [key, file(key)]))
			: {
					// Keep the server's dependency local before the candidate is published,
					// while preserving the root peer versions tested by the negative cases.
					'@lushly-dev/afd-server>@lushly-dev/afd-core': file('@lushly-dev/afd-core'),
				},
	};
	await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	const result = spawnSync(
		'pnpm',
		[
			'install',
			'--ignore-scripts',
			'--prefer-offline',
			'--strict-peer-dependencies',
			'--config.auto-install-peers=false',
		],
		{ cwd: root, encoding: 'utf8' }
	);
	const log = `${result.stdout}${result.stderr}`;
	await writeFile(join(root, 'install.log'), log);
	assert.equal(result.status === 0, expected, `${name} install outcome:\n${log}`);
	return { root, log };
}
function typecheck(cwd) {
	execFileSync(
		process.execPath,
		[
			tsc,
			'--noEmit',
			'--strict',
			'--skipLibCheck',
			'false',
			'--module',
			'NodeNext',
			'--moduleResolution',
			'NodeNext',
			'--target',
			'ES2024',
			'--lib',
			'ES2024,DOM,DOM.Iterable',
			'--types',
			'node',
			'--typeRoots',
			typeRoots,
			'consumer.ts',
		],
		{ cwd, stdio: 'inherit' }
	);
}

// Packed manifests: portable ranges, no workspace protocol, native has no cross-family edges.
const native = packedManifest('@lushly-dev/specimen');
assert.equal(native.version, '2.2.0');
assert.equal(native.bin, undefined);
assert.equal(native.peerDependencies, undefined);
assert.equal(native.optionalDependencies, undefined);
assert.deepEqual(Object.keys(native.exports), ['.', './types', './schema']);
assert(!Object.keys(native.dependencies).some((name) => name.startsWith('@lushly-dev/')));
assert(!Object.keys(native.scripts ?? {}).some((key) => /install|prepare/.test(key)));
const integration = packedManifest('@lushly-dev/specimen-afd');
assert.deepEqual(integration.peerDependencies, {
	'@lushly-dev/specimen': '^2.2.0',
	'@lushly-dev/afd-core': '^2.2.0',
	'@lushly-dev/afd-server': '^2.2.0',
});
const cli = packedManifest('@lushly-dev/specimen-cli');
assert.deepEqual(cli.bin, { specimen: './dist/bin.js' });
for (const manifest of [native, integration, cli])
	assert(!JSON.stringify(manifest).includes('workspace:'), `${manifest.name} leaks workspace:`);
const nativeFiles = execFileSync('tar', ['-tzf', packs['@lushly-dev/specimen']], {
	encoding: 'utf8',
})
	.trim()
	.split('\n');
assert(!nativeFiles.some((path) => /(?:commands|cli|bin)\.(?:js|d\.ts)$/.test(path)));
passed('packed manifests: native has no cross-family edge, peers declare ^2.2.0, no workspace:');

// Native only: integration and every other family absent.
const { root: nativeRoot } = await install('native-only', {
	'@lushly-dev/specimen': file('@lushly-dev/specimen'),
});
const installed = await readdir(join(nativeRoot, 'node_modules/.pnpm'));
assert(!installed.some((name) => forbiddenFamilies.test(name)), installed.join('\n'));
await cp(fixtures, join(nativeRoot, 'fixtures'), { recursive: true });
passed(
	'native-only install graph contains no AFD, FAST-AF, Violet or Specimen integration/endpoint'
);

await writeFile(
	join(nativeRoot, 'cold.mjs'),
	`import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
	resolve(specifier, context, next) {
		assert(!/^(?:vite|playwright|@lushly-dev\\/(?:afd|fast|violet|specimen-afd|specimen-cli))/.test(specifier), 'forbidden cold dependency: ' + specifier);
		return next(specifier, context);
	},
});
const { createSpecimenBench } = await import('@lushly-dev/specimen');
const bench = await createSpecimenBench({ root: new URL('./fixtures/', import.meta.url).pathname });
assert(bench.list().length > 0);
await bench.close();
`
);
execFileSync(process.execPath, ['cold.mjs'], { cwd: nativeRoot, stdio: 'inherit' });
passed('cold native import/list loads no runtime tooling or other family');

await writeFile(
	join(nativeRoot, 'runtime.mjs'),
	`import assert from 'node:assert/strict';
import { createSpecimenBench, diffObservations, normalizeDom, CAPTURE_VERSION, NORMALIZATION_VERSION } from '@lushly-dev/specimen';
import * as root from '@lushly-dev/specimen';
import * as types from '@lushly-dev/specimen/types';
import { contextSchema, captureRequestSchema, observationSchema, buildOutputSchema } from '@lushly-dev/specimen/schema';
import * as schema from '@lushly-dev/specimen/schema';
assert.deepEqual(Object.keys(root).sort(), ['CAPTURE_VERSION', 'NORMALIZATION_VERSION', 'createSpecimenBench', 'diffObservations', 'normalizeDom']);
assert.deepEqual(Object.keys(types).sort(), ['CAPTURE_VERSION', 'NORMALIZATION_VERSION']);
assert.deepEqual(Object.keys(schema).sort(), ['buildOutputSchema', 'captureRequestSchema', 'contextSchema', 'observationSchema']);
assert.equal(CAPTURE_VERSION, '0.2');
assert.equal(NORMALIZATION_VERSION, '0.1');
assert.equal(typeof normalizeDom('<div> hello </div>'), 'string');
assert(captureRequestSchema.safeParse({ id: 'primary' }).success);
assert(!captureRequestSchema.safeParse({ id: '' }).success);
assert(!contextSchema.safeParse({}).success);
try {
	await import('@lushly-dev/specimen-afd');
	assert.fail('integration unexpectedly installed');
} catch (error) {
	assert.equal(error.code, 'ERR_MODULE_NOT_FOUND');
	assert.match(error.message, /@lushly-dev\\/specimen-afd/);
}
for (const runtimeIsolation of ['in-process', 'process']) {
	const bench = await createSpecimenBench({ root: new URL('./fixtures/', import.meta.url).pathname, runtimeIsolation });
	try {
		const entries = bench.list();
		assert(entries.length > 0);
		const first = entries[0];
		const capture = await bench.render({ id: first.id });
		assert(observationSchema.safeParse(capture).success);
		const reused = await bench.render({ id: first.id });
		assert(observationSchema.safeParse(reused).success);
		assert.equal(diffObservations(capture, reused, { requireVisual: true }).status, 'insufficient-evidence');
		const built = await bench.build(new URL('./site-' + runtimeIsolation, import.meta.url).pathname);
		assert(buildOutputSchema.safeParse(built).success);
	} finally {
		await bench.close();
	}
	assert.throws(() => bench.list(), /closed/);
}
`
);
execFileSync(process.execPath, ['runtime.mjs'], { cwd: nativeRoot, stdio: 'inherit' });
passed('native exports, schemas, in-process and process-worker render/reuse/build/close');
passed('requested-but-unavailable integration fails with ERR_MODULE_NOT_FOUND naming the package');

const typeSource = await readFile(join(repository, 'foundations/specimen/src/types.ts'), 'utf8');
const publicTypes = [...typeSource.matchAll(/export (?:interface|type) (\w+)/g)].map(
	(match) => match[1]
);
assert(publicTypes.length >= 19, `expected the 19 public data types, saw ${publicTypes.length}`);
await writeFile(
	join(nativeRoot, 'consumer.ts'),
	`import * as Native from '@lushly-dev/specimen';
import type * as Contracts from '@lushly-dev/specimen/types';
import * as Schema from '@lushly-dev/specimen/schema';
export type RootCoverage = [${publicTypes.map((name) => `Native.${name}`).join(', ')}];
export type TypeCoverage = [${publicTypes.map((name) => `Contracts.${name}`).join(', ')}];
export type Bench = Native.SpecimenBench;
export const schemas = [Schema.contextSchema, Schema.captureRequestSchema, Schema.observationSchema, Schema.buildOutputSchema];
export const api = [Native.createSpecimenBench, Native.diffObservations, Native.normalizeDom, Native.CAPTURE_VERSION, Native.NORMALIZATION_VERSION];
// @ts-expect-error AFD commands moved to the separate integration
Native.createSpecimenCommands;
`
);
typecheck(nativeRoot);
passed(
	`native declarations compile without AFD for ${publicTypes.length} public types and all exports`
);

// Integration and endpoint present. Unpublished local units are wired through overrides.
const { root: fullRoot } = await install(
	'integration-present',
	Object.fromEntries(Object.keys(packs).map((name) => [name, file(name)])),
	{ overrides: true }
);
await cp(fixtures, join(fullRoot, 'fixtures'), { recursive: true });
await writeFile(
	join(fullRoot, 'runtime.mjs'),
	`import assert from 'node:assert/strict';
import { createSpecimenBench } from '@lushly-dev/specimen';
import * as integration from '@lushly-dev/specimen-afd';
import * as endpoint from '@lushly-dev/specimen-cli';
const { createSpecimenCommands, executeSpecimenCommand, executeSpecimenDiff } = integration;
assert.deepEqual(Object.keys(integration).sort(), ['buildOutputSchema', 'contextSchema', 'createSpecimenCommands', 'executeSpecimenCommand', 'executeSpecimenDiff', 'observationSchema']);
assert.deepEqual(Object.keys(endpoint), ['runCli']);
const root = new URL('./fixtures/', import.meta.url).pathname;
const bench = await createSpecimenBench({ root });
try {
	const commands = createSpecimenCommands(bench);
	assert.deepEqual(commands.map((command) => command.name).sort(), ['specimen-build', 'specimen-diff', 'specimen-list', 'specimen-render']);
	assert.equal((await executeSpecimenCommand(bench, 'specimen-list', {})).success, true);
	assert.equal((await executeSpecimenCommand(bench, 'specimen-unknown', {})).success, false);
	assert.equal((await executeSpecimenDiff({ left: {}, right: {} })).error.code, 'VALIDATION_ERROR');
	const output = [];
	assert.equal(await endpoint.runCli(['list', '--root', root], { stdout: (text) => output.push(text), stderr: () => {} }), 0);
	assert.equal(output.length, 1);
	assert(JSON.parse(output[0]).success);
} finally {
	await bench.close();
}
`
);
execFileSync(process.execPath, ['runtime.mjs'], { cwd: fullRoot, stdio: 'inherit' });
passed(
	'integration present: four command definitions, execution, invalid input and unknown command'
);
await writeFile(
	join(fullRoot, 'consumer.ts'),
	`import { buildOutputSchema, contextSchema, createSpecimenCommands, executeSpecimenCommand, executeSpecimenDiff, observationSchema, type SpecimenCommandBench } from '@lushly-dev/specimen-afd';
import { type CliIO, runCli } from '@lushly-dev/specimen-cli';
export const api = [createSpecimenCommands, executeSpecimenCommand, executeSpecimenDiff, observationSchema, contextSchema, buildOutputSchema, runCli];
export type Types = [SpecimenCommandBench, CliIO];
`
);
typecheck(fullRoot);
passed('integration and endpoint declarations compile for every export');

const binary = join(fullRoot, 'node_modules/.bin/specimen');
for (const [args, status, code] of [
	[['list', '--root', join(fullRoot, 'fixtures')], 0, undefined],
	[['wat'], 1, 'SPECIMEN_CLI_ERROR'],
	[['diff', 'missing.json', 'other.json'], 1, 'SPECIMEN_CLI_ERROR'],
]) {
	const result = spawnSync(binary, args, { cwd: fullRoot, encoding: 'utf8' });
	assert.equal(result.status, status, result.stderr);
	const lines = result.stdout.trim().split('\n');
	assert.equal(lines.length, 1);
	const value = JSON.parse(lines[0]);
	assert.equal(value.success, status === 0);
	if (code) assert.equal(value.error.code, code);
}
passed('specimen binary: one stdout JSON value, exit 0 on success and 1 on failure');

// Missing and incompatible peers fail at the strict installation boundary.
const missing = await install(
	'integration-peers-missing',
	{ '@lushly-dev/specimen-afd': file('@lushly-dev/specimen-afd') },
	{ expected: false }
);
assert.match(missing.log, /ERR_PNPM_PEER_DEP_ISSUES/);
for (const peer of ['@lushly-dev/specimen', '@lushly-dev/afd-core', '@lushly-dev/afd-server'])
	assert(missing.log.includes(`missing peer ${peer}@^2.2.0`), `expected missing ${peer}`);
passed('integration without peers is rejected (missing peer)');

async function fake(name, packageName) {
	const root = join(consumers, name);
	await mkdir(root, { recursive: true });
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: packageName, version: '3.0.0', type: 'module' })
	);
	return `file:${root}`;
}
const incompatible = {
	'@lushly-dev/specimen': await fake('fake-specimen-3', '@lushly-dev/specimen'),
	'@lushly-dev/afd-core': await fake('fake-afd-core-3', '@lushly-dev/afd-core'),
};
for (const [peer, version] of Object.entries(incompatible)) {
	const dependencies = {
		'@lushly-dev/specimen-afd': file('@lushly-dev/specimen-afd'),
		'@lushly-dev/specimen': file('@lushly-dev/specimen'),
		'@lushly-dev/afd-core': file('@lushly-dev/afd-core'),
		'@lushly-dev/afd-server': file('@lushly-dev/afd-server'),
		[peer]: version,
	};
	const result = await install(`integration-incompatible-${peer.split('/')[1]}`, dependencies, {
		expected: false,
		overrides: false,
	});
	assert.match(result.log, /ERR_PNPM_PEER_DEP_ISSUES/);
	assert(result.log.includes(`unmet peer ${peer}@^2.2.0: found 3.0.0`), result.log);
	passed(`integration with ${peer}@3.0.0 is rejected (unmet peer)`);
}

const receipt = {
	sourceCommit: 'ceaa5156ae0461c2b076168ea4949535f8fcf176',
	node: process.version,
	checks,
	packages: await Promise.all(
		Object.entries(packs).map(async ([name, path]) => ({
			name,
			version: packedManifest(name).version,
			sha256: createHash('sha256')
				.update(await readFile(path))
				.digest('hex'),
		}))
	),
	publicTypes,
	limitations: [
		'Local tarballs only; no registry installation or publication authorization',
		'Third-party dependencies resolved from the configured registry/store at run time',
		'No hosted CI receipt unless run by specimen.yml',
		'No visual equivalence, axe, token, event-history or Storybook-removal claim',
	],
};
await writeFile(
	join(output, 'specimen-artifact-receipt.json'),
	`${JSON.stringify(receipt, null, 2)}\n`
);
console.log(`Specimen artifact consumers passed (${checks.length} checks); receipt in ${output}`);
