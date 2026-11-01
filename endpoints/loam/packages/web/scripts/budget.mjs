#!/usr/bin/env node
/**
 * budget: the bundle budget of Loam's web host (phase 0 specification, 8.1).
 *
 *   pnpm -F @lushly-dev/loam-web budget [--json]
 *
 * Builds the shell with Vite in production mode and measures what the empty shell loads before
 * first paint: `index.html`'s entry and every chunk it imports statically (a chunk imported
 * dynamically loads later). It also builds `@lushly-dev/loam-kernel` alone, minified with its
 * dependencies, as Vite bundles it for the browser. It fails when a measure is over its ceiling.
 * `dist/` is rebuilt, so run it after `build` or in its place.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The ceilings of 8.1, in bytes, as amended by step 7 (2026-11-01): the CSS ceiling lowered to its
 * measured value plus 10%, being under 70% of the old one, and the kernel's raised to its measured
 * value plus 10%, because Zod's classic API is most of it (see 8.1 and its follow-up).
 */
export const CEILINGS = Object.freeze({
	jsMinified: 320_000,
	jsGzip: 95_000,
	cssMinified: 8_496,
	kernelMinified: 231_360,
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
	const initialChunks = [...initial].map((name) => chunks.get(name)).filter(Boolean);
	const js = initialChunks.map((chunk) => Buffer.from(chunk.code));
	const cssAssets = output.filter((item) => item.type === 'asset' && css.includes(item.fileName));
	// loam-theme.css is adopted through a constructable stylesheet, so it ships inside the entry.
	let inlineCss = 0;
	for (const chunk of initialChunks)
		for (const [id, info] of Object.entries(chunk.modules ?? {}))
			if (/\.css\?inline$/.test(id)) inlineCss += info.renderedLength;
	return {
		files: initialChunks.map((chunk) => chunk.fileName),
		lazy: [...chunks.keys()].filter((name) => !initial.has(name)),
		jsMinified: js.reduce((sum, code) => sum + code.length, 0),
		jsGzip: js.reduce((sum, code) => sum + gzipSync(code, { level: 9 }).length, 0),
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
			build: {
				outDir,
				emptyOutDir: true,
				write: false,
				target: 'es2022',
				minify: true,
				lib: { entry, formats: ['es'], fileName: 'kernel' },
				rolldownOptions: { output: { codeSplitting: false } },
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

const ROWS = [
	['jsMinified', 'JavaScript, minified'],
	['jsGzip', 'JavaScript, gzip'],
	['cssMinified', 'CSS, minified, including loam-theme.css'],
	['kernelMinified', '@lushly-dev/loam-kernel alone, minified with Zod'],
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
	return { rows, page, kernel };
}

async function main() {
	const { rows, page, kernel } = await measure();
	if (process.argv.includes('--json')) {
		console.log(JSON.stringify({ rows, page, kernel }, null, '\t'));
	} else {
		const pad = (text, width) => String(text).padEnd(width);
		console.log(`Loaded before first paint: ${page.files.join(', ')}`);
		if (page.lazy.length) console.log(`Loaded later: ${page.lazy.join(', ')}`);
		for (const row of rows)
			console.log(
				`${pad(row.label, 52)} ${pad(row.bytes.toLocaleString('en-US'), 10)} of ${pad(row.ceiling.toLocaleString('en-US'), 10)} ${row.over ? 'OVER' : `${Math.round((row.bytes / row.ceiling) * 100)}%`}`
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
