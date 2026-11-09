import { defineConfig } from 'vitest/config';

/**
 * The editor area's seeded walk against the built `dist/index.html`; run `pnpm build` first. Run by `loam.yml`'s
 * "Editor walk" job, beside the Chromium suite, which leaves it out.
 */
export default defineConfig({
	test: {
		include: ['test/browser/documents/walk.test.ts'],
		environment: 'node',
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
