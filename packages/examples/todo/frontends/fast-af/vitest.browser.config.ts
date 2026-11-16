import { defineConfig } from 'vitest/config';

/** Chromium suites against the built page and a real TypeScript backend; run `pnpm build` first. */
export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
