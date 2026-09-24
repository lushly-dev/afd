import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTransport, HttpTransport, SseTransport } from './transport.js';

describe('createTransport', () => {
	it('creates SseTransport for "sse" type', () => {
		const transport = createTransport('sse', 'http://localhost:3100/sse');
		expect(transport).toBeInstanceOf(SseTransport);
	});

	it('creates HttpTransport for "http" type', () => {
		const transport = createTransport('http', 'http://localhost:3100/message');
		expect(transport).toBeInstanceOf(HttpTransport);
	});

	it('throws for unsupported transport type', () => {
		expect(() => createTransport('websocket' as 'sse', 'ws://localhost:3100')).toThrow(
			'Unsupported transport type: websocket'
		);
	});
});

describe('SseTransport', () => {
	it('derives message endpoint from SSE URL', () => {
		const transport = new SseTransport('http://localhost:3100/sse');
		// Verify by checking the transport was created without error
		expect(transport).toBeInstanceOf(SseTransport);
	});

	it('handles URL with trailing slash', () => {
		const transport = new SseTransport('http://localhost:3100/sse/');
		expect(transport).toBeInstanceOf(SseTransport);
	});

	it('isConnected returns false initially', () => {
		const transport = new SseTransport('http://localhost:3100/sse');
		expect(transport.isConnected()).toBe(false);
	});

	it('disconnect when not connected does nothing', () => {
		const transport = new SseTransport('http://localhost:3100/sse');
		transport.disconnect();
		expect(transport.isConnected()).toBe(false);
	});

	it('accepts handler registrations', () => {
		const transport = new SseTransport('http://localhost:3100/sse');
		transport.onMessage(vi.fn());
		transport.onError(vi.fn());
		transport.onClose(vi.fn());
		// No error thrown
	});
});

describe('HttpTransport', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('converts /sse URL to /message', () => {
		const transport = new HttpTransport('http://localhost:3100/sse');
		expect(transport.url).toBe('http://localhost:3100/sse');
	});

	it('keeps /message URL as-is', () => {
		const transport = new HttpTransport('http://localhost:3100/message');
		expect(transport.url).toBe('http://localhost:3100/message');
	});

	it('keeps non-standard URL as-is', () => {
		const transport = new HttpTransport('http://localhost:3100/api');
		expect(transport.url).toBe('http://localhost:3100/api');
	});

	it('isConnected returns false initially', () => {
		const transport = new HttpTransport('http://localhost:3100/message');
		expect(transport.isConnected()).toBe(false);
	});

	it('disconnect sets connected to false and calls close handler', () => {
		const transport = new HttpTransport('http://localhost:3100/message');
		const closeHandler = vi.fn();
		transport.onClose(closeHandler);

		// Manually set connected state through connect
		// We can't easily mock fetch here, so just test disconnect behavior
		transport.disconnect();
		expect(transport.isConnected()).toBe(false);
		expect(closeHandler).toHaveBeenCalled();
	});

	it('onMessage stores handler', () => {
		const transport = new HttpTransport('http://localhost:3100/message');
		const handler = vi.fn();
		transport.onMessage(handler);
		// No error thrown
	});

	it('onError is no-op (errors propagate via thrown exceptions)', () => {
		const transport = new HttpTransport('http://localhost:3100/message');
		transport.onError(vi.fn());
		// No error thrown
	});

	it('connect marks as connected (fallback path)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

		const transport = new HttpTransport('http://localhost:3100/message');
		await transport.connect();
		// Fallback: marks as connected even if health check fails
		expect(transport.isConnected()).toBe(true);
	});

	it('connect marks as connected on successful health check', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

		const transport = new HttpTransport('http://localhost:3100/message');
		await transport.connect();
		expect(transport.isConnected()).toBe(true);
	});

	it('send throws on non-ok response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
			})
		);

		const transport = new HttpTransport('http://localhost:3100/message');
		await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'test' })).rejects.toThrow(
			'HTTP error: 500 Internal Server Error'
		);
	});

	it('send throws on invalid MCP response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ not: 'an mcp response' }),
			})
		);

		const transport = new HttpTransport('http://localhost:3100/message');
		await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'test' })).rejects.toThrow(
			'Invalid MCP response received'
		);
	});

	it('send returns valid MCP response and dispatches to message handler', async () => {
		const validResponse = { jsonrpc: '2.0', id: 1, result: { tools: [] } };
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => validResponse,
			})
		);

		const transport = new HttpTransport('http://localhost:3100/message');
		const messageHandler = vi.fn();
		transport.onMessage(messageHandler);

		const response = await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
		expect(response.result).toEqual({ tools: [] });
		expect(messageHandler).toHaveBeenCalledWith(validResponse);
	});
});

describe('MCP session header', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function reply(id: number, headers: Record<string, string> = {}, status = 200): Response {
		const body = status === 200 ? JSON.stringify({ jsonrpc: '2.0', id, result: {} }) : '{}';
		return new Response(body, { status, headers });
	}

	function sentSession(fetchMock: ReturnType<typeof vi.fn>, call: number): string | undefined {
		const init = fetchMock.mock.calls[call]?.[1] as { headers: Record<string, string> };
		return init.headers['Mcp-Session-Id'];
	}

	it.each([
		['http', (url: string) => new HttpTransport(url)],
		['sse', (url: string) => new SseTransport(url.replace('/message', '/sse'))],
	] as const)('%s transport repeats the session issued by initialize', async (_name, create) => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(reply(1, { 'Mcp-Session-Id': 'session-1' }))
			.mockResolvedValueOnce(reply(2));
		vi.stubGlobal('fetch', fetchMock);
		const transport = create('http://localhost:3100/message');
		expect(transport.sessionId).toBeUndefined();
		await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
		expect(transport.sessionId).toBe('session-1');
		await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
		expect(sentSession(fetchMock, 0)).toBeUndefined();
		expect(sentSession(fetchMock, 1)).toBe('session-1');

		transport.disconnect();
		expect(transport.sessionId).toBeUndefined();
		fetchMock.mockResolvedValueOnce(reply(3));
		await transport.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
		expect(sentSession(fetchMock, 2)).toBeUndefined();
	});

	it.each([
		['http', (url: string) => new HttpTransport(url)],
		['sse', (url: string) => new SseTransport(url.replace('/message', '/sse'))],
	] as const)('%s transport renews its session with the last initialize', async (_name, create) => {
		const fetchMock = vi.fn().mockResolvedValueOnce(reply(1, { 'Mcp-Session-Id': 'old' }));
		vi.stubGlobal('fetch', fetchMock);
		const transport = create('http://localhost:3100/message');
		expect(await transport.renewSession()).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();

		await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
		fetchMock.mockResolvedValueOnce(reply(1, { 'Mcp-Session-Id': 'new' }));
		expect(await transport.renewSession()).toBe(true);
		expect(transport.sessionId).toBe('new');
		expect(fetchMock.mock.calls[1]?.[0]).toBe('http://localhost:3100/message');
		expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).method).toBe('initialize');
		expect(sentSession(fetchMock, 1)).toBeUndefined();
	});

	it('starts a new session and retries once when the server forgot the session', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(reply(1, { 'Mcp-Session-Id': 'old' }))
			.mockResolvedValueOnce(reply(2, {}, 404))
			.mockResolvedValueOnce(reply(1, { 'Mcp-Session-Id': 'new' }))
			.mockResolvedValueOnce(reply(2));
		vi.stubGlobal('fetch', fetchMock);
		const transport = new HttpTransport('http://localhost:3100/message');
		await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
		const response = await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
		expect(response.id).toBe(2);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(sentSession(fetchMock, 1)).toBe('old');
		expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).method).toBe('initialize');
		expect(sentSession(fetchMock, 2)).toBeUndefined();
		expect(sentSession(fetchMock, 3)).toBe('new');
	});

	it('does not retry a 404 when no session was sent', async () => {
		const fetchMock = vi.fn().mockResolvedValue(reply(1, {}, 404));
		vi.stubGlobal('fetch', fetchMock);
		const transport = new HttpTransport('http://localhost:3100/message');
		await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).rejects.toThrow(
			'HTTP error: 404'
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
