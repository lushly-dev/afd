import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: false,
		include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types.ts'],
			// Measured 2026-09-23: 96.96% statements, 90.17% branches, 86.66% functions,
			// 96.72% lines. Thresholds sit just below; raise them as coverage improves.
			thresholds: {
				statements: 96,
				branches: 90,
				functions: 86,
				lines: 96,
			},
		},
	},
});
