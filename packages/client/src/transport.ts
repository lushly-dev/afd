/**
 * @fileoverview Transport layer for MCP communication
 */

import type { McpRequest, McpResponse } from '@lushly-dev/afd-core';
import { isMcpResponse } from '@lushly-dev/afd-core';
import EventSource from 'eventsource';

/**
 * Transport interface for MCP communication.
 */
export interface Transport {
	/** Connect to the server */
	connect(): Promise<void>;

	/** Disconnect from the server */
	disconnect(): void;

	/** Send a request and wait for response */
	send(request: McpRequest): Promise<McpResponse>;

	/** Check if connected */
	isConnected(): boolean;

	/** Set message handler */
	onMessage(handler: (response: McpResponse) => void): void;

	/** Set error handler */
	onError(handler: (error: Error) => void): void;

	/** Set close handler */
	onClose(handler: () => void): void;
}

/**
 * SSE (Server-Sent Events) transport for MCP.
 *
 * This transport:
 * 1. Connects via SSE to receive messages from server
 * 2. Sends requests via HTTP POST
 */
export class SseTransport implements Transport {
	private eventSource: EventSource | null = null;
	private messageHandler: ((response: McpResponse) => void) | null = null;
	private errorHandler: ((error: Error) => void) | null = null;
	private closeHandler: (() => void) | null = null;
	private connected = false;
	private messageEndpoint: string;

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

	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				const options: EventSource.EventSourceInitDict = {};

				if (this.headers) {
					options.headers = this.headers;
				}

				this.eventSource = new EventSource(this.sseUrl, options);

				this.eventSource.onopen = () => {
					this.connected = true;
					resolve();
				};

				this.eventSource.onmessage = (event) => {
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

				this.eventSource.onerror = (_event) => {
					const error = new Error('SSE connection error');
					if (this.connected) {
						// Connection was established but lost
						this.connected = false;
						if (this.closeHandler) {
							this.closeHandler();
						}
					} else {
						// Failed to connect initially
						reject(error);
					}
					if (this.errorHandler) {
						this.errorHandler(error);
					}
				};
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	disconnect(): void {
		if (this.eventSource) {
			this.eventSource.close();
			this.eventSource = null;
		}
		this.connected = false;
	}

	async send(request: McpRequest): Promise<McpResponse> {
		const response = await fetch(this.messageEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...this.headers,
			},
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();

		if (!isMcpResponse(data)) {
			throw new Error('Invalid MCP response received');
		}

		return data;
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
}

/**
 * HTTP transport for MCP (request/response only, no streaming).
 */
export class HttpTransport implements Transport {
	private messageHandler: ((response: McpResponse) => void) | null = null;
	private errorHandler: ((error: Error) => void) | null = null;
	private closeHandler: (() => void) | null = null;
	private connected = false;
	private messageUrl: string;

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

	async connect(): Promise<void> {
		// For HTTP, verify the endpoint is reachable via health check
		try {
			const healthUrl = this.messageUrl.replace(/\/message$/, '/health');
			const response = await fetch(healthUrl, {
				method: 'GET',
				headers: this.headers,
			});

			if (response.ok) {
				this.connected = true;
				return;
			}
		} catch {
			// Health check failed, try to continue anyway
		}

		// Fallback: just mark as connected and let first request fail if not reachable
		this.connected = true;
	}

	disconnect(): void {
		this.connected = false;
		if (this.closeHandler) {
			this.closeHandler();
		}
	}

	async send(request: McpRequest): Promise<McpResponse> {
		const response = await fetch(this.messageUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...this.headers,
			},
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();

		if (!isMcpResponse(data)) {
			throw new Error('Invalid MCP response received');
		}

		// For HTTP transport, also dispatch through message handler
		if (this.messageHandler) {
			this.messageHandler(data);
		}

		return data;
	}

	isConnected(): boolean {
		return this.connected;
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
