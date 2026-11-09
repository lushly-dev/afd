import { singleFileHtml } from '@lushly-dev/loam-cli/vite';
import { defineConfig } from 'vite';

// One build per page, since a page must be one file (phase 1 specification, 11.2). The editor's build comes
// first and empties `dist`; `--mode handlers` adds the handlers' page beside it. A view has no native entry.
const EDITOR = { page: 'editor.html', empty: true };
const HANDLERS = { page: 'handlers.html', empty: false };

export default defineConfig(({ mode }) => {
	const { page, empty } = mode === 'handlers' ? HANDLERS : EDITOR;
	return {
		root: 'src/pages',
		plugins: [singleFileHtml()],
		build: {
			target: 'es2022',
			outDir: '../../dist',
			emptyOutDir: empty,
			rollupOptions: { input: `src/pages/${page}` },
		},
	};
});
