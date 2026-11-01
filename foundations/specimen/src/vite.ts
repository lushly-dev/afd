import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, type Plugin, type ViteDevServer } from 'vite';
import { bundled, defaultContext, type LoadedConfig } from './config.js';

const ENTRY = '/__specimen_entry__.js';
const SHELL_BUDGET = 50_000;
/** The proposal's category ceilings, in minified UTF-8 JavaScript bytes. */
const TOTAL_BUDGET = 1_300_000;
const CATEGORY_BUDGETS = {
	shell: SHELL_BUDGET,
	interaction: 600_000,
	accessibility: 650_000,
	// The lazy capture normalizer has no category of its own; it counts toward the total.
	capture: TOTAL_BUDGET,
} as const;
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
function entrySource(config: LoadedConfig, runtime: string): string {
	const { entries, modules } = bundled(config);
	const loaders = Object.entries(modules)
		.map(([id, file]) => `${JSON.stringify(id)}: () => import(${JSON.stringify(file)})`)
		.join(',');
	return `import { installRuntime, installPage } from ${JSON.stringify(runtime)};
const entries = ${JSON.stringify(entries)};
installRuntime({${loaders}});
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
		resolveId(id) {
			if (id === ENTRY) return '\0specimen-entry';
		},
		load(id) {
			if (id === '\0specimen-entry') return entrySource(config, runtime);
		},
	};
	return {
		root,
		runtime,
		plugin,
		build: (outDir) => buildStatic(root, runtime, plugin, outDir),
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
	outDir: string
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
			},
		},
	});
	if (Array.isArray(result) || !('output' in result))
		throw new Error('Unexpected Vite build result');
	const chunks = result.output.filter((output) => output.type === 'chunk');
	// The proposal's categories: the shell lists and mounts a plain fixture; retained stories'
	// runtime is interaction support and axe is the accessibility engine, each loaded only by
	// the cases that need them and each counted against its own budget, never left out.
	const runtimeDirectory = dirname(runtime);
	const lazyRuntime = ['story-runtime', 'csf'].map((name) => join(runtimeDirectory, name));
	const packageSource = dirname(runtimeDirectory);
	const categoryOf = (
		chunk: (typeof chunks)[number]
	): 'shell' | 'interaction' | 'accessibility' | 'capture' | 'consumer' => {
		const ids = Object.keys(chunk.modules);
		if (ids.some((id) => id.includes('/axe-core/'))) return 'accessibility';
		const owned = ids.filter((id) => id.startsWith(runtimeDirectory));
		if (owned.length && owned.every((id) => lazyRuntime.some((path) => id.startsWith(path))))
			return 'interaction';
		if (chunk.isEntry || owned.length || ids.includes('\0specimen-entry')) return 'shell';
		// Bench code outside the page runtime, loaded lazily: the capture normalizer.
		return ids.some((id) => id.startsWith(packageSource)) ? 'capture' : 'consumer';
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
		capture: bytesOf('capture'),
	};
	const files = result.output.map((output) => output.fileName);
	const report = { directory, shellBytes, budget: SHELL_BUDGET, files };
	await writeFile(
		join(directory, 'specimen-build.json'),
		JSON.stringify(
			{
				...report,
				categories: Object.fromEntries(
					Object.entries(categoryBytes).map(([category, bytes]) => [
						category,
						{ bytes, budget: CATEGORY_BUDGETS[category as keyof typeof CATEGORY_BUDGETS] },
					])
				),
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
	const total = Object.values(categoryBytes).reduce((sum, bytes) => sum + bytes, 0);
	if (total > TOTAL_BUDGET)
		throw new Error(`Bench JavaScript exceeds budget: ${total} > ${TOTAL_BUDGET} bytes`);
	return report;
}
