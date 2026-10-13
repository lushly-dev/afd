import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

export async function startFixtureServer({ directory, deploymentUrl, origin }) {
	const requested = origin ? new URL(origin) : new URL('http://127.0.0.1:0');
	if (requested.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(requested.hostname)) {
		throw new Error('Fixture server origin must be HTTP loopback');
	}
	const server = createServer(async (request, response) => {
		try {
			response.setHeader('Cache-Control', 'no-store');
			if (request.url === '/config.js') {
				response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
				response.end(
					`window.__AFD_CONVEX_CONFIG__=${JSON.stringify({ deploymentUrl: deploymentUrl.href })};`
				);
				return;
			}
			const file = request.url === '/bundle.js' ? 'bundle.js' : 'index.html';
			response.setHeader(
				'Content-Type',
				file === 'bundle.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8'
			);
			response.end(await readFile(join(directory, file)));
		} catch {
			response.statusCode = 500;
			response.end('fixture unavailable');
		}
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(Number(requested.port || 80), requested.hostname, resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Fixture server did not bind TCP');
	return {
		origin: `http://${requested.hostname}:${address.port}`,
		close: () =>
			new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			),
	};
}
