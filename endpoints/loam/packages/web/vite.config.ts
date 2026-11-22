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
				// The kernel's `document-*` definitions, its editor commands and its hearing of the adapter, which `late`
				// imports in stage B, are named `late-documents`, `late-editor` and `late-identity` so `budget` counts
				// each once, in its own row (phase 2 specification, 2.4; phase 3 specification, 13). A name only: the
				// bundler parts the chunks as it would.
				chunkFileNames: (chunk) => {
					const late =
						/kernel[\\/]dist[\\/]late[\\/](documents|editor-commands|session-settle|settings|hosted)\.js$/.exec(
							chunk.facadeModuleId ?? ''
						)?.[1];
					// The copilot's panel, which the shell loads when its panel part first opens (phase 5 specification, 16).
					if (/chrome[\\/]dist[\\/]copilot[\\/]index\.js$/.test(chunk.facadeModuleId ?? ''))
						return 'assets/copilot-panel-[hash].js';
					// The copilot's records and commands, which `late` loads in stage B (phase 5 specification, 2).
					if (/kernel[/]dist[/]copilot[/]commands\.js$/.test(chunk.facadeModuleId ?? ''))
						return 'assets/late-copilot-[hash].js';
					// Phase 4's settings commands and their rules (phase 4 specification, 1): `late-settings`.
					if (late === 'settings') return 'assets/late-settings-[hash].js';
					// Phase 6's routing and copy of the trust records (its 6.1, 6.3): loaded in a hosted `provider` shell only.
					if (late === 'hosted') return 'assets/late-hosted-[hash].js';
					// The manifest's settings checks, which `late-settings` and `apps` share, named apart from the chrome's
					// `settings` chunk, the settings section (phase 4 specification, 3.5), so `budget` reads each by name.
					if (
						!chunk.facadeModuleId &&
						chunk.moduleIds.some((id) => /manifest[\\/]dist[\\/]settings\.js$/.test(id))
					)
						return 'assets/setting-checks-[hash].js';
					return late === 'documents'
						? 'assets/late-documents-[hash].js'
						: late === 'session-settle'
							? 'assets/late-identity-[hash].js'
							: late
								? 'assets/late-editor-[hash].js'
								: 'assets/[name]-[hash].js';
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
							test: /(preload-helper|chrome[\\/]dist[\\/]elements[\\/](events|entry-styles|app-entry|notice-loader)\.js|packages[\\/]auth[\\/]dist[\\/](errors|listeners|session-state|types)\.js|fast-element[\\/]dist[\\/]esm[\\/]templating[\\/]ref\.js)/,
						},
					],
				},
			},
		},
	},
});
