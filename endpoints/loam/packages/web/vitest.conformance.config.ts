import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/** local-db's adapter contract in Chromium's real IndexedDB (E10). Run by `test:browser`. */
export default defineConfig({
	test: {
		// Each test's title in the log, which the exit check reads (phase 2 specification, E14). Naming a
		// reporter drops the annotations Vitest adds by default on GitHub, so they are named too.
		reporters: process.env.GITHUB_ACTIONS === 'true' ? ['verbose', 'github-actions'] : ['verbose'],
		include: ['test/conformance/**/*.test.ts'],
		browser: {
			enabled: true,
			provider: playwright(),
			headless: true,
			instances: [{ browser: 'chromium' }],
		},
	},
});
