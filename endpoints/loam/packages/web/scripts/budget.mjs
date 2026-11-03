#!/usr/bin/env node
/**
 * budget: the bundle budget of Loam's web host (phase 0 specification, 8.1).
 *
 *   pnpm -F @lushly-dev/loam-web budget [--json]
 *
 * Builds the shell with Vite in production mode and measures what the empty shell loads before
 * first paint: `index.html`'s entry and every chunk it imports statically (a chunk imported
 * dynamically loads later). It also builds `@lushly-dev/loam-kernel` alone, minified with its
 * dependencies, as Vite bundles it for the browser. What loads later has rows of its own (phase 2
 * specification, 2.4): the kernel's late commands, its `src/apps/` with the readers and validators and
 * classic Zod, the chrome's surfaces, its view host and the console. Each is a static closure, charged
 * what a page has not loaded by then. Hello's and tally's bundles are recorded and not limited. It fails
 * when a measure is over its ceiling, when first paint holds classic Zod or `toJSONSchema`, or when it holds
 * a chunk of stage B: `late`, `apps`, the readers, `surfaces` (phase 2 specification, 2.2). That first
 * paint is the same for every deployment. `dist/` is rebuilt, so run it after `build` or in its place.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { narrowZodFromJsonSchema, zodJitlessByDefault } from './narrow-zod.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The ceilings, in bytes, as phase 2's step 1 sets them (2.4): first paint lowered, the kernel's its
 * measured value plus 10% now that Zod's classic API has left it, `late` added, and `apps` its measured
 * value plus 5%, the one raise, for the bytes that left first paint. Step 3 raised `apps` once more, to
 * its new measured value plus 5%, for manifest version 2's validator (about 40 KB of generated code).
 * Step 2 changed no ceiling: first paint 273,179 and 83,564 gzip, `apps` 377,811 (2.4's table).
 * Step 4 changed none either: first paint 277,777 and 85,355 gzip, the kernel alone 110,682, `late`
 * 47,625 with the `store` chunk it shares with `apps`, and `apps` 377,472 (2.4's table).
 */
export const CEILINGS = Object.freeze({
	jsMinified: 300_000,
	jsGzip: 91_000,
	cssMinified: 8_496,
	kernelMinified: 113_401,
	lateMinified: 75_000,
	appsMinified: 378_993,
	surfacesMinified: 85_000,
	viewMinified: 25_080,
	consoleMinified: 91_222,
	mountMinified: 238_268,
});

/** Group a module id by the package it belongs to. */
function packageOf(id) {
	const path = id.replace(/\\/g, '/').replace(/\?.*$/, '');
	const store = path.match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
	if (store) return store[1];
	const nested = path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
	if (nested) return nested[1];
	for (const [pattern, name] of [
		[/endpoints\/loam\/packages\/([^/]+)\//, (m) => `@lushly-dev/loam-${m[1]}`],
		[/foundations\/fast-af\/packages\/violet-elements\//, () => '@lushly-dev/violet-elements'],
		[
			/foundations\/fast-af\/packages\/element\/packages\/fast-element\//,
			() => '@lushly-dev/fast-element',
		],
		[
			/\/packages\/(core|server|auth|view-state|local-db)\//,
			(m) => (m[1] === 'local-db' ? '@lushly-dev/local-db' : `@lushly-dev/afd-${m[1]}`),
		],
	]) {
		const match = path.match(pattern);
		if (match) return name(match);
	}
	return path;
}

/** Bytes per package of the chunks given, from Rolldown's rendered lengths. */
function breakdown(chunks) {
	const sizes = new Map();
	for (const chunk of chunks)
		for (const [id, info] of Object.entries(chunk.modules ?? {}))
			sizes.set(packageOf(id), (sizes.get(packageOf(id)) ?? 0) + info.renderedLength);
	return [...sizes.entries()].sort((a, b) => b[1] - a[1]);
}

async function measurePage() {
	const result = await build({ root: ROOT, logLevel: 'warn', build: { write: true } });
	const output = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
	const chunks = new Map(
		output.filter((item) => item.type === 'chunk').map((c) => [c.fileName, c])
	);
	const html = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
	const initial = new Set();
	const visit = (fileName) => {
		if (initial.has(fileName)) return;
		initial.add(fileName);
		for (const imported of chunks.get(fileName)?.imports ?? []) visit(imported);
	};
	for (const match of html.matchAll(/<script[^>]+src="\.?\/?([^"]+)"/g)) visit(match[1]);
	const css = [];
	for (const match of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\.?\/?([^"]+)"/g))
		css.push(match[1]);
	if (![...chunks.keys()].some((name) => /^assets\/surfaces-/.test(name))) {
		throw new Error('budget: the build has no `surfaces` chunk to measure');
	}
	if (![...chunks.keys()].some((name) => /^assets\/console-/.test(name))) {
		throw new Error('budget: the build has no `console` chunk to measure');
	}
	const initialChunks = [...initial].map((name) => chunks.get(name)).filter(Boolean);
	const classic = initialChunks
		.flatMap((chunk) => Object.keys(chunk.modules ?? {}))
		.filter((id) => /zod[\\/]v4[\\/](classic[\\/]|core[\\/]to-json-schema)/.test(id));
	if (classic.length > 0) {
		throw new Error(`budget: first paint holds what belongs to \`apps\`: ${classic.join(', ')}`);
	}
	// One first paint for every deployment: nothing stage B reads is in it (phase 2 specification, 2.2).
	const stageB = [...initial].filter((name) =>
		/^assets\/(apps|validate\.generated|deployment|surfaces|late)-/.test(name)
	);
	if (stageB.length > 0) {
		throw new Error(`budget: first paint holds a chunk of stage B: ${stageB.join(', ')}`);
	}
	// With what it imports statically and what loaded before it has not, such as the listbox.
	const closure = (pattern, loaded) => {
		const found = new Set();
		const visitChunk = (fileName) => {
			if (loaded.has(fileName) || found.has(fileName)) return;
			found.add(fileName);
			for (const imported of chunks.get(fileName)?.imports ?? []) visitChunk(imported);
		};
		for (const name of chunks.keys()) if (pattern.test(name)) visitChunk(name);
		return found;
	};
	// In the order a page loads them, so a shared chunk, classic Zod's among them, is charged to the first.
	const late = closure(/^assets\/late-/, initial);
	if (late.size === 0) throw new Error('budget: the build has no `late` chunk to measure');
	const afterLate = new Set([...initial, ...late]);
	// The bundler parts the kernel's `src/apps/` from the validators, because the host reads with them too.
	const apps = closure(/^assets\/(apps|validate\.generated|deployment)-/, afterLate);
	if (apps.size < 3) throw new Error('budget: the build has no `apps` chunks to measure');
	const afterApps = new Set([...afterLate, ...apps]);
	const surfaces = closure(/^assets\/surfaces-/, afterApps);
	// What a view app or a console adds when it opens: the surfaces have loaded by then.
	const afterSurfaces = new Set([...afterApps, ...surfaces]);
	const view = closure(/^assets\/view-/, afterSurfaces);
	if (view.size === 0) throw new Error('budget: the build has no `view` chunk to measure');
	const consoleFiles = closure(/^assets\/console-/, afterSurfaces);
	const mount = closure(/^assets\/mount-/, afterSurfaces);
	if (mount.size === 0) throw new Error('budget: the build has no `mount` chunk to measure');
	const sizeOf = (files) =>
		[...files].reduce((sum, name) => sum + Buffer.byteLength(chunks.get(name).code), 0);
	const js = initialChunks.map((chunk) => Buffer.from(chunk.code));
	const gzipOf = (code) => gzipSync(code, { level: 9 }).length;
	const cssAssets = output.filter((item) => item.type === 'asset' && css.includes(item.fileName));
	// loam-theme.css is adopted through a constructable stylesheet, so it ships inside the entry.
	let inlineCss = 0;
	for (const chunk of initialChunks)
		for (const [id, info] of Object.entries(chunk.modules ?? {}))
			if (/\.css\?inline$/.test(id)) inlineCss += info.renderedLength;
	return {
		files: initialChunks.map((chunk) => ({
			file: chunk.fileName,
			bytes: Buffer.byteLength(chunk.code),
			gzip: gzipOf(Buffer.from(chunk.code)),
		})),
		lazy: [...chunks.keys()].filter((name) => !initial.has(name)),
		lateMinified: sizeOf(late),
		appsMinified: sizeOf(apps),
		surfacesMinified: sizeOf(surfaces),
		viewMinified: sizeOf(view),
		consoleMinified: sizeOf(consoleFiles),
		mountMinified: sizeOf(mount),
		jsMinified: js.reduce((sum, code) => sum + code.length, 0),
		jsGzip: js.reduce((sum, code) => sum + gzipOf(code), 0),
		cssMinified:
			cssAssets.reduce((sum, asset) => sum + Buffer.byteLength(asset.source), 0) + inlineCss,
		packages: breakdown(initialChunks),
	};
}

async function measureKernel() {
	const outDir = await mkdtemp(join(tmpdir(), 'loam-kernel-budget-'));
	try {
		const entry = fileURLToPath(import.meta.resolve('@lushly-dev/loam-kernel'));
		const result = await build({
			configFile: false,
			root: ROOT,
			logLevel: 'warn',
			plugins: [zodJitlessByDefault(), narrowZodFromJsonSchema()],
			build: {
				outDir,
				emptyOutDir: true,
				write: false,
				target: 'es2022',
				minify: true,
				lib: { entry, formats: ['es'], fileName: 'kernel' },
				// Without `src/apps/` and `src/late/`, which load after first paint. What they widen in the
				// shared Zod is counted on the page's row (9.5).
				rolldownOptions: {
					external: (id) => /[\\/](apps|late)[\\/]index\.js$/.test(id),
					output: { codeSplitting: false },
				},
			},
		});
		const output = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
		const chunks = output.filter((item) => item.type === 'chunk');
		return {
			kernelMinified: chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0),
			packages: breakdown(chunks),
		};
	} finally {
		await rm(outDir, { recursive: true, force: true });
	}
}

/** An app's own bundle, as its build left it: `recorded, not limited` (9.2). */
function appBundle(app) {
	const dist = resolve(ROOT, `../../apps/${app}/dist`);
	if (!existsSync(dist)) return null;
	const files = readdirSync(dist).filter((name) => name.endsWith('.js'));
	const sources = files.map((name) => readFileSync(join(dist, name)));
	return {
		app,
		minified: sources.reduce((sum, source) => sum + source.length, 0),
		gzip: sources.reduce((sum, source) => sum + gzipSync(source, { level: 9 }).length, 0),
	};
}

const ROWS = [
	['jsMinified', 'JavaScript, minified'],
	['jsGzip', 'JavaScript, gzip'],
	['cssMinified', 'CSS, minified, including loam-theme.css'],
	['kernelMinified', '@lushly-dev/loam-kernel alone, minified with Zod Mini'],
	['lateMinified', "The kernel's `late` chunk and its imports, minified"],
	['appsMinified', "The kernel's `apps` chunks and imports, with classic Zod"],
	['surfacesMinified', "The chrome's `surfaces` chunk and its imports, minified"],
	['viewMinified', "The chrome's `view` chunk and its imports, minified"],
	['consoleMinified', 'The `console` chunk and its imports, minified'],
	['mountMinified', 'The `mount` chunk and its imports, minified: the MCP client'],
];

export async function measure() {
	const page = await measurePage();
	const kernel = await measureKernel();
	const values = { ...page, kernelMinified: kernel.kernelMinified };
	const rows = ROWS.map(([key, label]) => ({
		key,
		label,
		bytes: values[key],
		ceiling: CEILINGS[key],
		over: values[key] > CEILINGS[key],
	}));
	return { rows, page, kernel, apps: ['hello', 'tally'].map(appBundle).filter(Boolean) };
}

async function main() {
	const { rows, page, kernel, apps } = await measure();
	if (process.argv.includes('--json')) {
		console.log(JSON.stringify({ rows, page, kernel, apps }, null, '\t'));
	} else {
		const pad = (text, width) => String(text).padEnd(width);
		console.log('Loaded before first paint:');
		for (const { file, bytes, gzip } of page.files)
			console.log(
				`  ${pad(file, 44)} ${pad(bytes.toLocaleString('en-US'), 8)} gzip ${gzip.toLocaleString('en-US')}`
			);
		if (page.lazy.length) console.log(`Loaded later: ${page.lazy.join(', ')}`);
		for (const row of rows)
			console.log(
				`${pad(row.label, 52)} ${pad(row.bytes.toLocaleString('en-US'), 10)} of ${pad(row.ceiling.toLocaleString('en-US'), 10)} ${row.over ? 'OVER' : `${Math.round((row.bytes / row.ceiling) * 100)}%`}`
			);
		for (const { app, minified, gzip } of apps)
			console.log(
				`${pad(`${app}'s native bundle, recorded`, 52)} ${minified.toLocaleString('en-US')}, gzip ${gzip.toLocaleString('en-US')}`
			);
		console.log('\nThe page by package (rendered bytes, before minification of names):');
		for (const [name, bytes] of page.packages.slice(0, 15))
			console.log(`  ${pad(name, 40)} ${bytes.toLocaleString('en-US')}`);
		console.log('\nThe kernel alone by package:');
		for (const [name, bytes] of kernel.packages.slice(0, 8))
			console.log(`  ${pad(name, 40)} ${bytes.toLocaleString('en-US')}`);
	}
	const over = rows.filter((row) => row.over);
	if (over.length) {
		console.error(`\nbudget: over the ceiling: ${over.map((row) => row.label).join('; ')}`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
