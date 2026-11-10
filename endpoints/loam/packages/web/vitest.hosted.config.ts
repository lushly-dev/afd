import { defineConfig } from 'vitest/config';

/**
 * The hosted criterion (phase 6 specification, section 19's "Hosted" place): Chromium against the built
 * shell served by `loam-host dev` in a child process, through `startDevHost`. Build the web host and
 * `loam-host` first. Run by `loam.yml`'s "Hosted development profile" job; one file at a time, since each
 * starts a server child beside Chromium.
 */
export default defineConfig({
	test: {
		// Each test's title in the log, which the exit check reads. Naming a reporter drops the annotations
		// Vitest adds by default on GitHub, so they are named too.
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/hosted/**/*.test.ts'],
		environment: 'node',
		testTimeout: 60_000,
		hookTimeout: 120_000,
		fileParallelism: false,
	},
});
