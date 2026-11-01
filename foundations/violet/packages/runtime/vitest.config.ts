import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: false,
		environment: 'happy-dom',
		include: ['src/**/*.test.ts'],
		// Node 25+ defines a global localStorage that is undefined without --localstorage-file,
		// and it shadows happy-dom's; turn Node's Web Storage off in the test workers.
		execArgv: ['--no-experimental-webstorage'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/__tests__/**'],
			thresholds: {
				statements: 65,
				branches: 70,
				functions: 75,
				lines: 65,
			},
		},
	},
});
