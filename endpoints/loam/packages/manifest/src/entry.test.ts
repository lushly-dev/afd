/**
 * @fileoverview What each entry bundles for the browser. The root and `/validate` reach the page, so they
 * must never reach `/server`'s reader, the Public Suffix List (`tldts`) or a Node.js builtin.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };
import { compileValidators, packageRoot } from '../scripts/compile.mjs';

interface EsbuildResult {
	errors: Array<{ text: string }>;
	metafile?: { inputs: Record<string, unknown> };
}

interface EsbuildPluginBuild {
	onResolve(
		options: { filter: RegExp },
		callback: (args: { path: string }) => { path: string; namespace: string }
	): void;
	onLoad(
		options: { filter: RegExp; namespace: string },
		callback: (args: { path: string }) => { contents: string; resolveDir: string; loader: 'js' }
	): void;
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
	throw new Error('esbuild is not resolvable. It normally comes with vite.');
}

/** The validators live in dist/; the bundle compiles them from the current schemas, as the suite does. */
const validators = {
	name: 'loam-manifest-validators',
	setup(build: EsbuildPluginBuild) {
		build.onResolve({ filter: /validate(?:-[a-z]+)?\.generated\.js$/ }, (args) => ({
			path: args.path.split('/').at(-1) as string,
			namespace: 'generated',
		}));
		build.onLoad({ filter: /.*/, namespace: 'generated' }, (args) => ({
			contents: compileValidators()[args.path] as string,
			resolveDir: packageRoot,
			loader: 'js',
		}));
	},
};

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
		plugins: [validators],
	});
	expect(result.errors).toEqual([]);
	return Object.keys(result.metafile?.inputs ?? {});
}

describe('entries', () => {
	it.each([
		['.', 'index.ts'],
		['./validate', 'validate.ts'],
	])('%s never reaches tldts, the server reader or a Node.js builtin', async (subpath, file) => {
		const exports = packageJson.exports as Record<string, { import?: string }>;
		expect(exports[subpath]?.import).toBe(`./dist/${file.replace(/\.ts$/, '.js')}`);
		const inputs = await browserInputs(file);
		expect(inputs.some((input) => input.endsWith(`src/${file}`))).toBe(true);
		expect(inputs.filter((input) => input.startsWith('node:'))).toEqual([]);
		expect(inputs.filter((input) => /tldts|read-server|validate-server/.test(input))).toEqual([]);
	});

	it('/server is where they are, so the scan above can see them', async () => {
		const inputs = await browserInputs('server.ts');
		expect(inputs.some((input) => /\/tldts(-core)?\//.test(input))).toBe(true);
		expect(inputs.some((input) => input.endsWith('src/read-server.ts'))).toBe(true);
	});
});
