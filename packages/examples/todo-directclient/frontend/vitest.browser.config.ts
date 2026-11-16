import { defineConfig } from 'vitest/config';

/** The built page in Chromium against the real server with a scripted model; run `pnpm build` first. */
export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
