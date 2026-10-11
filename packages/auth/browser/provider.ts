import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { toNodeHandler } from 'better-auth/node';
import { build } from 'esbuild';

/** No fake auth endpoints: all /api/auth traffic goes to the installed provider. */
export async function startProvider(session: { expiresIn: number; updateAge: number }) {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL('./fixture.ts', import.meta.url))],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		define: { 'process.env.NODE_ENV': '"production"' },
	});
	const script = bundled.outputFiles[0]?.text;
	if (!script) throw new Error('Browser fixture build produced no JavaScript');
	const database = { user: [], session: [], account: [], verification: [] };
	const server = createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening', { signal: AbortSignal.timeout(5_000) });
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Expected loopback address');
	const origin = `http://127.0.0.1:${address.port}`;
	const auth = betterAuth({
		baseURL: origin,
		secret: 'afd-browser-test-only-secret-at-least-32-characters',
		database: memoryAdapter(database),
		emailAndPassword: { enabled: true },
		session,
		advanced: { useSecureCookies: false },
		logger: { disabled: true },
	});
	const authHandler = toNodeHandler(auth);
	server.on('request', (request, response) => {
		if (request.url?.startsWith('/api/auth/')) {
			void authHandler(request, response);
		} else if (request.url === '/fixture.js') {
			response.writeHead(200, { 'content-type': 'text/javascript' }).end(script);
		} else {
			response
				.writeHead(200, { 'content-type': 'text/html' })
				.end(
					'<!doctype html><html lang="en"><title>AFD auth browser fixture</title>' +
						'<div id="root"></div><script type="module" src="/fixture.js"></script></html>'
				);
		}
	});
	return {
		origin,
		database,
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			);
			for (const records of Object.values(database)) records.length = 0;
		},
	};
}
