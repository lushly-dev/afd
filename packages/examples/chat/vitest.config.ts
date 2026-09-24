import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		// Only the sources: compiled copies in dist/ would run every test twice.
		include: ['src/**/*.test.ts'],
	},
});
