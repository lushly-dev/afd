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
import { existsSync, rmSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outputIndex = process.argv.indexOf('--output');
const consumers = await realpath(await mkdtemp(join(tmpdir(), 'afd-specimen-consumers-')));
// A failed run keeps its consumers for inspection; a passing one leaves nothing behind.
process.on('exit', (code) => {
	if (code === 0) rmSync(consumers, { recursive: true, force: true });
});
const output = outputIndex > 0 ? resolve(process.argv[outputIndex + 1]) : consumers;
const artifacts = join(consumers, 'artifacts');
await mkdir(artifacts, { recursive: true });
await mkdir(output, { recursive: true });
const fixtures = join(repository, 'foundations/specimen/fixtures');
// The prebuilt host for this platform: the source build (or SPECIMEN_HOST_BINARY) staged into its
// package, which every consumer below installs. No consumer sees SPECIMEN_HOST_BINARY, so each
// render proves the packaged host is found.
const hostBinary =
	process.env.SPECIMEN_HOST_BINARY ??
	join(repository, 'foundations/specimen/host/target/release/specimen-host');
assert(
	existsSync(hostBinary),
	'build the Specimen host first: pnpm -F @lushly-dev/specimen build:host'
);
delete process.env.SPECIMEN_HOST_BINARY;
// `pnpm` scripts put the workspace's hoisted store on NODE_PATH, where its own packages resolve.
delete process.env.NODE_PATH;
const hostSuffix = `${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}`;
const hostPackage = `@lushly-dev/specimen-host-${hostSuffix}`;
const hostPackages = ['darwin-arm64', 'darwin-x64', 'linux-arm64-gnu', 'linux-x64-gnu'].map(
	(suffix) => `@lushly-dev/specimen-host-${suffix}`
);
assert(hostPackages.includes(hostPackage), `no prebuilt host package for ${hostSuffix}`);
execFileSync(
	process.execPath,
	[join(repository, 'foundations/specimen/host/stage.mjs'), hostSuffix, '--binary', hostBinary],
	{ stdio: 'inherit' }
);
const tsc = join(repository, 'node_modules/typescript/bin/tsc');
const typeRoots = join(repository, 'node_modules/@types');
const sources = [
	'packages/core',
	'packages/server',
	'foundations/specimen',
	`foundations/specimen/packages/host-${hostSuffix}`,
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
	// The host package carries a binary, which its prepack checks, rather than a dist.
	const built = manifest.name === hostPackage ? 'bin/specimen-host' : 'dist';
	assert(existsSync(join(repository, path, built)), `${path} is not built`);
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

// The other platforms' hosts are not packed here, so their optional dependencies are removed.
const otherHosts = Object.fromEntries(
	hostPackages.filter((name) => name !== hostPackage).map((name) => [name, '-'])
);
async function install(
	name,
	dependencies,
	{ expected = true, overrides = false, optional = true } = {}
) {
	const root = join(consumers, name);
	await mkdir(root, { recursive: true });
	const manifest = { name, private: true, type: 'module', dependencies };
	manifest.pnpm = {
		overrides: {
			...otherHosts,
			...(overrides
				? Object.fromEntries(Object.keys(packs).map((key) => [key, file(key)]))
				: {
						// Keep the server's dependency local before the candidate is published,
						// while preserving the root peer versions tested by the negative cases.
						'@lushly-dev/afd-server>@lushly-dev/afd-core': file('@lushly-dev/afd-core'),
						[hostPackage]: file(hostPackage),
					}),
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
			...(optional ? [] : ['--no-optional']),
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
assert.deepEqual(
	native.optionalDependencies,
	Object.fromEntries(hostPackages.map((name) => [name, '2.2.0']))
);
assert.deepEqual(Object.keys(native.exports), [
	'.',
	'./types',
	'./schema',
	'./evidence',
	'./preview',
	'./test',
]);
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
const host = packedManifest(hostPackage);
assert.equal(host.version, native.version);
assert.equal(host.scripts?.install ?? host.scripts?.postinstall, undefined);
const hostFiles = execFileSync('tar', ['-tvzf', packs[hostPackage]], { encoding: 'utf8' })
	.trim()
	.split('\n');
assert.deepEqual(hostFiles.map((line) => line.split(/\s+/).at(-1)).sort(), [
	'package/LICENSE',
	'package/README.md',
	'package/bin/specimen-host',
	'package/package.json',
]);
assert.match(
	hostFiles.find((line) => line.endsWith('bin/specimen-host')),
	/^-rwx/,
	'the packed host is executable'
);
for (const manifest of [native, integration, cli, host])
	assert(!JSON.stringify(manifest).includes('workspace:'), `${manifest.name} leaks workspace:`);
const nativeFiles = execFileSync('tar', ['-tzf', packs['@lushly-dev/specimen']], {
	encoding: 'utf8',
})
	.trim()
	.split('\n');
assert(!nativeFiles.some((path) => /(?:commands|cli|bin)\.(?:js|d\.ts)$/.test(path)));
passed('packed manifests: native has no cross-family edge, peers declare ^2.2.0, no workspace:');
passed(`packed ${hostPackage}: an executable host at Specimen's version, and nothing else`);

// Native only: integration and every other family absent.
const { root: nativeRoot } = await install('native-only', {
	'@lushly-dev/specimen': file('@lushly-dev/specimen'),
});
const installed = await readdir(join(nativeRoot, 'node_modules/.pnpm'));
assert(!installed.some((name) => forbiddenFamilies.test(name)), installed.join('\n'));
assert.deepEqual(
	installed.filter((name) => name.includes('specimen-host')).map((name) => name.split('@')[1]),
	[`lushly-dev+specimen-host-${hostSuffix}`],
	'only this platform’s host is installed'
);
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
import * as evidence from '@lushly-dev/specimen/evidence';
assert.deepEqual(Object.keys(root).sort(), ['CAPTURE_VERSION', 'DEFAULT_STORY_FILES', 'DiscoveryError', 'NORMALIZATION_VERSION', 'UNSUPPORTED_ANNOTATIONS', 'composeTokenMaps', 'createSpecimenBench', 'definePlugin', 'diffObservations', 'finiteValues', 'normalizeDom', 'normalizeSpecifier', 'readManifest']);
assert.deepEqual(Object.keys(types).sort(), ['CAPTURE_VERSION', 'NORMALIZATION_VERSION']);
assert.deepEqual(Object.keys(schema).sort(), ['a11yRequestSchema', 'a11yRunSchema', 'baselineRequestSchema', 'buildOutputSchema', 'captureRequestSchema', 'componentSchemaSchema', 'contextSchema', 'contractRequestSchema', 'contractRunSchema', 'coverageRequestSchema', 'coverageRunSchema', 'inspectRequestSchema', 'inspectResultSchema', 'matrixRequestSchema', 'matrixRunSchema', 'migrateRequestSchema', 'migrationReportSchema', 'observationSchema', 'profileRequestSchema', 'profileRunSchema', 'runRequestSchema', 'storyRunSchema', 'suggestRequestSchema', 'suggestRunSchema', 'suiteRequestSchema', 'suiteRunSchema']);
assert.deepEqual(Object.keys(evidence), ['claim']);
assert.equal(evidence.claim({}, 'default', 'an-expectation'), undefined);
const { setCustomElementsManifest } = await import('@lushly-dev/specimen/preview');
setCustomElementsManifest({ modules: [] });
assert.equal(CAPTURE_VERSION, '0.8');
assert.equal(NORMALIZATION_VERSION, '0.2');
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

// Without optional dependencies there is no host: rendering names the package to install.
const { root: hostlessRoot } = await install(
	'native-without-host',
	{ '@lushly-dev/specimen': file('@lushly-dev/specimen') },
	{ optional: false }
);
await cp(fixtures, join(hostlessRoot, 'fixtures'), { recursive: true });
await writeFile(
	join(hostlessRoot, 'hostless.mjs'),
	`import assert from 'node:assert/strict';
import { createSpecimenBench } from '@lushly-dev/specimen';
const bench = await createSpecimenBench({ root: new URL('./fixtures/', import.meta.url).pathname });
try {
	await assert.rejects(bench.render({ id: bench.list()[0].id }), /${hostPackage.replace('/', '\\/')} is not installed; reinstall without omitting optional dependencies/);
} finally {
	await bench.close();
}
`
);
execFileSync(process.execPath, ['hostless.mjs'], { cwd: hostlessRoot, stdio: 'inherit' });
passed('without optional dependencies, rendering fails naming the host package to install');

// A retained story with Specimen's helpers and types, where no Storybook is installed.
assert(!installed.some((name) => /^(?:@storybook\+|storybook@)/.test(name)), installed.join('\n'));
await mkdir(join(nativeRoot, 'retained'));
await writeFile(
	join(nativeRoot, 'retained/specimen.config.json'),
	JSON.stringify({ stories: ['*.stories.ts'] })
);
await writeFile(
	join(nativeRoot, 'retained/press.stories.ts'),
	`import { expect, fn, userEvent, waitFor, within } from '@lushly-dev/specimen/test';
import type { Meta, StoryObj } from '@lushly-dev/specimen/types';
type Args = { onPress?: () => void };
const meta: Meta<Args> = {
	title: 'Consumer/Press',
	render: ({ onPress }) => {
		const button = document.createElement('button');
		button.textContent = 'Press';
		if (onPress) button.addEventListener('click', onPress);
		return button;
	},
};
export default meta;
export const Presses: StoryObj<Args> = {
	args: { onPress: fn() },
	play: async ({ args, canvasElement }) => {
		const button = within(canvasElement).getByRole('button');
		await userEvent.click(button);
		await waitFor(() => expect(args.onPress).toHaveBeenCalledOnce());
		await expect(button).toHaveTextContent('Press');
	},
};
export const Fails: StoryObj<Args> = {
	play: async ({ canvasElement }) => {
		await expect(canvasElement).toHaveTextContent('Absent');
	},
};
`
);
await writeFile(
	join(nativeRoot, 'retained.mjs'),
	`import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSpecimenBench } from '@lushly-dev/specimen';
import * as test from '@lushly-dev/specimen/test';
assert.deepEqual(Object.keys(test).sort(), ['expect', 'fn', 'spyOn', 'userEvent', 'waitFor', 'within']);
const bench = await createSpecimenBench({ root: new URL('./retained/', import.meta.url).pathname });
try {
	const status = async (id) => (await bench.run({ id })).outcome.status;
	assert.equal(await status('consumer-press--presses'), 'passed');
	assert.equal(await status('consumer-press--fails'), 'failed');
	const out = new URL('./retained-site', import.meta.url).pathname;
	await bench.build(out);
	const report = JSON.parse(await readFile(out + '/specimen-build.json', 'utf8'));
	assert.equal(report.reported.incumbent, 0);
	assert(report.categories.interaction.bytes > 200000, 'the helpers count as interaction support');
	assert(report.reported.consumer < 5000, 'nothing they bring counts as the consumer');
} finally {
	await bench.close();
}
`
);
execFileSync(process.execPath, ['retained.mjs'], { cwd: nativeRoot, stdio: 'inherit' });
passed('a retained story runs on Specimen’s helpers and types with no Storybook installed');
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
import { expect as check } from '@lushly-dev/specimen/test';
const meta: Contracts.Meta<{ label: string }> = { title: 'Typed', render: ({ label }) => label };
export const typed: Contracts.StoryObj<{ label: string }> = {
	args: { label: 'A' },
	play: async ({ args, canvasElement }) => {
		await check(canvasElement).toHaveTextContent(args.label);
	},
};
// @ts-expect-error A retained play's context has no \`mount\`.
export const noMount: Contracts.StoryObj = { play: async ({ mount }) => void mount };
export const fromMeta: Contracts.StoryObj<typeof meta> = { args: { label: 'B' } };
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
assert.deepEqual(Object.keys(integration).sort(), ['a11yRunSchema', 'buildOutputSchema', 'contextSchema', 'contractRunSchema', 'coverageRunSchema', 'createSpecimenCommands', 'executeSpecimenCommand', 'executeSpecimenDiff', 'inspectResultSchema', 'matrixRunSchema', 'observationSchema', 'profileRunSchema', 'storyRunSchema', 'suggestRunSchema', 'suiteRunSchema']);
assert.deepEqual(Object.keys(endpoint), ['runCli']);
const root = new URL('./fixtures/', import.meta.url).pathname;
const bench = await createSpecimenBench({ root });
try {
	const commands = createSpecimenCommands(bench);
	assert.deepEqual(commands.map((command) => command.name).sort(), ['specimen-a11y', 'specimen-baseline', 'specimen-build', 'specimen-contract', 'specimen-coverage', 'specimen-diff', 'specimen-inspect', 'specimen-list', 'specimen-matrix', 'specimen-migrate', 'specimen-profile', 'specimen-render', 'specimen-run', 'specimen-suggest', 'specimen-validate']);
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
	'integration present: fifteen command definitions, execution, invalid input and unknown command'
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
		`Only this platform's prebuilt host (${hostSuffix}); the others are checked by specimen.yml's host-packages job`,
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
