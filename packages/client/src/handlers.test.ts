/**
 * @fileoverview Tests for built-in WebSocket and SSE protocol handlers
 */

import type { HandoffResult } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtinHandlers, sseHandler, websocketHandler } from './handlers.js';
import { clearProtocolHandlers, connectHandoff, registerProtocolHandler } from './handoff.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════════

function createMockHandoff(overrides?: Partial<HandoffResult>): HandoffResult {
	return {
		protocol: 'websocket',
		endpoint: 'wss://example.com/socket',
		credentials: {
			token: 'test-token-123',
			sessionId: 'session-abc',
		},
		metadata: {
			expectedLatency: 50,
			capabilities: ['text'],
			expiresAt: new Date(Date.now() + 3600000).toISOString(),
		},
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Built-in Handler Registry
// ═══════════════════════════════════════════════════════════════════════════════

describe('builtinHandlers', () => {
	it('should contain websocket and sse handlers', () => {
		expect(builtinHandlers.has('websocket')).toBe(true);
		expect(builtinHandlers.has('sse')).toBe(true);
		expect(builtinHandlers.size).toBe(2);
	});

	it('should return the websocketHandler for websocket protocol', () => {
		expect(builtinHandlers.get('websocket')).toBe(websocketHandler);
	});

	it('should return the sseHandler for sse protocol', () => {
		expect(builtinHandlers.get('sse')).toBe(sseHandler);
	});

	it('should be read-only', () => {
		// builtinHandlers is ReadonlyMap — no set/delete at type level
		// Verify it has no set method at runtime
		expect(typeof (builtinHandlers as Map<string, unknown>).set).toBe('function');
		// The ReadonlyMap type prevents compile-time mutation; runtime is a regular Map
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: WebSocket Handler
// ═══════════════════════════════════════════════════════════════════════════════

describe('websocketHandler', () => {
	const originalWebSocket = globalThis.WebSocket;

	afterEach(() => {
		globalThis.WebSocket = originalWebSocket;
	});

	it('should throw when WebSocket is not available', async () => {
		// @ts-expect-error — removing WebSocket for test
		delete globalThis.WebSocket;

		const handoff = createMockHandoff();
		await expect(websocketHandler(handoff, {})).rejects.toThrow(
			'WebSocket is not available in this runtime'
		);
	});

	it('should connect using a mock WebSocket', async () => {
		const mockWs = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as ((event: unknown) => void) | null,
			onclose: null as ((event: { code: number; reason: string }) => void) | null,
			send: vi.fn(),
			close: vi.fn(),
		};

		// @ts-expect-error — mock WebSocket constructor
		globalThis.WebSocket = vi.fn(() => {
			// Defer onopen to next tick so the promise handler is set up
			setTimeout(() => {
				mockWs.onopen?.();
			}, 0);
			return mockWs;
		});

		const onConnect = vi.fn();
		const handoff = createMockHandoff();

		const connection = await websocketHandler(handoff, { onConnect });

		expect(connection.state).toBe('connected');
		expect(connection.protocol).toBe('websocket');
		expect(connection.endpoint).toBe('wss://example.com/socket');
		expect(onConnect).toHaveBeenCalledWith(mockWs);
	});

	it('should send auth token as first message after connection', async () => {
		const mockWs = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as ((event: unknown) => void) | null,
			onclose: null as ((event: { code: number; reason: string }) => void) | null,
			send: vi.fn(),
			close: vi.fn(),
		};

		// @ts-expect-error — mock WebSocket constructor
		globalThis.WebSocket = vi.fn((url: string) => {
			setTimeout(() => mockWs.onopen?.(), 0);
			return mockWs;
		});

		const handoff = createMockHandoff({
			credentials: { token: 'my-secret-token' },
		});

		await websocketHandler(handoff, {});

		expect(mockWs.send).toHaveBeenCalledWith(
			JSON.stringify({ type: 'auth', token: 'my-secret-token' })
		);
	});

	it('should forward messages via onMessage callback', async () => {
		const mockWs = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as ((event: unknown) => void) | null,
			onclose: null as ((event: { code: number; reason: string }) => void) | null,
			send: vi.fn(),
			close: vi.fn(),
		};

		// @ts-expect-error — mock WebSocket constructor
		globalThis.WebSocket = vi.fn(() => {
			setTimeout(() => mockWs.onopen?.(), 0);
			return mockWs;
		});

		const onMessage = vi.fn();
		await websocketHandler(createMockHandoff(), { onMessage });

		// Simulate incoming message
		mockWs.onmessage?.({ data: JSON.stringify({ type: 'chat', text: 'Hello' }) });

		expect(onMessage).toHaveBeenCalledWith({ type: 'chat', text: 'Hello' });
	});

	it('should forward non-JSON messages as raw strings', async () => {
		const mockWs = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as ((event: unknown) => void) | null,
			onclose: null as ((event: { code: number; reason: string }) => void) | null,
			send: vi.fn(),
			close: vi.fn(),
		};

		// @ts-expect-error — mock WebSocket constructor
		globalThis.WebSocket = vi.fn(() => {
			setTimeout(() => mockWs.onopen?.(), 0);
			return mockWs;
		});

		const onMessage = vi.fn();
		await websocketHandler(createMockHandoff(), { onMessage });

		mockWs.onmessage?.({ data: 'plain text message' });

		expect(onMessage).toHaveBeenCalledWith('plain text message');
	});

	it('should call onDisconnect when WebSocket closes', async () => {
		const mockWs = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as ((event: unknown) => void) | null,
			onclose: null as ((event: { code: number; reason: string }) => void) | null,
			send: vi.fn(),
			close: vi.fn(),
		};

		// @ts-expect-error — mock WebSocket constructor
		globalThis.WebSocket = vi.fn(() => {
			setTimeout(() => mockWs.onopen?.(), 0);
			return mockWs;
		});

		const onDisconnect = vi.fn();
		await websocketHandler(createMockHandoff(), { onDisconnect });

		mockWs.onclose?.({ code: 1000, reason: 'Normal closure' });

		expect(onDisconnect).toHaveBeenCalledWith(1000, 'Normal closure');
	});

	it('should reject on connection error during connecting phase', async () => {
		const mockWs = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as ((event: unknown) => void) | null,
			onclose: null as ((event: { code: number; reason: string }) => void) | null,
			send: vi.fn(),
			close: vi.fn(),
		};

		// @ts-expect-error — mock WebSocket constructor
		globalThis.WebSocket = vi.fn(() => {
			setTimeout(() => mockWs.onerror?.(new Event('error')), 0);
			return mockWs;
		});

		const onError = vi.fn();
		await expect(websocketHandler(createMockHandoff(), { onError })).rejects.toThrow(
			'WebSocket error'
		);
		expect(onError).toHaveBeenCalled();
	});

	it('should JSON-serialize data on send', async () => {
		const mockWs = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as ((event: unknown) => void) | null,
			onclose: null as ((event: { code: number; reason: string }) => void) | null,
			send: vi.fn(),
			close: vi.fn(),
		};

		// @ts-expect-error — mock WebSocket constructor
		globalThis.WebSocket = vi.fn(() => {
			setTimeout(() => mockWs.onopen?.(), 0);
			return mockWs;
		});

		const connection = await websocketHandler(createMockHandoff(), {});
		connection.send({ type: 'test' });

		expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
	});

	it('should throw when sending on non-connected state', async () => {
		const mockWs = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as ((event: unknown) => void) | null,
			onclose: null as ((event: { code: number; reason: string }) => void) | null,
			send: vi.fn(),
			close: vi.fn(),
		};

		// @ts-expect-error — mock WebSocket constructor
		globalThis.WebSocket = vi.fn(() => {
			setTimeout(() => mockWs.onopen?.(), 0);
			return mockWs;
		});

		const connection = await websocketHandler(createMockHandoff(), {});

		// Simulate close
		mockWs.onclose?.({ code: 1000, reason: 'test' });

		expect(() => connection.send({ test: true })).toThrow('WebSocket is not in connected state');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: SSE Handler
// ═══════════════════════════════════════════════════════════════════════════════

describe('sseHandler', () => {
	const originalEventSource = globalThis.EventSource;
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.EventSource = originalEventSource;
		globalThis.fetch = originalFetch;
	});

	it('should throw when neither EventSource nor fetch is available', async () => {
		// @ts-expect-error — removing for test
		delete globalThis.EventSource;
		// @ts-expect-error — removing for test
		delete globalThis.fetch;

		const handoff = createMockHandoff({
			protocol: 'sse',
			endpoint: 'https://example.com/events',
			credentials: undefined,
		});

		await expect(sseHandler(handoff, {})).rejects.toThrow(
			'EventSource is not available in this runtime'
		);
	});

	it('should use fetch-based SSE when token is present', async () => {
		// @ts-expect-error — removing for test
		delete globalThis.EventSource;

		// Use a deferred promise to keep the stream open until we're done asserting
		let resolveHold!: () => void;
		const holdPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
			resolveHold = () => resolve({ done: true, value: undefined });
		});

		const mockReader = {
			read: vi
				.fn()
				.mockResolvedValueOnce({
					done: false,
					value: new TextEncoder().encode('data: {"type":"hello"}\n\n'),
				})
				.mockReturnValueOnce(holdPromise),
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			body: { getReader: () => mockReader },
		}) as unknown as typeof fetch;

		const onConnect = vi.fn();
		const onMessage = vi.fn();

		const handoff = createMockHandoff({
			protocol: 'sse',
			endpoint: 'https://example.com/events',
			credentials: { token: 'my-token' },
		});

		const connection = await sseHandler(handoff, { onConnect, onMessage });

		expect(connection.state).toBe('connected');
		expect(connection.protocol).toBe('sse');
		expect(onConnect).toHaveBeenCalled();

		// Wait for read loop to process the first chunk
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(onMessage).toHaveBeenCalledWith({ type: 'hello' });

		// Release the stream to avoid dangling promise
		resolveHold();
	});

	it('should send Authorization header with fetch-based SSE', async () => {
		// @ts-expect-error — removing for test
		delete globalThis.EventSource;

		const mockReader = {
			read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			body: { getReader: () => mockReader },
		}) as unknown as typeof fetch;

		const handoff = createMockHandoff({
			protocol: 'sse',
			endpoint: 'https://example.com/events',
			credentials: { token: 'bearer-token-123' },
		});

		await sseHandler(handoff, {});

		expect(globalThis.fetch).toHaveBeenCalledWith(
			'https://example.com/events',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer bearer-token-123',
				}),
			})
		);
	});

	it('should throw on fetch failure', async () => {
		// @ts-expect-error — removing for test
		delete globalThis.EventSource;

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			body: null,
		}) as unknown as typeof fetch;

		const handoff = createMockHandoff({
			protocol: 'sse',
			endpoint: 'https://example.com/events',
			credentials: { token: 'bad-token' },
		});

		await expect(sseHandler(handoff, {})).rejects.toThrow('SSE connection failed with status 401');
	});

	it('SSE send() should throw read-only error', async () => {
		// @ts-expect-error — removing for test
		delete globalThis.EventSource;

		const mockReader = {
			read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			body: { getReader: () => mockReader },
		}) as unknown as typeof fetch;

		const handoff = createMockHandoff({
			protocol: 'sse',
			endpoint: 'https://example.com/events',
			credentials: { token: 'token' },
		});

		const connection = await sseHandler(handoff, {});

		expect(() => connection.send({ test: true })).toThrow('SSE connections are read-only');
	});

	it('should use EventSource when no credentials', async () => {
		const mockEventSource = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as (() => void) | null,
			close: vi.fn(),
		};

		// @ts-expect-error — mock EventSource constructor
		globalThis.EventSource = vi.fn(() => {
			setTimeout(() => mockEventSource.onopen?.(), 0);
			return mockEventSource;
		});

		const onConnect = vi.fn();
		const handoff = createMockHandoff({
			protocol: 'sse',
			endpoint: 'https://example.com/events',
			credentials: undefined,
		});

		const connection = await sseHandler(handoff, { onConnect });

		expect(connection.state).toBe('connected');
		expect(onConnect).toHaveBeenCalledWith(mockEventSource);
	});

	it('should forward EventSource messages via onMessage', async () => {
		const mockEventSource = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as (() => void) | null,
			close: vi.fn(),
		};

		// @ts-expect-error — mock EventSource constructor
		globalThis.EventSource = vi.fn(() => {
			setTimeout(() => mockEventSource.onopen?.(), 0);
			return mockEventSource;
		});

		const onMessage = vi.fn();
		const handoff = createMockHandoff({
			protocol: 'sse',
			endpoint: 'https://example.com/events',
			credentials: undefined,
		});

		await sseHandler(handoff, { onMessage });

		mockEventSource.onmessage?.({ data: JSON.stringify({ event: 'update' }) });

		expect(onMessage).toHaveBeenCalledWith({ event: 'update' });
	});

	it('should close EventSource on connection.close()', async () => {
		const mockEventSource = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as (() => void) | null,
			close: vi.fn(),
		};

		// @ts-expect-error — mock EventSource constructor
		globalThis.EventSource = vi.fn(() => {
			setTimeout(() => mockEventSource.onopen?.(), 0);
			return mockEventSource;
		});

		const handoff = createMockHandoff({
			protocol: 'sse',
			endpoint: 'https://example.com/events',
			credentials: undefined,
		});

		const connection = await sseHandler(handoff, {});
		connection.close();

		expect(mockEventSource.close).toHaveBeenCalled();
		expect(connection.state).toBe('disconnected');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: connectHandoff auto-selection
// ═══════════════════════════════════════════════════════════════════════════════

describe('connectHandoff built-in handler auto-selection', () => {
	beforeEach(() => {
		clearProtocolHandlers();
	});

	afterEach(() => {
		clearProtocolHandlers();
	});

	it('should fall back to built-in websocket handler when no custom registered', async () => {
		// Mock WebSocket for the built-in handler
		const mockWs = {
			onopen: null as (() => void) | null,
			onmessage: null as ((event: { data: string }) => void) | null,
			onerror: null as ((event: unknown) => void) | null,
			onclose: null as ((event: { code: number; reason: string }) => void) | null,
			send: vi.fn(),
			close: vi.fn(),
		};

		const originalWebSocket = globalThis.WebSocket;
		// @ts-expect-error — mock WebSocket constructor
		globalThis.WebSocket = vi.fn(() => {
			setTimeout(() => mockWs.onopen?.(), 0);
			return mockWs;
		});

		try {
			const handoff = createMockHandoff({ protocol: 'websocket' });
			const connection = await connectHandoff(handoff);

			expect(connection.state).toBe('connected');
			expect(connection.protocol).toBe('websocket');
		} finally {
			globalThis.WebSocket = originalWebSocket;
		}
	});

	it('should prefer custom handler over built-in', async () => {
		const customHandler = vi.fn(async (handoff: HandoffResult) => ({
			send: vi.fn(),
			close: vi.fn(),
			state: 'connected' as const,
			protocol: handoff.protocol,
			endpoint: handoff.endpoint,
		}));

		registerProtocolHandler('websocket', customHandler);

		const handoff = createMockHandoff({ protocol: 'websocket' });
		await connectHandoff(handoff);

		expect(customHandler).toHaveBeenCalled();
	});

	it('should list built-in protocols in error message for unsupported protocols', async () => {
		const handoff = createMockHandoff({ protocol: 'webrtc' });

		await expect(connectHandoff(handoff)).rejects.toThrow('websocket');
		await expect(connectHandoff(handoff)).rejects.toThrow('sse');
	});
});
