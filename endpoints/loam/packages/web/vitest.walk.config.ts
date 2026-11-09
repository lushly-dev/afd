import { defineConfig } from 'vitest/config';

/**
 * The editor area's seeded walk against the built `dist/index.html`; run `pnpm build` first. Run by `loam.yml`'s
 * "Editor walk" job, beside the Chromium suite, which leaves it out.
 */
export default defineConfig({
	test: {
		// Each test's title in the log, which the exit check reads (phase 2 specification, E14). Naming a
		// reporter drops the annotations Vitest adds by default on GitHub, so they are named too.
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/browser/documents/walk.test.ts'],
		environment: 'node',
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
