import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		passWithNoTests: true,
		env: {
			TODO_STORE_TYPE: 'memory',
		},
	},
});
