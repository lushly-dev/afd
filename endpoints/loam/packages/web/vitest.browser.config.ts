import { defineConfig } from 'vitest/config';

/** Chromium suites against the built `dist/index.html`; run `pnpm build` first. Run by `loam.yml` only. */
export default defineConfig({
	test: {
		include: ['test/browser/**/*.test.ts'],
		environment: 'node',
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
