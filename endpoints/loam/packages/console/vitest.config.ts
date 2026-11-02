import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			include: ['src/commands.ts', 'src/form.ts', 'src/result.ts'],
			exclude: ['src/**/*.test.ts'],
		},
	},
});
