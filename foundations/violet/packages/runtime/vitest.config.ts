import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: false,
		environment: 'happy-dom',
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/__tests__/**'],
			thresholds: {
				statements: 65,
				branches: 70,
				functions: 75,
				lines: 65,
			},
		},
	},
});
