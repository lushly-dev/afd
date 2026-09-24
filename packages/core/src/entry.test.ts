/**
 * @fileoverview The root entry bundles for the browser.
 *
 * The connectors spawn processes, so they live only in `@lushly-dev/afd-core/connectors`.
 * Bundling the root entry with esbuild for the browser must not reach `node:child_process`
 * or any other Node.js builtin.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as root from './index.js';

interface EsbuildResult {
	errors: Array<{ text: string }>;
	metafile?: { inputs: Record<string, unknown> };
}

interface EsbuildApi {
	build(options: Record<string, unknown>): Promise<EsbuildResult>;
}

const srcDir = dirname(fileURLToPath(import.meta.url));

/** esbuild comes with vite (vitest) and tsx; resolve it from vitest's real location. */
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
		'esbuild is not resolvable. It normally comes with vite and tsx; add it as a devDependency.'
	);
}

describe('root entry', () => {
	it('bundles for the browser with no Node.js builtin in its module graph', async () => {
		const esbuild = await loadEsbuild();
		const result = await esbuild.build({
			entryPoints: [join(srcDir, 'index.ts')],
			bundle: true,
			platform: 'browser',
			format: 'esm',
			write: false,
			metafile: true,
			logLevel: 'silent',
		});

		expect(result.errors).toEqual([]);
		const inputs = Object.keys(result.metafile?.inputs ?? {});
		expect(inputs.some((input) => input.endsWith('src/result.ts'))).toBe(true);
		expect(inputs.filter((input) => /^node:|src\/(platform|connectors\/)/.test(input))).toEqual([]);
	});

	it('no longer exports the resolveReference alias', () => {
		expect(root).not.toHaveProperty('resolveReference');
		expect(root.resolveVariable).toBeTypeOf('function');
	});
});
