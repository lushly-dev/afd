import { configDefaults, defineConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * Browser-free suites for the repository-wide `pnpm test`. `test:browser` runs the full
 * native suite, including these Chromium and process-worker suites, in specimen.yml.
 */
export const browserSuites = [
	'src/bench-worker.test.ts',
	'src/compat.test.ts',
	'src/compat-run.test.ts',
	'src/plugins.test.ts',
	'src/drivers.test.ts',
	'src/feasibility.test.ts',
	'src/lifecycle.test.ts',
];

export default defineConfig({
	test: {
		...base.test,
		exclude: [...configDefaults.exclude, ...browserSuites],
		coverage: {
			...base.test?.coverage,
			// Browser-free suites exercise only these modules; browser modules are measured by test:browser.
			include: ['src/diff.ts', 'src/normalize.ts', 'src/normalize-ids.ts', 'src/validate.ts'],
			exclude: [],
		},
	},
});
