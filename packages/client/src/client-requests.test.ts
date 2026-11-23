import type { McpRequest, McpTool } from '@lushly-dev/afd-core';
import { timeoutError } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient, SERVER_DEADLINE_MARGIN_MS } from './client.js';
import { isOutcomeUnknown, SessionLimitError, toCommandError } from './client-errors.js';

type ToolCallHandler = (request: McpRequest, init: RequestInit | undefined) => Promise<unknown>;

function jsonResponse(body: unknown, status = 200, statusText = 'OK') {
	return { ok: status >= 200 && status < 300, status, statusText, json: async () => body };
}

/** Answer health, initialize and tools/list; hand every other request to `onRequest`. */
function mockServer(onRequest: ToolCallHandler, tools: McpTool[] = []) {
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
			return jsonResponse({ jsonrpc: '2.0', id: request.id, result: { tools } });
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

const CALL_TOOLS: McpTool[] = [
	{
		name: 'item-create',
		description: 'Create an item',
		inputSchema: { type: 'object' },
		_meta: { mutation: true },
		annotations: { readOnlyHint: false },
	},
	{
		name: 'item-get',
		description: 'Get an item',
		inputSchema: { type: 'object' },
		_meta: { mutation: false },
		annotations: { readOnlyHint: true },
	},
	{
		name: 'item-read-meta-only',
		description: 'AFD read tool declaring _meta.mutation: false without annotations',
		inputSchema: { type: 'object' },
		_meta: { mutation: false },
	},
	{
		name: 'external-read',
		description: 'Non-AFD tool with readOnlyHint only and no _meta.mutation',
		inputSchema: { type: 'object' },
		annotations: { readOnlyHint: true },
	},
	{
		name: 'item-unmarked',
		description: 'Tool with no mutation or annotation metadata',
		inputSchema: { type: 'object' },
	},
	{
		name: 'item-contradictory',
		description: 'Tool with conflicting mutation and readOnlyHint flags',
		inputSchema: { type: 'object' },
		_meta: { mutation: true },
		annotations: { readOnlyHint: true },
	},
	{
		name: 'item-destructive-contradictory',
		description: 'Tool with conflicting destructive and mutation: false flags',
		inputSchema: { type: 'object' },
		_meta: { mutation: false, destructive: true },
		annotations: { readOnlyHint: true },
	},
	{
		name: 'item-meta-false-hint-false',
		description: 'Tool with conflicting mutation: false and readOnlyHint: false',
		inputSchema: { type: 'object' },
		_meta: { mutation: false },
		annotations: { readOnlyHint: false },
	},
	{
		name: 'item-meta-false-destructive-hint',
		description: 'Tool with conflicting mutation: false and destructiveHint: true',
		inputSchema: { type: 'object' },
		_meta: { mutation: false },
		annotations: { destructiveHint: true },
	},
];

describe('McpClient.call() error mapping', () => {
	it.each([
		[-32700, 400, 'PARSE_ERROR', false],
		[-32600, 400, 'INVALID_REQUEST', false],
		[-32601, 200, 'METHOD_NOT_FOUND', false],
		[-32602, 200, 'INVALID_INPUT', false],
		[-32000, 403, 'REQUEST_REJECTED', false],
		[-32001, 404, 'SESSION_NOT_FOUND', true],
		[-32002, 503, 'JSON_RPC_ERROR', false],
		[-32000, 503, 'REQUEST_REJECTED', false],
		[-32099, 200, 'JSON_RPC_ERROR', false],
	])(
		'maps definite JSON-RPC %i (HTTP %i) to %s on a mutation',
		async (code, status, expected, retryable) => {
			mockServer(rpcError(code, 'Server said no', undefined, status), CALL_TOOLS);
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
		}
	);

	it('maps JSON-RPC -32603 to OUTCOME_UNKNOWN on a mutation and INTERNAL_ERROR on a read', async () => {
		mockServer(rpcError(-32603, 'Server failed mid-request', undefined, 200), CALL_TOOLS);
		const client = await connect();

		const mutation = await client.call('item-create', {});
		expect(mutation.error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'INTERNAL_ERROR', jsonRpcCode: -32603 },
		});
		expect(mutation.error?.suggestion).toMatch(/before retrying/);

		const read = await client.call('item-get', {});
		expect(read.error).toEqual({
			code: 'INTERNAL_ERROR',
			message: 'Server failed mid-request',
			suggestion: expect.any(String),
			retryable: true,
			details: { jsonRpcCode: -32603 },
		});
	});

	it('reads a session-limit refusal only from HTTP 503 with data.code SESSION_LIMIT_REACHED', async () => {
		const limit = { code: 'SESSION_LIMIT_REACHED', retryAfter: 60 };
		mockServer(rpcError(-32000, 'Too many live MCP sessions', limit, 503), CALL_TOOLS);
		const client = await connect();

		const result = await client.call('item-create', {});

		expect(result.error).toMatchObject({
			code: 'SESSION_LIMIT_REACHED',
			retryable: true,
			details: { retryAfterSeconds: 60 },
		});
		expect(result.error?.suggestion).toContain('Retry-After');
		expect(result.error?.suggestion).not.toMatch(/Host|Origin/);

		// The same data.code on another status is the plain JSON-RPC error.
		mockServer(rpcError(-32000, 'Too many live MCP sessions', limit, 403), CALL_TOOLS);
		expect((await client.call('item-create', {})).error).toMatchObject({
			code: 'REQUEST_REJECTED',
			retryable: false,
		});
	});

	it('rejects connect() with a retryable SessionLimitError when initialize is refused', async () => {
		const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
			if (init?.method === 'GET') return { ok: true };
			const request = JSON.parse(String(init?.body)) as McpRequest;
			return {
				...jsonResponse(
					{
						jsonrpc: '2.0',
						id: request.id,
						error: {
							code: -32000,
							message: 'Too many live MCP sessions',
							data: {
								code: 'SESSION_LIMIT_REACHED',
								suggestion: 'Retry after 30 seconds',
								retryAfter: 60,
							},
						},
					},
					503,
					'Service Unavailable'
				),
				headers: new Headers({ 'Retry-After': '30' }),
			};
		});
		vi.stubGlobal('fetch', fetchMock);
		const client = new McpClient({ url: 'http://localhost/message', transport: 'http' });
		client.on('error', () => undefined);

		const refused = await client.connect().then(
			() => undefined,
			(error: unknown) => error
		);

		expect(refused).toBeInstanceOf(SessionLimitError);
		expect(refused).toMatchObject({
			code: 'SESSION_LIMIT_REACHED',
			retryable: true,
			suggestion: 'Retry after 30 seconds',
			retryAfterSeconds: 30,
		});
		expect(toCommandError(refused)).toEqual({
			code: 'SESSION_LIMIT_REACHED',
			message: 'Too many live MCP sessions',
			suggestion: 'Retry after 30 seconds',
			retryable: true,
			details: { retryAfterSeconds: 30 },
		});
		expect(isOutcomeUnknown(refused)).toBe(false);
		expect(client.getStatus().state).toBe('error');
	});

	it("prefers the server's suggestion", async () => {
		mockServer(
			rpcError(-32000, 'Origin not allowed', { suggestion: 'Add the origin' }, 403),
			CALL_TOOLS
		);
		const client = await connect();

		const result = await client.call('item-create', {});

		expect(result.error?.suggestion).toBe('Add the origin');
	});

	it.each([
		[406, 'Not Acceptable', false],
		[429, 'Too Many Requests', true],
	])(
		'maps definite HTTP %i without a JSON-RPC body on a mutation',
		async (status, statusText, retryable) => {
			mockServer(async () => jsonResponse('nope', status, statusText), CALL_TOOLS);
			const client = await connect();

			const result = await client.call('item-create', {});

			expect(result.error).toMatchObject({ code: `HTTP_${status}`, retryable });
		}
	);

	it.each([
		['item-create', 'mutation'],
		['item-unmarked', 'unmarked tool'],
		['item-not-listed', 'unlisted tool'],
		['external-read', 'readOnlyHint only without _meta.mutation: false'],
		['item-contradictory', 'contradictory mutation + readOnlyHint'],
		['item-destructive-contradictory', 'contradictory destructive + mutation: false'],
		['item-meta-false-hint-false', 'contradictory mutation: false + readOnlyHint: false'],
		['item-meta-false-destructive-hint', 'contradictory mutation: false + destructiveHint: true'],
	])('maps HTTP 5xx to OUTCOME_UNKNOWN (not retryable) for %s (%s)', async (toolName) => {
		mockServer(async () => jsonResponse('nope', 503, 'Service Unavailable'), CALL_TOOLS);
		const client = await connect();

		const result = await client.call(toolName, {});

		expect(result.error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'HTTP_503' },
		});
		expect(result.error?.suggestion).toMatch(/before retrying/);
	});

	it.each([
		['item-get', '_meta.mutation: false + readOnlyHint: true'],
		['item-read-meta-only', '_meta.mutation: false without annotations'],
	])('maps HTTP 5xx to retryable HTTP_503 for read-only tool %s (%s)', async (toolName) => {
		mockServer(async () => jsonResponse('nope', 503, 'Service Unavailable'), CALL_TOOLS);
		const client = await connect();

		const result = await client.call(toolName, {});

		expect(result.error).toMatchObject({ code: 'HTTP_503', retryable: true });
	});

	it('maps a request timeout to OUTCOME_UNKNOWN on a mutation and TIMEOUT on a read', async () => {
		vi.useFakeTimers();
		mockServer(hang, CALL_TOOLS);
		const client = await connect(50);

		const mutationPending = client.call('item-create', {});
		await vi.advanceTimersByTimeAsync(51);
		expect((await mutationPending).error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'TIMEOUT', method: 'tools/call', timeoutMs: 50 },
		});

		const unmarkedPending = client.call('item-unmarked', {});
		await vi.advanceTimersByTimeAsync(51);
		expect((await unmarkedPending).error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'TIMEOUT', method: 'tools/call', timeoutMs: 50 },
		});

		const readPending = client.call('item-get', {});
		await vi.advanceTimersByTimeAsync(51);
		expect((await readPending).error).toMatchObject({
			code: 'TIMEOUT',
			retryable: true,
			details: { method: 'tools/call', timeoutMs: 50 },
		});

		const metaOnlyReadPending = client.call('item-read-meta-only', {});
		await vi.advanceTimersByTimeAsync(51);
		expect((await metaOnlyReadPending).error).toMatchObject({
			code: 'TIMEOUT',
			retryable: true,
			details: { method: 'tools/call', timeoutMs: 50 },
		});
	});

	it('maps a connection loss to OUTCOME_UNKNOWN on a mutation and CONNECTION_ERROR on a read', async () => {
		mockServer(async () => {
			throw new TypeError('socket hang up');
		}, CALL_TOOLS);
		const client = await connect();

		const mutation = await client.call('item-create', {});
		expect(mutation.error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'CONNECTION_ERROR' },
		});
		expect(mutation.error?.message).toContain('socket hang up');

		const read = await client.call('item-get', {});
		expect(read.error).toMatchObject({
			code: 'CONNECTION_ERROR',
			retryable: true,
		});
		expect(read.error?.message).toContain('socket hang up');

		const metaOnlyRead = await client.call('item-read-meta-only', {});
		expect(metaOnlyRead.error).toMatchObject({
			code: 'CONNECTION_ERROR',
			retryable: true,
		});
	});

	it('captures read-only classification before dispatch so refreshTools cannot flip an in-flight call', async () => {
		vi.useFakeTimers();
		let currentTools: McpTool[] = [
			{
				name: 'item-changing',
				description: 'Unmarked at dispatch',
				inputSchema: { type: 'object' },
			},
		];
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
				return jsonResponse({ jsonrpc: '2.0', id: request.id, result: { tools: currentTools } });
			}
			return hang(request, init);
		});
		vi.stubGlobal('fetch', fetchMock);
		const client = await connect(50);

		const pending = client.call('item-changing', {});
		currentTools = [
			{
				name: 'item-changing',
				description: 'Later marked read-only',
				inputSchema: { type: 'object' },
				_meta: { mutation: false },
			},
		];
		await client.refreshTools();
		await vi.advanceTimersByTimeAsync(51);

		expect((await pending).error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'TIMEOUT' },
		});
	});

	it('handles a malformed tools/list result without throwing on a subsequent call failure', async () => {
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
				return jsonResponse({ jsonrpc: '2.0', id: request.id, result: {} });
			}
			throw new TypeError('socket hang up');
		});
		vi.stubGlobal('fetch', fetchMock);
		const client = await connect();

		expect(client.getTools()).toEqual([]);
		const result = await client.call('item-create', {});
		expect(result.error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'CONNECTION_ERROR' },
		});
	});

	it('keeps structured transport timeout errors on the OUTCOME_UNKNOWN path for call, batch and pipe', async () => {
		mockServer(async () => {
			throw timeoutError('item-create', 50);
		}, CALL_TOOLS);
		const client = await connect();

		const called = await client.call('item-create', {});
		expect(called.error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'TIMEOUT', operationName: 'item-create', timeoutMs: 50 },
		});

		const batched = await client.batch(commands);
		expect(batched.error).toMatchObject({
			code: 'OUTCOME_UNKNOWN',
			retryable: false,
			details: { cause: 'TIMEOUT' },
		});
		expect(batched.summary.failureCount).toBe(0);

		const piped = await client.pipe([{ command: 'item-create', input: {} }]);
		expect(piped.steps).toEqual([
			expect.objectContaining({
				index: -1,
				error: expect.objectContaining({ code: 'OUTCOME_UNKNOWN', retryable: false }),
			}),
		]);
	});

	it('maps calls before connect() to NOT_CONNECTED', async () => {
		const client = new McpClient({ url: 'http://localhost/message', transport: 'http' });

		const result = await client.call('item-create', {});

		expect(result.error).toMatchObject({ code: 'NOT_CONNECTED', retryable: false });
	});

	it('keeps a structured error thrown by a transport', async () => {
		mockServer(async () => {
			throw { code: 'CUSTOM', message: 'custom failure', suggestion: 'do the thing' };
		}, CALL_TOOLS);
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
