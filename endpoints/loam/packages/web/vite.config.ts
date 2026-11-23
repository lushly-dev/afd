import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { narrowZodFromJsonSchema, zodJitlessByDefault } from './scripts/narrow-zod.mjs';

/**
 * The copilot's runtime frame (phase 5 specification, 3.2): `@lushly-dev/loam-copilot`'s `dist/frame/`, copied to
 * `sandbox/copilot/`, which every host serves on its sandbox origin with the frame's own policy. Not part of the
 * shell's graph: nothing in first paint imports it.
 */
function copilotFrame(): Plugin {
	const from = fileURLToPath(new URL('../copilot/dist/frame/', import.meta.url));
	return {
		name: 'loam-copilot-frame',
		apply: 'build',
		closeBundle() {
			if (!existsSync(from))
				throw new Error(`Build @lushly-dev/loam-copilot first: ${from} is missing`);
			const to = fileURLToPath(new URL('./dist/sandbox/copilot/', import.meta.url));
			rmSync(to, { recursive: true, force: true });
			cpSync(from, to, { recursive: true, filter: (path) => !path.endsWith('sizes.json') });
		},
	};
}

/**
 * Declarative load-staging chunk names by domain entry suffix (#1778). The kernel organizes its
 * modules by domain; staging decisions stay here in the bundler configuration so `budget` counts
 * each lazy domain chunk once, in its own row.
 */
const STAGED_DOMAIN_CHUNKS: ReadonlyArray<readonly [suffix: string, chunkName: string]> = [
	['kernel/dist/documents/documents.js', 'assets/late-documents-[hash].js'],
	['kernel/dist/documents/editor-commands.js', 'assets/late-editor-[hash].js'],
	['kernel/dist/identity/session-settle.js', 'assets/late-identity-[hash].js'],
	['kernel/dist/identity/hosted.js', 'assets/late-hosted-[hash].js'],
	['kernel/dist/settings/settings.js', 'assets/late-settings-[hash].js'],
	['kernel/dist/copilot/commands.js', 'assets/late-copilot-[hash].js'],
	['chrome/dist/copilot/index.js', 'assets/copilot-panel-[hash].js'],
];

export default defineConfig({
	base: './',
	plugins: [zodJitlessByDefault(), narrowZodFromJsonSchema(), copilotFrame()],
	build: {
		target: 'es2022',
		outDir: 'dist',
		emptyOutDir: true,
		modulePreload: false,
		reportCompressedSize: false,
		rolldownOptions: {
			output: {
				chunkFileNames: (chunk) => {
					const facade = (chunk.facadeModuleId ?? '').replaceAll('\\', '/');
					for (const [suffix, name] of STAGED_DOMAIN_CHUNKS) {
						if (facade.endsWith(suffix)) return name;
					}
					// The manifest's settings checks, which `late-settings` and `apps` share, named apart from the chrome's
					// `settings` chunk, the settings section (phase 4 specification, 3.5), so `budget` reads each by name.
					if (
						!chunk.facadeModuleId &&
						chunk.moduleIds.some((id) =>
							id.replaceAll('\\', '/').endsWith('manifest/dist/settings.js')
						)
					)
						return 'assets/setting-checks-[hash].js';
					return 'assets/[name]-[hash].js';
				},
				codeSplitting: {
					groups: [
						{
							// Vite's preload helper stays in first paint's `events` chunk, with the chrome modules that
							// chunk held before phase 2's step 7 (phase 2 specification, 2.4). Once a chunk loaded later
							// imports the helper (`url-sync` for `sections`, `late` for the summary rows), the bundler
							// would otherwise give it a first-paint chunk of its own, and the entry an import line: 93
							// bytes and 149 gzip, measured on step 8's base. The four chrome modules are named by path:
							// one renamed or moved leaves this group, and `budget` fails unless first paint holds exactly
							// one `events-` chunk with the helper and all four, and no `preload-helper-` chunk.
							name: 'events',
							includeDependenciesRecursively: false,
							// Phase 3's step 3: afd-auth's modules that first paint's Mock and the `auth` chunk's adapter share,
							// and FAST's `ref`, which the bundler would otherwise part into first-paint chunks of their own once
							// the `sign-in`, `account-menu` and `auth` chunks exist (13, E10).
							// Phase 6's step 11b (10.8): the direct registry, its engine and the kernel's scope field, which
							// first paint's kernel and the desktop's `inbound` chunk share, and which the bundler would otherwise
							// part into first-paint chunks of their own (`define-core`, `direct-registry`, `field`).
							// Output budgets (#1989 / PR #2215): keep core and server `output-budget.js` in `events` alongside
							// `commands`, `define-core`, `execution`, and `direct-registry` so Rollup emits no extra `output-budget` first-paint chunks.
							test: /(preload-helper|chrome[\\/]dist[\\/]elements[\\/](events|entry-styles|app-entry|notice-loader)\.js|packages[\\/]auth[\\/]dist[\\/](errors|listeners|session-state|types)\.js|fast-element[\\/]dist[\\/]esm[\\/]templating[\\/]ref\.js|packages[\\/]core[\\/]dist[\\/](result|commands|output-budget|clock|actor|pipeline-variables|request-validation|batch|streaming|command-execution|similarity|pipeline|pipeline-executor|direct-allow|direct-approval)\.js|packages[\\/]server[\\/]dist[\\/](issue-message|validation|define-core|command-allow|context-fields|context-scope|approval-admission|command-routing|output-budget|execution|direct-registry)\.js|kernel[\\/]dist[\\/]scope[\\/]field\.js|zod[\\/]v4[\\/]mini[\\/]schemas\.js)/,
						},
					],
				},
			},
		},
	},
});
