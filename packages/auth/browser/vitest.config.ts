import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: false,
		include: ['browser/**/*.test.ts'],
		testTimeout: 30_000,
		hookTimeout: 30_000,
		fileParallelism: false,
	},
});
