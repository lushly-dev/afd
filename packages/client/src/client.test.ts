import type { McpResponse, McpToolCallResult } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from './client.js';

function toolResult(value: unknown, isError = false): McpToolCallResult {
	return {
		content: [{ type: 'text', text: JSON.stringify(value) }],
		isError,
	};
}

function mockHttpConnection(): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
		if (init?.method === 'GET') return { ok: true };
		const request = JSON.parse(String(init?.body));
		const result =
			request.method === 'initialize'
				? {
						protocolVersion: '2024-11-05',
						serverInfo: { name: 'test', version: '1.0.0' },
						capabilities: {},
					}
				: { tools: [] };
		return {
			ok: true,
			json: async (): Promise<McpResponse> => ({ jsonrpc: '2.0', id: request.id, result }),
		};
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('McpClient - constructor', () => {
	it('throws without url or endpoint', () => {
		expect(() => new McpClient({})).toThrow('Either url or endpoint must be provided');
	});

	it('accepts url', () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		expect(client.getStatus().state).toBe('disconnected');
	});

	it('accepts endpoint as url alias', () => {
		const client = new McpClient({ endpoint: 'http://localhost:3100/message' });
		expect(client.getStatus().state).toBe('disconnected');
	});
});

describe('McpClient - status', () => {
	it('initial status is disconnected', () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		const status = client.getStatus();
		expect(status.state).toBe('disconnected');
		expect(status.url).toBeNull();
		expect(status.serverInfo).toBeNull();
		expect(status.capabilities).toBeNull();
		expect(status.connectedAt).toBeNull();
		expect(status.reconnectAttempts).toBe(0);
		expect(status.pendingRequests).toBe(0);
	});

	it('isConnected returns false when disconnected', () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		expect(client.isConnected()).toBe(false);
	});
});

describe('McpClient - events', () => {
	it('on/off subscribe and unsubscribe', () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		const handler = vi.fn();
		const unsubscribe = client.on('error', handler);

		// Unsubscribe
		unsubscribe();
		// After unsubscribe, handler should not be called
		// (we can't trigger events without connecting, but verify the API works)
		expect(typeof unsubscribe).toBe('function');
	});
});

describe('McpClient - call', () => {
	it('returns failure when callTool throws', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		// request() will throw "Not connected"
		const result = await client.call('test-cmd', { a: 1 });
		expect(result.success).toBe(false);
	});

	it('preserves a structured AFD failure from an MCP error result', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/message', transport: 'http' });
		vi.spyOn(client, 'callTool').mockResolvedValue(
			toolResult(
				{
					success: false,
					error: {
						code: 'OUT_OF_STOCK',
						message: 'No widgets remain',
						suggestion: 'Choose another item',
						retryable: true,
						details: { available: 0 },
					},
				},
				true
			)
		);

		const result = await client.call('order-create');

		expect(result.error).toEqual({
			code: 'OUT_OF_STOCK',
			message: 'No widgets remain',
			suggestion: 'Choose another item',
			retryable: true,
			details: { available: 0 },
		});
	});

	it('keeps the generic fallback for malformed non-AFD tool errors', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/message', transport: 'http' });
		vi.spyOn(client, 'callTool').mockResolvedValue({
			content: [{ type: 'text', text: 'external tool exploded' }],
			isError: true,
		});

		const result = await client.call('external-tool');

		expect(result.error?.code).toBe('TOOL_ERROR');
		expect(result.error?.message).toBe('external tool exploded');
	});
});

describe('McpClient - batch', () => {
	it('returns a definite NOT_CONNECTED failure when nothing was sent', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		const result = await client.batch([{ command: 'test-cmd', input: { a: 1 } }]);
		expect(result.success).toBe(false);
		expect(result.summary.failureCount).toBe(1);
		expect(result.error?.code).toBe('NOT_CONNECTED');
	});

	it('calls afd-batch and preserves every failed command result', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/message', transport: 'http' });
		const batchResult = {
			success: true,
			results: [
				{
					index: 0,
					command: 'one',
					success: false,
					error: { code: 'ONE_FAILED', message: 'one failed', suggestion: 'fix one' },
					executionTimeMs: 1,
				},
				{
					index: 1,
					command: 'two',
					success: false,
					error: { code: 'TWO_FAILED', message: 'two failed', retryable: true },
					executionTimeMs: 2,
				},
			],
			summary: { total: 2, successCount: 0, failureCount: 2, skippedCount: 0 },
			timing: { startedAt: '', completedAt: '', totalMs: 3, averageMs: 1.5 },
			confidence: 0,
			reasoning: 'Both failed',
		};
		const callTool = vi.spyOn(client, 'callTool').mockResolvedValue(toolResult(batchResult, true));

		const result = await client.batch([
			{ command: 'one', input: {} },
			{ command: 'two', input: {} },
		]);

		expect(callTool).toHaveBeenCalledWith('afd-batch', expect.any(Object), { timeout: 30000 });
		expect(result.results).toEqual(batchResult.results);
		expect(result.summary.failureCount).toBe(2);
	});
});

describe('McpClient - pipe', () => {
	it('normalizes array steps to PipelineRequest', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		const result = await client.pipe([{ command: 'user-get', input: { id: 1 }, as: 'user' }]);
		// Not connected, so it catches and returns error pipeline result
		expect(result.metadata.confidence).toBe(0);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]?.command).toBe('user-get');
	});

	it('accepts full PipelineRequest object', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		const result = await client.pipe({
			steps: [{ command: 'test-cmd', input: {} }],
		});
		expect(result.metadata.totalSteps).toBe(1);
	});

	it('preserves successful mutations before a failed and skipped step', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/message', transport: 'http' });
		const pipelineResult = {
			data: { createdId: 'item-1' },
			metadata: {
				confidence: 0,
				confidenceBreakdown: [],
				reasoning: [],
				warnings: [],
				sources: [],
				alternatives: [],
				executionTimeMs: 4,
				completedSteps: 1,
				totalSteps: 3,
			},
			steps: [
				{ index: 0, command: 'item-create', status: 'success', data: { id: 'item-1' } },
				{
					index: 1,
					command: 'charge-card',
					status: 'failure',
					error: { code: 'DECLINED', message: 'Card declined', suggestion: 'Use another card' },
				},
				{ index: 2, command: 'email-receipt', status: 'skipped' },
			],
		};
		vi.spyOn(client, 'callTool').mockResolvedValue(toolResult(pipelineResult, true));

		const result = await client.pipe([
			{ command: 'item-create', input: {} },
			{ command: 'charge-card', input: {} },
			{ command: 'email-receipt', input: {} },
		]);

		expect(result).toEqual(pipelineResult);
	});
});

describe('McpClient - disconnect', () => {
	it('can disconnect even when not connected', async () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		await client.disconnect();
		expect(client.getStatus().state).toBe('disconnected');
	});

	it('aborts an in-flight HTTP request and clears pending request state', async () => {
		const fetchMock = mockHttpConnection();
		const client = new McpClient({
			url: 'http://localhost:3100/message',
			transport: 'http',
			timeout: 1000,
		});
		await client.connect();
		fetchMock.mockImplementationOnce(
			(_input: string | URL | Request, init?: RequestInit) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
						once: true,
					});
				})
		);

		const request = client.request('slow-operation');
		await vi.waitFor(() => expect(client.getStatus().pendingRequests).toBe(1));
		await client.disconnect();

		await expect(request).rejects.toThrow('Client disconnected');
		expect(client.getStatus().pendingRequests).toBe(0);
		expect(client.getStatus().state).toBe('disconnected');
	});

	it('does not reconnect after an intentional HTTP disconnect', async () => {
		const fetchMock = mockHttpConnection();
		const client = new McpClient({
			url: 'http://localhost:3100/message',
			transport: 'http',
			autoReconnect: true,
			reconnectDelay: 1,
		});
		await client.connect();
		const callsBeforeDisconnect = fetchMock.mock.calls.length;

		await client.disconnect();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(client.getStatus().state).toBe('disconnected');
		expect(fetchMock).toHaveBeenCalledTimes(callsBeforeDisconnect);
	});
});

describe('McpClient - request timeout', () => {
	it('aborts stalled HTTP work at the configured timeout and cleans up', async () => {
		const fetchMock = mockHttpConnection();
		const client = new McpClient({
			url: 'http://localhost:3100/message',
			transport: 'http',
			timeout: 5,
		});
		await client.connect();
		fetchMock.mockImplementationOnce(
			(_input: string | URL | Request, init?: RequestInit) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
						once: true,
					});
				})
		);

		await expect(client.request('never-responds')).rejects.toThrow(
			"Request 'never-responds' timed out after 5ms"
		);
		expect(client.getStatus().pendingRequests).toBe(0);
	});

	it('times out connection establishment and remains disconnected from the transport', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_input: string | URL | Request, init?: RequestInit) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
							once: true,
						});
					})
			)
		);
		const client = new McpClient({
			url: 'http://localhost:3100/message',
			transport: 'http',
			timeout: 5,
		});
		client.on('error', () => undefined);

		await expect(client.connect()).rejects.toThrow('Connection timed out after 5ms');
		expect(client.isConnected()).toBe(false);
	});
});

describe('McpClient - reconnect lifecycle', () => {
	it('initializes and refreshes tools after a successful reconnect', async () => {
		vi.useFakeTimers();
		mockHttpConnection();
		const client = new McpClient({
			url: 'http://localhost/message',
			transport: 'http',
			reconnectDelay: 1,
		});
		const connected = vi.fn();
		client.on('connected', connected);
		await client.connect();
		const transport = (client as unknown as { transport: { disconnect(): void } }).transport;
		transport.disconnect();
		await vi.runAllTimersAsync();
		expect(client.isConnected()).toBe(true);
		expect(client.getStatus().reconnectAttempts).toBe(0);
		expect(connected).toHaveBeenCalledTimes(2);
		await client.disconnect();
		vi.useRealTimers();
	});

	it('retries failed reconnects up to the configured bound', async () => {
		vi.useFakeTimers();
		const fetchMock = mockHttpConnection();
		const client = new McpClient({
			url: 'http://localhost:3100/message',
			transport: 'http',
			timeout: 100,
			reconnectDelay: 1,
			maxReconnectAttempts: 3,
		});
		const reconnecting = vi.fn();
		client.on('reconnecting', reconnecting);
		client.on('error', () => undefined);
		await client.connect();
		fetchMock.mockRejectedValue(new Error('offline'));
		const transport = (client as unknown as { transport: { disconnect(): void } }).transport;

		transport.disconnect();
		await vi.runAllTimersAsync();

		expect(reconnecting.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
		expect(client.getStatus().reconnectAttempts).toBe(3);
		expect(client.getStatus().state).toBe('error');
		await client.disconnect();
		vi.useRealTimers();
	});

	it('cancels a scheduled reconnect before it creates a new transport', async () => {
		vi.useFakeTimers();
		const fetchMock = mockHttpConnection();
		const client = new McpClient({
			url: 'http://localhost:3100/message',
			transport: 'http',
			reconnectDelay: 100,
		});
		client.on('error', () => undefined);
		await client.connect();
		const callsBeforeClose = fetchMock.mock.calls.length;
		const transport = (client as unknown as { transport: { disconnect(): void } }).transport;

		transport.disconnect();
		await client.disconnect();
		await vi.runAllTimersAsync();

		expect(fetchMock).toHaveBeenCalledTimes(callsBeforeClose);
		expect(client.getStatus().state).toBe('disconnected');
		vi.useRealTimers();
	});
});

describe('McpClient - stream cleanup', () => {
	it('cancels the response reader when a consumer stops early', async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode('data: {"type":"data","data":"first","index":0}\n\n')
				);
			},
			cancel,
		});
		const fetchMock = mockHttpConnection();
		const client = new McpClient({ url: 'http://localhost:3100/message', transport: 'http' });
		await client.connect();
		fetchMock.mockResolvedValueOnce({ ok: true, body });

		for await (const chunk of client.stream('items-stream')) {
			expect(chunk.type).toBe('data');
			break;
		}

		expect(cancel).toHaveBeenCalledOnce();
	});
});

describe('McpClient - getTools', () => {
	it('returns empty array initially', () => {
		const client = new McpClient({ url: 'http://localhost:3100/sse' });
		expect(client.getTools()).toEqual([]);
	});
});
