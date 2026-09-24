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
			// Measured 2026-09-24: 95.97% statements, 93.6% branches, 95.72% functions,
			// 96.99% lines. Thresholds sit just below; raise them as coverage improves.
			thresholds: {
				statements: 95,
				branches: 93,
				functions: 95,
				lines: 96,
			},
		},
	},
});
