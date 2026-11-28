import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// Cap worker processes so `pnpm verify` running Rust, C++ and browser suites alongside the
		// kernel's test files does not exhaust memory/threads and SIGABRT a worker (#1560).
		maxWorkers: 4,
		// A loaded lane host (Windows, with other suites building) runs past Vitest's 5 s default (#2866).
		testTimeout: 30_000,
		hookTimeout: 30_000,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types.ts'],
			thresholds: {
				statements: 80,
				branches: 75,
				functions: 80,
				lines: 80,
			},
		},
	},
});
