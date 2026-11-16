import { defineConfig } from 'vitest/config';

/** Unit tests of the page's modules, in Node. */
export default defineConfig({
	test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
