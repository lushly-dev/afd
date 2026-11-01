#!/usr/bin/env node
/**
 * Violet packed-artifact consumers (platform migration Phase 3).
 *
 * Packs the native core and runtime foundations, the AFD integration and the CLI/server endpoints
 * from built workspace packages, then installs them in temporary projects outside the workspace's
 * dependency resolution:
 *
 * - Violet only: core without optional storage drivers and runtime, no AFD or other family. Cold
 *   imports, declarations, native resolution/export, tokens applied to plain HTML/CSS and through
 *   the runtime in Chromium, and optional storage backends that are absent.
 * - Integration absent, present, incompatible (bad or missing core peer) and unavailable (its
 *   declared AFD dependency missing), plus a consumer's own AFD 2.x shared with it.
 * - Endpoints: the `violet` and `violet-mcp` binaries and the server's entry points. With
 *   `--baseline <violet checkout>` (built at the imported revision) the CLI's serialized output
 *   is compared byte for byte with the upstream binary.
 *
 * Local tarballs only: this is not registry installation evidence. `@lushly-dev/afd-core` is packed
 * from the workspace like the Violet units; third-party packages come from the configured registry
 * or pnpm store.
 *
 * Usage: pnpm -F "@lushly-dev/violet-cli..." -F @lushly-dev/violet-runtime -F @lushly-dev/afd-core build
 *        node tests/consumers/violet/verify-artifacts.mjs [--output <dir>] [--baseline <dir>]
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argument = (name) => {
	const index = process.argv.indexOf(name);
	return index > 0 ? resolve(process.argv[index + 1]) : undefined;
};
const consumers = await realpath(await mkdtemp(join(tmpdir(), 'afd-violet-consumers-')));
const output = argument('--output') ?? consumers;
const baseline = argument('--baseline');
const artifacts = join(consumers, 'artifacts');
await mkdir(artifacts, { recursive: true });
await mkdir(output, { recursive: true });
const tsc = join(repository, 'node_modules/typescript/bin/tsc');
const typeRoots = join(repository, 'node_modules/@types');
// The test driver's browser comes from the workspace; it is never installed into a consumer.
const { chromium } = createRequire(join(repository, 'foundations/specimen/package.json'))(
	'playwright'
);
const sources = [
	'foundations/violet/packages/core',
	'foundations/violet/packages/runtime',
	'integrations/violet-afd',
	'endpoints/violet-server',
	'endpoints/violet-cli',
	'packages/core',
];
const CORE = '@lushly-dev/violet-core';
const RUNTIME = '@lushly-dev/violet-runtime';
const AFD = '@lushly-dev/violet-afd';
const SERVER = '@lushly-dev/violet-server';
const CLI = '@lushly-dev/violet-cli';
const AFD_CORE = '@lushly-dev/afd-core';
const workspaceManifest = (path) =>
	JSON.parse(readFileSync(join(repository, path, 'package.json'), 'utf8'));
// The fixed group's version, so a Changesets version step needs no edit here.
const VERSION = workspaceManifest('foundations/violet/packages/core').version;
// Widened before each minor release (Changesets major-bumps a dependent whose peer range
// the new version leaves); scripts/violet-provenance.test.mjs checks the widening.
const CORE_PEER = workspaceManifest('integrations/violet-afd').peerDependencies[CORE];
// pnpm quotes a peer range that contains spaces.
const CORE_PEER_SPEC = `${CORE}@"${CORE_PEER}"`;
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
const packedFiles = (name) =>
	execFileSync('tar', ['-tzf', packs[name]], { encoding: 'utf8' }).trim().split('\n');

async function install(
	name,
	dependencies,
	{ expected = true, optional = true, overrides = true } = {}
) {
	const root = join(consumers, name);
	await mkdir(root, { recursive: true });
	const manifest = {
		name,
		private: true,
		type: 'module',
		dependencies,
	};
	// Unpublished local units resolve to their tarballs wherever they are required.
	if (overrides)
		manifest.pnpm = {
			overrides: Object.fromEntries(Object.keys(packs).map((key) => [key, file(key)])),
		};
	await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	const args = [
		'install',
		'--ignore-scripts',
		'--prefer-offline',
		'--strict-peer-dependencies',
		'--config.auto-install-peers=false',
		...(optional ? [] : ['--no-optional']),
	];
	const result = spawnSync('pnpm', args, { cwd: root, encoding: 'utf8' });
	const log = `${result.stdout}${result.stderr}`;
	await writeFile(join(root, 'install.log'), log);
	assert.equal(result.status === 0, expected, `${name} install outcome:\n${log}`);
	return { root, log };
}
const run = (cwd, script) => execFileSync(process.execPath, [script], { cwd, stdio: 'inherit' });
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
			'ES2022',
			'--lib',
			'ES2022,DOM,DOM.Iterable',
			'--types',
			'node',
			'--typeRoots',
			typeRoots,
			'consumer.ts',
		],
		{ cwd, stdio: 'inherit' }
	);
}
const installedPackages = async (root) => readdir(join(root, 'node_modules/.pnpm'));

// ---- Packed manifests ------------------------------------------------------------------------
const core = packedManifest(CORE);
assert.deepEqual(Object.keys(core.exports), [
	'.',
	'./worker',
	'./css',
	'./types',
	'./engine',
	'./neon',
]);
assert.deepEqual(Object.keys(core.dependencies), ['zod']);
assert.deepEqual(Object.keys(core.optionalDependencies), ['better-sqlite3']);
// Neon/ws are optional peers, so an installing integration's copies satisfy ./neon in strict layouts.
assert.deepEqual(Object.keys(core.peerDependencies).sort(), ['@neondatabase/serverless', 'ws']);
assert.deepEqual(
	Object.values(core.peerDependenciesMeta).map((meta) => meta.optional),
	[true, true]
);
assert(!Object.keys(core.scripts ?? {}).some((key) => /^(pre|post)?install$|^prepare$/.test(key)));
const coreFiles = packedFiles(CORE);
assert(!coreFiles.some((path) => path.startsWith('package/dist/commands/')), 'commands packed');
for (const path of coreFiles.filter((entry) => /\.(?:js|d\.ts)$/.test(entry))) {
	const text = execFileSync('tar', ['-xzOf', packs[CORE], path], { encoding: 'utf8' });
	// Code and declarations only: comments may point readers at the integration.
	const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
	assert(!/@lushly-dev\/afd/.test(code), `${path} references AFD`);
	// The OpenAPI document names its wire envelope schema CommandResult; no AFD type may remain.
	assert(!/\b(?:type|interface|class) Command(?:Result|Error)\b|CommandResult</.test(code), path);
}
const runtime = packedManifest(RUNTIME);
assert.equal(runtime.dependencies, undefined);
const afd = packedManifest(AFD);
assert.deepEqual(afd.peerDependencies, { [CORE]: CORE_PEER });
assert(
	semver.satisfies(VERSION, CORE_PEER),
	`the integration peer ${CORE_PEER} rejects core ${VERSION}`
);
assert.equal(afd.dependencies[AFD_CORE], '^2.2.0');
assert.deepEqual(Object.keys(afd.exports), ['.', './worker', './commands', './css', './types']);
const cli = packedManifest(CLI);
assert.deepEqual(cli.bin, { violet: './dist/bin.js' });
assert.equal(cli.dependencies[AFD], VERSION);
// Endpoints depend on core directly: the integration only peers on it.
assert.equal(cli.dependencies[CORE], VERSION);
const server = packedManifest(SERVER);
assert.equal(server.dependencies[CORE], VERSION);
assert.deepEqual(server.bin, { 'violet-mcp': './dist/bin.js' });
assert.deepEqual(Object.keys(server.exports), ['.', './server', './api']);
for (const manifest of [core, runtime, afd, cli, server]) {
	assert.equal(manifest.version, VERSION, manifest.name);
	assert(!JSON.stringify(manifest).includes('workspace:'), `${manifest.name} leaks workspace:`);
}
passed(
	`packed manifests: core needs only zod (storage drivers optional), no AFD text in its files; integration peers core ${CORE_PEER} and depends on afd-core ^2.2.0; binaries preserved; all at ${VERSION}`
);

// ---- Violet only: native core without optional drivers, and runtime ---------------------------
const { root: violetRoot } = await install(
	'violet-only',
	{ [CORE]: file(CORE), [RUNTIME]: file(RUNTIME) },
	{ optional: false }
);
const nativeGraph = await installedPackages(violetRoot);
for (const forbidden of [
	/@lushly-dev\+(?:afd|violet-afd|violet-cli|violet-server|fast|specimen)/,
	/@neondatabase|^ws@|better-sqlite3/,
])
	assert(!nativeGraph.some((name) => forbidden.test(name)), nativeGraph.join('\n'));
passed('Violet-only install graph: no AFD, other family, integration, endpoint or storage driver');

await writeFile(
	join(violetRoot, 'cold.mjs'),
	`import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
	resolve(specifier, context, next) {
		assert(!/^(?:@lushly-dev\\/(?:afd|violet-afd|fast|specimen)|@neondatabase|ws$|better-sqlite3)/.test(specifier), 'forbidden cold dependency: ' + specifier);
		return next(specifier, context);
	},
});
for (const path of ['', '/worker', '/css', '/types', '/engine'])
	assert(Object.keys(await import('@lushly-dev/violet-core' + path)).length > 0, path);
const runtime = await import('@lushly-dev/violet-runtime');
assert.equal(typeof runtime.VioletRuntime, 'function');
assert.equal(typeof runtime.ThemeManager, 'function');
`
);
run(violetRoot, 'cold.mjs');
passed('cold imports of core root, worker, css, types, engine and runtime load no AFD or driver');

await writeFile(
	join(violetRoot, 'native.mjs'),
	`import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as root from '@lushly-dev/violet-core';
import * as worker from '@lushly-dev/violet-core/worker';
import * as css from '@lushly-dev/violet-core/css';
import * as types from '@lushly-dev/violet-core/types';
import * as engine from '@lushly-dev/violet-core/engine';
const { NodeSchema, exportTokens, resolveTokens, TokenDomainError, ErrorCodes, EXPORT_FORMATS } = root;
for (const name of ['registry', 'initializeCore', 'success', 'failure', 'isSuccess', 'isFailure', 'exportCommand', 'tokensResolveCommand', 'seedRealisticSystem', 'createNeonPostgresClient', 'toJsonSchema'])
	assert(!(name in root), 'root still exports ' + name);
assert(!('registry' in worker) && !('initializeWorkerCore' in worker));
assert.equal(typeof css.safeCssColor, 'function');
assert.equal(css.safeCssColor('url(x)'), null);
assert.equal(typeof types.NodeSchema.parse, 'function');
assert.equal(types.ErrorCodes.NODE_NOT_FOUND, 'NODE_NOT_FOUND');
assert.equal(typeof engine.resolveInheritance, 'function');
assert.equal(typeof worker.buildOpenApiSpec, 'function');
assert.equal(worker.resolveTokens, resolveTokens);

const now = '2026-10-29T00:00:00.000Z';
const db = worker.createMemoryDatabase();
let sequence = 0;
const node = (id, parentId) => db.createNode(NodeSchema.parse({ id, name: id, parentId, type: parentId ? 'theme' : 'root', createdAt: now, updatedAt: now }));
const op = (nodeId, type, tokenId, value, category) => db.addOperation({ id: 'op' + ++sequence, nodeId, sequence, type, tokenId, value: value === undefined ? null : JSON.stringify(value), metadata: category ? JSON.stringify({ category }) : null, fromNode: null, asTokenId: null, toAncestor: null, reason: null, author: 'consumer', createdAt: now });
await node('brand', null);
await node('brand-dark', 'brand');
await op('brand', 'add', 'color.brand', '#352064', 'color');
await op('brand', 'add', 'color.action', '{color.brand}', 'color');
await op('brand', 'add', 'color.text', '#000000', 'color');
await op('brand', 'add', 'spacing.md', '12px', 'spacing');
await op('brand-dark', 'override', 'color.text', '#ffffff');
const { tokens } = await resolveTokens(db, 'brand-dark');
assert.equal(tokens.find((token) => token.id === 'color.text').resolvedValue, '#ffffff');
for (const format of EXPORT_FORMATS.filter((format) => format !== 'lua'))
	assert((await exportTokens(db, 'brand-dark', { format })).content.length > 0, format);
await assert.rejects(exportTokens(db, 'missing', { format: 'css' }), (error) => error instanceof TokenDomainError && error.code === ErrorCodes.NODE_NOT_FOUND && Boolean(error.suggestion));
const { content } = await exportTokens(db, 'brand-dark', { format: 'css' });
writeFileSync('tokens.css', content);
writeFileSync('tokens.json', JSON.stringify({ success: true, data: { nodeId: 'brand-dark', ancestry: ['brand'], tokenCount: tokens.length, tokens: tokens.map((token) => ({ id: token.id, value: token.resolvedValue, resolvedAt: token.resolvedAt })) } }));
writeFileSync('plain.html', '<!doctype html><link rel="stylesheet" href="tokens.css"><style>button { background: var(--color-action); color: var(--color-text); padding: var(--spacing-md); }</style><button>Native</button>');
writeFileSync('runtime.html', '<!doctype html><style>button { background: var(--color-action); padding: var(--spacing-md); }</style><button>Runtime</button><script type="module">import { VioletRuntime } from "/node_modules/@lushly-dev/violet-runtime/dist/index.js"; const violet = new VioletRuntime({ nodeId: "brand-dark", cacheEnabled: false }); await violet.load(); document.body.dataset.loaded = String(violet.getAll().length);</script>');

// Optional storage drivers were omitted: their stores fail only when used.
await assert.rejects(import('@lushly-dev/violet-core/neon'), (error) => error.code === 'ERR_MODULE_NOT_FOUND' && /@neondatabase\\/serverless/.test(error.message));
assert.throws(() => new root.SQLiteDatabase(':memory:'), /optional 'better-sqlite3' package/);
// The integration is not installed, and the moved subpath is gone.
await assert.rejects(import('@lushly-dev/violet-afd'), (error) => error.code === 'ERR_MODULE_NOT_FOUND' && /@lushly-dev\\/violet-afd/.test(error.message));
await assert.rejects(import('@lushly-dev/violet-core/commands'), (error) => error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
`
);
run(violetRoot, 'native.mjs');
passed(
	'native exports: in-memory resolution and every export format, TokenDomainError, no command or AFD names'
);
passed(
	'optional drivers absent: ./neon fails naming @neondatabase/serverless, SQLite fails naming better-sqlite3'
);
passed(
	'integration absent: @lushly-dev/violet-afd is ERR_MODULE_NOT_FOUND, core ./commands is ERR_PACKAGE_PATH_NOT_EXPORTED'
);

// A preloaded source applies the same resolved tokens with no token server (Loam D50).
const runtimeImport =
	'import { VioletRuntime, ThemeManager } from "/node_modules/@lushly-dev/violet-runtime/dist/index.js";';
const resolved = JSON.parse(readFileSync(join(violetRoot, 'tokens.json'), 'utf8')).data.tokens;
const preloaded = { tokens: resolved.map(({ id, value }) => ({ id, value })) };
await writeFile(
	join(violetRoot, 'source.html'),
	`<!doctype html><style>button { background: var(--color-action); padding: var(--spacing-md); }</style><button>Source</button><script type="module">${runtimeImport} const violet = new VioletRuntime({ nodeId: "brand-dark", source: ${JSON.stringify(preloaded)} }); await violet.load(); document.body.dataset.loaded = String(violet.getAll().length);</script>`
);
// ThemeManager follows prefers-color-scheme, prefers-contrast and forced-colors.
const systemSources = {
	light: { tokens: [{ id: 'color.text', value: '#000000' }] },
	dark: { tokens: [{ id: 'color.text', value: '#ffffff' }] },
	contrast: { tokens: [{ id: 'color.text', value: '#ffff00' }] },
};
await writeFile(
	join(violetRoot, 'system.html'),
	`<!doctype html><script type="module">${runtimeImport} const sources = ${JSON.stringify(systemSources)}; const violet = new VioletRuntime({ nodeId: "light", source: sources.light }); await violet.load(); const themes = new ThemeManager(violet, { themes: Object.entries(sources).map(([nodeId, source]) => ({ nodeId, name: nodeId, source })), defaultTheme: "light", transitionDuration: 0 }); const show = (theme) => { document.body.dataset.theme = theme.nodeId; }; show(themes.getCurrentTheme()); themes.onChange(show); themes.useSystemPreference("light", "dark", "contrast");</script>`
);

const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
let apiRequests = 0;
const http = createServer(async (request, response) => {
	const path = new URL(request.url, 'http://consumer').pathname;
	if (path.startsWith('/api/')) apiRequests++;
	if (path === '/api/v1/nodes/brand-dark/tokens') {
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(await readFile(join(violetRoot, 'tokens.json')));
		return;
	}
	const target = normalize(join(violetRoot, path));
	// A directory, such as the root a browser may request, is not a served file.
	if (!target.startsWith(violetRoot) || !existsSync(target) || !statSync(target).isFile()) {
		response.writeHead(404).end();
		return;
	}
	response.writeHead(200, { 'content-type': mime[extname(target)] ?? 'application/octet-stream' });
	response.end(await readFile(target));
});
await new Promise((ready) => http.listen(0, '127.0.0.1', ready));
const origin = `http://127.0.0.1:${http.address().port}`;
const browser = await chromium.launch();
let browserVersion;
try {
	browserVersion = browser.version();
	const page = await browser.newPage();
	const style = () =>
		page.$eval('button', (element) => {
			const computed = getComputedStyle(element);
			return {
				tag: element.tagName,
				background: computed.backgroundColor,
				color: computed.color,
				padding: computed.paddingTop,
				undefinedElements: document.querySelectorAll(':not(:defined)').length,
			};
		});
	await page.goto(`${origin}/plain.html`);
	assert.deepEqual(await style(), {
		tag: 'BUTTON',
		background: 'rgb(53, 32, 100)',
		color: 'rgb(255, 255, 255)',
		padding: '12px',
		undefinedElements: 0,
	});
	await page.screenshot({ path: join(output, 'violet-native-html.png') });
	await page.goto(`${origin}/runtime.html`);
	await page.waitForSelector('body[data-loaded]');
	assert.equal(await page.$eval('body', (body) => body.dataset.loaded), '4');
	const applied = await style();
	assert.deepEqual(
		[applied.tag, applied.background, applied.padding],
		['BUTTON', 'rgb(53, 32, 100)', '12px']
	);
	assert.equal(apiRequests, 1);

	await page.goto(`${origin}/source.html`);
	await page.waitForSelector('body[data-loaded]');
	assert.equal(await page.$eval('body', (body) => body.dataset.loaded), '4');
	const fromSource = await style();
	assert.deepEqual(
		[fromSource.tag, fromSource.background, fromSource.padding],
		['BUTTON', 'rgb(53, 32, 100)', '12px']
	);
	assert.equal(apiRequests, 1, 'a preloaded source makes no token request');

	const system = await browser.newPage();
	const theme = async (expected) => {
		await system.waitForSelector(`body[data-theme="${expected}"]`, { state: 'attached' });
		return system.evaluate(() => document.documentElement.style.getPropertyValue('--color-text'));
	};
	await system.emulateMedia({ colorScheme: 'light', contrast: 'more' });
	await system.goto(`${origin}/system.html`);
	assert.equal(await theme('contrast'), '#ffff00');
	await system.emulateMedia({ colorScheme: 'dark', contrast: 'no-preference' });
	assert.equal(await theme('dark'), '#ffffff');
	await system.emulateMedia({ forcedColors: 'active' });
	assert.equal(await theme('contrast'), '#ffff00');
	await system.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
	assert.equal(await theme('light'), '#000000');
	assert.equal(apiRequests, 1);
} finally {
	await browser.close();
	http.close();
}
passed(
	`Chromium ${browserVersion}: exported CSS styles a plain HTML button; the runtime applies the same tokens as custom properties, over HTTP and from a preloaded source with no request`
);
passed(
	`Chromium ${browserVersion}: ThemeManager follows prefers-color-scheme, prefers-contrast: more and forced-colors: active to a high-contrast theme`
);

const typeSource = await readFile(
	join(repository, 'foundations/violet/packages/core/src/tokens.ts'),
	'utf8'
);
const nativeTypes = [...typeSource.matchAll(/export (?:interface|type) (\w+)/g)].map(
	(match) => match[1]
);
await writeFile(
	join(violetRoot, 'consumer.ts'),
	`import * as Native from '@lushly-dev/violet-core';
import * as Worker from '@lushly-dev/violet-core/worker';
import * as Css from '@lushly-dev/violet-core/css';
import type * as Types from '@lushly-dev/violet-core/types';
import * as Engine from '@lushly-dev/violet-core/engine';
import { VioletRuntime, ThemeManager, type VioletConfig, type VioletHttpConfig, type VioletSourceConfig, type VioletTokenSource, type SourceToken, type Token } from '@lushly-dev/violet-runtime';
export type NativeTypes = [${nativeTypes.map((name) => `Native.${name}`).join(', ')}];
export type Contracts = [Types.Node, Types.OperationRecord, Types.ResolvedToken, Types.Constraint, Types.Webhook, Types.CheckSnapshot, Types.ErrorCode, Native.Database, Worker.Database, Engine.ResolutionScope];
export const api = [Native.resolveTokens, Native.exportTokens, Native.createMemoryDatabase, Native.SQLiteDatabase, Native.PostgresDatabase, Native.transformerRegistry, Native.buildOpenApiSpec, Worker.exportTokens, Css.safeCssColor, Engine.resolveInheritance, Engine.matchesGlob, Engine.OverlayDatabase];
export const runtime: [typeof VioletRuntime, typeof ThemeManager, VioletConfig?, Token?] = [VioletRuntime, ThemeManager];
export const preloaded: VioletSourceConfig = { nodeId: 'brand-dark', source: { tokens: [{ id: 'color.text', value: '#fff' }] satisfies SourceToken[] } };
export const http: VioletHttpConfig = { nodeId: 'brand-dark', apiUrl: 'https://violet.example.com', apiKey: 'key' };
export const configs: VioletConfig[] = [preloaded, http];
export const switched: Promise<Token[]> = new VioletRuntime(preloaded).switchNode('brand-light', { tokens: [] } satisfies VioletTokenSource);
// @ts-expect-error a preloaded source and a token server are either/or
export const both: VioletConfig = { nodeId: 'brand-dark', source: { tokens: [] }, apiUrl: 'https://violet.example.com' };
// @ts-expect-error the command registry moved to @lushly-dev/violet-afd
Native.registry;
// @ts-expect-error AFD result helpers are no longer re-exported
Native.success;
// @ts-expect-error CommandResult is no longer a native type
export type Removed = Native.CommandResult<unknown>;
`
);
typecheck(violetRoot);
passed(
	`native and runtime declarations compile under NodeNext with no AFD installed (${nativeTypes.length} token API types, every entry point but ./neon)`
);

// ---- Integration present -------------------------------------------------------------------------
const { root: integrationRoot } = await install('integration-present', {
	[CORE]: file(CORE),
	[AFD]: file(AFD),
});
await writeFile(
	join(integrationRoot, 'integration.mjs'),
	`import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as native from '@lushly-dev/violet-core';
import * as legacy from '@lushly-dev/violet-afd';
import * as commands from '@lushly-dev/violet-afd/commands';
import * as worker from '@lushly-dev/violet-afd/worker';
import * as types from '@lushly-dev/violet-afd/types';
import * as css from '@lushly-dev/violet-afd/css';
const { initializeCore, registry, createMemoryDatabase, success, failure, isSuccess } = legacy;
for (const name of Object.keys(native)) assert(name in legacy, 'violet-afd root lacks native ' + name);
assert.equal(legacy.exportTokens, native.exportTokens);
assert.equal(commands.registry, registry);
assert.equal(typeof worker.initializeWorkerCore, 'function');
assert.equal(typeof types.success, 'function');
assert.equal(css.safeCssColor, native.safeCssColor);
assert.equal(typeof legacy.createNeonPostgresClient, 'function');
assert(isSuccess(success({ ok: true })));
assert.equal(failure({ code: 'X', message: 'y', suggestion: 'z' }).success, false);
initializeCore();
initializeCore();
const names = registry.list().map((command) => command.name);
const context = { db: createMemoryDatabase(), actor: 'consumer' };
assert((await registry.execute('node.create', { id: 'base', name: 'base', type: 'root' }, context)).success);
assert((await registry.execute('token.add', { nodeId: 'base', tokenId: 'color.bg', value: '#FFFFFF' }, context)).success);
const exported = await registry.execute('export', { nodeId: 'base', format: 'css' }, context);
assert.equal(exported.success, true);
assert.match(exported.reasoning, /Exported 1 tokens/);
assert.equal(exported.data.content, (await native.exportTokens(context.db, 'base', { format: 'css' })).content);
const missing = await registry.execute('export', { nodeId: 'nope', format: 'css' }, context);
assert.deepEqual(missing.error, { code: 'NODE_NOT_FOUND', message: "Node 'nope' not found", suggestion: "Use 'node.list' to see available nodes" });
assert.equal((await registry.execute('export', { nodeId: 'base', format: 'yaml' }, context)).success, false);
// pnpm places the integration's own dependencies beside it: .pnpm/<integration>/node_modules/@lushly-dev
const scope = dirname(dirname(realpathSync(fileURLToPath(import.meta.resolve('@lushly-dev/violet-afd')))));
const afdCore = JSON.parse(readFileSync(join(scope, '..', 'afd-core', 'package.json'), 'utf8')).version;
console.log(JSON.stringify({ commands: names.length, afdCore }));
`
);
const integrationRun = spawnSync(process.execPath, ['integration.mjs'], {
	cwd: integrationRoot,
	encoding: 'utf8',
});
assert.equal(integrationRun.status, 0, integrationRun.stderr);
const integrationFacts = JSON.parse(integrationRun.stdout.trim().split('\n').at(-1));
await writeFile(
	join(integrationRoot, 'worker-cold.mjs'),
	`import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
	resolve(specifier, context, next) {
		const result = next(specifier, context);
		// Test the package-relative path only: pnpm store directory names carry peer suffixes.
		const loaded = result.url.split('/node_modules/').at(-1);
		assert(!/^@lushly-dev\\/violet-core\\/dist\\/(?:index|db\\/(?:sqlite|postgres|neon))\\.js$|^@neondatabase\\/|^ws\\//.test(loaded), 'violet-afd/worker loaded ' + loaded);
		return result;
	},
});
const worker = await import('@lushly-dev/violet-afd/worker');
assert.equal(typeof worker.initializeWorkerCore, 'function');
`
);
run(integrationRoot, 'worker-cold.mjs');
passed('cold import of violet-afd/worker loads no core root, Node store or driver');
assert.equal(integrationFacts.commands, 46);
assert.equal(integrationFacts.afdCore, packedManifest(AFD_CORE).version);
assert.match(integrationFacts.afdCore, /^2\./);
passed(
	`integration present: pre-split root/commands/worker/types/css surfaces, ${integrationFacts.commands} commands, envelopes match native export; afd-core ${integrationFacts.afdCore}`
);
await writeFile(
	join(integrationRoot, 'consumer.ts'),
	`import { initializeCore, registry, type CommandContext, type CommandDefinition, type CommandResult, type Database, ErrorCodes, exportTokens } from '@lushly-dev/violet-afd';
import { exportCommand, tokensResolveCommand } from '@lushly-dev/violet-afd/commands';
import { initializeWorkerCore, registry as workerRegistry } from '@lushly-dev/violet-afd/worker';
import type { CommandResult as TypesResult, Node } from '@lushly-dev/violet-afd/types';
import { safeCssColor } from '@lushly-dev/violet-afd/css';
import { createNeonPostgresClient } from '@lushly-dev/violet-core/neon';
export const api = [initializeCore, registry, exportCommand, tokensResolveCommand, initializeWorkerCore, workerRegistry, safeCssColor, createNeonPostgresClient, exportTokens, ErrorCodes];
export type Types = [CommandContext, CommandDefinition<never, unknown>, CommandResult<unknown>, TypesResult<Node>, Database];
`
);
typecheck(integrationRoot);
passed(
	'integration declarations compile under NodeNext for every entry point, with the Neon store'
);

// ---- A consumer's own AFD 2.x is the integration's: one shared afd-core -------------------------
// The overrides pin every afd-core to the packed one, so check the declared range accepts it.
assert(semver.satisfies(packedManifest(AFD_CORE).version, afd.dependencies[AFD_CORE]));
const { root: sharedRoot } = await install('integration-with-afd-2', {
	[CORE]: file(CORE),
	[AFD]: file(AFD),
	[AFD_CORE]: file(AFD_CORE),
});
const sharedGraph = await installedPackages(sharedRoot);
const afdVersions = sharedGraph.filter((name) => name.startsWith('@lushly-dev+afd-core@'));
assert.equal(afdVersions.length, 1, sharedGraph.join('\n'));
await writeFile(
	join(sharedRoot, 'shared.mjs'),
	`import assert from 'node:assert/strict';
import { initializeCore, registry, createMemoryDatabase, success as violetSuccess, isSuccess } from '@lushly-dev/violet-afd';
import { success } from '@lushly-dev/afd-core';
initializeCore();
const context = { db: createMemoryDatabase() };
assert((await registry.execute('node.create', { id: 'n', name: 'n', type: 'root' }, context)).success);
assert.equal(violetSuccess, success);
assert(isSuccess(success(1)));
`
);
run(sharedRoot, 'shared.mjs');
passed(
	`AFD ${packedManifest(AFD_CORE).version} in the consumer satisfies ^2.2.0: the integration shares the consumer's single afd-core`
);

// ---- Integration incompatible and unavailable ----------------------------------------------------
const missingPeer = await install(
	'integration-core-missing',
	{ [AFD]: file(AFD) },
	{ expected: false, overrides: false }
);
assert.match(missingPeer.log, /ERR_PNPM_PEER_DEP_ISSUES/);
assert(missingPeer.log.includes(`missing peer ${CORE_PEER_SPEC}`), missingPeer.log);
passed('integration without the core peer is rejected (missing peer)');
const fakeCore = join(consumers, 'fake-core-9');
await mkdir(fakeCore, { recursive: true });
await writeFile(
	join(fakeCore, 'package.json'),
	JSON.stringify({ name: CORE, version: '9.0.0', type: 'module' })
);
const incompatible = await install(
	'integration-core-incompatible',
	{ [AFD]: file(AFD), [CORE]: `file:${fakeCore}` },
	{ expected: false, overrides: false }
);
assert.match(incompatible.log, /ERR_PNPM_PEER_DEP_ISSUES/);
assert(incompatible.log.includes(`unmet peer ${CORE_PEER_SPEC}: found 9.0.0`), incompatible.log);
passed('integration with violet-core 9.0.0 is rejected (unmet peer)');

const { root: unavailableRoot } = await install('integration-afd-unavailable', {
	[CORE]: file(CORE),
	[AFD]: file(AFD),
});
// Simulate a broken installation: the integration's declared afd-core is gone from the store.
const store = join(unavailableRoot, 'node_modules/.pnpm');
for (const name of await readdir(store))
	if (name.startsWith('@lushly-dev+afd-core@'))
		await rm(join(store, name), { recursive: true, force: true });
await writeFile(
	join(unavailableRoot, 'unavailable.mjs'),
	`import assert from 'node:assert/strict';
await assert.rejects(import('@lushly-dev/violet-afd'), (error) => error.code === 'ERR_MODULE_NOT_FOUND' && /@lushly-dev\\/afd-core/.test(error.message));
const { createMemoryDatabase, exportTokens } = await import('@lushly-dev/violet-core');
await assert.rejects(exportTokens(createMemoryDatabase(), 'none', { format: 'css' }), { code: 'NODE_NOT_FOUND' });
`
);
run(unavailableRoot, 'unavailable.mjs');
passed(
	'integration requested but its AFD dependency unavailable: import fails naming @lushly-dev/afd-core; native core still works'
);

// ---- Endpoints ------------------------------------------------------------------------------------
const { root: endpointRoot } = await install('endpoints', {
	[CORE]: file(CORE),
	[AFD]: file(AFD),
	[SERVER]: file(SERVER),
	[CLI]: file(CLI),
});
const tokensDir = join(endpointRoot, 'tokens');
await mkdir(tokensDir);
await writeFile(
	join(tokensDir, 'brand.tokens.json'),
	JSON.stringify({ color: { $type: 'color', primary: { $value: '#0078D4' } } })
);
await writeFile(
	join(tokensDir, 'brand-dark.tokens.json'),
	JSON.stringify({
		$extensions: { 'dev.lushly.violet': { parent: 'brand' } },
		color: { primary: { $value: '#4CC2FF' }, accent: { $value: '{color.primary}' } },
	})
);
const invocations = [
	['--version'],
	['--json', 'commands'],
	['--from', 'tokens', '--json', 'tokens', 'brand-dark'],
	['--from', 'tokens', 'export', 'css', 'brand-dark'],
	['--from', 'tokens', '--json', 'export', 'ts', 'brand-dark'],
	['--from', 'tokens', '--json', 'cicd', 'validate', '--node', 'brand-dark'],
	['--from', 'tokens', '--json', 'tokens', 'nope'],
	['--json', 'api', 'spec'],
];
const binary = join(endpointRoot, 'node_modules/.bin/violet');
const outputs = invocations.map((args) => {
	const result = spawnSync(binary, args, { cwd: endpointRoot, encoding: 'utf8' });
	return { args, status: result.status, stdout: result.stdout, stderr: result.stderr };
});
await writeFile(join(output, 'violet-cli-outputs.json'), `${JSON.stringify(outputs, null, 2)}\n`);
// Upstream cli.ts hard-coded .version('0.1.0'); the CLI now reports its package version.
assert.equal(outputs[0].stdout.trim(), VERSION);
assert.equal(JSON.parse(outputs[1].stdout).data.commands.length, 46);
assert.equal(JSON.parse(outputs[2].stdout).success, true);
assert.match(outputs[3].stdout, /--color-accent:\s*#4CC2FF/i);
assert.equal(outputs[6].status, 1);
assert.equal(JSON.parse(outputs[6].stdout).error.code, 'NODE_NOT_FOUND');
passed(
	`violet binary: --version (${VERSION}), 46 commands, --from resolve/export/validate, failure envelope and exit 1`
);
if (baseline) {
	const upstream = join(baseline, 'packages/cli/dist/bin.js');
	assert(existsSync(upstream), `${upstream} is not built`);
	// Timings, trace ids and clock times differ per run; everything else must match.
	const volatile = (text) =>
		text.replace(
			/\[\d+ms\]|"(?:durationMs|executionTimeMs)": \d+|"traceId": "[^"]+"|Generated: \S+|\d{4}-\d\d-\d\dT[\d:.]+Z/g,
			'<v>'
		);
	// --version is the one intended difference: upstream hard-coded 0.1.0.
	const compared = outputs.filter((entry) => entry.args[0] !== '--version');
	for (const entry of compared) {
		const result = spawnSync(process.execPath, [upstream, ...entry.args], {
			cwd: endpointRoot,
			encoding: 'utf8',
		});
		assert.equal(result.status, entry.status, entry.args.join(' '));
		assert.equal(volatile(entry.stdout), volatile(result.stdout), entry.args.join(' '));
	}
	passed(
		`violet serialized output equals the upstream binary at ${baseline} for ${compared.length} invocations (all but --version)`
	);
}

const mcp = spawn(
	join(endpointRoot, 'node_modules/.bin/violet-mcp'),
	['--db', join(endpointRoot, 'mcp.db')],
	{
		cwd: endpointRoot,
		stdio: ['pipe', 'pipe', 'pipe'],
	}
);
const replies = new Map();
let buffer = '';
mcp.stdout.setEncoding('utf8');
mcp.stdout.on('data', (chunk) => {
	buffer += chunk;
	for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
		const line = buffer.slice(0, index).trim();
		buffer = buffer.slice(index + 1);
		if (!line) continue;
		const message = JSON.parse(line);
		replies.get(message.id)?.(message);
	}
});
const request = (id, method, params) =>
	new Promise((reply, fail) => {
		const timer = setTimeout(() => fail(new Error(`MCP ${method} timed out`)), 20000);
		replies.set(id, (message) => {
			clearTimeout(timer);
			reply(message);
		});
		mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
	});
try {
	const initialized = await request(1, 'initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'violet-consumer', version: '0.0.0' },
	});
	assert(initialized.result.serverInfo.name, JSON.stringify(initialized));
	mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
	const tools = (await request(2, 'tools/list', {})).result.tools;
	assert(tools.length >= 46, `${tools.length} tools`);
	const doctor = tools.find((tool) => /doctor/.test(tool.name));
	const called = await request(3, 'tools/call', { name: doctor.name, arguments: {} });
	assert(Array.isArray(called.result.content), JSON.stringify(called));
	passed(
		`violet-mcp over stdio: initialize (${initialized.result.serverInfo.name}), ${tools.length} tools listed, ${doctor.name} called`
	);
} finally {
	mcp.kill();
}

await writeFile(
	join(endpointRoot, 'server.mjs'),
	`import assert from 'node:assert/strict';
import * as root from '@lushly-dev/violet-server';
import * as serverModule from '@lushly-dev/violet-server/server';
import * as api from '@lushly-dev/violet-server/api';
for (const name of ['createApiServer', 'createMcpServer', 'generateTools', 'startStdioServer']) assert.equal(typeof root[name], 'function', name);
assert(Object.keys(serverModule).length > 0 && Object.keys(api).length > 0);
`
);
run(endpointRoot, 'server.mjs');
passed('server entry points ., ./server and ./api import from the packed endpoint');

const receipt = {
	sourceCommit: '59b4bfa64a8cf423322b857c5c697e110201e0f2',
	node: process.version,
	chromium: browserVersion,
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
	afdCoreForIntegration: integrationFacts.afdCore,
	baseline: baseline ?? null,
	limitations: [
		'Local tarballs only; no registry installation or publication authorization',
		'@lushly-dev/afd-core packed from the workspace; third-party packages resolved from the configured registry/store at run time',
		'No hosted CI receipt unless run by violet.yml',
		'No Postgres or Neon store exercised; SQLite only through violet-mcp --db in the consumer directory',
	],
};
await writeFile(
	join(output, 'violet-artifact-receipt.json'),
	`${JSON.stringify(receipt, null, 2)}\n`
);
console.log(`Violet artifact consumers passed (${checks.length} checks); receipt in ${output}`);
