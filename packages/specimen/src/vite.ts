import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, type Plugin, type ViteDevServer } from 'vite';
import { defaultContext, type LoadedConfig } from './config.js';

const ENTRY = '/__specimen_entry__.js';
const SHELL_BUDGET = 50_000;
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
	const loaders = Object.entries(config.modules)
		.map(([id, file]) => `${JSON.stringify(id)}: () => import(${JSON.stringify(file)})`)
		.join(',');
	return `import { installRuntime, installPage } from ${JSON.stringify(runtime)};
const entries = ${JSON.stringify(config.config.specimens)};
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
export async function startBenchServer(config: LoadedConfig): Promise<BenchServer> {
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
	const server = await createServer({
		configFile: false,
		root,
		plugins: [plugin],
		logLevel: 'silent',
		server: { host: '127.0.0.1', port: 0, fs: { allow: [root, config.root, dirname(runtime)] } },
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
		async build(outDir) {
			const directory = resolve(outDir);
			await mkdir(directory, { recursive: true });
			if ((await readdir(directory)).length)
				throw new Error('Build output directory must be empty');
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
			const shell = new Set(
				chunks
					.filter(
						(chunk) =>
							chunk.isEntry ||
							Object.keys(chunk.modules).some(
								(id) => id === '\0specimen-entry' || id.startsWith(dirname(runtime))
							)
					)
					.map((chunk) => chunk.fileName)
			);
			let added = true;
			while (added) {
				added = false;
				for (const chunk of chunks)
					if (shell.has(chunk.fileName))
						for (const imported of chunk.imports)
							if (!shell.has(imported)) {
								shell.add(imported);
								added = true;
							}
			}
			const shellBytes = chunks
				.filter((chunk) => shell.has(chunk.fileName))
				.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0);
			const files = result.output.map((output) => output.fileName);
			const report = { directory, shellBytes, budget: SHELL_BUDGET, files };
			await writeFile(
				join(directory, 'specimen-build.json'),
				JSON.stringify(
					{
						...report,
						chunks: chunks.map((chunk) => ({
							file: chunk.fileName,
							category: shell.has(chunk.fileName) ? 'shell' : 'consumer',
							bytes: Buffer.byteLength(chunk.code),
						})),
					},
					null,
					2
				)
			);
			if (shellBytes > SHELL_BUDGET)
				throw new Error(`Bench shell exceeds budget: ${shellBytes} > ${SHELL_BUDGET} bytes`);
			return report;
		},
	};
}
