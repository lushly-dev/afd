/**
 * @fileoverview Transport layer for MCP communication
 */

import type { McpRequest, McpResponse } from '@lushly-dev/afd-core';
import { isMcpResponse } from '@lushly-dev/afd-core';
import { EventSource } from 'eventsource';
import { HttpStatusError } from './client-errors.js';
import { McpSession } from './mcp-session.js';

/**
 * Consecutive network failures (no HTTP response at all) after which `HttpTransport` reports the
 * connection as lost, so `McpClient` can reconnect.
 */
export const HTTP_FAILURES_BEFORE_CONNECTION_LOST = 3;

async function readJsonBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return undefined;
	}
}

/**
 * Read a JSON-RPC response. A non-2xx status with a JSON-RPC error body (the AFD server answers
 * parse errors, invalid envelopes, rejected requests and unknown sessions this way) is returned
 * as that error response; any other non-2xx status throws `HttpStatusError`.
 */
async function readRpcResponse(response: Response): Promise<McpResponse> {
	if (!response.ok) {
		const body = await readJsonBody(response);
		if (isMcpResponse(body) && body.error) return body;
		throw new HttpStatusError(response.status, response.statusText);
	}
	const data = await response.json();
	if (!isMcpResponse(data)) {
		throw new Error('Invalid MCP response received');
	}
	return data;
}

/**
 * Transport interface for MCP communication.
 */
export interface Transport {
	/** Connect to the server */
	connect(signal?: AbortSignal): Promise<void>;

	/** Disconnect from the server */
	disconnect(): void;

	/** Send a request and wait for response */
	send(request: McpRequest, signal?: AbortSignal): Promise<McpResponse>;

	/** Check if connected */
	isConnected(): boolean;

	/** Set message handler */
	onMessage(handler: (response: McpResponse) => void): void;

	/** Set error handler */
	onError(handler: (error: Error) => void): void;

	/** Set close handler */
	onClose(handler: () => void): void;

	/**
	 * The MCP session ID the server issued in its `initialize` response, if any. `McpClient`
	 * sends it with `stream()` requests, so a stream shares the session's context state.
	 */
	readonly sessionId?: string;

	/**
	 * Start a new session with the last `initialize` request after the server rejected the
	 * current one (404). Resolves `false`, sending nothing, when there is no session to renew.
	 */
	renewSession?(signal?: AbortSignal): Promise<boolean>;
}

/**
 * SSE (Server-Sent Events) transport for MCP.
 *
 * This transport:
 * 1. Connects via SSE to receive messages from server
 * 2. Sends requests via HTTP POST
 *
 * It speaks the AFD server's HTTP transport: requests go to the URL with its trailing `/sse`
 * replaced by `/message`. The `endpoint` event of the legacy MCP SSE transport is not read, so
 * servers that announce a different message URL (such as official MCP SDK servers) are not
 * supported.
 */
export class SseTransport implements Transport {
	private eventSource: EventSource | null = null;
	private messageHandler: ((response: McpResponse) => void) | null = null;
	private errorHandler: ((error: Error) => void) | null = null;
	private closeHandler: (() => void) | null = null;
	private connected = false;
	private messageEndpoint: string;
	private activeControllers = new Set<AbortController>();
	private readonly session = new McpSession();

	constructor(
		private readonly sseUrl: string,
		private readonly headers?: Record<string, string>
	) {
		// Derive message endpoint from SSE URL
		// e.g., http://localhost:3100/sse -> http://localhost:3100/message
		const url = new URL(sseUrl);
		url.pathname = url.pathname.replace(/\/sse\/?$/, '/message');
		this.messageEndpoint = url.toString();
	}

	async connect(signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
		this.disconnect();
		return new Promise((resolve, reject) => {
			const { controller, signal: requestSignal } = this.createRequestController(signal);
			let settled = false;
			const cleanup = () => {
				settled = true;
				requestSignal.removeEventListener('abort', handleAbort);
				this.activeControllers.delete(controller);
			};
			const handleAbort = () => {
				this.eventSource?.close();
				this.eventSource = null;
				this.connected = false;
				if (!settled) {
					cleanup();
					reject(requestSignal.reason ?? new Error('Connection aborted'));
				}
			};
			requestSignal.addEventListener('abort', handleAbort, { once: true });
			try {
				const headers = this.headers;
				const eventSource = new EventSource(
					this.sseUrl,
					headers
						? {
								fetch: (input, init) =>
									fetch(input, {
										...init,
										signal: AbortSignal.any(
											[init?.signal, requestSignal].filter(
												(value): value is AbortSignal => value !== undefined && value !== null
											)
										),
										headers: {
											...Object.fromEntries(new Headers(init?.headers).entries()),
											...headers,
										},
									}),
							}
						: {}
				);

				this.eventSource = eventSource;
				eventSource.onopen = () => {
					if (this.eventSource !== eventSource) return;
					this.connected = true;
					cleanup();
					resolve();
				};

				eventSource.onmessage = (event) => {
					if (this.eventSource !== eventSource) return;
					try {
						const data = JSON.parse(event.data);
						if (isMcpResponse(data) && this.messageHandler) {
							this.messageHandler(data);
						}
					} catch (error) {
						if (this.errorHandler) {
							this.errorHandler(error instanceof Error ? error : new Error(String(error)));
						}
					}
				};

				eventSource.onerror = (_event) => {
					if (this.eventSource !== eventSource) return;
					eventSource.close();
					this.eventSource = null;
					const error = new Error('SSE connection error');
					if (this.connected) {
						// Connection was established but lost
						this.connected = false;
						if (this.closeHandler) {
							this.closeHandler();
						}
					} else {
						// Failed to connect initially
						cleanup();
						reject(error);
					}
					if (this.errorHandler) {
						this.errorHandler(error);
					}
				};
			} catch (error) {
				cleanup();
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	disconnect(): void {
		for (const controller of this.activeControllers) {
			controller.abort(new Error('Transport disconnected'));
		}
		this.activeControllers.clear();
		if (this.eventSource) {
			this.eventSource.close();
			this.eventSource = null;
		}
		this.connected = false;
		this.session.reset();
	}

	async send(request: McpRequest, signal?: AbortSignal): Promise<McpResponse> {
		const { controller, signal: requestSignal } = this.createRequestController(signal);
		try {
			const response = await this.session.post(
				this.messageEndpoint,
				this.headers,
				request,
				requestSignal
			);
			return await readRpcResponse(response);
		} finally {
			this.activeControllers.delete(controller);
		}
	}

	get sessionId(): string | undefined {
		return this.session.sessionId;
	}

	async renewSession(signal?: AbortSignal): Promise<boolean> {
		const { controller, signal: requestSignal } = this.createRequestController(signal);
		try {
			return await this.session.renew(this.messageEndpoint, this.headers, requestSignal);
		} finally {
			this.activeControllers.delete(controller);
		}
	}

	isConnected(): boolean {
		return this.connected && this.eventSource?.readyState === EventSource.OPEN;
	}

	onMessage(handler: (response: McpResponse) => void): void {
		this.messageHandler = handler;
	}

	onError(handler: (error: Error) => void): void {
		this.errorHandler = handler;
	}

	onClose(handler: () => void): void {
		this.closeHandler = handler;
	}

	private createRequestController(signal?: AbortSignal): {
		controller: AbortController;
		signal: AbortSignal;
	} {
		const controller = new AbortController();
		this.activeControllers.add(controller);
		return {
			controller,
			signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
		};
	}
}

/**
 * HTTP transport for MCP (request/response only, no streaming).
 *
 * Connection loss is detected from consecutive requests that get no HTTP response at all.
 */
export class HttpTransport implements Transport {
	private messageHandler: ((response: McpResponse) => void) | null = null;
	private closeHandler: (() => void) | null = null;
	private connected = false;
	private consecutiveFailures = 0;
	private messageUrl: string;
	private activeControllers = new Set<AbortController>();
	private readonly session = new McpSession();

	constructor(
		readonly url: string,
		private readonly headers?: Record<string, string>
	) {
		// If URL ends with /sse, convert to /message
		if (url.endsWith('/sse')) {
			this.messageUrl = url.replace(/\/sse$/, '/message');
		} else if (url.endsWith('/message')) {
			this.messageUrl = url;
		} else {
			this.messageUrl = url;
		}
	}

	async connect(signal?: AbortSignal): Promise<void> {
		const { controller, signal: requestSignal } = this.createRequestController(signal);
		// For HTTP, verify the endpoint is reachable via health check
		try {
			const healthUrl = this.messageUrl.replace(/\/message$/, '/health');
			const response = await fetch(healthUrl, {
				method: 'GET',
				headers: this.headers,
				signal: requestSignal,
			});

			if (response.ok) {
				this.connected = true;
				return;
			}
		} catch (error) {
			if (requestSignal.aborted) throw error;
			// Health check failed, try to continue anyway
		} finally {
			this.activeControllers.delete(controller);
		}

		// Fallback: just mark as connected and let first request fail if not reachable
		this.connected = true;
	}

	disconnect(): void {
		for (const controller of this.activeControllers) {
			controller.abort(new Error('Transport disconnected'));
		}
		this.activeControllers.clear();
		this.connected = false;
		this.session.reset();
		if (this.closeHandler) {
			this.closeHandler();
		}
	}

	async send(request: McpRequest, signal?: AbortSignal): Promise<McpResponse> {
		const { controller, signal: requestSignal } = this.createRequestController(signal);
		try {
			let response: Response;
			try {
				response = await this.session.post(this.messageUrl, this.headers, request, requestSignal);
			} catch (error) {
				if (!requestSignal.aborted) this.recordNetworkFailure();
				throw error;
			}
			this.consecutiveFailures = 0;
			const data = await readRpcResponse(response);

			// For HTTP transport, also dispatch through message handler
			if (this.messageHandler) {
				this.messageHandler(data);
			}

			return data;
		} finally {
			this.activeControllers.delete(controller);
		}
	}

	get sessionId(): string | undefined {
		return this.session.sessionId;
	}

	async renewSession(signal?: AbortSignal): Promise<boolean> {
		const { controller, signal: requestSignal } = this.createRequestController(signal);
		try {
			return await this.session.renew(this.messageUrl, this.headers, requestSignal);
		} finally {
			this.activeControllers.delete(controller);
		}
	}

	/**
	 * HTTP has no persistent connection to watch, so a request that gets no response at all
	 * counts as a failure. After {@link HTTP_FAILURES_BEFORE_CONNECTION_LOST} in a row the
	 * transport reports the connection as lost (its close handler runs, which lets `McpClient`
	 * reconnect). Any HTTP response, even an error status, resets the count.
	 */
	private recordNetworkFailure(): void {
		this.consecutiveFailures++;
		if (this.consecutiveFailures < HTTP_FAILURES_BEFORE_CONNECTION_LOST || !this.connected) return;
		this.connected = false;
		this.closeHandler?.();
	}

	isConnected(): boolean {
		return this.connected;
	}

	onMessage(handler: (response: McpResponse) => void): void {
		this.messageHandler = handler;
	}

	onError(_handler: (error: Error) => void): void {
		// HttpTransport errors propagate via thrown exceptions in send()
	}

	onClose(handler: () => void): void {
		this.closeHandler = handler;
	}

	private createRequestController(signal?: AbortSignal): {
		controller: AbortController;
		signal: AbortSignal;
	} {
		const controller = new AbortController();
		this.activeControllers.add(controller);
		return {
			controller,
			signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
		};
	}
}

/**
 * Create a transport based on type.
 */
export function createTransport(
	type: 'sse' | 'http' | 'websocket',
	url: string,
	headers?: Record<string, string>
): Transport {
	switch (type) {
		case 'sse':
			return new SseTransport(url, headers);
		case 'http':
			return new HttpTransport(url, headers);
		default:
			throw new Error(`Unsupported transport type: ${type}`);
	}
}
