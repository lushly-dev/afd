import { defineConfig } from 'vite';

// The entry is one self-contained ES module, with its elements behind a relative dynamic import (5.1).
export default defineConfig({
	build: {
		target: 'es2022',
		minify: true,
		lib: { entry: 'src/native.ts', formats: ['es'], fileName: () => 'native.js' },
	},
});
