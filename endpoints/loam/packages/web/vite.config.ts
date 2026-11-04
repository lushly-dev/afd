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
