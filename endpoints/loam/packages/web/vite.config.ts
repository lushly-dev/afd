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
				// The kernel's `document-*` definitions, its editor commands and its hearing of the adapter, which `late`
				// imports in stage B, are named `late-documents`, `late-editor` and `late-identity` so `budget` counts
				// each once, in its own row (phase 2 specification, 2.4; phase 3 specification, 13). A name only: the
				// bundler parts the chunks as it would.
				chunkFileNames: (chunk) => {
					const late =
						/kernel[\\/]dist[\\/]late[\\/](documents|editor-commands|session-settle)\.js$/.exec(
							chunk.facadeModuleId ?? ''
						)?.[1];
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
