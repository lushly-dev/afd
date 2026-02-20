/**
 * @fileoverview Simple HTTP handler for browser demo
 *
 * Adds a JSON-RPC POST endpoint for testing the handoff pattern from browsers.
 */

import {
	createServer as createHttpServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server';

/**
 * Create a simple HTTP server for JSON-RPC POST requests.
 */
export function createHttpHandler(
	commands: ZodCommandDefinition[],
	port = 3200
): ReturnType<typeof createHttpServer> {
	const commandMap = new Map(commands.map((cmd) => [cmd.name, cmd]));

	const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
		// CORS headers
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		if (req.method !== 'POST') {
			res.writeHead(405, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
			return;
		}

		// Read body
		let body = '';
		for await (const chunk of req) {
			body += chunk;
		}

		try {
			const request = JSON.parse(body);
			const { method, params, id } = request;

			const command = commandMap.get(method);
			if (!command) {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id,
						error: { code: -32601, message: `Method not found: ${method}` },
					})
				);
				return;
			}

			// Execute command with minimal context
			const ctx = { traceId: `http-${Date.now()}` };
			const result = await command.handler(params ?? {}, ctx);

			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					jsonrpc: '2.0',
					id,
					result,
				})
			);
		} catch (error) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					jsonrpc: '2.0',
					id: null,
					error: { code: -32700, message: error instanceof Error ? error.message : 'Parse error' },
				})
			);
		}
	});

	server.listen(port, () => {
		console.error(`HTTP JSON-RPC Server running at http://localhost:${port}`);
	});

	return server;
}
