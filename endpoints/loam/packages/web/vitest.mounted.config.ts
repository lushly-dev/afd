import { defineConfig } from 'vitest/config';

/**
 * E3, E4 and E9's mounted part: Chromium against the built shell, through a test-only relay, to a stock
 * `umbel` (phase 1 specification, 7.1 and section 14), and phase 2's E6, the scope on the wire to it and to a
 * fixture AFD server (phase 2 specification, 9.2). Run by `test:mounted`, which builds the binaries.
 */
export default defineConfig({
	test: {
		// Each test's title in the log, which the exit check reads (phase 2 specification, E14). Naming a
		// reporter drops the annotations Vitest adds by default on GitHub, so they are named too.
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/mounted/**/*.test.ts'],
		environment: 'node',
		testTimeout: 60_000,
		hookTimeout: 120_000,
		fileParallelism: false,
	},
});
