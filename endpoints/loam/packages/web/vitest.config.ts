import { defineConfig } from 'vitest/config';

/**
 * Browser-free unit suites; part of the repository-wide `pnpm test` and `pnpm check`. `test/unit/` holds the
 * ones that must not change `src`, as D2's scan of it (Loam's documents specification, step 13).
 */
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
		environment: 'node',
		// A loaded lane host (Windows, with other suites building) runs past Vitest's 5 s default (#2866).
		testTimeout: 30_000,
		hookTimeout: 30_000,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/main.ts'],
		},
	},
});
