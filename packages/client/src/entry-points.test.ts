/**
 * @fileoverview `@lushly-dev/afd-client/streamable-http` must stay browser-safe.
 *
 * Bundles an entry that imports only that subpath with esbuild for the browser. The test fails if
 * the module graph reaches this package's `eventsource` dependency or a Node.js builtin, if the
 * bundle gains a way to compile code beyond Zod's two known ones, which a strict
 * Content-Security-Policy refuses, or if it outgrows its budget.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as root from './index.js';
import type {
	ElicitationHandler,
	ElicitationRequest,
	ElicitationResponse,
	McpInitializeResult,
	McpRequest,
	McpResponse,
	McpTool,
	McpToolCallParams,
	McpToolCallResult,
	StreamableHttpMode,
	StreamableHttpTransportOptions,
	Transport,
} from './streamable-http.js';
import * as entry from './streamable-http.js';

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
		outputs: Record<
			string,
			{ imports: { path: string }[]; inputs: Record<string, { bytesInOutput: number }> }
		>;
	};
	outputFiles?: { contents: Uint8Array }[];
}

interface EsbuildApi {
	build(options: Record<string, unknown>): Promise<EsbuildResult>;
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_NAME = '@lushly-dev/afd-client';
const ENTRY = `${PACKAGE_NAME}/streamable-http`;

interface ExportConditions {
	types: string;
	import: string;
}

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
	exports: Record<string, ExportConditions>;
};

/**
 * esbuild is not a direct dependency: it is installed through vite (vitest) and tsx. Resolve it
 * from vitest's real location, where pnpm's hoisting makes it visible.
 */
async function loadEsbuild(): Promise<EsbuildApi> {
	const require = createRequire(import.meta.url);
	const bases = [import.meta.url, require.resolve('vitest/package.json')];
	for (const base of bases) {
		try {
			const resolved = createRequire(base).resolve('esbuild');
			return (await import(pathToFileURL(resolved).href)) as EsbuildApi;
		} catch {
			// Try the next base.
		}
	}
	throw new Error(
		'esbuild is not resolvable. It normally comes with vite and tsx; add it as a devDependency.'
	);
}

/**
 * Resolve `@lushly-dev/afd-client[/subpath]` through package.json `exports`, mapped to the
 * TypeScript source so the test does not need a fresh build. Dependencies such as
 * `@lushly-dev/afd-core` resolve normally (to their dist).
 */
const selfReference = {
	name: 'afd-client-self-reference',
	setup(build: EsbuildPluginBuild) {
		build.onResolve({ filter: /^@lushly-dev\/afd-client(\/.*)?$/ }, (args) => {
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
			absWorkingDir: packageRoot,
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

/**
 * This package's own `eventsource`, as esbuild's metafile spells it: relative to the package,
 * with forward slashes on every platform.
 */
const OWN_EVENTSOURCE = `${relative(
	packageRoot,
	realpathSync(join(packageRoot, 'node_modules/eventsource'))
)
	.split(sep)
	.join('/')}/`;

/** The modules of this package the entry may load: everything else it names is a type. */
const OWN_MODULES = [
	'src/request-abort.ts',
	'src/streamable-http-transport.ts',
	'src/streamable-http.ts',
];

/**
 * Every reference to the global `Function` that could compile code, in the minified bundle. Two
 * are Zod's, and both are expected: its probe (`allowsEval`) and its JIT (`Doc.compile`). The rest
 * of the word's uses are `Function.prototype` and an error message. A third is a new way to break
 * a strict Content-Security-Policy.
 */
const FUNCTION_REFERENCES = /\bFunction\b(?!\.prototype| types)/g;
const ZOD_FUNCTION_REFERENCES = 2;

/** The source modules that contribute bytes to a bundle, not merely parsed into its graph. */
function modulesInOutput(result: EsbuildResult): string[] {
	return Object.values(result.metafile?.outputs ?? {}).flatMap((output) =>
		Object.entries(output.inputs)
			.filter(([, input]) => input.bytesInOutput > 0)
			.map(([path]) => path)
	);
}

/**
 * The budget, minified, covers the whole entry, with the SDK and Zod in it. Measured 2026-11-01
 * with esbuild 0.27.7: 327,336 bytes, of which the SDK's client and transport are 324,094. Loam's
 * `mount` chunk, which loads this entry, has the same ceiling.
 */
const BUDGET_BYTES = 340_000;

describe('@lushly-dev/afd-client/streamable-http', () => {
	it('declares the subpath with the same conditions as the root export', () => {
		expect(manifest.exports['./streamable-http']).toEqual({
			types: './dist/streamable-http.d.ts',
			import: './dist/streamable-http.js',
		});
		expect(manifest.exports['.']).toEqual({
			types: './dist/index.d.ts',
			import: './dist/index.js',
		});
	});

	it('exports the transport of the root entry, and nothing else at runtime', () => {
		expect(Object.keys(entry).sort()).toEqual([
			'MODERN_PROTOCOL_VERSION',
			'StreamableHttpTransport',
		]);
		expect(entry.StreamableHttpTransport).toBe(root.StreamableHttpTransport);
		expect(entry.MODERN_PROTOCOL_VERSION).toBe(root.MODERN_PROTOCOL_VERSION);
	});

	it('exports the types of the MCP calls a host makes over the transport', () => {
		expectTypeOf<ElicitationHandler>().toBeFunction();
		expectTypeOf<ElicitationRequest>().toHaveProperty('message');
		expectTypeOf<ElicitationResponse>().toHaveProperty('action');
		expectTypeOf<McpInitializeResult>().toHaveProperty('protocolVersion');
		expectTypeOf<McpRequest>().toHaveProperty('method');
		expectTypeOf<McpResponse>().toHaveProperty('id');
		expectTypeOf<McpTool>().toHaveProperty('name');
		expectTypeOf<McpToolCallParams>().toHaveProperty('name');
		expectTypeOf<McpToolCallResult>().toHaveProperty('content');
	});

	it('exports the types a host needs to build a transport', () => {
		const mode: StreamableHttpMode = 'auto';
		const options: StreamableHttpTransportOptions = {
			clientName: 'test',
			clientVersion: '1.0.0',
			mode,
		};
		const transport: Transport = new entry.StreamableHttpTransport(
			'http://localhost:1/mcp',
			options
		);

		expect(transport.isConnected()).toBe(false);
	});

	it('bundles for the browser with no eventsource of ours or Node builtin in its module graph', async () => {
		const result = await bundleForBrowser(ENTRY);

		expect(result.errors.map((message) => message.text)).toEqual([]);
		const inputs = Object.keys(result.metafile?.inputs ?? {});
		// The SDK's browser shim, which validates with @cfworker/json-schema and not with Ajv.
		expect(inputs.some((input) => input.endsWith('dist/shimsBrowser.mjs'))).toBe(true);
		expect(inputs.filter((input) => /dist\/shimsNode|\/ajv\//.test(input))).toEqual([]);
		// esbuild refuses a static builtin import, and an optional one is left as an output import.
		expect(
			result.metafile && Object.values(result.metafile.outputs).flatMap((o) => o.imports)
		).toEqual([]);
		expect(inputs.filter((input) => input.startsWith('(disabled):'))).toEqual([]);
		expect(inputs.filter((input) => input.startsWith(OWN_EVENTSOURCE))).toEqual([]);
		// Type-only imports: nothing of the rest of the package, or of AFD core, is loaded.
		expect(inputs.filter((input) => input.startsWith('src/')).sort()).toEqual(OWN_MODULES);
		expect(inputs.filter((input) => /^\.\.\/core\/|afd-core/.test(input))).toEqual([]);
		// The SDK imports its own eventsource for its SSE transport; none of that code is kept.
		expect(modulesInOutput(result).filter((path) => /\/eventsource\//.test(path))).toEqual([]);
	});

	it('the root entry, by contrast, loads eventsource', async () => {
		const result = await bundleForBrowser(PACKAGE_NAME);

		expect(result.errors.map((message) => message.text)).toEqual([]);
		const inputs = Object.keys(result.metafile?.inputs ?? {});
		expect(inputs.some((input) => input.startsWith(OWN_EVENTSOURCE))).toBe(true);
	});

	it(`keeps the whole entry within ${BUDGET_BYTES} bytes minified`, async () => {
		const result = await bundleForBrowser(ENTRY, { minify: true });

		expect(result.errors.map((message) => message.text)).toEqual([]);
		const contents = result.outputFiles?.[0]?.contents;
		expect(contents?.length ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(BUDGET_BYTES);
	});

	it('compiles code only where Zod does, and reads no Node.js global', async () => {
		const result = await bundleForBrowser(ENTRY, { minify: true });

		expect(result.errors.map((message) => message.text)).toEqual([]);
		const text = new TextDecoder().decode(result.outputFiles?.[0]?.contents);
		expect(text.match(FUNCTION_REFERENCES)).toHaveLength(ZOD_FUNCTION_REFERENCES);
		expect(text).not.toMatch(/\beval\b/);
		expect(text).not.toMatch(/\bprocess\.|\bBuffer\b|\brequire\(/);
	});
});
