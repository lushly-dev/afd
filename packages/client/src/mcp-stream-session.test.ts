import { createServer, type ServerResponse } from 'node:http';
import type { McpRequest, StreamChunk } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { streamOverHttp } from './mcp-stream.js';
import { HttpTransport } from './transport.js';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}

const cleanup: Array<() => Promise<void>> = [];
const initialize: McpRequest = { jsonrpc: '2.0', id: 1, method: 'initialize' };

async function sessionServer(renewal: 'success' | 'failure' | 'same-id') {
	const started = { a: deferred(), b: deferred() };
	const release = { a: deferred(), b: deferred() };
	const requests: Array<{ slot: string; session?: string }> = [];
	let initializes = 0;
	const server = createServer((request, response) => {
		void (async () => {
			let body = '';
			for await (const part of request) body += part;
			const input = JSON.parse(body);
			if (request.url === '/message') {
				initializes++;
				if (initializes > 2 || (initializes === 2 && renewal === 'failure')) {
					response.writeHead(503).end('{}');
					return;
				}
				response
					.writeHead(200, {
						'Content-Type': 'application/json',
						'Mcp-Session-Id': initializes === 1 || renewal === 'same-id' ? 'old' : 'new',
					})
					.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: {} }));
				return;
			}
			const slot = input.slot as 'a' | 'b';
			const session = request.headers['mcp-session-id'] as string | undefined;
			requests.push({ slot, session });
			if (requests.filter((entry) => entry.slot === slot).length === 1) {
				started[slot].resolve();
				await release[slot].promise;
				response.writeHead(404, { 'Content-Type': 'application/json' }).end('{}');
				return;
			}
			finishStream(response);
		})().catch(() => {
			response.writeHead(500).end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Expected loopback TCP address');
	cleanup.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return {
		url: `http://127.0.0.1:${address.port}`,
		started,
		release,
		requests,
		get initializes() {
			return initializes;
		},
	};
}

function finishStream(response: ServerResponse) {
	response.writeHead(200, { 'Content-Type': 'text/event-stream' });
	response.write(
		`data: ${JSON.stringify({ type: 'data', data: 'ok', index: 0, isLast: true })}\n\n`
	);
	response.end(`data: ${JSON.stringify({ type: 'complete', totalChunks: 1, durationMs: 1 })}\n\n`);
}

async function collect(url: string, session: HttpTransport, slot: 'a' | 'b') {
	const controller = new AbortController();
	const chunks: StreamChunk[] = [];
	for await (const chunk of streamOverHttp({
		url: `${url}/stream/item-get`,
		args: { slot },
		headers: {},
		session,
		signal: controller.signal,
		abort: { controller, timedOut: false },
		timeoutMs: undefined,
		maxEventSize: 1024,
		debug: () => undefined,
	}))
		chunks.push(chunk);
	return chunks;
}

afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe('HTTP stream renewal owns the session generation and rejected revision', () => {
	it.each(['success', 'failure', 'same-id'] as const)(
		'shares a completed %s renewal with a delayed old-session 404',
		async (renewal) => {
			const server = await sessionServer(renewal);
			const transport = new HttpTransport(`${server.url}/message`);
			await transport.send(initialize);
			const a = collect(server.url, transport, 'a');
			const b = collect(server.url, transport, 'b');
			await Promise.all([server.started.a.promise, server.started.b.promise]);
			server.release.a.resolve();
			const first = await a; // Renewal completes before the second rejected response arrives.
			server.release.b.resolve();
			const second = await b;
			const types = renewal === 'failure' ? ['error'] : ['data', 'complete'];
			expect(first.map((chunk) => chunk.type)).toEqual(types);
			expect(second.map((chunk) => chunk.type)).toEqual(types);
			expect(server.initializes).toBe(2);
			const replacement = renewal === 'same-id' ? 'old' : 'new';
			expect(server.requests.map((entry) => entry.session)).toEqual(
				renewal === 'failure' ? ['old', 'old'] : ['old', 'old', replacement, replacement]
			);
			transport.disconnect();
		}
	);

	it('does not replay a delayed 404 in a replacement connection generation', async () => {
		const server = await sessionServer('success');
		const transport = new HttpTransport(`${server.url}/message`);
		await transport.send(initialize);
		const stream = collect(server.url, transport, 'a');
		await server.started.a.promise;
		transport.disconnect();
		await transport.send({ ...initialize, id: 2 });
		expect(transport.sessionId).toBe('new');
		server.release.a.resolve();
		expect((await stream).map((chunk) => chunk.type)).toEqual(['error']);
		expect(server.initializes).toBe(2);
		expect(server.requests).toEqual([{ slot: 'a', session: 'old' }]);
		transport.disconnect();
	});
});
