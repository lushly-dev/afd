import { defineConfig } from 'vitest/config';
import { reportValidator } from './tooling/report-validator.ts';

/** Browser-free unit suites; part of the repository-wide `pnpm test` and `pnpm check`. */
export default defineConfig({
	plugins: [reportValidator()],
	test: {
		include: ['src/**/*.test.ts', 'tooling/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			include: ['src/report/**/*.ts', 'tooling/**/*.ts'],
			exclude: ['**/*.test.ts', 'src/report/types.ts'],
			thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
		},
	},
});
