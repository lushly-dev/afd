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
	'src/themes-bench.test.ts',
	'src/pack-run.test.ts',
	'src/pick.test.ts',
	'src/point.test.ts',
	'src/note.test.ts',
	'src/portable-gates.test.ts',
	'src/targets.test.ts',
	'src/network.test.ts',
	'src/sets-bench.test.ts',
	'src/compare-bench.test.ts',
	'src/jobs-bench.test.ts',
];

export default defineConfig({
	test: {
		...base.test,
		exclude: [...configDefaults.exclude, ...browserSuites],
		coverage: {
			...base.test?.coverage,
			// Browser-free suites exercise only these modules; browser modules are measured by test:browser.
			include: [
				'src/browser/clock.ts',
				'src/browser/clock-parse.ts',
				'src/browser/instrumentation.ts',
				'src/climb.ts',
				'src/compare.ts',
				'src/compare-page.ts',
				'src/decision-validate.ts',
				'src/decisions.ts',
				'src/decisions-store.ts',
				'src/diff.ts',
				'src/evidence.ts',
				'src/guide-coverage.ts',
				'src/guide-source.ts',
				'src/job-coverage.ts',
				'src/job-source.ts',
				'src/jobs.ts',
				'src/note.ts',
				'src/note-validate.ts',
				'src/normalize.ts',
				'src/normalize-ids.ts',
				'src/pack.ts',
				'src/pack-files.ts',
				'src/pack-schema.ts',
				'src/pattern-schema.ts',
				'src/patterns.ts',
				'src/png.ts',
				'src/point.ts',
				'src/pointer.ts',
				'src/sets.ts',
				'src/themes.ts',
				'src/validate.ts',
			],
			exclude: [],
		},
	},
});
