import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/** local-db's adapter contract in Chromium's real IndexedDB (E10). Run by `test:browser`. */
export default defineConfig({
	test: {
		include: ['test/conformance/**/*.test.ts'],
		browser: {
			enabled: true,
			provider: playwright(),
			headless: true,
			instances: [{ browser: 'chromium' }],
		},
	},
});
