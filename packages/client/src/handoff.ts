// afd-override: max-lines=700 — single-module cohesion: registry + connectHandoff + reconnection + helpers
/**
 * @fileoverview Handoff Protocol Handlers & Utilities
 *
 * This module provides utilities for handling AFD handoff results, allowing
 * clients to connect to streaming protocols (WebSocket, SSE, WebRTC, etc.)
 * returned by handoff commands.
 *
 * @example Basic usage
 * ```typescript
 * import { DirectClient, isHandoff, connectHandoff } from '@afd/client';
 *
 * const result = await client.call<HandoffResult>('chat-connect', { roomId });
 *
 * if (result.success && isHandoff(result.data)) {
 *   const connection = await connectHandoff(result.data, {
 *     onConnect: () => console.log('Connected!'),
 *     onMessage: (msg) => console.log('Message:', msg),
 *     onDisconnect: () => console.log('Disconnected'),
 *   });
 *
 *   connection.send({ type: 'message', text: 'Hello!' });
 * }
 * ```
 *
 * @example Protocol handlers
 * ```typescript
 * import { registerProtocolHandler } from '@afd/client';
 *
 * // Register a custom WebSocket handler
 * registerProtocolHandler('websocket', async (handoff, options) => {
 *   const ws = new WebSocket(handoff.endpoint);
 *   // ... setup handlers
 *   return { send: (data) => ws.send(data), close: () => ws.close() };
 * });
 * ```
 */

import type {
	CommandResult,
	HandoffCredentials,
	HandoffMetadata,
	HandoffProtocol,
	HandoffResult,
} from '@lushly-dev/afd-core';
import { isHandoff, isHandoffProtocol } from '@lushly-dev/afd-core';
import { backoffDelay, CancellableDelay } from './backoff.js';
import { builtinHandlers } from './handlers.js';

export type { HandoffCredentials, HandoffMetadata, HandoffProtocol, HandoffResult };
// Re-export core types and guards for convenience
export { isHandoff, isHandoffProtocol };

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connection state for handoff connections.
 */
export type HandoffConnectionState =
	| 'connecting'
	| 'connected'
	| 'reconnecting'
	| 'disconnected'
	| 'failed';

/**
 * Represents an active connection to a handoff endpoint.
 */
export interface HandoffConnection {
	/**
	 * Send data through the connection.
	 * @param data - Data to send (will be JSON-serialized)
	 */
	send(data: unknown): void;

	/**
	 * Close the connection.
	 */
	close(): void;

	/**
	 * Get the current connection state.
	 */
	readonly state: HandoffConnectionState;

	/**
	 * The protocol of this connection.
	 */
	readonly protocol: HandoffProtocol;

	/**
	 * The endpoint URL of this connection.
	 */
	readonly endpoint: string;
}

/**
 * Options for connecting to a handoff endpoint.
 */
export interface HandoffConnectionOptions {
	/**
	 * Called when the connection is established.
	 * @param connection - The underlying connection (protocol-specific)
	 */
	onConnect?: (connection: unknown) => void;

	/**
	 * Called when a message is received.
	 * @param message - Parsed message data
	 */
	onMessage?: (message: unknown) => void;

	/**
	 * Called when the connection is closed.
	 * @param code - Close code (if available)
	 * @param reason - Close reason (if available)
	 */
	onDisconnect?: (code?: number, reason?: string) => void;

	/**
	 * Called when an error occurs.
	 * @param error - Error object
	 */
	onError?: (error: Error) => void;

	/**
	 * Called when connection state changes.
	 * @param state - New connection state
	 */
	onStateChange?: (state: HandoffConnectionState) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROTOCOL HANDLER TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handler function for a specific protocol.
 *
 * Protocol handlers are responsible for:
 * 1. Establishing the connection to the endpoint
 * 2. Handling authentication with credentials
 * 3. Managing the connection lifecycle
 * 4. Translating protocol-specific events to HandoffConnectionOptions callbacks
 */
export type ProtocolHandler = (
	handoff: HandoffResult,
	options: HandoffConnectionOptions
) => Promise<HandoffConnection>;

/**
 * Internal protocol handler registry.
 */
const protocolHandlers = new Map<string, ProtocolHandler>();

// ═══════════════════════════════════════════════════════════════════════════════
// PROTOCOL HANDLER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Register a protocol handler for a specific protocol type.
 *
 * @param protocol - The protocol identifier (e.g., 'websocket', 'sse', 'webrtc')
 * @param handler - The handler function to call when connecting to this protocol
 *
 * @example Browser WebSocket handler
 * ```typescript
 * registerProtocolHandler('websocket', async (handoff, options) => {
 *   const ws = new WebSocket(handoff.endpoint);
 *
 *   ws.onopen = () => {
 *     if (handoff.credentials?.token) {
 *       ws.send(JSON.stringify({ type: 'auth', token: handoff.credentials.token }));
 *     }
 *     options.onConnect?.(ws);
 *   };
 *
 *   ws.onmessage = (event) => {
 *     options.onMessage?.(JSON.parse(event.data));
 *   };
 *
 *   ws.onclose = (event) => {
 *     options.onDisconnect?.(event.code, event.reason);
 *   };
 *
 *   return {
 *     send: (data) => ws.send(JSON.stringify(data)),
 *     close: () => ws.close(),
 *     state: 'connected',
 *     protocol: handoff.protocol,
 *     endpoint: handoff.endpoint,
 *   };
 * });
 * ```
 */
export function registerProtocolHandler(protocol: string, handler: ProtocolHandler): void {
	protocolHandlers.set(protocol, handler);
}

/**
 * Unregister a protocol handler.
 *
 * @param protocol - The protocol identifier to unregister
 * @returns True if a handler was removed, false if none existed
 */
export function unregisterProtocolHandler(protocol: string): boolean {
	return protocolHandlers.delete(protocol);
}

/**
 * Get a registered protocol handler.
 *
 * @param protocol - The protocol identifier
 * @returns The handler function or undefined if not registered
 */
export function getProtocolHandler(protocol: string): ProtocolHandler | undefined {
	return protocolHandlers.get(protocol);
}

/**
 * Check if a protocol handler is registered.
 *
 * @param protocol - The protocol identifier
 * @returns True if a handler is registered
 */
export function hasProtocolHandler(protocol: string): boolean {
	return protocolHandlers.has(protocol);
}

/**
 * List all registered protocol handlers.
 *
 * @returns Array of registered protocol identifiers
 */
export function listProtocolHandlers(): string[] {
	return Array.from(protocolHandlers.keys());
}

/**
 * Clear all registered protocol handlers.
 * Useful for testing or resetting state.
 */
export function clearProtocolHandlers(): void {
	protocolHandlers.clear();
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDOFF CONNECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connect to a handoff endpoint using the appropriate protocol handler.
 *
 * @param handoff - The handoff result from a command
 * @param options - Connection options and callbacks
 * @returns A promise that resolves to a HandoffConnection
 * @throws Error if no handler is registered for the protocol
 *
 * @example
 * ```typescript
 * const result = await client.call<HandoffResult>('chat-connect', { roomId: 'room-123' });
 *
 * if (result.success && result.data) {
 *   const connection = await connectHandoff(result.data, {
 *     onConnect: () => console.log('Connected!'),
 *     onMessage: (msg) => console.log('Message:', msg),
 *     onDisconnect: (code, reason) => console.log('Disconnected:', code),
 *   });
 *
 *   connection.send({ type: 'message', text: 'Hello!' });
 *
 *   // Later: close
 *   connection.close();
 * }
 * ```
 */
export async function connectHandoff(
	handoff: HandoffResult,
	options: HandoffConnectionOptions = {}
): Promise<HandoffConnection> {
	// Prefer custom-registered handlers over built-in defaults
	const handler = protocolHandlers.get(handoff.protocol) ?? builtinHandlers.get(handoff.protocol);

	if (!handler) {
		const available = [
			...listProtocolHandlers(),
			...Array.from(builtinHandlers.keys()).filter((k) => !protocolHandlers.has(k)),
		];

		throw new Error(
			`No protocol handler registered for '${handoff.protocol}'. ` +
				`Available protocols: ${available.join(', ') || 'none'}. ` +
				`Register a handler with registerProtocolHandler('${handoff.protocol}', handler).`
		);
	}

	return handler(handoff, options);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECONNECTION HELPER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for creating a reconnecting handoff connection.
 */
export interface ReconnectionOptions extends HandoffConnectionOptions {
	/**
	 * Command to call for reconnection.
	 * This command should return a new HandoffResult.
	 */
	reconnectCommand?: string;

	/**
	 * Arguments to pass to the reconnect command.
	 */
	reconnectArgs?: Record<string, unknown>;

	/**
	 * Session ID for reconnection (extracted from original handoff credentials).
	 */
	sessionId?: string;

	/**
	 * Maximum number of reconnection attempts.
	 * @default 5
	 */
	maxAttempts?: number;

	/**
	 * Base backoff time in milliseconds.
	 * @default 1000
	 */
	backoffMs?: number;

	/**
	 * Maximum backoff time in milliseconds.
	 * @default 30000
	 */
	maxBackoffMs?: number;

	/**
	 * Called when a reconnection attempt starts.
	 * @param attempt - Current attempt number (1-based)
	 */
	onReconnect?: (attempt: number) => void;

	/**
	 * Called when all reconnection attempts have failed.
	 */
	onReconnectFailed?: () => void;
}

/**
 * The client `createReconnectingHandoff()` calls `reconnectCommand` with. Both `McpClient` and
 * `DirectClient` satisfy it.
 */
export interface HandoffCommandClient {
	call(name: string, args?: Record<string, unknown>): Promise<CommandResult<unknown>>;
}

/**
 * Represents a reconnecting handoff connection with automatic retry logic.
 */
export interface ReconnectingHandoffConnection extends HandoffConnection {
	/**
	 * Current reconnection attempt number (0 if not reconnecting).
	 */
	readonly reconnectAttempt: number;

	/**
	 * Whether the connection is currently attempting to reconnect.
	 */
	readonly isReconnecting: boolean;

	/**
	 * Manually trigger a reconnection.
	 */
	reconnect(): Promise<void>;
}

/**
 * Create a reconnecting handoff connection with automatic retry logic.
 *
 * This helper wraps a standard handoff connection and adds:
 * - Automatic reconnection on disconnect
 * - Exponential backoff between attempts
 * - Session resumption via reconnect command
 *
 * If the initial connection fails, the promise rejects and nothing keeps running: the
 * connection is closed, so late events from the failed attempt (such as a browser WebSocket's
 * `close` after its `error`) cannot start a reconnect loop.
 *
 * @param client - The client (`McpClient` or `DirectClient`) that runs `reconnectCommand`
 * @param handoff - The initial handoff result
 * @param options - Reconnection options and callbacks
 * @returns A promise that resolves to a ReconnectingHandoffConnection
 *
 * @example
 * ```typescript
 * const result = await client.call<HandoffResult>('chat-connect', { roomId: 'room-123' });
 *
 * if (result.success && result.data) {
 *   const connection = await createReconnectingHandoff(client, result.data, {
 *     reconnectCommand: 'chat-reconnect',
 *     sessionId: result.data.credentials?.sessionId,
 *
 *     onConnect: () => console.log('Connected'),
 *     onReconnect: (attempt) => console.log(`Reconnecting (attempt ${attempt})`),
 *     onReconnectFailed: () => console.log('Reconnection failed'),
 *     onMessage: (msg) => handleMessage(msg),
 *     onDisconnect: () => console.log('Disconnected'),
 *   });
 * }
 * ```
 */
export async function createReconnectingHandoff(
	client: HandoffCommandClient,
	handoff: HandoffResult,
	options: ReconnectionOptions = {}
): Promise<ReconnectingHandoffConnection> {
	const {
		reconnectCommand,
		reconnectArgs = {},
		sessionId,
		maxAttempts = options.maxAttempts ?? handoff.metadata?.reconnect?.maxAttempts ?? 5,
		backoffMs = options.backoffMs ?? handoff.metadata?.reconnect?.backoffMs ?? 1000,
		maxBackoffMs = 30000,
		onReconnect,
		onReconnectFailed,
		onDisconnect,
		onStateChange,
		...connectionOptions
	} = options;

	let currentHandoff = handoff;
	let currentConnection: HandoffConnection | null = null;
	let reconnectAttempt = 0;
	let isReconnecting = false;
	let state: HandoffConnectionState = 'connecting';
	let closed = false;
	let connectionGeneration = 0;
	let reconnectPromise: Promise<void> | null = null;
	const backoff = new CancellableDelay();

	const setState = (newState: HandoffConnectionState) => {
		state = newState;
		onStateChange?.(newState);
	};

	const connect = async (reconnecting = false): Promise<HandoffConnection> => {
		const generation = ++connectionGeneration;
		const active = () => !closed && generation === connectionGeneration;
		if (reconnecting) {
			setState('reconnecting');
		} else {
			setState('connecting');
		}

		const conn = await connectHandoff(currentHandoff, {
			...connectionOptions,
			onConnect: (rawConn) => {
				if (!active()) return;
				setState('connected');
				connectionOptions.onConnect?.(rawConn);
			},
			onDisconnect: (code, reason) => {
				if (!active()) return;
				connectionGeneration++;
				currentConnection = null;
				if (closed || handoff.metadata?.reconnect?.allowed === false) {
					setState('disconnected');
					onDisconnect?.(code, reason);
					return;
				}
				void attemptReconnect();
			},
			onMessage: (message) => {
				if (active()) connectionOptions.onMessage?.(message);
			},
			onError: (error) => {
				if (active()) connectionOptions.onError?.(error);
			},
		});

		if (!active()) {
			conn.close();
			throw new Error('Connection closed during connection attempt');
		}
		currentConnection = conn;
		return conn;
	};

	const runReconnectLoop = async (): Promise<void> => {
		isReconnecting = true;
		try {
			for (let attempt = 1; attempt <= maxAttempts && !closed; attempt++) {
				reconnectAttempt = attempt;
				setState('reconnecting');
				onReconnect?.(attempt);
				await backoff.wait(backoffDelay(attempt, backoffMs, maxBackoffMs));
				if (closed) return;

				if (reconnectCommand) {
					try {
						const args = { ...reconnectArgs };
						if (sessionId) args.sessionId = sessionId;
						const result = await client.call(reconnectCommand, args);
						if (result.success && isHandoff(result.data)) {
							currentHandoff = result.data;
						}
					} catch {
						// Fall back to the last valid handoff.
					}
				}

				try {
					await connect(true);
					reconnectAttempt = 0;
					return;
				} catch {
					// The loop owns all bounded retry attempts.
				}
			}

			if (!closed) {
				setState('failed');
				onReconnectFailed?.();
			}
		} finally {
			isReconnecting = false;
		}
	};

	const attemptReconnect = (): Promise<void> => {
		if (closed) return Promise.resolve();
		if (reconnectPromise) return reconnectPromise;
		connectionGeneration++;
		const previous = currentConnection;
		currentConnection = null;
		previous?.close();
		reconnectPromise = runReconnectLoop().finally(() => {
			reconnectPromise = null;
		});
		return reconnectPromise;
	};

	// Initial connection. On failure the caller gets the rejection and owns nothing, so close
	// this connection: callbacks the failed attempt fires later are ignored instead of starting
	// a background reconnect loop.
	try {
		await connect(false);
	} catch (error) {
		closed = true;
		connectionGeneration++;
		throw error;
	}

	const reconnectingConnection: ReconnectingHandoffConnection = {
		get state() {
			return state;
		},
		get protocol() {
			return currentHandoff.protocol;
		},
		get endpoint() {
			return currentHandoff.endpoint;
		},
		get reconnectAttempt() {
			return reconnectAttempt;
		},
		get isReconnecting() {
			return isReconnecting;
		},

		send(data: unknown) {
			if (!currentConnection || state !== 'connected') {
				throw new Error('Cannot send: connection not in connected state');
			}
			currentConnection.send(data);
		},

		close() {
			if (closed) return;
			closed = true;
			isReconnecting = false;
			backoff.cancel();
			currentConnection?.close();
			currentConnection = null;
			setState('disconnected');
			onDisconnect?.();
		},

		async reconnect() {
			if (closed) throw new Error('Cannot reconnect a closed connection');
			reconnectAttempt = 0;
			await attemptReconnect();
		},
	};

	return reconnectingConnection;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sleep for a specified number of milliseconds.
 */
/**
 * Build a WebSocket URL with authentication token as query parameter.
 *
 * @param endpoint - The base WebSocket endpoint
 * @param credentials - Optional credentials with token
 * @returns The URL with token appended if provided
 */
export function buildAuthenticatedEndpoint(
	endpoint: string,
	credentials?: HandoffCredentials
): string {
	if (!credentials?.token) {
		return endpoint;
	}

	const url = new URL(endpoint);
	url.searchParams.set('token', credentials.token);
	return url.toString();
}

/**
 * Parse a handoff endpoint URL and extract connection details.
 *
 * @param endpoint - The endpoint URL
 * @returns Parsed URL components
 */
export function parseHandoffEndpoint(endpoint: string): {
	protocol: string;
	host: string;
	port: number | null;
	path: string;
	secure: boolean;
} {
	const url = new URL(endpoint);
	const isSecure = url.protocol === 'wss:' || url.protocol === 'https:';

	return {
		protocol: url.protocol.replace(':', ''),
		host: url.hostname,
		port: url.port ? parseInt(url.port, 10) : null,
		path: url.pathname + url.search,
		secure: isSecure,
	};
}

/**
 * Check if handoff credentials have expired.
 *
 * @param handoff - The handoff result to check
 * @returns True if credentials have expired
 */
export function isHandoffExpired(handoff: HandoffResult): boolean {
	if (!handoff.metadata?.expiresAt) {
		return false;
	}

	const expiresAt = new Date(handoff.metadata.expiresAt);
	return expiresAt.getTime() < Date.now();
}

/**
 * Get the time until handoff credentials expire.
 *
 * @param handoff - The handoff result to check
 * @returns Milliseconds until expiration, or null if no expiration set
 */
export function getHandoffTTL(handoff: HandoffResult): number | null {
	if (!handoff.metadata?.expiresAt) {
		return null;
	}

	const expiresAt = new Date(handoff.metadata.expiresAt);
	const ttl = expiresAt.getTime() - Date.now();
	return ttl > 0 ? ttl : 0;
}
