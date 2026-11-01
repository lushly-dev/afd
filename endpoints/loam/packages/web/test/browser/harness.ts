import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIST = resolve(fileURLToPath(new URL('../../dist', import.meta.url)));

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
};

/** Serves the `vite build` output over loopback HTTP, so the page's CSP applies as deployed. */
export async function serveDist(): Promise<{ origin: string; close: () => Promise<void> }> {
	const server: Server = createServer(async (request, response) => {
		const path = new URL(request.url ?? '/', 'http://localhost').pathname;
		const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
		if (file !== DIST && !file.startsWith(DIST + sep)) {
			response.writeHead(403).end();
			return;
		}
		try {
			const body = await readFile(file);
			response.writeHead(200, {
				'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
			});
			response.end(body);
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No loopback address');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () => new Promise((done) => server.close(() => done())),
	};
}
