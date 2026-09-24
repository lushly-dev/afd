import type { McpRequest } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient, SERVER_DEADLINE_MARGIN_MS } from './client.js';

type ToolCallHandler = (request: McpRequest, init: RequestInit | undefined) => Promise<unknown>;

function jsonResponse(body: unknown, status = 200, statusText = 'OK') {
	return { ok: status >= 200 && status < 300, status, statusText, json: async () => body };
}

/** Answer health, initialize and tools/list; hand every other request to `onRequest`. */
function mockServer(onRequest: ToolCallHandler) {
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
			return jsonResponse({ jsonrpc: '2.0', id: request.id, result: { tools: [] } });
		}
		return onRequest(request, init);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** A request that never gets an answer and rejects when it is aborted. */
function hang(_request: McpRequest, init: RequestInit | undefined): Promise<unknown> {
	return new Promise((_resolve, reject) => {
		init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
	});
}

function rpcError(code: number, message: string, data?: unknown, status = 200) {
	return async (request: McpRequest) =>
		jsonResponse(
			{ jsonrpc: '2.0', id: request.id, error: { code, message, ...(data ? { data } : {}) } },
			status,
			status === 200 ? 'OK' : 'Error'
		);
}

async function connect(timeout = 1000): Promise<McpClient> {
	const client = new McpClient({ url: 'http://localhost/message', transport: 'http', timeout });
	client.on('error', () => undefined);
	await client.connect();
	return client;
}

const commands = [
	{ command: 'item-create', input: { title: 'a' } },
	{ command: 'item-create', input: { title: 'b' } },
];

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('McpClient.batch() timeouts and outcomes', () => {
	it('waits for the batch deadline plus a margin, not the client timeout', async () => {
		vi.useFakeTimers();
		mockServer(hang);
		const client = await connect(1000);
		let settled = false;
		const pending = client.batch(commands, { timeout: 10_000 }).finally(() => {
			settled = true;
		});

		await vi.advanceTimersByTimeAsync(1_001);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(10_000 + SERVER_DEADLINE_MARGIN_MS);
		const result = await pending;

		expect(result.error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'TIMEOUT', timeoutMs: 10_000 + SERVER_DEADLINE_MARGIN_MS },
		});
	});

	it('keeps the client timeout when it is longer than the deadline plus the margin', async () => {
		vi.useFakeTimers();
		mockServer(hang);
		const client = await connect(60_000);
		let settled = false;
		const pending = client.batch(commands, { timeout: 10 }).finally(() => {
			settled = true;
		});

		await vi.advanceTimersByTimeAsync(10 + SERVER_DEADLINE_MARGIN_MS + 1);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(60_000);
		expect((await pending).error?.code).toBe('OUTCOME_UNKNOWN');
	});

	it('reports a connection failure after sending as OUTCOME_UNKNOWN without per-command statuses', async () => {
		mockServer(async () => {
			throw new TypeError('fetch failed');
		});
		const client = await connect();

		const result = await client.batch(commands);

		expect(result.success).toBe(false);
		expect(result.results).toEqual([]);
		expect(result.summary).toEqual({ total: 2, successCount: 0, failureCount: 0, skippedCount: 0 });
		expect(result.error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'CONNECTION_ERROR' },
		});
		expect(result.error?.message).toContain('fetch failed');
		expect(result.error?.suggestion).toMatch(/before retrying/);
	});

	it('reports a JSON-RPC rejection as a definite failure', async () => {
		mockServer(rpcError(-32602, 'Invalid params', { suggestion: 'Send an arguments object' }));
		const client = await connect();

		const result = await client.batch(commands);

		expect(result.summary.failureCount).toBe(2);
		expect(result.error).toMatchObject({
			code: 'INVALID_INPUT',
			suggestion: 'Send an arguments object',
			retryable: false,
		});
	});

	it('treats a JSON-RPC internal error as an unknown outcome', async () => {
		mockServer(rpcError(-32603, 'Internal error'));
		const client = await connect();

		const result = await client.batch(commands);

		expect(result.error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			details: { cause: 'INTERNAL_ERROR', jsonRpcCode: -32603 },
		});
	});
});

describe('McpClient.pipe() timeouts and outcomes', () => {
	it('waits for timeoutMs plus a margin and reports a timeout as OUTCOME_UNKNOWN', async () => {
		vi.useFakeTimers();
		mockServer(hang);
		const client = await connect(1000);
		let settled = false;
		const pending = client
			.pipe({ steps: [{ command: 'item-create', input: {} }], options: { timeoutMs: 20_000 } })
			.finally(() => {
				settled = true;
			});

		await vi.advanceTimersByTimeAsync(1_001);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(20_000 + SERVER_DEADLINE_MARGIN_MS);
		const result = await pending;

		expect(result.steps).toEqual([
			expect.objectContaining({
				index: -1,
				status: 'failure',
				error: expect.objectContaining({ code: 'OUTCOME_UNKNOWN', retryable: false }),
			}),
		]);
		expect(result.metadata.totalSteps).toBe(1);
	});

	it('uses the options argument with an array of steps', async () => {
		vi.useFakeTimers();
		mockServer(hang);
		const client = await connect(1000);
		let settled = false;
		void client.pipe([{ command: 'item-create', input: {} }], { timeoutMs: 20_000 }).finally(() => {
			settled = true;
		});

		await vi.advanceTimersByTimeAsync(1_001);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(settled).toBe(true);
	});

	it('does not invent step statuses when the connection fails', async () => {
		mockServer(async () => {
			throw new TypeError('socket hang up');
		});
		const client = await connect();

		const result = await client.pipe([
			{ command: 'item-create', input: {} },
			{ command: 'item-notify', input: {} },
		]);

		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]).toMatchObject({ index: -1, error: { code: 'OUTCOME_UNKNOWN' } });
		expect(result.metadata.totalSteps).toBe(2);
	});

	it('reports a JSON-RPC rejection on every step as a definite failure', async () => {
		mockServer(rpcError(-32601, 'Method not found'));
		const client = await connect();

		const result = await client.pipe([{ command: 'item-create', input: {} }]);

		expect(result.steps).toEqual([
			expect.objectContaining({
				command: 'item-create',
				status: 'failure',
				error: expect.objectContaining({ code: 'METHOD_NOT_FOUND', retryable: false }),
			}),
		]);
	});
});

describe('McpClient.call() error mapping', () => {
	it.each([
		[-32700, 400, 'PARSE_ERROR', false],
		[-32600, 400, 'INVALID_REQUEST', false],
		[-32601, 200, 'METHOD_NOT_FOUND', false],
		[-32602, 200, 'INVALID_INPUT', false],
		[-32603, 200, 'INTERNAL_ERROR', true],
		[-32000, 403, 'REQUEST_REJECTED', false],
		[-32001, 404, 'SESSION_NOT_FOUND', true],
		[-32099, 200, 'JSON_RPC_ERROR', false],
	])('maps JSON-RPC %i (HTTP %i) to %s', async (code, status, expected, retryable) => {
		mockServer(rpcError(code, 'Server said no', undefined, status));
		const client = await connect();

		const result = await client.call('item-create', {});

		expect(result.success).toBe(false);
		expect(result.error).toEqual({
			code: expected,
			message: 'Server said no',
			suggestion: expect.any(String),
			retryable,
			details: { jsonRpcCode: code },
		});
		expect(result.error?.suggestion).not.toMatch(/contact support/i);
		expect(Object.getOwnPropertyNames(result.error)).not.toContain('stack');
	});

	it("prefers the server's suggestion", async () => {
		mockServer(rpcError(-32000, 'Origin not allowed', { suggestion: 'Add the origin' }, 403));
		const client = await connect();

		const result = await client.call('item-create', {});

		expect(result.error?.suggestion).toBe('Add the origin');
	});

	it.each([
		[406, 'Not Acceptable', false],
		[503, 'Service Unavailable', true],
	])('maps HTTP %i without a JSON-RPC body', async (status, statusText, retryable) => {
		mockServer(async () => jsonResponse('nope', status, statusText));
		const client = await connect();

		const result = await client.call('item-create', {});

		expect(result.error).toMatchObject({ code: `HTTP_${status}`, retryable });
	});

	it('maps a request timeout to TIMEOUT', async () => {
		vi.useFakeTimers();
		mockServer(hang);
		const client = await connect(50);

		const pending = client.call('item-create', {});
		await vi.advanceTimersByTimeAsync(51);

		expect((await pending).error).toMatchObject({
			code: 'TIMEOUT',
			retryable: true,
			details: { method: 'tools/call', timeoutMs: 50 },
		});
	});

	it('maps calls before connect() to NOT_CONNECTED', async () => {
		const client = new McpClient({ url: 'http://localhost/message', transport: 'http' });

		const result = await client.call('item-create', {});

		expect(result.error).toMatchObject({ code: 'NOT_CONNECTED', retryable: false });
	});

	it('keeps a structured error thrown by a transport', async () => {
		mockServer(async () => {
			throw { code: 'CUSTOM', message: 'custom failure', suggestion: 'do the thing' };
		});
		const client = await connect();

		const result = await client.call('item-create', {});

		expect(result.error).toEqual({
			code: 'CUSTOM',
			message: 'custom failure',
			suggestion: 'do the thing',
		});
	});

	it('passes a per-request timeout through callTool()', async () => {
		vi.useFakeTimers();
		mockServer(hang);
		const client = await connect(50);

		const pending = client.callTool('item-create', {}, { timeout: 500 });
		const assertion = expect(pending).rejects.toThrow("Request 'tools/call' timed out after 500ms");
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(500);
		await assertion;
	});
});
