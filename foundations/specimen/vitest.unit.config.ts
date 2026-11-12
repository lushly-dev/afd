import { configDefaults, defineConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * Browser-free suites for the repository-wide `pnpm test`. `test:browser` runs the full
 * native suite, including these Chromium and process-worker suites, in specimen.yml.
 */
export const browserSuites = [
	'src/baseline.test.ts',
	'src/coverage.test.ts',
	'src/contract.test.ts',
	'src/suggest.test.ts',
	'src/events.test.ts',
	'src/static-build.test.ts',
	'src/profile-bench.test.ts',
	'src/a11y.test.ts',
	'src/bench-worker.test.ts',
	'src/compat.test.ts',
	'src/compat-run.test.ts',
	'src/plugins.test.ts',
	'src/migrate.test.ts',
	'src/drivers.test.ts',
	'src/feasibility.test.ts',
	'src/lifecycle.test.ts',
	'src/pack-run.test.ts',
];

export default defineConfig({
	test: {
		...base.test,
		exclude: [...configDefaults.exclude, ...browserSuites],
		coverage: {
			...base.test?.coverage,
			// Browser-free suites exercise only these modules; browser modules are measured by test:browser.
			include: [
				'src/diff.ts',
				'src/evidence.ts',
				'src/guide-coverage.ts',
				'src/normalize.ts',
				'src/normalize-ids.ts',
				'src/pack.ts',
				'src/pack-files.ts',
				'src/pack-schema.ts',
				'src/validate.ts',
			],
			exclude: [],
		},
	},
});
