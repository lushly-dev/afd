import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { StreamChunk } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from './client.js';
import { deriveStreamUrl } from './mcp-stream.js';

type StreamRoute = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

interface TestServer {
	url: string;
	streamUrls: string[];
	close(): Promise<void>;
}

const servers: TestServer[] = [];

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** An AFD-like server under `basePath`: health, JSON-RPC on `/message`, and `stream` for `/stream/*`. */
async function startServer(stream: StreamRoute, basePath = ''): Promise<TestServer> {
	const streamUrls: string[] = [];
	const server = createServer(async (request, response) => {
		const url = request.url ?? '';
		if (url === `${basePath}/health`) {
			response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
			return;
		}
		if (url.startsWith('/') && url.includes('/stream/')) {
			streamUrls.push(url);
			await stream(request, response);
			return;
		}
		if (url !== `${basePath}/message`) {
			response.writeHead(404).end();
			return;
		}
		const rpc = await readJson(request);
		const result =
			rpc.method === 'initialize'
				? {
						protocolVersion: '2024-11-05',
						serverInfo: { name: 'stream-test', version: '1.0.0' },
						capabilities: {},
					}
				: { tools: [] };
		response
			.writeHead(200, { 'Content-Type': 'application/json' })
			.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
	const testServer: TestServer = {
		url: `http://127.0.0.1:${address.port}${basePath}/message`,
		streamUrls,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
	servers.push(testServer);
	return testServer;
}

async function connectedClient(
	server: TestServer,
	extra: Partial<ConstructorParameters<typeof McpClient>[0]> = {}
): Promise<McpClient> {
	const client = new McpClient({ url: server.url, transport: 'http', ...extra });
	await client.connect();
	return client;
}

async function collect<T>(stream: AsyncGenerator<StreamChunk<T>>): Promise<StreamChunk<T>[]> {
	const chunks: StreamChunk<T>[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks;
}

function sse(response: ServerResponse, ...events: string[]): void {
	response.writeHead(200, { 'Content-Type': 'text/event-stream' });
	for (const event of events) response.write(event);
}

const dataChunk = (index: number) =>
	`event: chunk\ndata: ${JSON.stringify({ type: 'data', data: { index }, index, isLast: false })}\n\n`;
const completeChunk = `data: ${JSON.stringify({ type: 'complete', totalChunks: 1, durationMs: 1 })}\n\n`;

afterEach(async () => {
	vi.unstubAllGlobals();
	for (const server of servers.splice(0)) await server.close();
});

describe('deriveStreamUrl', () => {
	it.each([
		['http://host/sse', 'http://host/stream/a%2Fb'],
		['http://host/message', 'http://host/stream/a%2Fb'],
		['http://host/api/mcp/sse', 'http://host/api/mcp/stream/a%2Fb'],
		['http://host/api/mcp/messages/', 'http://host/api/mcp/stream/a%2Fb'],
		['http://host/api/mcp?key=1#x', 'http://host/api/mcp/stream/a%2Fb'],
	])('maps %s to %s', (serverUrl, expected) => {
		expect(deriveStreamUrl(serverUrl, 'a/b')).toBe(expected);
	});
});

describe('McpClient.stream()', () => {
	it('keeps the base path of the client URL', async () => {
		const server = await startServer((_request, response) => {
			sse(response, dataChunk(0), completeChunk);
			response.end();
		}, '/api/mcp');
		const client = await connectedClient(server);

		const chunks = await collect(client.stream('items-stream'));

		expect(server.streamUrls).toEqual(['/api/mcp/stream/items-stream']);
		expect(chunks.map((chunk) => chunk.type)).toEqual(['data', 'complete']);
		await client.disconnect();
	});

	it('reports a stream that ends without a complete or error chunk as STREAM_TRUNCATED', async () => {
		const server = await startServer((_request, response) => {
			sse(response, dataChunk(0), dataChunk(1));
			response.end();
		});
		const client = await connectedClient(server);

		const chunks = await collect(client.stream('items-stream'));

		expect(chunks).toHaveLength(3);
		expect(chunks[2]).toMatchObject({
			type: 'error',
			error: { code: 'STREAM_TRUNCATED', retryable: false },
			chunksBeforeError: 2,
			recoverable: false,
		});
		await client.disconnect();
	});

	it('treats [DONE] without a complete chunk as a truncated stream', async () => {
		const server = await startServer((_request, response) => {
			sse(response, dataChunk(0), 'data: [DONE]\n\n', completeChunk);
			response.end();
		});
		const client = await connectedClient(server);

		const chunks = await collect(client.stream('items-stream'));

		expect(chunks.map((chunk) => chunk.type)).toEqual(['data', 'error']);
		expect(chunks[1]).toMatchObject({ error: { code: 'STREAM_TRUNCATED' } });
		await client.disconnect();
	});

	it('parses spec-compliant events: no space after data:, multi-line data and comments', async () => {
		const server = await startServer((_request, response) => {
			sse(
				response,
				': heartbeat\n\n',
				'data:{"type":"progress","progress":0.5}\n\n',
				'data: {"type":"complete",\ndata: "totalChunks":0,"durationMs":1}\n\n'
			);
			response.end();
		});
		const client = await connectedClient(server);

		const chunks = await collect(client.stream('items-stream'));

		expect(chunks).toEqual([
			{ type: 'progress', progress: 0.5 },
			{ type: 'complete', totalChunks: 0, durationMs: 1 },
		]);
		await client.disconnect();
	});

	it('skips malformed JSON and events that are not chunks', async () => {
		const debug = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const server = await startServer((_request, response) => {
			sse(response, 'data: {not json\n\n', 'data: {"hello":1}\n\n', completeChunk);
			response.end();
		});
		const client = await connectedClient(server, { debug: true });

		const chunks = await collect(client.stream('items-stream'));

		expect(chunks.map((chunk) => chunk.type)).toEqual(['complete']);
		expect(debug).toHaveBeenCalled();
		await client.disconnect();
	});

	it('ends with STREAM_EVENT_TOO_LARGE instead of buffering an oversized event', async () => {
		const server = await startServer((_request, response) => {
			sse(response, dataChunk(0), `data: "${'x'.repeat(500)}`);
		});
		const client = await connectedClient(server, { maxStreamEventSize: 200 });

		const chunks = await collect(client.stream('items-stream'));

		expect(chunks.map((chunk) => chunk.type)).toEqual(['data', 'error']);
		expect(chunks[1]).toMatchObject({
			error: { code: 'STREAM_EVENT_TOO_LARGE', retryable: false },
			chunksBeforeError: 1,
		});
		await client.disconnect();
	});

	it('reports its own timeout as STREAM_TIMEOUT, not cancellation', async () => {
		const server = await startServer((_request, response) => {
			sse(response, dataChunk(0)); // then never finishes
		});
		const client = await connectedClient(server);

		const chunks = await collect(client.stream('items-stream', {}, { timeout: 50 }));

		expect(chunks.map((chunk) => chunk.type)).toEqual(['data', 'error']);
		expect(chunks[1]).toMatchObject({
			error: { code: 'STREAM_TIMEOUT', retryable: true },
			chunksBeforeError: 1,
		});
		await client.disconnect();
	});

	it('reports the caller aborting as STREAM_CANCELLED', async () => {
		const server = await startServer((_request, response) => {
			sse(response, dataChunk(0));
		});
		const client = await connectedClient(server);
		const controller = new AbortController();

		const chunks: StreamChunk[] = [];
		for await (const chunk of client.stream('items-stream', {}, { signal: controller.signal })) {
			chunks.push(chunk);
			controller.abort();
		}

		expect(chunks[1]).toMatchObject({
			error: { code: 'STREAM_CANCELLED', message: 'Stream was cancelled by the caller' },
		});
		await client.disconnect();
	});

	it('refuses to stream before connect() without sending anything', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const client = new McpClient({ url: 'http://localhost/message', transport: 'http' });

		const chunks = await collect(client.stream('items-stream'));

		expect(chunks).toEqual([
			expect.objectContaining({
				type: 'error',
				error: expect.objectContaining({ code: 'NOT_CONNECTED' }),
			}),
		]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('aborts active streams on disconnect()', async () => {
		let requestClosed = false;
		const server = await startServer((request, response) => {
			request.on('close', () => {
				requestClosed = true;
			});
			sse(response, dataChunk(0)); // then stays open
		});
		const client = await connectedClient(server);

		const chunks: StreamChunk[] = [];
		for await (const chunk of client.stream('items-stream')) {
			chunks.push(chunk);
			if (chunks.length === 1) await client.disconnect();
		}

		expect(chunks[1]).toMatchObject({
			type: 'error',
			error: { code: 'STREAM_CANCELLED', message: 'Stream was cancelled: Client disconnected' },
		});
		await vi.waitFor(() => expect(requestClosed).toBe(true));
	});

	it('uses the AFD failure body of an HTTP error response', async () => {
		const server = await startServer((_request, response) => {
			response.writeHead(405, { 'Content-Type': 'application/json' }).end(
				JSON.stringify({
					success: false,
					error: {
						code: 'METHOD_NOT_ALLOWED',
						message: 'changes state',
						suggestion: 'POST instead',
					},
				})
			);
		});
		const client = await connectedClient(server);

		const chunks = await collect(client.stream('items-stream'));

		expect(chunks).toEqual([
			{
				type: 'error',
				error: { code: 'METHOD_NOT_ALLOWED', message: 'changes state', suggestion: 'POST instead' },
				chunksBeforeError: 0,
				recoverable: false,
			},
		]);
		await client.disconnect();
	});

	it('falls back to a STREAM_ERROR for an HTTP error without an AFD body', async () => {
		const server = await startServer((_request, response) => {
			response.writeHead(503).end('down');
		});
		const client = await connectedClient(server);

		const chunks = await collect(client.stream('items-stream'));

		expect(chunks[0]).toMatchObject({
			type: 'error',
			error: { code: 'STREAM_ERROR', message: 'HTTP 503: Service Unavailable', retryable: true },
		});
		await client.disconnect();
	});

	it('reports a connection failure while streaming as a recoverable error chunk', async () => {
		const server = await startServer((_request, response) => {
			sse(response, dataChunk(0));
			setTimeout(() => response.destroy(), 10);
		});
		const client = await connectedClient(server);

		const chunks = await collect(client.stream('items-stream'));

		expect(chunks.map((chunk) => chunk.type)).toEqual(['data', 'error']);
		expect(chunks[1]).toMatchObject({ recoverable: true, chunksBeforeError: 1 });
		await client.disconnect();
	});
});
