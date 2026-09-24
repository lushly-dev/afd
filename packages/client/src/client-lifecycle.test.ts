import type { CommandContext, CommandResult, McpRequest } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from './client.js';
import type { DirectRegistry } from './direct-types.js';
import type { McpClientConfig } from './types.js';

function jsonResponse(body: unknown) {
	return { ok: true, status: 200, statusText: 'OK', json: async () => body };
}

interface ServerOptions {
	tools?: () => unknown;
	call?: (request: McpRequest) => Promise<unknown>;
}

/** An AFD-like HTTP server made of fetch mocks. */
function mockServer(options: ServerOptions = {}) {
	const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
		if (init?.method === 'GET') return { ok: true };
		const request = JSON.parse(String(init?.body)) as McpRequest;
		if (request.method === 'initialize') {
			return jsonResponse({
				jsonrpc: '2.0',
				id: request.id,
				result: {
					protocolVersion: '2024-11-05',
					serverInfo: { name: 't', version: '1' },
					capabilities: {},
				},
			});
		}
		if (request.method === 'tools/list') {
			const tools = options.tools?.() ?? [{ name: 'item-get', inputSchema: { type: 'object' } }];
			return jsonResponse({ jsonrpc: '2.0', id: request.id, result: { tools } });
		}
		if (options.call) return options.call(request);
		return jsonResponse({
			jsonrpc: '2.0',
			id: request.id,
			result: { content: [{ type: 'text', text: '{"success":true,"data":1}' }] },
		});
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function httpClient(config: Partial<McpClientConfig> = {}): McpClient {
	return new McpClient({ url: 'http://localhost/message', transport: 'http', ...config });
}

function currentTransport(client: McpClient): { disconnect(): void } {
	return (client as unknown as { transport: { disconnect(): void } }).transport;
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('McpClient constructor', () => {
	it.each(['stdio', 'websocket'])(
		'refuses the unimplemented %s transport with a clear error',
		(transport) => {
			expect(
				() => new McpClient({ url: 'http://localhost/sse', transport: transport as 'sse' })
			).toThrow(`Unsupported transport '${transport}'`);
		}
	);

	it('requires a registry for the direct transport', () => {
		expect(() => new McpClient({ transport: 'direct' })).toThrow(
			"transport: 'direct' requires a registry"
		);
	});
});

describe('McpClient connect lifecycle', () => {
	it('emits connected after the tools list is loaded', async () => {
		mockServer();
		const client = httpClient();
		const toolsAtConnected: string[][] = [];
		client.on('connected', () => {
			toolsAtConnected.push(client.getTools().map((tool) => tool.name));
		});

		await client.connect();

		expect(toolsAtConnected).toEqual([['item-get']]);
	});

	it('stays connected when the tools refresh fails', async () => {
		mockServer({
			tools: () => {
				throw new Error('tools/list exploded');
			},
		});
		const client = httpClient();
		const errors = vi.fn();
		const connected = vi.fn();
		client.on('error', errors);
		client.on('connected', connected);

		await expect(client.connect()).resolves.toMatchObject({ serverInfo: { name: 't' } });

		expect(client.isConnected()).toBe(true);
		expect(client.getTools()).toEqual([]);
		expect(connected).toHaveBeenCalledOnce();
		expect(errors).not.toHaveBeenCalled();
	});

	it('delivers an event to every handler even when one unsubscribes during delivery', async () => {
		mockServer();
		const client = httpClient();
		const calls: string[] = [];
		const unsubscribeFirst = client.on('connected', () => {
			calls.push('first');
			unsubscribeFirst();
		});
		client.on('connected', () => calls.push('second'));
		client.on('connected', () => {
			calls.push('third');
			client.on('connected', () => calls.push('added'));
		});

		await client.connect();

		expect(calls).toEqual(['first', 'second', 'third']);
	});

	it('reports one error for a failed initial connection', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
		const client = httpClient();
		const errors = vi.fn();
		client.on('error', errors);

		await expect(client.connect()).rejects.toThrow('fetch failed');

		expect(errors).toHaveBeenCalledOnce();
		expect(client.getStatus().state).toBe('error');
	});
});

describe('McpClient reconnection', () => {
	it('emits a single error, without toggling state, when every reconnect attempt fails', async () => {
		vi.useFakeTimers();
		const fetchMock = mockServer();
		const client = httpClient({ reconnectDelay: 1, maxReconnectAttempts: 3, timeout: 100 });
		await client.connect();
		const states: string[] = [];
		const errors: Error[] = [];
		client.on('stateChange', (state) => states.push(state));
		client.on('error', (error) => errors.push(error));
		fetchMock.mockRejectedValue(new TypeError('offline'));

		currentTransport(client).disconnect();
		await vi.runAllTimersAsync();

		expect(states).toEqual(['reconnecting', 'error']);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.message).toBe('Max reconnection attempts reached');
		expect(errors[0]?.cause).toEqual(new TypeError('offline'));
		await client.disconnect();
	});

	it('caps the reconnect delay at maxReconnectDelay', async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const fetchMock = mockServer();
		const client = httpClient({ reconnectDelay: 60_000, maxReconnectDelay: 50 });
		await client.connect();
		const callsBefore = fetchMock.mock.calls.length;

		currentTransport(client).disconnect();
		await vi.advanceTimersByTimeAsync(49);
		expect(fetchMock.mock.calls.length).toBe(callsBefore);
		await vi.advanceTimersByTimeAsync(1);

		expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
		await vi.waitFor(() => expect(client.isConnected()).toBe(true));
		await client.disconnect();
	});

	it('adds up to 100 ms of jitter to the exponential delay', async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const fetchMock = mockServer();
		const client = httpClient({ reconnectDelay: 10 });
		await client.connect();
		const callsBefore = fetchMock.mock.calls.length;

		currentTransport(client).disconnect();
		await vi.advanceTimersByTimeAsync(59);
		expect(fetchMock.mock.calls.length).toBe(callsBefore);
		await vi.advanceTimersByTimeAsync(1);

		expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
		await client.disconnect();
	});

	it('detects a lost HTTP connection after consecutive network failures and reconnects', async () => {
		let online = true;
		const fetchMock = mockServer();
		const base = fetchMock.getMockImplementation();
		fetchMock.mockImplementation(async (input, init) => {
			if (!online) throw new TypeError('fetch failed');
			if (!base) throw new Error('missing mock');
			return base(input, init);
		});
		const client = httpClient({ reconnectDelay: 1 });
		await client.connect();
		const reconnecting = vi.fn();
		client.on('reconnecting', reconnecting);

		online = false;
		await client.call('item-get');
		await client.call('item-get');
		expect(reconnecting).not.toHaveBeenCalled();
		online = true;
		await client.call('item-get');
		online = false;
		await client.call('item-get');
		await client.call('item-get');
		expect(reconnecting).not.toHaveBeenCalled();
		const result = await client.call('item-get');
		online = true;

		expect(result.error?.code).toBe('CONNECTION_ERROR');
		expect(reconnecting).toHaveBeenCalledWith(1, 5);
		await vi.waitFor(() => expect(client.isConnected()).toBe(true));
		await client.disconnect();
	});
});

describe('McpClient with transport: direct', () => {
	function createRegistry(): DirectRegistry {
		const handlers: Record<
			string,
			(input: unknown, context?: CommandContext) => Promise<CommandResult>
		> = {
			'item-get': async (input) => ({ success: true, data: { id: (input as { id: string }).id } }),
			'item-list': async () => ({ success: true, data: [1, 2] }),
			'item-explode': async () => {
				throw new Error('secret failure');
			},
		};
		return {
			async execute<T>(name: string, input?: unknown, context?: CommandContext) {
				const handler = handlers[name];
				if (!handler)
					return { success: false, error: { code: 'COMMAND_NOT_FOUND', message: name } };
				return (await handler(input, context)) as CommandResult<T>;
			},
			listCommandNames: () => Object.keys(handlers),
			listCommands: () => Object.keys(handlers).map((name) => ({ name, description: name })),
			hasCommand: (name) => name in handlers,
		};
	}

	async function directClient(): Promise<McpClient> {
		const client = new McpClient({ transport: 'direct', registry: createRegistry() });
		await client.connect();
		return client;
	}

	it('connects, lists tools and calls commands in process', async () => {
		const client = await directClient();

		expect(client.getTools().map((tool) => tool.name)).toEqual([
			'item-get',
			'item-list',
			'item-explode',
		]);
		expect(await client.call('item-get', { id: 'a' })).toEqual({
			success: true,
			data: { id: 'a' },
		});
		expect(client.getStatus().url).toBe('direct://in-process');
		await client.disconnect();
	});

	it('returns UNKNOWN_TOOL with a suggestion instead of TOOL_ERROR', async () => {
		const client = await directClient();

		const result = await client.call('item-gte');

		expect(result.error).toMatchObject({
			code: 'UNKNOWN_TOOL',
			suggestion: "Did you mean 'item-get'?",
		});
		expect(result.data).toMatchObject({ error: 'UNKNOWN_TOOL', requested_tool: 'item-gte' });
		await client.disconnect();
	});

	it('returns a sanitized failure when a command throws', async () => {
		const client = await directClient();

		const result = await client.call('item-explode');

		expect(result.error?.code).toBe('COMMAND_EXECUTION_ERROR');
		expect(JSON.stringify(result)).not.toContain('secret');
		await client.disconnect();
	});

	it('runs batch() and pipe() through the core executors', async () => {
		const client = await directClient();

		const batch = await client.batch([
			{ command: 'item-get', input: { id: 'a' } },
			{ command: 'item-explode', input: {} },
		]);
		const pipeline = await client.pipe([
			{ command: 'item-get', input: { id: 'b' }, as: 'item' },
			{ command: 'item-get', input: { id: '$steps.item.id' } },
		]);

		expect(batch.summary).toMatchObject({ total: 2, successCount: 1, failureCount: 1 });
		expect(pipeline.data).toEqual({ id: 'b' });
		expect(pipeline.steps.map((step) => step.status)).toEqual(['success', 'success']);
		await client.disconnect();
	});

	it('streams in process', async () => {
		const client = await directClient();

		const chunks = [];
		for await (const chunk of client.stream('item-list')) chunks.push(chunk);

		expect(chunks.map((chunk) => chunk.type)).toEqual(['data', 'data', 'complete']);
		await client.disconnect();
	});

	it('reports a direct stream aborted by its timeout as STREAM_TIMEOUT', async () => {
		const registry = createRegistry();
		const slow: DirectRegistry = {
			...registry,
			execute: async <T>(name: string, input?: unknown, context?: CommandContext) => {
				await new Promise((resolve) => setTimeout(resolve, 30));
				return registry.execute<T>(name, input, context);
			},
		};
		const client = new McpClient({ transport: 'direct', registry: slow });
		await client.connect();

		const chunks = [];
		for await (const chunk of client.stream('item-list', {}, { timeout: 5 })) chunks.push(chunk);

		expect(chunks).toEqual([
			expect.objectContaining({
				type: 'error',
				error: expect.objectContaining({ code: 'STREAM_TIMEOUT' }),
			}),
		]);
		await client.disconnect();
	});
});
