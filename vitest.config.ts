import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['packages/*/src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			thresholds: {
				statements: 80,
				branches: 75,
				functions: 80,
				lines: 80,
			},
		},
	},
});
