import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { recordModules } from './scripts/module-record.mjs';
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
			cpSync(from, to, {
				recursive: true,
				filter: (path) => !path.endsWith('sizes.json') && !path.endsWith('modules.json'),
			});
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
	plugins: [
		zodJitlessByDefault(),
		narrowZodFromJsonSchema(),
		copilotFrame(),
		// What the shell ships, for the desktop's third-party notices (#2808); beside `dist/`, not in it.
		recordModules(
			fileURLToPath(new URL('./build-record/modules.json', import.meta.url)),
			fileURLToPath(new URL('.', import.meta.url))
		),
	],
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
							// One `$initial` group for every module first paint loads or shares with a lazy chunk (#862):
							// `includeDependenciesRecursively: false` keeps only modules Rolldown tagged `$initial`
							// (the entry's static dependency graph), so first paint is one `index-` chunk holding the
							// entry, Vite's preload helper and every shared first-paint module, instead of 14 chunks
							// split by which lazy chunk shares them.
							name: 'index',
							tags: ['$initial'],
							includeDependenciesRecursively: false,
						},
					],
				},
			},
		},
	},
});
