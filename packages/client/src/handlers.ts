/**
 * @fileoverview Built-in protocol handlers for WebSocket and SSE
 *
 * Provides default transport handlers that `connectHandoff()` auto-selects
 * when no custom handler has been registered for the protocol.
 *
 * @example Using built-in WebSocket handler (automatic)
 * ```typescript
 * // No manual registration needed — connectHandoff auto-selects
 * const connection = await connectHandoff(handoff);
 * connection.send({ type: 'message', text: 'Hello!' });
 * ```
 *
 * @example Overriding a built-in handler
 * ```typescript
 * registerProtocolHandler('websocket', myCustomHandler);
 * // Now connectHandoff will use your handler instead of the built-in one
 * ```
 */

import type { HandoffResult } from '@lushly-dev/afd-core';
import type {
	HandoffConnection,
	HandoffConnectionOptions,
	HandoffConnectionState,
	ProtocolHandler,
} from './handoff.js';

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Built-in WebSocket protocol handler.
 *
 * Handles:
 * - Connection establishment with optional token authentication
 * - JSON message serialization/deserialization
 * - Connection lifecycle management
 *
 * Authentication flow:
 * 1. If `credentials.token` is present, sent as `{ type: 'auth', token }` message after connect
 * 2. If `credentials.headers` are present, sent as `{ type: 'auth_headers', headers }` message
 *    (avoids leaking tokens in URLs or subprotocol encoding)
 *
 * Runtime requirement: `WebSocket` global (browser or Node.js 22+)
 */
export const websocketHandler: ProtocolHandler = async (
	handoff: HandoffResult,
	options: HandoffConnectionOptions
): Promise<HandoffConnection> => {
	if (typeof WebSocket === 'undefined') {
		throw new Error(
			'WebSocket is not available in this runtime. ' + 'Use Node.js 22+ or a browser environment.'
		);
	}

	let state: HandoffConnectionState = 'connecting';

	const setState = (newState: HandoffConnectionState) => {
		state = newState;
		options.onStateChange?.(newState);
	};

	const endpoint = handoff.endpoint;
	const ws = new WebSocket(endpoint);

	return new Promise<HandoffConnection>((resolve, reject) => {
		let settled = false;
		const resolveOnce = (connection: HandoffConnection) => {
			if (!settled) {
				settled = true;
				resolve(connection);
			}
		};
		const rejectOnce = (error: Error) => {
			if (!settled) {
				settled = true;
				reject(error);
			}
		};

		const connection: HandoffConnection = {
			get state() {
				return state;
			},
			protocol: handoff.protocol,
			endpoint: handoff.endpoint,
			send(data: unknown) {
				if (state !== 'connected') {
					throw new Error('Cannot send: WebSocket is not in connected state');
				}
				ws.send(JSON.stringify(data));
			},
			close() {
				ws.close(1000, 'Client close');
			},
		};

		ws.onopen = () => {
			// Send auth token as first message after connection (avoids leaking token in URL/logs)
			if (handoff.credentials?.token) {
				ws.send(JSON.stringify({ type: 'auth', token: handoff.credentials.token }));
			}
			if (handoff.credentials?.headers) {
				ws.send(JSON.stringify({ type: 'auth_headers', headers: handoff.credentials.headers }));
			}
			setState('connected');
			options.onConnect?.(ws);
			resolveOnce(connection);
		};

		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(String(event.data));
				options.onMessage?.(data);
			} catch {
				// Forward raw string if not valid JSON
				options.onMessage?.(event.data);
			}
		};

		ws.onerror = () => {
			const error = new Error('WebSocket error');
			options.onError?.(error);
			if (state === 'connecting') {
				setState('failed');
				rejectOnce(error);
			}
		};

		ws.onclose = (event) => {
			if (state === 'connecting') {
				setState('failed');
				const closeError = new Error(
					`WebSocket closed before connection established (${event.code}: ${event.reason || 'no reason'})`
				);
				options.onError?.(closeError);
				rejectOnce(closeError);
				return;
			}
			setState('disconnected');
			options.onDisconnect?.(event.code, event.reason);
		};
	});
};

// ═══════════════════════════════════════════════════════════════════════════════
// SSE HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Built-in SSE (Server-Sent Events) protocol handler.
 *
 * Handles:
 * - Connection establishment via EventSource or fetch-based SSE
 * - Token authentication via `Authorization` header (fetch) or query param (EventSource)
 * - Custom header propagation via `credentials.headers`
 * - JSON message deserialization from SSE `data` fields
 * - Connection lifecycle management
 *
 * Authentication flow:
 * - If custom headers or bearer token needed: uses `fetch()` with streaming body
 * - Otherwise: uses `EventSource` with token as query parameter
 *
 * Runtime requirement: `EventSource` global or `fetch` with streaming support
 */
export const sseHandler: ProtocolHandler = async (
	handoff: HandoffResult,
	options: HandoffConnectionOptions
): Promise<HandoffConnection> => {
	const setState = (newState: HandoffConnectionState) => {
		options.onStateChange?.(newState);
	};

	const hasCustomHeaders =
		handoff.credentials?.headers && Object.keys(handoff.credentials.headers).length > 0;
	const hasToken = !!handoff.credentials?.token;

	// If we need custom headers (including Authorization), use fetch-based SSE
	// Otherwise, use EventSource with token as query param
	if (hasCustomHeaders || hasToken) {
		return createFetchBasedSse(handoff, options, setState);
	}

	return createEventSourceSse(handoff, options, setState);
};

/**
 * Create an SSE connection using the fetch API for custom header support.
 */
async function createFetchBasedSse(
	handoff: HandoffResult,
	options: HandoffConnectionOptions,
	parentSetState: (state: HandoffConnectionState) => void
): Promise<HandoffConnection> {
	let state: HandoffConnectionState = 'connecting';
	const setState = (newState: HandoffConnectionState) => {
		state = newState;
		parentSetState(newState);
	};

	if (typeof fetch === 'undefined') {
		throw new Error(
			'fetch is not available in this runtime. ' +
				'Use Node.js 22+ or a browser environment for SSE with authentication headers.'
		);
	}

	const headers: Record<string, string> = {
		Accept: 'text/event-stream',
		'Cache-Control': 'no-cache',
		...handoff.credentials?.headers,
	};

	if (handoff.credentials?.token) {
		headers.Authorization = `Bearer ${handoff.credentials.token}`;
	}

	const abortController = new AbortController();

	let response: Response;
	try {
		response = await fetch(handoff.endpoint, {
			headers,
			signal: abortController.signal,
		});
	} catch (err) {
		setState('failed');
		throw new Error(`SSE connection failed: ${err instanceof Error ? err.message : String(err)}`);
	}

	if (!response.ok) {
		setState('failed');
		throw new Error(`SSE connection failed with status ${response.status}`);
	}

	if (!response.body) {
		setState('failed');
		throw new Error('SSE response has no body — streaming not supported in this runtime');
	}

	setState('connected');
	options.onConnect?.(response);

	// Read SSE stream in background
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	const readLoop = async () => {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const raw = line.slice(6);
						try {
							options.onMessage?.(JSON.parse(raw));
						} catch {
							options.onMessage?.(raw);
						}
					}
				}
			}
		} catch (err) {
			if (!abortController.signal.aborted) {
				options.onError?.(err instanceof Error ? err : new Error(String(err)));
			}
		} finally {
			setState('disconnected');
			options.onDisconnect?.();
		}
	};

	readLoop();

	return {
		get state() {
			return state;
		},
		protocol: handoff.protocol,
		endpoint: handoff.endpoint,
		send(_data: unknown) {
			throw new Error('SSE connections are read-only. Use a separate HTTP endpoint to send data.');
		},
		close() {
			abortController.abort();
		},
	};
}

/**
 * Create an SSE connection using the EventSource API.
 */
function createEventSourceSse(
	handoff: HandoffResult,
	options: HandoffConnectionOptions,
	parentSetState: (state: HandoffConnectionState) => void
): Promise<HandoffConnection> {
	let state: HandoffConnectionState = 'connecting';
	const setState = (newState: HandoffConnectionState) => {
		state = newState;
		parentSetState(newState);
	};

	if (typeof EventSource === 'undefined') {
		throw new Error(
			'EventSource is not available in this runtime. ' +
				'Use a browser environment or install an EventSource polyfill.'
		);
	}

	const endpoint = handoff.endpoint;

	const eventSource = new EventSource(endpoint);

	return new Promise<HandoffConnection>((resolve, reject) => {
		let settled = false;
		const resolveOnce = (connection: HandoffConnection) => {
			if (!settled) {
				settled = true;
				resolve(connection);
			}
		};
		const rejectOnce = (error: Error) => {
			if (!settled) {
				settled = true;
				reject(error);
			}
		};

		const connection: HandoffConnection = {
			get state() {
				return state;
			},
			protocol: handoff.protocol,
			endpoint: handoff.endpoint,
			send(_data: unknown) {
				throw new Error(
					'SSE connections are read-only. Use a separate HTTP endpoint to send data.'
				);
			},
			close() {
				eventSource.close();
				setState('disconnected');
				options.onDisconnect?.();
			},
		};

		eventSource.onopen = () => {
			setState('connected');
			options.onConnect?.(eventSource);
			resolveOnce(connection);
		};

		eventSource.onmessage = (event) => {
			try {
				options.onMessage?.(JSON.parse(event.data));
			} catch {
				options.onMessage?.(event.data);
			}
		};

		eventSource.onerror = () => {
			const error = new Error('SSE connection error');
			options.onError?.(error);

			if (state === 'connecting') {
				setState('failed');
				eventSource.close();
				rejectOnce(error);
			} else {
				setState('disconnected');
				options.onDisconnect?.();
			}
		};
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILT-IN HANDLER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Map of built-in protocol handlers.
 * These are used as defaults when no custom handler is registered.
 */
export const builtinHandlers: ReadonlyMap<string, ProtocolHandler> = new Map<
	string,
	ProtocolHandler
>([
	['websocket', websocketHandler],
	['sse', sseHandler],
]);
