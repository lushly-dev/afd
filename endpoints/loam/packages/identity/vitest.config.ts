import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// Each file starts a Better Auth host in a child process; one worker keeps a shared machine usable.
		fileParallelism: false,
		testTimeout: 30_000,
		hookTimeout: 60_000,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			include: ['src/**/*.ts'],
			// The child's entry runs in another process, which coverage does not see.
			exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/testing/host-child.ts'],
			thresholds: {
				statements: 80,
				branches: 75,
				functions: 80,
				lines: 80,
			},
		},
	},
});
