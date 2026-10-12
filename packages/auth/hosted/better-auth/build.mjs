import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export async function buildFixture(directory) {
	await mkdir(directory, { recursive: true });
	await build({
		entryPoints: [fileURLToPath(new URL('./fixture.ts', import.meta.url))],
		bundle: true,
		outfile: resolve(directory, 'fixture.js'),
		format: 'esm',
		platform: 'browser',
		define: { 'process.env.NODE_ENV': '"production"' },
		logLevel: 'silent',
	});
	await build({
		entryPoints: [fileURLToPath(new URL('./child-entry.ts', import.meta.url))],
		bundle: true,
		packages: 'external',
		outfile: resolve(directory, 'server.mjs'),
		format: 'esm',
		platform: 'node',
		target: 'node24',
		logLevel: 'silent',
	});
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (!process.argv[2])
		throw new Error('Usage: node build.mjs OUTPUT_DIRECTORY (with access to auth node_modules)');
	await buildFixture(resolve(process.argv[2]));
}
