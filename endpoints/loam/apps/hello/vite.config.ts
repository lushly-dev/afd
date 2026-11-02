import { singleFileHtml } from '@lushly-dev/loam-cli/vite';
import { defineConfig } from 'vite';

// One build per output, since a page must be one file (11.2). The native entry is one self-contained
// ES module, with its elements behind a relative dynamic import (5.1), and comes first, since it empties
// `dist`. `--mode view-main` and `--mode view-handlers` each add a page beside it.
const PAGES: Record<string, string> = {
	'view-main': 'main.html',
	'view-handlers': 'handlers.html',
};

export default defineConfig(({ mode }) => {
	const page = PAGES[mode];
	if (page === undefined) {
		return {
			build: {
				target: 'es2022',
				minify: true,
				lib: { entry: 'src/native.ts', formats: ['es'], fileName: () => 'native.js' },
			},
		};
	}
	return {
		root: 'src/pages',
		plugins: [singleFileHtml()],
		build: {
			target: 'es2022',
			outDir: '../../dist',
			emptyOutDir: false,
			rollupOptions: { input: `src/pages/${page}` },
		},
	};
});
