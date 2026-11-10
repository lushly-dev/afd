/**
 * The main entry never bundles the Mock's capabilities: they are `/mock-capabilities`', so a
 * host that only signs in with the Mock and gates commands, as Loam's first paint does, leaves
 * them out (Loam phase 3, section 13).
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

interface Output {
	inputs: Record<string, { bytesInOutput: number }>;
}

interface EsbuildApi {
	build(
		options: Record<string, unknown>
	): Promise<{ metafile: { outputs: Record<string, Output> } }>;
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** esbuild comes through vitest's vite; resolve it from there, as afd-server's entry test does. */
async function loadEsbuild(): Promise<EsbuildApi> {
	const require = createRequire(import.meta.url);
	for (const base of [import.meta.url, require.resolve('vitest/package.json')]) {
		try {
			return (await import(
				pathToFileURL(createRequire(base).resolve('esbuild')).href
			)) as EsbuildApi;
		} catch {
			// Try the next base.
		}
	}
	throw new Error('esbuild not found');
}

async function bundledInputs(contents: string): Promise<string[]> {
	const esbuild = await loadEsbuild();
	const { metafile } = await esbuild.build({
		stdin: { contents, resolveDir: packageRoot, sourcefile: 'entry.ts', loader: 'ts' },
		bundle: true,
		format: 'esm',
		platform: 'browser',
		write: false,
		metafile: true,
		external: ['@lushly-dev/afd-core', '@lushly-dev/afd-core/*'],
	});
	return Object.values(metafile.outputs).flatMap((output) =>
		Object.entries(output.inputs)
			.filter(([, input]) => input.bytesInOutput > 0)
			.map(([input]) => input)
	);
}

const CAPABILITY_MODULES = ['src/adapters/mock-directory.ts', 'src/adapters/session-rows.ts'];

it('keeps the Mock’s capabilities out of the main entry', async () => {
	// What Loam's first paint imports: neither the records nor the session helpers.
	const firstPaint = await bundledInputs(
		"export { MockAuthAdapter, createAuthMiddleware } from './src/index.ts';"
	);
	expect(firstPaint.some((input) => input.endsWith('src/adapters/mock.ts'))).toBe(true);
	expect(firstPaint.filter((input) => CAPABILITY_MODULES.some((m) => input.endsWith(m)))).toEqual(
		[]
	);
	// The whole entry: `BetterAuthAdapter` uses the session helpers, never the Mock's records.
	const root = await bundledInputs("export * from './src/index.ts';");
	expect(root.filter((input) => input.endsWith('src/adapters/mock-directory.ts'))).toEqual([]);
});

it('bundles them from /mock-capabilities', async () => {
	const inputs = await bundledInputs(
		"export { withMockCapabilities } from './src/mock-capabilities.ts';"
	);
	for (const module of CAPABILITY_MODULES) {
		expect(inputs.some((input) => input.endsWith(module))).toBe(true);
	}
});
