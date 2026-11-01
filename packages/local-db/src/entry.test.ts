/**
 * @fileoverview The package's entries bundle for the browser.
 *
 * The root, `/indexeddb` and `/testing` entries must not reach any Node.js builtin, so a
 * browser app (and a Vitest browser-mode suite) can import them. The root entry must not load
 * the IndexedDB adapter or the contract suite.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };

interface EsbuildResult {
	errors: Array<{ text: string }>;
	metafile?: { inputs: Record<string, unknown> };
}

interface EsbuildApi {
	build(options: Record<string, unknown>): Promise<EsbuildResult>;
}

const srcDir = dirname(fileURLToPath(import.meta.url));

/** esbuild comes with vite (vitest); resolve it from vitest's real location. */
async function loadEsbuild(): Promise<EsbuildApi> {
	const require = createRequire(import.meta.url);
	for (const base of [import.meta.url, require.resolve('vitest/package.json')]) {
		try {
			const entry = createRequire(base).resolve('esbuild');
			return (await import(pathToFileURL(entry).href)) as EsbuildApi;
		} catch {
			// Try the next base.
		}
	}
	throw new Error(
		'esbuild is not resolvable. It normally comes with vite; add it as a devDependency.'
	);
}

async function browserInputs(file: string): Promise<string[]> {
	const esbuild = await loadEsbuild();
	const result = await esbuild.build({
		entryPoints: [join(srcDir, file)],
		bundle: true,
		platform: 'browser',
		format: 'esm',
		write: false,
		metafile: true,
		logLevel: 'silent',
		external: ['vitest'],
	});
	expect(result.errors).toEqual([]);
	return Object.keys(result.metafile?.inputs ?? {});
}

describe('entries', () => {
	it.each([
		['.', 'index.ts'],
		['./indexeddb', 'indexeddb-adapter.ts'],
		['./testing', 'testing.ts'],
	])(
		'%s is exported and bundles for the browser with no Node.js builtin',
		async (subpath, file) => {
			const exports = packageJson.exports as Record<string, { import: string }>;
			expect(exports[subpath]?.import).toBe(`./dist/${file.replace(/\.ts$/, '.js')}`);

			const inputs = await browserInputs(file);
			expect(inputs.some((input) => input.endsWith(`src/${file}`))).toBe(true);
			expect(inputs.filter((input) => input.startsWith('node:'))).toEqual([]);
		}
	);

	it('keeps the IndexedDB adapter and the contract suite out of the root entry', async () => {
		const inputs = await browserInputs('index.ts');
		expect(inputs.filter((input) => /src\/(indexeddb-adapter|testing)\.ts$/.test(input))).toEqual(
			[]
		);
	});
});
