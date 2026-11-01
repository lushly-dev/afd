import { defineConfig } from 'vitest/config';

/** Browser-free unit suites; part of the repository-wide `pnpm test` and `pnpm check`. */
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		passWithNoTests: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/main.ts'],
		},
	},
});
