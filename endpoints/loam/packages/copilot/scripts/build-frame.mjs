#!/usr/bin/env node
/**
 * Builds the runtime frame's assets into `dist/frame/` (phase 5 specification, 3.2 and 16): `index.html`, the
 * first-party `bootstrap.js`, and one runtime chunk per provider kind as classic scripts for a `blob:` worker's
 * `importScripts`. The vendor SDKs are aliased to a stub that throws (4.3). `dist/frame/sizes.json` records each
 * chunk's gzip size for `budget`. A host copies `dist/frame/` to its sandbox origin's `sandbox/copilot/`.
 */
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist/frame');
const stub = join(root, 'src/sdk-stub.ts');

async function bundle(entry, name) {
	const result = await build({
		configFile: false,
		root,
		logLevel: 'warn',
		resolve: {
			alias: [
				{ find: /^@anthropic-ai\/sdk$/, replacement: stub },
				{ find: /^openai$/, replacement: stub },
			],
		},
		define: { 'process.env.NODE_ENV': '"production"' },
		build: {
			write: false,
			minify: true,
			target: 'es2022',
			lib: { entry: join(root, entry), formats: ['iife'], name: 'loamCopilot', fileName: name },
			rolldownOptions: { output: { codeSplitting: false } },
		},
	});
	const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
	return outputs.find((item) => item.type === 'chunk').code;
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const sizes = {};
for (const [entry, name] of [
	['src/frame/bootstrap.ts', 'bootstrap.js'],
	['src/runtime-anthropic.ts', 'runtime-anthropic.js'],
	['src/runtime-openai.ts', 'runtime-openai.js'],
]) {
	const code = await bundle(entry, name);
	await writeFile(join(out, name), code);
	sizes[name] = {
		minBytes: Buffer.byteLength(code),
		gzipBytes: gzipSync(code, { level: 9 }).length,
	};
}
await copyFile(join(root, 'static/index.html'), join(out, 'index.html'));
await writeFile(join(out, 'sizes.json'), `${JSON.stringify(sizes, null, '\t')}\n`);
