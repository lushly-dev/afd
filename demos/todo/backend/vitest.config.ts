import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
	resolve: {
		alias: {
			'@afd/server': resolve(__dirname, '../../../../server/src/index.ts'),
			'@afd/core': resolve(__dirname, '../../../../core/src/index.ts'),
		},
	},
	test: {
		globals: true,
		environment: 'node',
		passWithNoTests: true,
		env: {
			TODO_STORE_TYPE: 'memory',
		},
	},
});
