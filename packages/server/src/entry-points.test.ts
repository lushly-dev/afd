/**
 * @fileoverview `@lushly-dev/afd-server/define`, `/direct` and `/credentials` must stay
 * transport-free.
 *
 * Bundles an entry that imports only one subpath with esbuild for the
 * browser. The bundle fails if anything in the module graph imports the MCP
 * SDK or a Node.js builtin. `/direct` is also held to size budgets for AFD's
 * own code, and a host that does not import `createDirectToolSurface` must not
 * bundle the tool router, the tool list or the bootstrap tools. A host on the lean path must bundle
 * neither classic Zod nor `toJSONSchema`.
 */

import { execFileSync } from 'node:child_process';
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
		inputs: Record<string, { imports: { path: string }[] }>;
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

/** The MCP authorization layer and the library it verifies signatures with. */
const MCP_AUTH_LAYER = /src\/(mcp-auth|strict-json)|\/jose\//;

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
		expect(define.defineCommandWithSchema).toBe(root.defineCommandWithSchema);
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
		expect(inputs.filter((input) => MCP_AUTH_LAYER.test(input))).toEqual([]);
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

describe('@lushly-dev/afd-server/credentials', () => {
	it('declares the subpath with the same conditions as the root export', () => {
		expect(manifest.exports['./credentials']).toEqual({
			types: './dist/credentials.d.ts',
			import: './dist/credentials.js',
		});
	});

	it('bundles for the browser as the brand module alone', async () => {
		const result = await bundleForBrowser(`${PACKAGE_NAME}/credentials`);

		expect(result.errors.map((message) => message.text)).toEqual([]);
		const inputs = Object.keys(result.metafile?.inputs ?? {}).filter(
			(input) => input !== 'browser-entry.js'
		);
		expect(inputs.map((input) => input.replace(/^.*\/src\//, 'src/')).sort()).toEqual([
			'src/credentials.ts',
			'src/verified-credentials.ts',
		]);
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
 *   nor approvals are in it. Measured again 2026-11-02 with esbuild 0.28.2 on the lean path: 38,588
 *   bytes before it and under 39,000 after, with almost nothing to spare, since `issue-message.ts`
 *   was cut down to fit. The next addition here moves something out or changes this budget openly.
 *   Raised to 39,100 by MCP authorization's scopes (Loam phase 3 step 0c, approved by the
 *   coordinator 2026-11-10): measured 38,997 bytes on `main` and 39,071 after, with esbuild
 *   0.28.2; `defineCommand` carrying a command's `scopes` adds 31, and the engine's two optional
 *   hooks that look a hidden command up as a missing one add 43. No authorization code is in it.
 *   Raised to 39,400 by `JournalRange.last` (#663, 2026-11-18): measured 39,099 bytes on `main` at
 *   `626187de` and 39,315 after, with esbuild 0.28.2; `MemoryJournalSink` reads through
 *   `selectJournalRange`, which now checks `last` and takes the range's tail.
 *   Raised to 39,500 by app-to-app calls (Loam phase 5 step 0b, under D115's rule that a step
 *   raises the limit it exceeds): measured 39,315 bytes on `main` at `5e219704` and 39,419 after. The check
 *   itself is in `createAppCallRegistry`'s own module, which this host does not bundle (asserted
 *   below); `createDirectRegistry` only throws for `apps` unless that registry built it, through
 *   a module-private symbol, which adds 104. Putting the check here cost 772.
 *   Raised to 39,600 by the journal's append order and `JournalRange.last`'s clamp (#1650, under D115):
 *   measured 39,419 bytes on `main` at `1ec16f4c` and 39,508 after, with esbuild 0.28.2. The journal
 *   middleware takes a turn as a command returns, so concurrent calls append in the order they finished.
 *   Raised to 42,000 / 54,000 / 76,500 / 116,000 by bounded pipeline variable expansion (#1704, under D115):
 *   measured 41,666 / 53,605 / 76,090 / 115,729 bytes after adding bounded cloning and expansion accounting
 *   to `packages/core/src/pipeline-variables.ts` and `VALIDATION_ERROR` handling to `pipeline-executor.ts`.
 *   Raised to 43,300 / 55,700 / 77,700 / 117,800 by approval admission (a declared approval policy
 *   holds without the approval middleware, under D115): measured on `main` at `2700c62e` 41,666 /
 *   53,649 / 76,090 / 115,773 bytes, and 42,951 / 55,365 / 77,375 / 117,482 after, with esbuild
 *   0.28.2. The engine records each call's policy and admission and refuses an unadmitted gated
 *   call; the canonical JSON that binds an admission to its input comes from the approval
 *   middleware, so a host without it does not bundle it. A second refusal reason (an approval step
 *   ran, but not for this dispatch) took them to 43,305 / 55,719 / 77,729 / 117,836; raised to
 *   43,700 / 56,100 / 78,100 / 118,200.
 *   The approval-admission follow-ups (a listed policy's gate recorded on the admission, the
 *   canonical input decided on carried into it, and the middleware's `input-not-canonical` answer,
 *   under D115): measured on `main` at `d6764276` 43,305 / 55,719 / 77,729 / 117,836 bytes and
 *   43,386 / 56,431 / 77,810 / 118,549 after, with esbuild 0.28.2; the two it exceeds are raised
 *   to 56,500 and 118,600. Their review fixes (an approval step admits only a call it may gate,
 *   every step's admission must match, and an input changed while the step decides is refused)
 *   took those two to 57,006 and 119,121, and a fresh admission required from every step that
 *   admitted to 57,230 and 119,346; raised to 57,400 and 119,500.
 *   Contract schemas and error-code metadata (#1733, #1740, under D115): typing `error` (`code`,
 *   `message`, `suggestion`, `retryable`) in `commandResultOutputSchema` adds 364 bytes to the
 *   tool-surface bundle (77,810 → 78,174; raised 78,100 → 78,500). `ERROR_CODE_CATALOG` lives in
 *   its own `error-catalog.ts` module and `middleware.ts` imports `failure` statically, so host
 *   and every-export `/direct` bundles tree-shake it out cleanly (every-export stays under 119,500).
 *   MCP Tasks (#1971, under D115): `task` metadata/validation in `@lushly-dev/afd-core` and the
 *   zero-runtime-import `task-dispatch.ts` seam in `tool-router.ts` and `lazy-tools.ts` bring the
 *   tool-surface bundle on `main` at `3aaa06e0` to 78,834 bytes (raised 78,500 → 79,200); the host,
 *   approval, and every-export bundles stay within their ceilings.
 *   Journal uncopyable-result fallback (#865, under D115): `copyResult` and the
 *   `JOURNAL_RESULT_UNSERIALIZABLE` entry in `journal.ts` bring the tool-surface bundle on `main`
 *   at `b77e8674` to 79,467 bytes (raised 79,200 → 79,700); the host, approval, and every-export
 *   bundles stay within their ceilings.
 *   AFD validation issue code mapping (#1734, under D115): `VALIDATION_ISSUE_CODES` and
 *   `mapZodIssueCode` in `validation.ts` add the 9-code normative catalog to `formatZodIssue`,
 *   bringing the host, approval, and tool-surface bundles on `main` at `e28d5629` to 43,852 /
 *   57,532 / 79,726 bytes (raised 43,700 → 44,000, 57,400 → 57,700, 79,700 → 79,900); every-export
 *   stays within 119,500.
 *   TypeScript output budgets (#1989, under D115, owner-approved 2026-11-22): `output-budget.ts` in
 *   `@lushly-dev/afd-core` and `packages/server/src/output-budget.ts`, wired into `define-core.ts`,
 *   `execution.ts`, `direct-registry.ts`, `direct-tool-surface.ts` (including `assertToolMeta` so
 *   forged `dev.afd/outputBudget` `toolMeta` is refused on the direct tool surface), `journal*.ts`
 *   and `meta-argument.ts` with zero Node built-ins, MCP SDK or `ErrorCodes` imports, bring the
 *   host, approval, tool-surface and every-export bundles on `main` at `11331eca6` (esbuild 0.28.2)
 *   from 43,852 / 57,532 / 79,726 / 104,974 bytes to 48,004 / 61,680 / 85,910 / 111,387 bytes
 *   (raised 44,000 → 48,400, 57,700 → 62,100, 79,900 → 86,300; every-export stays within 119,500).
 *   The server's `instances` check (under D115): `createApprovalMiddleware` marks each middleware
 *   it makes with what it keeps per process, under a registered symbol so a server from another
 *   installed copy reads it, which brings the approval bundle to 57,719 bytes with esbuild 0.28.2
 *   (57,532 at `e28d5629`); merged with the output budgets above it stays within their 62,100. The
 *   other three stay within their ceilings.
 *   Execution controls enforcement (#2128, under D115): `checkBatchLimits` in `command-execution.ts`
 *   and `DEFAULT_MAX_VALIDATION_ISSUES` truncation in `validation.ts` / `execution.ts` merged on
 *   `main` at `804e17cc3` (`command-timeout.ts` stays outside `/direct`).
 *   DirectRegistryCommand metadata (#2274, under D115): carrying `confirmPrompt`, `requires`,
 *   `tags`, and `examples` in `direct-registry.ts` brings the approval bundle on `main` at
 *   `bc316e8e4` (esbuild 0.28.2) to 64,203 bytes (raised 64,200 → 64,600); host (50,347),
 *   tool-surface (88,450), and every-export (114,344) stay within their ceilings.
 *   Host-verified confirmation mode and private relay evidence (#2263, under D115):
 *   `confirmationMode` metadata/validation in `commands.ts`, `command-metadata.ts`, `define-core.ts`,
 *   `tools.ts`, `lazy-tools.ts`, `tool-router.ts`, off-object WeakMap `relay-evidence.ts` carrier &
 *   one-shot host-verified dispatch admission in `execution.ts`, and relay-evidence verification
 *   (`sha256Base64url`, `checkRelayEvidence`, `spendRelayDecision`) in `approval.ts` /
 *   `approval-crypto.ts` (keeping `human-relay.ts` and `node:crypto` out of `/direct`) bring host,
 *   approval, and tool-surface on `main` at `bd3749120` (esbuild 0.28.2) to 51,910 / 66,576 /
 *   90,788 bytes (raised 50,500 → 52,300, 64,600 → 67,000, 88,500 → 91,200); every-export stays
 *   within 119,500.
 *   Engine recoveries (verified recovery, step 5): every engine refusal decides once whether the
 *   caller can call the command it names and sets the matching `recovery` and suggestion
 *   (`canCall` in `command-routing.ts`, which keeps its own copy of the meta-tool names; its
 *   callers pass in what the caller is shown, so neither `builtin-tools` nor `scope-view` joins
 *   Loam's first paint). Before #2263 it measured 51,214 / 65,193 / 89,457 bytes on
 *   `lush/engine-recoveries` at `00c702e98`. With `main` at `3403a6e02` (#2263) merged, host,
 *   approval, tool-surface and every-export measure 51,258 / 66,609 / 90,598 / 118,150 bytes
 *   (esbuild 0.28.2), within #2263's 52,300 / 67,000 / 91,200 / 119,500.
 *   Journal secret scope: marking the engine's continuations (`markEngineNext`,
 *   `inheritEngineNext`, `liveSecret`) and walking every recording layer's tape bring every-export,
 *   with `main` at `bede7d3fd` merged, to 119,592 bytes (raised 119,500 → 120,000).
 * - 48.0 KB for a host that also imports `createApprovalMiddleware`.
 * - 68.6 KB for a host that also imports `createDirectToolSurface`: the router, the tool
 *   list, the meta-tools, `lazy-tools` and `bootstrap/`.
 * - 103.7 KB for every export. The budget was 66 KB (63.4 KB measured) before the tool
 *   surface and approvals joined the entry; it was 113 KB, and app-to-app calls raised it to 114 KB
 *   (Loam phase 5 step 0b, D115): 111,851 measured on `main`, 113,133 with `createAppCallRegistry`;
 *   113,432 with `main` at `5e219704` merged in; 115,729 with #1704.
 */
const DIRECT_BUDGETS = [
	{
		what: 'a host that imports the registry, the journal and defineCommand',
		imports: HOST_IMPORTS,
		bytes: 52_300,
	},
	{
		what: 'the same host with the approval middleware',
		imports: `${HOST_IMPORTS}, createApprovalMiddleware`,
		bytes: 67_800,
	},
	{
		what: 'a host with the tool surface',
		imports: `${HOST_IMPORTS}, createDirectToolSurface`,
		bytes: 91_800,
	},
	{ what: 'every export', imports: undefined, bytes: 120_000 },
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
		expect(direct.JOURNAL_RESULT_UNSERIALIZABLE).toBe(root.JOURNAL_RESULT_UNSERIALIZABLE);
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
		// MCP authorization (spec/authorization.md) is the HTTP layer's: none of it, nor jose.
		expect(inputs.filter((input) => MCP_AUTH_LAYER.test(input))).toEqual([]);
		// Server-only deadlines (#543) must not grow in-process hosts that do not use them.
		expect(inputs.filter((input) => input.endsWith('src/command-timeout.ts'))).toEqual([]);
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
		// App-to-app calls (spec/command-metadata.md) cost a host only when it imports their registry.
		expect(host.filter((path) => /src\/app-call(s|-registry)\.(ts|js)$/.test(path))).toEqual([]);

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

/** What a host on the lean path imports from AFD. */
const LEAN_IMPORTS = 'createDirectRegistry, createJournalMiddleware, defineCommandWithSchema';

/** Zod's root and classic API, its locales, and the two modules of `toJSONSchema`. */
const NOT_LEAN =
	/zod\/(index\.js|v4\/index\.js|v4\/classic\/|v4\/locales\/|v4\/core\/(to-json-schema|json-schema-processors)\.js)/;

describe('the lean schema path', () => {
	const bundleImports = (specifier: string, imports: string) =>
		bundleForBrowser(specifier, {
			minify: true,
			stdin: {
				contents: `export { ${imports} } from '${specifier}';`,
				resolveDir: packageRoot,
				sourcefile: 'browser-entry.js',
			},
		});

	it.each([
		['/direct', LEAN_IMPORTS],
		['/define', 'defineCommandWithSchema, failure, success'],
	])(
		'P2-E2: %s leaves classic Zod and toJSONSchema out of its output',
		async (subpath, imports) => {
			const result = await bundleImports(`${PACKAGE_NAME}${subpath}`, imports);

			expect(result.errors.map((message) => message.text)).toEqual([]);
			const output = modulesInOutput(result);
			expect(output.some((path) => path.endsWith('src/define-core.ts'))).toBe(true);
			expect(output.some((path) => /zod\/v4\/core\/parse\.js$/.test(path))).toBe(true);
			expect(output.filter((path) => NOT_LEAN.test(path))).toEqual([]);

			// And no AFD module that made it into the output imports them, even for a value that tree-shook.
			const importedByAfd = output
				.filter((path) => /src\/[^/]+\.ts$/.test(path))
				.flatMap((path) => result.metafile?.inputs[path]?.imports ?? [])
				.map((imported) => imported.path);
			expect(importedByAfd.filter((path) => NOT_LEAN.test(path))).toEqual([]);
		}
	);

	it('defineCommand, by contrast, brings toJSONSchema and still no classic Zod', async () => {
		const result = await bundleImports(`${PACKAGE_NAME}/direct`, `${LEAN_IMPORTS}, defineCommand`);

		const output = modulesInOutput(result);
		expect(output.some((path) => /json-schema-processors\.js$/.test(path))).toBe(true);
		expect(output.filter((path) => /zod\/(index\.js|v4\/classic\/)/.test(path))).toEqual([]);
	});

	it('runs a Zod Mini host with no locale, and its errors stay actionable', async () => {
		const result = await bundleForBrowser(`${PACKAGE_NAME}/direct`, {
			stdin: {
				contents: `
					import * as z from 'zod/mini';
					import {
						createDirectRegistry,
						createJournalMiddleware,
						defineCommandWithSchema,
						MemoryJournalSink,
						success,
					} from '${PACKAGE_NAME}/direct';

					const panelOpen = defineCommandWithSchema({
						name: 'panel-open',
						description: 'Open a panel',
						input: z.object({ id: z.string() }),
						jsonSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
						async handler(input) {
							return success({ id: input.id });
						},
					});
					const registry = createDirectRegistry([panelOpen], {
						middleware: [createJournalMiddleware(new MemoryJournalSink())],
					});
					console.log(JSON.stringify({
						opened: await registry.execute('panel-open', { id: 'settings' }),
						refused: await registry.execute('panel-open', { id: 7 }),
						tools: registry.listCommands(),
					}));
				`,
				resolveDir: packageRoot,
				sourcefile: 'browser-entry.js',
			},
		});
		expect(result.errors.map((message) => message.text)).toEqual([]);
		expect(modulesInOutput(result).filter((path) => NOT_LEAN.test(path))).toEqual([]);

		const code = new TextDecoder().decode(result.outputFiles?.[0]?.contents);
		const printed = JSON.parse(
			execFileSync(process.execPath, ['--input-type=module'], { input: code, encoding: 'utf8' })
		);

		expect(printed.opened.data).toEqual({ id: 'settings' });
		expect(printed.refused.error.code).toBe('VALIDATION_ERROR');
		expect(printed.refused.error.suggestion).toContain(
			'id: Invalid input: expected string, received number'
		);
		expect(printed.tools[0].inputSchema.required).toEqual(['id']);
	});
});
