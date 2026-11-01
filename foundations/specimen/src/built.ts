import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, isAbsolute, join } from 'node:path';
import { build } from 'vite';
import type { LoadedConfig } from './config.js';
import { type BenchSite, prepareBenchSite } from './vite.js';

/**
 * Automation renders load a prebuilt bundle instead of Vite's dev module graph. The bench page
 * and every case chunk are built once, in memory, and served from 127.0.0.1. Each render gets
 * its own path prefix, so the server records exactly which files that render loaded and their
 * digests, without reading response bodies back from the browser. Before each render the
 * bundle's source files are checked, and a change rebuilds it.
 */
interface ServedFile {
	body: Buffer;
	type: string;
	digest: string;
}
interface Generation {
	files: Map<string, ServedFile>;
	watched: { file: string; mtimeMs: number; size: number }[];
	number: number;
}
export interface BuiltRender {
	/** Base URL ending in `/`; the page is `specimen.html` under it. */
	url: string;
	/** `file:digest` for every file this render requested, sorted. */
	loaded(): string[];
	end(): void;
}
export interface BuiltBench {
	render(): Promise<BuiltRender>;
	build: BenchSite['build'];
	close(): Promise<void>;
}

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
};
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function bundle(site: BenchSite, number: number): Promise<Generation> {
	const result = await build({
		configFile: false,
		root: site.root,
		plugins: [site.plugin],
		logLevel: 'silent',
		mode: 'development',
		base: './',
		build: {
			write: false,
			minify: false,
			sourcemap: false,
			reportCompressedSize: false,
			rolldownOptions: { input: { specimen: join(site.root, 'specimen.html') } },
		},
	});
	const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) =>
		'output' in entry ? entry.output : []
	);
	const files = new Map<string, ServedFile>();
	const sources = new Set<string>();
	for (const output of outputs) {
		const body = Buffer.from(output.type === 'chunk' ? output.code : output.source);
		files.set(output.fileName, {
			body,
			type: TYPES[extname(output.fileName)] ?? 'application/octet-stream',
			digest: digest(body),
		});
		if (output.type === 'chunk')
			for (const id of output.moduleIds) {
				const file = id.split(/[?#]/, 1)[0] ?? '';
				if (isAbsolute(file) && !file.startsWith(site.root)) sources.add(file);
			}
	}
	const watched = [];
	for (const file of sources) {
		const info = await stat(file).catch(() => null);
		if (info) watched.push({ file, mtimeMs: info.mtimeMs, size: info.size });
	}
	return { files, watched, number };
}

async function changed(generation: Generation): Promise<boolean> {
	for (const entry of generation.watched) {
		const info = await stat(entry.file).catch(() => null);
		if (!info || info.mtimeMs !== entry.mtimeMs || info.size !== entry.size) return true;
	}
	return false;
}

export async function startBuiltBench(config: LoadedConfig): Promise<BuiltBench> {
	const site = await prepareBenchSite(config);
	let generation: Generation | undefined;
	let builds = 0;
	// One check at a time: concurrent renders share a rebuild instead of racing to start two.
	let queue: Promise<unknown> = Promise.resolve();
	const fresh = (): Promise<Generation> => {
		const next = queue.then(async () => {
			if (!generation || (await changed(generation))) generation = await bundle(site, ++builds);
			return generation;
		});
		queue = next.catch(() => undefined);
		return next;
	};
	const renders = new Map<string, { generation: Generation; loaded: Set<string> }>();
	const server: Server = createServer((request, response) => {
		const [, token, file] = /^\/r\/([0-9a-f-]{36})\/([^?#]*)/.exec(request.url ?? '') ?? [];
		const render = token ? renders.get(token) : undefined;
		const served = render && file !== undefined ? render.generation.files.get(file) : undefined;
		if (!render || !served || file === undefined) {
			response.writeHead(404).end();
			return;
		}
		render.loaded.add(`${file}:${served.digest}`);
		response.writeHead(200, { 'content-type': served.type, 'cache-control': 'no-store' });
		response.end(served.body);
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolveListen);
	});
	const address = server.address();
	if (!address || typeof address === 'string') {
		server.close();
		await site.dispose();
		throw new Error('Built bench server did not bind a TCP port');
	}
	const origin = `http://127.0.0.1:${address.port}`;
	return {
		async render() {
			const current = await fresh();
			const token = randomUUID();
			const loaded = new Set<string>();
			renders.set(token, { generation: current, loaded });
			return {
				url: `${origin}/r/${token}/`,
				loaded: () => [...loaded].sort(),
				end: () => {
					renders.delete(token);
				},
			};
		},
		build: site.build,
		async close() {
			await new Promise<void>((resolveClose) => {
				server.closeAllConnections();
				server.close(() => resolveClose());
			});
			await site.dispose();
		},
	};
}
