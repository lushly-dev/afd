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
			// Branches and functions recalibrated from 70 and 75 for vitest 4's coverage
			// remapping; restore with #602.
			thresholds: {
				statements: 65,
				branches: 65,
				functions: 61,
				lines: 65,
			},
		},
	},
});
