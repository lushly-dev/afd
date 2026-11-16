import { defineConfig } from 'vitest/config';

/**
 * Phase 6's desktop suite, P6-D1 to P6-D4 (specification, 10.7): Vitest with `webdriverio` as its WebDriver
 * client, driving the app under `tauri-driver`, one app at a time. Run by `test:desktop` after `build:app`.
 */
export default defineConfig({
	test: {
		// Each test's title in the log, which the exit check reads (phase 6 specification, 19).
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/**/*.test.ts'],
		environment: 'node',
		testTimeout: 120_000,
		hookTimeout: 180_000,
		fileParallelism: false,
	},
});
