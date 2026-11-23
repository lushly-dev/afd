import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/specimen.test.ts'],
		environment: 'node',
		testTimeout: 120_000,
		hookTimeout: 120_000,
		fileParallelism: false,
	},
});
