/**
 * @fileoverview `@lushly-dev/afd-server/define` must stay transport-free.
 *
 * Bundles an entry that imports only the `/define` subpath with esbuild for
 * the browser. The bundle fails if anything in the module graph imports the
 * MCP SDK or a Node.js builtin.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as define from './define.js';
import * as root from './index.js';

// ─── Minimal esbuild API surface used here ───────────────────────────────────

interface EsbuildMessage {
	text: string;
}

interface EsbuildResolveResult {
	path?: string;
	errors?: EsbuildMessage[];
}

interface EsbuildPluginBuild {
	onResolve(
		options: { filter: RegExp },
		callback: (args: { path: string }) => EsbuildResolveResult
	): void;
}

interface EsbuildResult {
	errors: EsbuildMessage[];
	metafile?: { inputs: Record<string, unknown> };
}

interface EsbuildApi {
	build(options: Record<string, unknown>): Promise<EsbuildResult>;
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_NAME = '@lushly-dev/afd-server';

interface ExportConditions {
	types: string;
	import: string;
}

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
	exports: Record<string, ExportConditions>;
};

/**
 * esbuild is not a direct dependency: it is installed through vite (vitest)
 * and tsx. Resolve it from vitest's real location, where pnpm's hoisting makes
 * it visible.
 */
async function loadEsbuild(): Promise<EsbuildApi> {
	const require = createRequire(import.meta.url);
	const bases = [import.meta.url, require.resolve('vitest/package.json')];
	for (const base of bases) {
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

/**
 * Resolve `@lushly-dev/afd-server[/subpath]` through package.json `exports`,
 * mapped to the TypeScript source so the test does not need a fresh build.
 * Dependencies such as `@lushly-dev/afd-core` resolve normally (to their dist).
 */
const selfReference = {
	name: 'afd-server-self-reference',
	setup(build: EsbuildPluginBuild) {
		build.onResolve({ filter: /^@lushly-dev\/afd-server(\/.*)?$/ }, (args) => {
			const subpath = `.${args.path.slice(PACKAGE_NAME.length)}`;
			const target = manifest.exports[subpath]?.import;
			if (!target) {
				return { errors: [{ text: `package.json has no "${subpath}" export` }] };
			}
			const source = target.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts');
			return { path: join(packageRoot, source) };
		});
	},
};

async function bundleForBrowser(specifier: string): Promise<EsbuildResult> {
	const esbuild = await loadEsbuild();
	try {
		return await esbuild.build({
			stdin: {
				contents: `export * from '${specifier}';`,
				resolveDir: packageRoot,
				sourcefile: 'browser-entry.js',
			},
			bundle: true,
			platform: 'browser',
			format: 'esm',
			write: false,
			metafile: true,
			logLevel: 'silent',
			plugins: [selfReference],
		});
	} catch (error) {
		const errors = (error as { errors?: EsbuildMessage[] }).errors;
		if (!errors) throw error;
		return { errors };
	}
}

describe('@lushly-dev/afd-server/define', () => {
	it('declares the subpath with the same conditions as the root export', () => {
		expect(manifest.exports['./define']).toEqual({
			types: './dist/define.d.ts',
			import: './dist/define.js',
		});
		expect(Object.keys(manifest.exports['.'] ?? {})).toEqual(['types', 'import']);
	});

	it('re-exports the same command definition helpers as the root entry', () => {
		expect(define.defineCommand).toBe(root.defineCommand);
		expect(define.zodToJsonSchema).toBe(root.zodToJsonSchema);
		expect(define.getRequiredFields).toBe(root.getRequiredFields);
		expect(define.isObjectSchema).toBe(root.isObjectSchema);
		expect(define.success).toBe(root.success);
		expect(define.failure).toBe(root.failure);
		expect(define.error).toBe(root.error);
		expect(define.isSuccess).toBe(root.isSuccess);
		expect(define.isFailure).toBe(root.isFailure);
		expect(define.defaultExpose).toBe(root.defaultExpose);
	});

	it('bundles for the browser with no MCP SDK or Node builtin in its module graph', async () => {
		const result = await bundleForBrowser(`${PACKAGE_NAME}/define`);

		expect(result.errors.map((message) => message.text)).toEqual([]);
		const inputs = Object.keys(result.metafile?.inputs ?? {});
		expect(inputs.some((input) => input.endsWith('src/schema.ts'))).toBe(true);
		expect(inputs.some((input) => input.endsWith('core/dist/commands.js'))).toBe(true);
		expect(inputs.filter((input) => /modelcontextprotocol|^node:/.test(input))).toEqual([]);
		// The core root entry still re-exports the process-spawning connectors.
		// Workspace inputs appear as `../core/dist/...`, installed ones as `.../afd-core/dist/...`.
		expect(
			inputs.filter((input) => /core\/dist\/(index\.js|platform\.js|connectors\/)/.test(input))
		).toEqual([]);
	});

	it('the root entry, by contrast, cannot be bundled for the browser', async () => {
		const result = await bundleForBrowser(PACKAGE_NAME);

		const texts = result.errors.map((message) => message.text).join('\n');
		expect(texts).toMatch(/node:(http|tls|child_process)/);
	});
});
