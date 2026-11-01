import { defineConfig } from 'vitest/config';

// The plugin through Specimen's bench: the native host, Chromium and the fixture project.
export default defineConfig({
	test: {
		globals: false,
		include: ['src/**/*.browser.test.ts'],
		testTimeout: 60000,
		hookTimeout: 60000,
		maxWorkers: 1,
	},
});
