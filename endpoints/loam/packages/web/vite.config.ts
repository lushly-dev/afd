import { defineConfig } from 'vite';
import { narrowZodFromJsonSchema, zodJitlessByDefault } from './scripts/narrow-zod.mjs';

export default defineConfig({
	base: './',
	plugins: [zodJitlessByDefault(), narrowZodFromJsonSchema()],
	build: {
		target: 'es2022',
		outDir: 'dist',
		emptyOutDir: true,
		modulePreload: false,
		reportCompressedSize: false,
		rolldownOptions: {
			output: {
				// The kernel's `document-*` definitions and its editor commands, which `late` imports in stage B, are
				// named `late-documents` and `late-editor` so `budget` counts each once, in its own row (phase 2
				// specification, 2.4). A name only: the bundler parts the chunks as it would.
				chunkFileNames: (chunk) => {
					const late = /kernel[\\/]dist[\\/]late[\\/](documents|editor-commands)\.js$/.exec(
						chunk.facadeModuleId ?? ''
					)?.[1];
					return late === 'documents'
						? 'assets/late-documents-[hash].js'
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
							test: /(preload-helper|chrome[\\/]dist[\\/]elements[\\/](events|entry-styles|app-entry|notice-loader)\.js)/,
						},
					],
				},
			},
		},
	},
});
