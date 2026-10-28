import { defineConfig } from 'vitest/config';
export default defineConfig({
	test: {
		globals: false,
		include: ['src/**/*.test.ts', 'experiments/resources/**/*.test.mjs'],
		testTimeout: 30000,
		hookTimeout: 30000,
		maxWorkers: 2,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/bin.ts', 'src/types.ts', 'src/browser/**'],
			thresholds: { statements: 80, branches: 75, functions: 80, lines: 80 },
		},
	},
});
