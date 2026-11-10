import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		testTimeout: 30000,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			include: ['src/**/*.ts'],
			exclude: [
				'src/**/*.test.ts',
				'src/**/*.d.ts',
				'src/index.ts',
				'src/test-support.ts',
				// These run only in a child process of the built `dist`, so only end to end: the hosted suite
				// (`web`'s `test:hosted`) runs them. Everything else of `startDevHost` is unit-tested in-process.
				'src/testing/child-launcher.ts',
				'src/testing/dev-child.ts',
			],
			thresholds: {
				statements: 80,
				branches: 75,
				functions: 80,
				lines: 80,
			},
		},
	},
});
