/** Bundles a test page's module into one script for WebDriver's `execute`, with Vite as the shell is built. */
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { zodJitlessByDefault } from '../../web/scripts/narrow-zod.mjs';

export async function bundlePage(name: string): Promise<string> {
	const entry = fileURLToPath(new URL(`./pages/${name}.ts`, import.meta.url));
	const result = await build({
		configFile: false,
		root: fileURLToPath(new URL('..', import.meta.url)),
		logLevel: 'silent',
		// Under the shell's CSP, with no `unsafe-eval`.
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
