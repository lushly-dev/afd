import { configDefaults, defineConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * Store-free suites for the repository-wide `pnpm test`. The SQLite (native better-sqlite3
 * binding) and Postgres/Neon contract suites need a database driver and run with `test:db`
 * (the upstream configuration) in violet.yml.
 */
export const databaseSuites = [
	'src/db/audit.contract.test.ts',
	'src/db/audit-sequence.test.ts',
	'src/db/webhooks.contract.test.ts',
];

export default defineConfig({
	test: {
		...base.test,
		exclude: [...configDefaults.exclude, ...databaseSuites],
		coverage: {
			...base.test?.coverage,
			// The native suites target these modules. The resolver, stores and constraint validators
			// are exercised by the integration's suites through the built package, which per-package
			// coverage cannot attribute, and by the store suites in test:db.
			include: [
				'src/tokens.ts',
				'src/export/**/*.ts',
				'src/css/safe-css.ts',
				'src/utils/glob.ts',
				'src/types/error-codes.ts',
			],
			exclude: ['src/**/*.test.ts'],
		},
	},
});
