/** Bundles a test page's module into one script for `page.evaluate`, with Vite as the shell is built. */
import { rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { zodJitlessByDefault } from '../../scripts/narrow-zod.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export async function bundlePage(name: string): Promise<string> {
	const entry = fileURLToPath(new URL(`./pages/${name}.ts`, import.meta.url));
	const result = await build({
		configFile: false,
		root: ROOT,
		logLevel: 'silent',
		// A page that brings Zod runs under a CSP with no `unsafe-eval`, as the shell does.
		plugins: [zodJitlessByDefault()],
		build: {
			write: false,
			minify: false,
			target: 'es2022',
			lib: { entry, formats: ['iife'], name: 'loamTestPage', fileName: name },
			rolldownOptions: { output: { codeSplitting: false } },
		},
	});
	const outputs = (Array.isArray(result) ? result : [result]) as {
		output: { type: string; code?: string }[];
	}[];
	const chunk = outputs.flatMap((entry) => entry.output).find((item) => item.type === 'chunk');
	if (!chunk?.code) throw new Error(`No bundle for ${name}`);
	return chunk.code;
}

/**
 * `vite build` over a scaffold's own `vite.config.ts`, in place, with the Loam units aliased to the
 * workspace's `dist`, since a temporary directory has no dependencies of its own (E10). Its config
 * imports `vite`, so this unit's `node_modules` is linked in while it builds. A view's config names paths
 * from where a person runs it, so its handler page is built with those paths made absolute.
 */
export async function buildScaffold(directory: string, kind: 'native' | 'view' = 'native') {
	const modules = join(directory, 'node_modules');
	await symlink(join(ROOT, 'node_modules'), modules);
	try {
		await build({
			configFile: join(directory, 'vite.config.ts'),
			logLevel: 'silent',
			resolve: {
				alias: [
					{
						find: /^@lushly-dev\/loam-sdk\/view$/,
						replacement: fileURLToPath(new URL('../../../sdk/dist/view.js', import.meta.url)),
					},
					{
						find: /^@lushly-dev\/loam-sdk$/,
						replacement: fileURLToPath(new URL('../../../sdk/dist/index.js', import.meta.url)),
					},
				],
			},
			...(kind === 'native'
				? { root: directory }
				: {
						mode: 'handlers',
						root: join(directory, 'src'),
						build: {
							outDir: join(directory, 'dist'),
							rollupOptions: { input: join(directory, 'src/handlers.html') },
						},
					}),
		});
	} finally {
		await rm(modules);
	}
}
