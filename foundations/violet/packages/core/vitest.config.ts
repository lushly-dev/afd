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
			thresholds: {
				statements: 65,
				branches: 70,
				functions: 50,
				lines: 65,
			},
		},
	},
});
