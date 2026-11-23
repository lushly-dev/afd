import { defineConfig } from 'vitest/config';

// The AFD runner plugin through Specimen's bench: native host, Chromium, and consuming scenarios.
export default defineConfig({
	test: {
		globals: false,
		include: ['src/**/*.browser.test.ts'],
		testTimeout: 60000,
		hookTimeout: 60000,
		maxWorkers: 1,
	},
});
