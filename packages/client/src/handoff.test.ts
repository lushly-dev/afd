/**
 * @fileoverview Tests for Handoff Protocol Handlers & Utilities
 *
 * These tests validate the protocol handler registry, handoff connections,
 * and reconnection logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	registerProtocolHandler,
	unregisterProtocolHandler,
	getProtocolHandler,
	hasProtocolHandler,
	listProtocolHandlers,
	clearProtocolHandlers,
	connectHandoff,
	createReconnectingHandoff,
	buildAuthenticatedEndpoint,
	parseHandoffEndpoint,
	isHandoffExpired,
	getHandoffTTL,
	isHandoff,
	isHandoffProtocol,
	type HandoffResult,
	type HandoffConnection,
	type ProtocolHandler,
} from './handoff.js';
import { DirectClient, type DirectRegistry } from './direct.js';
import type { CommandResult, CommandContext } from '@lushly-dev/afd-core';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a mock handoff result for testing.
 */
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
			capabilities: ['text', 'typing-indicator'],
			expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
			reconnect: {
				allowed: true,
				maxAttempts: 5,
				backoffMs: 1000,
			},
			description: 'Test chat connection',
		},
		...overrides,
	};
}

/**
 * Create a mock protocol handler that simulates a connection.
 */
function createMockHandler(options?: {
	simulateDelay?: number;
	simulateError?: Error;
	simulateDisconnect?: { code: number; reason: string; delay: number };
}): ProtocolHandler {
	return async (handoff, connectionOptions) => {
		if (options?.simulateDelay) {
			await new Promise((resolve) => setTimeout(resolve, options.simulateDelay));
		}

		if (options?.simulateError) {
			throw options.simulateError;
		}

		let state: 'connecting' | 'connected' | 'disconnected' = 'connected';
		let closed = false;

		// Simulate connection
		connectionOptions.onConnect?.(handoff);

		// Simulate auto-disconnect if configured
		if (options?.simulateDisconnect) {
			setTimeout(() => {
				if (!closed) {
					state = 'disconnected';
					connectionOptions.onDisconnect?.(
						options.simulateDisconnect!.code,
						options.simulateDisconnect!.reason
					);
				}
			}, options.simulateDisconnect.delay);
		}

		return {
			send: vi.fn((data) => {
				if (state !== 'connected') {
					throw new Error('Cannot send: connection closed');
				}
				// Simulate echo for testing
				connectionOptions.onMessage?.({ echo: data });
			}),
			close: vi.fn(() => {
				closed = true;
				state = 'disconnected';
				connectionOptions.onDisconnect?.(1000, 'Normal closure');
			}),
			get state() {
				return state;
			},
			protocol: handoff.protocol,
			endpoint: handoff.endpoint,
		};
	};
}

/**
 * Mock registry for reconnection tests.
 */
class MockReconnectRegistry implements DirectRegistry {
	public reconnectCalls = 0;
	public lastReconnectArgs?: Record<string, unknown>;

	async execute<T>(
		name: string,
		input?: unknown,
		_context?: CommandContext
	): Promise<CommandResult<T>> {
		const params = (input ?? {}) as Record<string, unknown>;

		if (name === 'chat-reconnect') {
			this.reconnectCalls++;
			this.lastReconnectArgs = params;

			const newHandoff: HandoffResult = {
				protocol: 'websocket',
				endpoint: 'wss://example.com/socket/reconnected',
				credentials: {
					token: `new-token-${this.reconnectCalls}`,
					sessionId: params.sessionId as string,
				},
				metadata: {
					reconnect: {
						allowed: true,
						maxAttempts: 5,
						backoffMs: 100,
					},
				},
			};

			return { success: true, data: newHandoff as T };
		}

		return {
			success: false,
			error: { code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${name}` },
		};
	}

	listCommandNames(): string[] {
		return ['chat-reconnect'];
	}

	listCommands(): Array<{ name: string; description: string }> {
		return [{ name: 'chat-reconnect', description: 'Reconnect to chat' }];
	}

	hasCommand(name: string): boolean {
		return name === 'chat-reconnect';
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Protocol Handler Registry
// ═══════════════════════════════════════════════════════════════════════════════

describe('Protocol Handler Registry', () => {
	beforeEach(() => {
		clearProtocolHandlers();
	});

	afterEach(() => {
		clearProtocolHandlers();
	});

	describe('registerProtocolHandler', () => {
		it('should register a protocol handler', () => {
			const handler = createMockHandler();
			registerProtocolHandler('websocket', handler);

			expect(hasProtocolHandler('websocket')).toBe(true);
			expect(getProtocolHandler('websocket')).toBe(handler);
		});

		it('should override existing handler', () => {
			const handler1 = createMockHandler();
			const handler2 = createMockHandler();

			registerProtocolHandler('websocket', handler1);
			registerProtocolHandler('websocket', handler2);

			expect(getProtocolHandler('websocket')).toBe(handler2);
		});

		it('should support multiple protocols', () => {
			const wsHandler = createMockHandler();
			const sseHandler = createMockHandler();

			registerProtocolHandler('websocket', wsHandler);
			registerProtocolHandler('sse', sseHandler);

			expect(hasProtocolHandler('websocket')).toBe(true);
			expect(hasProtocolHandler('sse')).toBe(true);
			expect(listProtocolHandlers()).toEqual(['websocket', 'sse']);
		});
	});

	describe('unregisterProtocolHandler', () => {
		it('should remove a registered handler', () => {
			registerProtocolHandler('websocket', createMockHandler());

			const result = unregisterProtocolHandler('websocket');

			expect(result).toBe(true);
			expect(hasProtocolHandler('websocket')).toBe(false);
		});

		it('should return false for non-existent handler', () => {
			const result = unregisterProtocolHandler('nonexistent');

			expect(result).toBe(false);
		});
	});

	describe('listProtocolHandlers', () => {
		it('should return empty array when no handlers registered', () => {
			expect(listProtocolHandlers()).toEqual([]);
		});

		it('should return all registered protocols', () => {
			registerProtocolHandler('websocket', createMockHandler());
			registerProtocolHandler('sse', createMockHandler());
			registerProtocolHandler('webrtc', createMockHandler());

			expect(listProtocolHandlers()).toContain('websocket');
			expect(listProtocolHandlers()).toContain('sse');
			expect(listProtocolHandlers()).toContain('webrtc');
		});
	});

	describe('clearProtocolHandlers', () => {
		it('should remove all handlers', () => {
			registerProtocolHandler('websocket', createMockHandler());
			registerProtocolHandler('sse', createMockHandler());

			clearProtocolHandlers();

			expect(listProtocolHandlers()).toEqual([]);
			expect(hasProtocolHandler('websocket')).toBe(false);
			expect(hasProtocolHandler('sse')).toBe(false);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: connectHandoff
// ═══════════════════════════════════════════════════════════════════════════════

describe('connectHandoff', () => {
	beforeEach(() => {
		clearProtocolHandlers();
	});

	afterEach(() => {
		clearProtocolHandlers();
	});

	it('should connect using registered protocol handler', async () => {
		const handler = createMockHandler();
		registerProtocolHandler('websocket', handler);

		const handoff = createMockHandoff();
		const onConnect = vi.fn();

		const connection = await connectHandoff(handoff, { onConnect });

		expect(connection.protocol).toBe('websocket');
		expect(connection.endpoint).toBe('wss://example.com/socket');
		expect(connection.state).toBe('connected');
		expect(onConnect).toHaveBeenCalledWith(handoff);
	});

	it('should throw error for unregistered protocol', async () => {
		const handoff = createMockHandoff({ protocol: 'unknown' });

		await expect(connectHandoff(handoff)).rejects.toThrow(
			"No protocol handler registered for 'unknown'"
		);
	});

	it('should call onMessage when messages are received', async () => {
		registerProtocolHandler('websocket', createMockHandler());

		const handoff = createMockHandoff();
		const onMessage = vi.fn();

		const connection = await connectHandoff(handoff, { onMessage });

		// Send triggers echo in mock handler
		connection.send({ type: 'test' });

		expect(onMessage).toHaveBeenCalledWith({ echo: { type: 'test' } });
	});

	it('should call onDisconnect when connection closes', async () => {
		registerProtocolHandler('websocket', createMockHandler());

		const handoff = createMockHandoff();
		const onDisconnect = vi.fn();

		const connection = await connectHandoff(handoff, { onDisconnect });
		connection.close();

		expect(onDisconnect).toHaveBeenCalledWith(1000, 'Normal closure');
	});

	it('should propagate handler errors', async () => {
		const error = new Error('Connection failed');
		registerProtocolHandler('websocket', createMockHandler({ simulateError: error }));

		const handoff = createMockHandoff();

		await expect(connectHandoff(handoff)).rejects.toThrow('Connection failed');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: createReconnectingHandoff
// ═══════════════════════════════════════════════════════════════════════════════

describe('createReconnectingHandoff', () => {
	let mockRegistry: MockReconnectRegistry;
	let client: DirectClient;

	beforeEach(() => {
		clearProtocolHandlers();
		mockRegistry = new MockReconnectRegistry();
		client = new DirectClient(mockRegistry);

		// Register a mock handler that tracks connections
		registerProtocolHandler('websocket', createMockHandler());
	});

	afterEach(() => {
		clearProtocolHandlers();
	});

	it('should establish initial connection', async () => {
		const handoff = createMockHandoff();
		const onConnect = vi.fn();

		const connection = await createReconnectingHandoff(client, handoff, {
			onConnect,
		});

		expect(connection.state).toBe('connected');
		expect(connection.isReconnecting).toBe(false);
		expect(connection.reconnectAttempt).toBe(0);
		expect(onConnect).toHaveBeenCalled();
	});

	it('should send messages when connected', async () => {
		const handoff = createMockHandoff();
		const onMessage = vi.fn();

		const connection = await createReconnectingHandoff(client, handoff, {
			onMessage,
		});

		connection.send({ type: 'test', text: 'hello' });

		expect(onMessage).toHaveBeenCalledWith({
			echo: { type: 'test', text: 'hello' },
		});
	});

	it('should close connection and stop reconnection', async () => {
		const handoff = createMockHandoff();
		const onDisconnect = vi.fn();

		const connection = await createReconnectingHandoff(client, handoff, {
			onDisconnect,
		});

		connection.close();

		expect(connection.state).toBe('disconnected');
		expect(onDisconnect).toHaveBeenCalled();
	});

	it('should use metadata reconnect settings', async () => {
		const handoff = createMockHandoff({
			metadata: {
				reconnect: {
					allowed: true,
					maxAttempts: 3,
					backoffMs: 100,
				},
			},
		});

		const connection = await createReconnectingHandoff(client, handoff, {});

		// Connection should be established
		expect(connection.state).toBe('connected');
	});

	it('should throw when sending on disconnected connection', async () => {
		const handoff = createMockHandoff();

		const connection = await createReconnectingHandoff(client, handoff, {});
		connection.close();

		expect(() => connection.send({ test: true })).toThrow(
			'Cannot send: connection not in connected state'
		);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Type Guards
// ═══════════════════════════════════════════════════════════════════════════════

describe('Type Guards', () => {
	describe('isHandoff', () => {
		it('should return true for valid handoff', () => {
			const handoff = createMockHandoff();
			expect(isHandoff(handoff)).toBe(true);
		});

		it('should return true for minimal handoff', () => {
			const handoff = {
				protocol: 'websocket',
				endpoint: 'wss://example.com',
			};
			expect(isHandoff(handoff)).toBe(true);
		});

		it('should return false for null', () => {
			expect(isHandoff(null)).toBe(false);
		});

		it('should return false for undefined', () => {
			expect(isHandoff(undefined)).toBe(false);
		});

		it('should return false for non-object', () => {
			expect(isHandoff('string')).toBe(false);
			expect(isHandoff(123)).toBe(false);
			expect(isHandoff(true)).toBe(false);
		});

		it('should return false for missing protocol', () => {
			expect(isHandoff({ endpoint: 'wss://example.com' })).toBe(false);
		});

		it('should return false for missing endpoint', () => {
			expect(isHandoff({ protocol: 'websocket' })).toBe(false);
		});

		it('should return false for empty protocol', () => {
			expect(isHandoff({ protocol: '', endpoint: 'wss://example.com' })).toBe(false);
		});

		it('should return false for empty endpoint', () => {
			expect(isHandoff({ protocol: 'websocket', endpoint: '' })).toBe(false);
		});
	});

	describe('isHandoffProtocol', () => {
		it('should return true for matching protocol', () => {
			const handoff = createMockHandoff({ protocol: 'websocket' });
			expect(isHandoffProtocol(handoff, 'websocket')).toBe(true);
		});

		it('should return false for non-matching protocol', () => {
			const handoff = createMockHandoff({ protocol: 'websocket' });
			expect(isHandoffProtocol(handoff, 'sse')).toBe(false);
		});

		it('should work with custom protocols', () => {
			const handoff = createMockHandoff({ protocol: 'custom-protocol' });
			expect(isHandoffProtocol(handoff, 'custom-protocol')).toBe(true);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: Helper Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Helper Functions', () => {
	describe('buildAuthenticatedEndpoint', () => {
		it('should return original endpoint without credentials', () => {
			const result = buildAuthenticatedEndpoint('wss://example.com/socket');
			expect(result).toBe('wss://example.com/socket');
		});

		it('should return original endpoint without token', () => {
			const result = buildAuthenticatedEndpoint('wss://example.com/socket', {});
			expect(result).toBe('wss://example.com/socket');
		});

		it('should append token as query parameter', () => {
			const result = buildAuthenticatedEndpoint('wss://example.com/socket', {
				token: 'my-token-123',
			});
			expect(result).toBe('wss://example.com/socket?token=my-token-123');
		});

		it('should preserve existing query parameters', () => {
			const result = buildAuthenticatedEndpoint(
				'wss://example.com/socket?room=123',
				{ token: 'my-token-123' }
			);
			expect(result).toBe('wss://example.com/socket?room=123&token=my-token-123');
		});

		it('should URL-encode token', () => {
			const result = buildAuthenticatedEndpoint('wss://example.com/socket', {
				token: 'token with spaces & special=chars',
			});
			expect(result).toContain('token=token+with+spaces');
		});
	});

	describe('parseHandoffEndpoint', () => {
		it('should parse WebSocket URL', () => {
			const result = parseHandoffEndpoint('ws://example.com:8080/socket');
			expect(result).toEqual({
				protocol: 'ws',
				host: 'example.com',
				port: 8080,
				path: '/socket',
				secure: false,
			});
		});

		it('should parse secure WebSocket URL', () => {
			const result = parseHandoffEndpoint('wss://example.com/socket');
			expect(result).toEqual({
				protocol: 'wss',
				host: 'example.com',
				port: null,
				path: '/socket',
				secure: true,
			});
		});

		it('should parse HTTPS URL', () => {
			const result = parseHandoffEndpoint('https://example.com/events');
			expect(result).toEqual({
				protocol: 'https',
				host: 'example.com',
				port: null,
				path: '/events',
				secure: true,
			});
		});

		it('should include query string in path', () => {
			const result = parseHandoffEndpoint('wss://example.com/socket?room=123&user=456');
			expect(result.path).toBe('/socket?room=123&user=456');
		});
	});

	describe('isHandoffExpired', () => {
		it('should return false when no expiration', () => {
			const handoff = createMockHandoff({
				metadata: { capabilities: ['test'] },
			});
			delete handoff.metadata!.expiresAt;

			expect(isHandoffExpired(handoff)).toBe(false);
		});

		it('should return false when not expired', () => {
			const handoff = createMockHandoff({
				metadata: {
					expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
				},
			});

			expect(isHandoffExpired(handoff)).toBe(false);
		});

		it('should return true when expired', () => {
			const handoff = createMockHandoff({
				metadata: {
					expiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
				},
			});

			expect(isHandoffExpired(handoff)).toBe(true);
		});
	});

	describe('getHandoffTTL', () => {
		it('should return null when no expiration', () => {
			const handoff = createMockHandoff({
				metadata: { capabilities: ['test'] },
			});
			delete handoff.metadata!.expiresAt;

			expect(getHandoffTTL(handoff)).toBeNull();
		});

		it('should return positive TTL for future expiration', () => {
			const expireTime = Date.now() + 3600000; // 1 hour from now
			const handoff = createMockHandoff({
				metadata: {
					expiresAt: new Date(expireTime).toISOString(),
				},
			});

			const ttl = getHandoffTTL(handoff);
			expect(ttl).not.toBeNull();
			// Allow some tolerance for execution time
			expect(ttl!).toBeGreaterThan(3590000);
			expect(ttl!).toBeLessThanOrEqual(3600000);
		});

		it('should return 0 for expired handoff', () => {
			const handoff = createMockHandoff({
				metadata: {
					expiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
				},
			});

			expect(getHandoffTTL(handoff)).toBe(0);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS: DirectClient Integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('DirectClient Handoff Integration', () => {
	let mockRegistry: MockReconnectRegistry;
	let client: DirectClient;

	beforeEach(() => {
		clearProtocolHandlers();
		mockRegistry = new MockReconnectRegistry();
		client = new DirectClient(mockRegistry);

		registerProtocolHandler('websocket', createMockHandler());
	});

	afterEach(() => {
		clearProtocolHandlers();
	});

	it('should connect via client.connectHandoff', async () => {
		const handoff = createMockHandoff();
		const onConnect = vi.fn();

		const connection = await client.connectHandoff(handoff, { onConnect });

		expect(connection.state).toBe('connected');
		expect(onConnect).toHaveBeenCalled();
	});

	it('should create reconnecting handoff via client', async () => {
		const handoff = createMockHandoff();
		const onConnect = vi.fn();

		const connection = await client.createReconnectingHandoff(handoff, {
			onConnect,
		});

		expect(connection.state).toBe('connected');
		expect(connection.isReconnecting).toBe(false);
		expect(onConnect).toHaveBeenCalled();
	});
});
