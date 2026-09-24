import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: false,
		include: ['src/**/*.test.ts'],
		// Rebuilds dist when it is older than src: the e2e tests run dist/bin.js.
		globalSetup: ['./vitest.global-setup.ts'],
		// Output assertions check for escape sequences; keep chalk's colors out of them.
		env: { FORCE_COLOR: '0' },
		passWithNoTests: true, // Allow passing when no tests exist yet
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/bin.ts'],
			thresholds: {
				statements: 80,
				branches: 75,
				functions: 80,
				lines: 80,
			},
		},
	},
});
