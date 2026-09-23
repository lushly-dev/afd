import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: false,
		environment: 'node',
		include: ['src/**/*.test.ts'],
		passWithNoTests: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/index.ts'],
			// Measured 2026-09-23: 90.02% statements, 82.63% branches, 92.7% functions,
			// 91.03% lines. Thresholds sit just below; raise them as coverage improves.
			thresholds: {
				statements: 89,
				branches: 82,
				functions: 92,
				lines: 90,
			},
		},
	},
});
