import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, relative, resolve } from 'node:path';

/** Serve a built static bench over HTTP, as a reviewer would, without the bench's Vite server. */
export async function serveStatic(
	directory: string
): Promise<{ url: string; close(): Promise<void> }> {
	const mime: Record<string, string> = {
		'.html': 'text/html',
		'.js': 'text/javascript',
		'.css': 'text/css',
		'.json': 'application/json',
		'.png': 'image/png',
	};
	const server = createServer((request, response) => {
		void (async () => {
			try {
				const pathname = decodeURIComponent(
					new URL(request.url ?? '/', 'http://localhost').pathname
				);
				const file = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
				if (relative(directory, file).startsWith('..')) {
					response.writeHead(403).end();
					return;
				}
				const body = await readFile(file);
				response.writeHead(200, {
					'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
				});
				response.end(body);
			} catch {
				response.writeHead(404).end();
			}
		})();
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolveListen);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No static server address');
	return {
		url: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolveClose, reject) => {
				server.close((error) => (error ? reject(error) : resolveClose()));
			}),
	};
}
