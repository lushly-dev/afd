import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.test.ts'],
		setupFiles: ['src/db/neon-local.test-support.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			// Branches recalibrated from 70 for vitest 4's coverage remapping; restore with #602.
			thresholds: {
				statements: 65,
				branches: 66,
				functions: 50,
				lines: 65,
			},
		},
	},
});
