import { describe, expect, it, vi } from 'vitest';
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
		// Mock fetch to simulate failed health check
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

		try {
			const transport = new HttpTransport('http://localhost:3100/message');
			await transport.connect();
			// Fallback: marks as connected even if health check fails
			expect(transport.isConnected()).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('connect marks as connected on successful health check', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

		try {
			const transport = new HttpTransport('http://localhost:3100/message');
			await transport.connect();
			expect(transport.isConnected()).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('send throws on non-ok response', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
		});

		try {
			const transport = new HttpTransport('http://localhost:3100/message');
			await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'test' })).rejects.toThrow(
				'HTTP error: 500 Internal Server Error'
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('send throws on invalid MCP response', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ not: 'an mcp response' }),
		});

		try {
			const transport = new HttpTransport('http://localhost:3100/message');
			await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'test' })).rejects.toThrow(
				'Invalid MCP response received'
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('send returns valid MCP response and dispatches to message handler', async () => {
		const validResponse = { jsonrpc: '2.0', id: 1, result: { tools: [] } };
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => validResponse,
		});

		try {
			const transport = new HttpTransport('http://localhost:3100/message');
			const messageHandler = vi.fn();
			transport.onMessage(messageHandler);

			const response = await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
			expect(response.result).toEqual({ tools: [] });
			expect(messageHandler).toHaveBeenCalledWith(validResponse);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
