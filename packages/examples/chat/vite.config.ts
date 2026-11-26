import { defineConfig } from 'vite';

/**
 * The browser demo: `vite build` writes it to dist/demo, which the realtime server serves on
 * port 3001. There is no Vite dev server, because the servers allow only their own origins.
 */
export default defineConfig({
	root: 'demo',
	base: '/',
	resolve: { conditions: ['browser'] },
	build: { target: 'es2022', outDir: '../dist/demo', emptyOutDir: true },
});
