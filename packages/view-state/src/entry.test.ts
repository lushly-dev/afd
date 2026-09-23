/**
 * @fileoverview The package entry points load no MCP transport.
 *
 * Bundles `@lushly-dev/afd-view-state` and `@lushly-dev/afd-view-state/commands`
 * with esbuild for the browser. The commands take `defineCommand` from
 * `@lushly-dev/afd-server/define`, so neither entry reaches the MCP SDK,
 * `node:http` or any other Node.js builtin.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as commandsEntry from './commands.js';
import * as root from './index.js';

// ─── Minimal esbuild API surface used here ───────────────────────────────────

interface EsbuildMessage {
	text: string;
}

interface EsbuildPluginBuild {
	onResolve(
		options: { filter: RegExp },
		callback: (args: { path: string }) => { path?: string; errors?: EsbuildMessage[] }
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
const PACKAGE_NAME = '@lushly-dev/afd-view-state';

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
	exports: Record<string, { types: string; import: string }>;
};

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

/** Resolve this package's own subpaths through `exports`, to the TypeScript source. */
const selfReference = {
	name: 'afd-view-state-self-reference',
	setup(build: EsbuildPluginBuild) {
		build.onResolve({ filter: /^@lushly-dev\/afd-view-state(\/.*)?$/ }, (args) => {
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

async function browserBundleInputs(specifier: string): Promise<string[]> {
	const esbuild = await loadEsbuild();
	const result = await esbuild.build({
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
	expect(result.errors).toEqual([]);
	return Object.keys(result.metafile?.inputs ?? {});
}

/**
 * Modules that belong to the MCP transport or to Node.js. Workspace inputs
 * appear as `../server/dist/...`; installed ones as `.../afd-server/dist/...`.
 */
const TRANSPORT =
	/modelcontextprotocol|^node:|server\/dist\/(index|server|http-handler)\.js|core\/dist\/(index|platform)\.js|core\/dist\/connectors\//;

describe('package entry points', () => {
	it('declares ./commands next to the root with the same conditions', () => {
		expect(manifest.exports['./commands']).toEqual({
			types: './dist/commands.d.ts',
			import: './dist/commands.js',
		});
	});

	it('keeps the deprecated root re-export of the command factory', () => {
		expect(root.createViewStateCommands).toBe(commandsEntry.createViewStateCommands);
	});

	it('bundles the root entry for the browser without the MCP transport', async () => {
		const inputs = await browserBundleInputs(PACKAGE_NAME);

		expect(inputs.some((input) => input.endsWith('src/registry.ts'))).toBe(true);
		expect(inputs.filter((input) => TRANSPORT.test(input))).toEqual([]);
	});

	it('bundles the commands entry for the browser without the MCP transport', async () => {
		const inputs = await browserBundleInputs(`${PACKAGE_NAME}/commands`);

		expect(inputs.some((input) => input.endsWith('server/dist/define.js'))).toBe(true);
		expect(inputs.filter((input) => TRANSPORT.test(input))).toEqual([]);
	});
});
