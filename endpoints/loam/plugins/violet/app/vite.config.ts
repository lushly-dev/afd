import { defineConfig } from 'vite';

// One self-contained ES module, with UI elements behind a relative dynamic import.
export default defineConfig({
	build: {
		target: 'es2022',
		minify: true,
		lib: { entry: 'src/native.ts', formats: ['es'], fileName: () => 'native.js' },
	},
});
