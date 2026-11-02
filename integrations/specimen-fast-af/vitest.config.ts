import { configDefaults, defineConfig } from 'vitest/config';

// Browser-free tests for `pnpm check`; `test:browser` runs the bench-backed suite.
export default defineConfig({
	test: {
		globals: false,
		include: ['src/**/*.test.ts'],
		exclude: [...configDefaults.exclude, 'src/**/*.browser.test.ts'],
		testTimeout: 30000,
	},
});
