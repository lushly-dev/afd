import { defineConfig } from 'vitest/config';

/**
 * E3, E4 and E9's mounted part: Chromium against the built shell, through a test-only relay, to a stock
 * `umbel` (phase 1 specification, 7.1 and section 14). Run by `test:mounted`, which builds the binaries.
 */
export default defineConfig({
	test: {
		include: ['test/mounted/**/*.test.ts'],
		environment: 'node',
		testTimeout: 60_000,
		hookTimeout: 120_000,
		fileParallelism: false,
	},
});
