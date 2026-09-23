import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: false,
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/index.ts'],
			// Measured 2026-09-23: 84.93% statements, 78.18% branches, 90.47% functions,
			// 85.16% lines. Thresholds sit just below; raise them as coverage improves.
			thresholds: {
				statements: 84,
				branches: 78,
				functions: 90,
				lines: 85,
			},
		},
	},
});
