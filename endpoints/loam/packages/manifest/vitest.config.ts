import { defineConfig } from 'vitest/config';
import { compileValidators } from './scripts/compile.mjs';

const VALIDATORS = /(validate(?:-[a-z]+)?\.generated\.js)$/;
const VIRTUAL = '\0loam-manifest:';

export default defineConfig({
	plugins: [
		{
			// The validators live in dist/; a test compiles the current schemas, so no build is needed.
			name: 'loam-manifest-validators',
			resolveId(id) {
				const file = id.match(VALIDATORS)?.[1];
				return file ? `${VIRTUAL}${file}` : undefined;
			},
			load(id) {
				return id.startsWith(VIRTUAL) ? compileValidators()[id.slice(VIRTUAL.length)] : undefined;
			},
		},
	],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			include: ['src/**/*.ts'],
			exclude: [
				'src/**/*.test.ts',
				'src/**/*.d.ts',
				'src/index.ts',
				'src/types.ts',
				'src/_generated/**',
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
