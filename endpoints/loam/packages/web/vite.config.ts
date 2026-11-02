import { defineConfig } from 'vite';
import { narrowZodFromJsonSchema, zodJitlessByDefault } from './scripts/narrow-zod.mjs';

export default defineConfig({
	base: './',
	plugins: [zodJitlessByDefault(), narrowZodFromJsonSchema()],
	build: {
		target: 'es2022',
		outDir: 'dist',
		emptyOutDir: true,
		modulePreload: false,
		reportCompressedSize: false,
	},
});
