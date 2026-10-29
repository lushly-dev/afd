import { configDefaults, defineConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * Store-free suites for the repository-wide `pnpm test`. The SQLite (native better-sqlite3
 * binding) and Postgres/Neon contract suites need a database driver and run with `test:db`
 * (the upstream configuration) in violet.yml.
 */
export const databaseSuites = [
	'src/db/commands.contract.test.ts',
	'src/db/lens-follow-ups.contract.test.ts',
	'src/db/lens-follow-ups-upgrade.test.ts',
	'src/db/neon.test.ts',
];

export default defineConfig({
	test: {
		...base.test,
		exclude: [...configDefaults.exclude, ...databaseSuites],
	},
});
