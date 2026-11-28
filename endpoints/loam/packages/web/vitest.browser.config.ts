import { defineConfig } from 'vitest/config';

/** Chromium suites against the built `dist/index.html`; run `pnpm build` first. Run by `loam.yml` only. */
export default defineConfig({
	test: {
		// Each test's title in the log, which the exit check reads (phase 2 specification, E14). Naming a
		// reporter drops the annotations Vitest adds by default on GitHub, so they are named too.
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/browser/**/*.test.ts'],
		// The seeded walk is its own CI job, `vitest.walk.config.ts`. `engines/` holds what only Firefox and WebKit
		// run (`vitest.engines.config.ts`), whose Chromium case is already in this suite.
		exclude: ['test/browser/documents/walk.test.ts', 'test/browser/engines/**'],
		environment: 'node',
		// The suites `vitest.engines.config.ts` runs in Firefox and WebKit launch Chromium here, whatever the shell exports.
		env: { LOAM_ENGINE: 'chromium' },
		testTimeout: 30_000,
		hookTimeout: 60_000,
		// `expect.poll` waits on the page, not the clock: a loaded lane host renders past its 1 s default (#2866).
		expect: { poll: { timeout: 10_000 } },
		fileParallelism: false,
	},
});
