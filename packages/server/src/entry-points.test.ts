/**
 * @fileoverview `@lushly-dev/afd-server/define` and `/direct` must stay transport-free.
 *
 * Bundles an entry that imports only one subpath with esbuild for the
 * browser. The bundle fails if anything in the module graph imports the MCP
 * SDK or a Node.js builtin. `/direct` is also held to size budgets for AFD's
 * own code, and a host that does not import `createDirectToolSurface` must not
 * bundle the tool router, the tool list or the bootstrap tools.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as define from './define.js';
import * as direct from './direct.js';
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
	metafile?: {
		inputs: Record<string, unknown>;
		outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }>;
	};
	outputFiles?: { contents: Uint8Array }[];
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

/** Workspace inputs appear as `../core/dist/...`, installed ones as `.../afd-core/dist/...`. */
const NODE_ONLY_CORE = /core\/dist\/(platform\.js|connectors\/|journal-file\.js)/;

async function bundleForBrowser(
	specifier: string,
	options: Record<string, unknown> = {}
): Promise<EsbuildResult> {
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
			...options,
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
		// Only the narrow core subpaths: not the core root, and nothing that needs Node.js.
		expect(
			inputs.filter((input) => /core\/dist\/index\.js/.test(input) || NODE_ONLY_CORE.test(input))
		).toEqual([]);
	});

	it('the root entry, by contrast, cannot be bundled for the browser', async () => {
		const result = await bundleForBrowser(PACKAGE_NAME);

		const texts = result.errors.map((message) => message.text).join('\n');
		expect(texts).toMatch(/node:(http|tls|child_process)/);
	});
});

const HOST_IMPORTS =
	'createDirectRegistry, createJournalMiddleware, defineCommand, failure, MemoryJournalSink, success';

/**
 * Size budgets for AFD's own code in `/direct`, minified, with Zod left to the application (any
 * app that defines commands loads it anyway). Measured 2026-10-31 with esbuild 0.27.7, after
 * part 3 of #527 (contexts and the tool surface in process), part 2 (approvals on WebCrypto) and
 * #577 (the `allow` call option, about 0.8 KB in the registry and 1.1 KB with the surface):
 *
 * - 38.1 KB for a host that imports the registry, the journal and `defineCommand`
 *   (37.3 KB before #577; 35.3 KB before part 3, whose contexts add 2.0 KB to the registry;
 *   32.2 KB before declared context fields). The budget stays 39 KB: neither the tool surface
 *   nor approvals are in it.
 * - 48.0 KB for a host that also imports `createApprovalMiddleware`.
 * - 68.6 KB for a host that also imports `createDirectToolSurface`: the router, the tool
 *   list, the meta-tools, `lazy-tools` and `bootstrap/`.
 * - 103.7 KB for every export. The budget was 66 KB (63.4 KB measured) before the tool
 *   surface and approvals joined the entry; it is now 113 KB.
 */
const DIRECT_BUDGETS = [
	{
		what: 'a host that imports the registry, the journal and defineCommand',
		imports: HOST_IMPORTS,
		bytes: 39_000,
	},
	{
		what: 'the same host with the approval middleware',
		imports: `${HOST_IMPORTS}, createApprovalMiddleware`,
		bytes: 52_000,
	},
	{
		what: 'a host with the tool surface',
		imports: `${HOST_IMPORTS}, createDirectToolSurface`,
		bytes: 74_000,
	},
	{ what: 'every export', imports: undefined, bytes: 113_000 },
];

/** The modules only the tool surface needs. */
const TOOL_SURFACE_MODULES =
	/src\/(tool-router|tools|lazy-tools|meta-tools|direct-tool-surface)\.ts$|src\/bootstrap\//;

/** The source modules that contribute bytes to a bundle, not merely parsed into its graph. */
function modulesInOutput(result: EsbuildResult): string[] {
	return Object.values(result.metafile?.outputs ?? {}).flatMap((output) =>
		Object.entries(output.inputs)
			.filter(([, input]) => input.bytesInOutput > 0)
			.map(([path]) => path)
	);
}
describe('@lushly-dev/afd-server/direct', () => {
	it('declares the subpath with the same conditions as the root export', () => {
		expect(manifest.exports['./direct']).toEqual({
			types: './dist/direct.d.ts',
			import: './dist/direct.js',
		});
	});

	it('re-exports the registry, journal and middleware of the root entry, and all of /define', () => {
		expect(direct.createDirectRegistry).toBe(root.createDirectRegistry);
		expect(direct.createDirectToolSurface).toBe(root.createDirectToolSurface);
		expect(direct.createApprovalMiddleware).toBe(root.createApprovalMiddleware);
		expect(direct.createJournalMiddleware).toBe(root.createJournalMiddleware);
		expect(direct.replayJournal).toBe(root.replayJournal);
		expect(direct.composeMiddleware).toBe(root.composeMiddleware);
		expect(direct.defaultMiddleware).toBe(root.defaultMiddleware);
		expect(direct.createLoggingMiddleware).toBe(root.createLoggingMiddleware);
		expect(direct.createTelemetryMiddleware).toBe(root.createTelemetryMiddleware);
		const directExports = new Map(Object.entries(direct));
		for (const [name, value] of Object.entries(define)) {
			expect(directExports.get(name), name).toBe(value);
		}
	});

	it('bundles for the browser with no MCP SDK or Node builtin in its module graph', async () => {
		const result = await bundleForBrowser(`${PACKAGE_NAME}/direct`);

		expect(result.errors.map((message) => message.text)).toEqual([]);
		const inputs = Object.keys(result.metafile?.inputs ?? {});
		expect(inputs.some((input) => input.endsWith('src/direct-registry.ts'))).toBe(true);
		expect(inputs.some((input) => input.endsWith('src/journal-replay.ts'))).toBe(true);
		expect(inputs.some((input) => input.endsWith('src/approval-crypto.ts'))).toBe(true);
		expect(inputs.filter((input) => /modelcontextprotocol|^node:/.test(input))).toEqual([]);
		expect(inputs.filter((input) => NODE_ONLY_CORE.test(input))).toEqual([]);
	});

	it('keeps the tool surface out of a registry that does not ask for it', async () => {
		const specifier = `${PACKAGE_NAME}/direct`;
		const bundle = (imports: string) =>
			bundleForBrowser(specifier, {
				minify: true,
				external: ['zod', 'zod/*'],
				stdin: {
					contents: `export { ${imports} } from '${specifier}';`,
					resolveDir: packageRoot,
					sourcefile: 'browser-entry.js',
				},
			});

		const hostBundle = await bundle(HOST_IMPORTS);
		expect(hostBundle.errors.map((message) => message.text)).toEqual([]);
		const host = modulesInOutput(hostBundle);
		expect(host.some((path) => path.endsWith('src/direct-registry.ts'))).toBe(true);
		expect(host.filter((path) => TOOL_SURFACE_MODULES.test(path))).toEqual([]);

		// The router and the tool list load no Node.js built-in since the confirmation gate moved
		// out of confirmations.ts, so the surface bundles for the browser too.
		const surfaceBundle = await bundle(`${HOST_IMPORTS}, createDirectToolSurface`);
		expect(surfaceBundle.errors.map((message) => message.text)).toEqual([]);
		const surface = modulesInOutput(surfaceBundle);
		expect(surface.some((path) => path.endsWith('src/tool-router.ts'))).toBe(true);
		expect(surface.some((path) => path.endsWith('src/tools.ts'))).toBe(true);
		expect(surface.filter((path) => /^node:|modelcontextprotocol/.test(path))).toEqual([]);
	});

	it.each(DIRECT_BUDGETS)('keeps $what within $bytes bytes minified', async (budget) => {
		const specifier = `${PACKAGE_NAME}/direct`;
		const result = await bundleForBrowser(specifier, {
			minify: true,
			external: ['zod', 'zod/*'],
			...(budget.imports && {
				stdin: {
					contents: `export { ${budget.imports} } from '${specifier}';`,
					resolveDir: packageRoot,
					sourcefile: 'browser-entry.js',
				},
			}),
		});

		expect(result.errors.map((message) => message.text)).toEqual([]);
		const size = result.outputFiles?.[0]?.contents.length ?? Number.POSITIVE_INFINITY;
		expect(size).toBeLessThanOrEqual(budget.bytes);
	});
});
