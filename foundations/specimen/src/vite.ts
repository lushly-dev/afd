import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, type Plugin, type ViteDevServer } from 'vite';
import { bundled, defaultContext, type LoadedConfig } from './config.js';
import type { SpecimenEntry } from './types.js';

const ENTRY = '/__specimen_entry__.js';
/** Every story's identity and loader: sized by the consumer, so never in the entry's chunk. */
const CATALOG = '\0specimen-catalog';
const SHELL_BUDGET = 50_000;
/** The proposal's category ceilings, in minified UTF-8 JavaScript bytes. */
const TOTAL_BUDGET = 1_300_000;
const CATEGORY_BUDGETS = {
	shell: SHELL_BUDGET,
	interaction: 600_000,
	accessibility: 650_000,
} as const;
/**
 * The helpers a play imports, with what they bring: the proposal's interaction support (Vitest
 * helpers, Testing Library, jest-dom), however a story imports them, never consumer code.
 */
const HELPERS = /\/node_modules\/(?:storybook\/dist\/test\/|@testing-library\/|@vitest\/|chai\/)/;
/** What else a retained preview or story imports from the framework it is leaving. */
const INCUMBENT = /\/node_modules\/(?:storybook|@storybook\/[^/]+)\//;
const html =
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Specimens</title></head><body><main id="specimen-root"></main><script type="module" src="/__specimen_entry__.js"></script></body></html>';
async function runtimePath(): Promise<string> {
	const compiled = fileURLToPath(new URL('./browser/index.js', import.meta.url));
	try {
		await readFile(compiled);
		return compiled;
	} catch {
		return fileURLToPath(new URL('./browser/index.ts', import.meta.url));
	}
}
function catalogSource(config: LoadedConfig): string {
	const { entries, modules } = bundled(config);
	const loaders = Object.entries(modules)
		.map(([id, file]) => `${JSON.stringify(id)}: () => import(${JSON.stringify(file)})`)
		.join(',');
	return `export const entries = ${JSON.stringify(entries)};
export const loaders = {${loaders}};`;
}
function entrySource(runtime: string): string {
	return `import { installRuntime, installPage } from ${JSON.stringify(runtime)};
const { entries, loaders } = await import(${JSON.stringify('/__specimen_catalog__.js')});
installRuntime(loaders);
await installPage(entries, ${JSON.stringify(defaultContext)});`;
}
export interface BenchServer {
	url: string;
	server: ViteDevServer;
	close(): Promise<void>;
	build(
		outDir: string
	): Promise<{ directory: string; shellBytes: number; budget: number; files: string[] }>;
}
/** The bench page and its virtual entry, shared by the dev server and both builds. */
export interface BenchSite {
	root: string;
	runtime: string;
	plugin: Plugin;
	build(
		outDir: string
	): Promise<{ directory: string; shellBytes: number; budget: number; files: string[] }>;
	dispose(): Promise<void>;
}

export async function prepareBenchSite(config: LoadedConfig): Promise<BenchSite> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'afd-specimen-')));
	const runtime = await runtimePath();
	await writeFile(join(root, 'index.html'), html);
	await writeFile(join(root, 'specimen.html'), html);
	const plugin: Plugin = {
		name: 'afd-specimen',
		// Before Vite's resolver, which would find the real `vitest/browser` first.
		enforce: 'pre',
		resolveId(id) {
			if (id === ENTRY) return '\0specimen-entry';
			if (id === '/__specimen_catalog__.js') return CATALOG;
			// A retained play's real keyboard; see `browser/vitest-browser.ts`.
			if (id === 'vitest/browser')
				return join(dirname(runtime), `vitest-browser${extname(runtime)}`);
		},
		load(id) {
			if (id === '\0specimen-entry') return entrySource(runtime);
			if (id === CATALOG) return catalogSource(config);
		},
	};
	return {
		root,
		runtime,
		plugin,
		build: (outDir) =>
			buildStatic(root, runtime, plugin, outDir, config.staticDirs, bundled(config).entries),
		dispose: () => rm(root, { recursive: true, force: true }),
	};
}

export async function startBenchServer(
	config: LoadedConfig,
	options: { automation?: boolean } = {}
): Promise<BenchServer> {
	const site = await prepareBenchSite(config);
	const { root, runtime, plugin } = site;
	const cachedDevMaps: Plugin = {
		name: 'afd-specimen-cached-dev-maps',
		apply: 'serve',
		enforce: 'post',
		async transform(code, id) {
			const file = id.split(/[?#]/, 1)[0];
			if (!file || !isAbsolute(file) || !/\.[cm]?js$/.test(file)) return null;
			// Vite can remove external map comments during load. Compare the original
			// file too, leaving existing maps and earlier code transforms untouched.
			if (/sourceMappingURL\s*=/.test(code)) return null;
			const original = await readFile(file, 'utf8').catch(() => null);
			if (original !== code) return null;
			const map = this.getCombinedSourcemap();
			if (map.sources.length !== 1 || map.sources[0] !== file || map.sourcesContent?.[0] !== code)
				return null;
			// Vite discards a transform's map when its code equals the loaded code.
			// One trailing newline preserves JS behavior (including terminal comments)
			// while making Vite retain this fallback map in its normal transform cache.
			return { code: `${code}\n`, map };
		},
	};
	const server = await createServer({
		configFile: false,
		root,
		plugins: [plugin, cachedDevMaps],
		// The HTML references a virtual entry; scan its actual import roots before
		// dynamic specimen loading can discover dependencies and reload the page.
		optimizeDeps: { entries: [runtime, ...new Set(Object.values(bundled(config).modules))] },
		logLevel: 'silent',
		server: {
			host: '127.0.0.1',
			port: 0,
			// Captures must retain their document even if dependency discovery or a
			// source edit requests a reload. Interactive benches retain live updates.
			hmr: options.automation ? false : undefined,
			// The runtime's directory and its parent, which holds the lazily loaded normalizer.
			fs: { allow: [root, config.root, dirname(dirname(runtime))] },
		},
	});
	try {
		await server.listen();
	} catch (error) {
		await server.close();
		await rm(root, { recursive: true, force: true });
		throw error;
	}
	const address = server.httpServer?.address();
	if (!address || typeof address === 'string') {
		await server.close();
		throw new Error('Bench server did not bind a TCP port');
	}
	return {
		url: `http://127.0.0.1:${address.port}`,
		server,
		async close() {
			try {
				await server.close();
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
		build: site.build,
	};
}

async function buildStatic(
	root: string,
	runtime: string,
	plugin: Plugin,
	outDir: string,
	staticDirs: LoadedConfig['staticDirs'],
	entries: SpecimenEntry[]
): Promise<{ directory: string; shellBytes: number; budget: number; files: string[] }> {
	const directory = resolve(outDir);
	await mkdir(directory, { recursive: true });
	if ((await readdir(directory)).length) throw new Error('Build output directory must be empty');
	const result = await build({
		configFile: false,
		root,
		plugins: [plugin],
		logLevel: 'silent',
		mode: 'development',
		build: {
			outDir: directory,
			emptyOutDir: false,
			minify: true,
			manifest: true,
			rolldownOptions: {
				input: { index: join(root, 'index.html'), specimen: join(root, 'specimen.html') },
				// Their own chunks, so each is measured exactly and not as a share of a consumer's.
				output: {
					codeSplitting: {
						groups: [
							{ name: 'interaction-support', test: HELPERS, priority: 2 },
							{ name: 'incumbent', test: INCUMBENT, priority: 1 },
						],
					},
				},
			},
		},
	});
	if (Array.isArray(result) || !('output' in result))
		throw new Error('Unexpected Vite build result');
	for (const { from, to } of staticDirs) await cp(from, join(directory, to), { recursive: true });
	const chunks = result.output.filter((output) => output.type === 'chunk');
	// The proposal's categories: the shell lists and mounts a plain fixture; retained stories'
	// runtime is interaction support and axe is the accessibility engine, each loaded only by
	// the cases that need them and each counted against its own budget, never left out.
	const runtimeDirectory = dirname(runtime);
	const lazyRuntime = ['story-runtime', 'csf', 'vitest-browser'].map((name) =>
		join(runtimeDirectory, name)
	);
	const packageSource = dirname(runtimeDirectory);
	const categoryOf = (
		chunk: (typeof chunks)[number]
	): 'shell' | 'interaction' | 'accessibility' | 'catalog' | 'incumbent' | 'consumer' => {
		const ids = Object.keys(chunk.modules);
		if (ids.includes(CATALOG)) return 'catalog';
		if (ids.some((id) => HELPERS.test(id))) return 'interaction';
		if (ids.some((id) => INCUMBENT.test(id))) return 'incumbent';
		if (ids.some((id) => id.includes('/axe-core/'))) return 'accessibility';
		const owned = ids.filter((id) => id.startsWith(runtimeDirectory));
		if (owned.length && owned.every((id) => lazyRuntime.some((path) => id.startsWith(path))))
			return 'interaction';
		// Any other bench code is the shell's, however it loads, capture code included.
		return chunk.isEntry ||
			ids.includes('\0specimen-entry') ||
			ids.some((id) => id.startsWith(packageSource))
			? 'shell'
			: 'consumer';
	};
	const categories = new Map(chunks.map((chunk) => [chunk.fileName, categoryOf(chunk)]));
	const shell = new Set(
		chunks
			.filter((chunk) => categories.get(chunk.fileName) === 'shell')
			.map((chunk) => chunk.fileName)
	);
	let added = true;
	while (added) {
		added = false;
		for (const chunk of chunks)
			if (shell.has(chunk.fileName))
				for (const imported of chunk.imports)
					if (!shell.has(imported) && categories.get(imported) === 'consumer') {
						shell.add(imported);
						categories.set(imported, 'shell');
						added = true;
					}
	}
	const bytesOf = (category: string) =>
		chunks
			.filter((chunk) => categories.get(chunk.fileName) === category)
			.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0);
	const shellBytes = bytesOf('shell');
	const categoryBytes = {
		shell: shellBytes,
		interaction: bytesOf('interaction'),
		accessibility: bytesOf('accessibility'),
	};
	const total = Object.values(categoryBytes).reduce((sum, bytes) => sum + bytes, 0);
	const files = result.output.map((output) => output.fileName);
	const report = { directory, shellBytes, budget: SHELL_BUDGET, files };
	await writeFile(
		join(directory, 'specimen-build.json'),
		JSON.stringify(
			{
				...report,
				// Each case's identity and link, for what reads the build without running it.
				entries: entries.map((entry) => ({
					...entry,
					url: `specimen.html?id=${encodeURIComponent(entry.id)}`,
				})),
				total: { bytes: total, budget: TOTAL_BUDGET },
				categories: Object.fromEntries(
					Object.entries(categoryBytes).map(([category, bytes]) => [
						category,
						{ bytes, budget: CATEGORY_BUDGETS[category as keyof typeof CATEGORY_BUDGETS] },
					])
				),
				// The proposal reports consumer code separately, with no core-wide ceiling.
				reported: {
					catalog: bytesOf('catalog'),
					incumbent: bytesOf('incumbent'),
					consumer: bytesOf('consumer'),
				},
				chunks: chunks.map((chunk) => ({
					file: chunk.fileName,
					category: categories.get(chunk.fileName),
					bytes: Buffer.byteLength(chunk.code),
				})),
			},
			null,
			2
		)
	);
	if (shellBytes > SHELL_BUDGET)
		throw new Error(`Bench shell exceeds budget: ${shellBytes} > ${SHELL_BUDGET} bytes`);
	for (const [category, bytes] of Object.entries(categoryBytes)) {
		const budget = CATEGORY_BUDGETS[category as keyof typeof CATEGORY_BUDGETS];
		if (bytes > budget)
			throw new Error(`Bench ${category} code exceeds budget: ${bytes} > ${budget} bytes`);
	}
	if (total > TOTAL_BUDGET)
		throw new Error(`Bench JavaScript exceeds budget: ${total} > ${TOTAL_BUDGET} bytes`);
	return report;
}
