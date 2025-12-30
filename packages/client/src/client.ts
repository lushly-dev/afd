/**
 * @fileoverview MCP Client implementation
 */

import type {
	CommandResult,
	McpInitializeParams,
	McpInitializeResult,
	McpRequest,
	McpResponse,
	McpTool,
	McpToolCallParams,
	McpToolCallResult,
	McpToolsListResult,
} from '@afd/core';
import {
	createMcpErrorResponse,
	createMcpRequest,
	failure,
	McpErrorCodes,
	success,
	wrapError,
} from '@afd/core';

import { createTransport, type Transport } from './transport.js';
import type {
	ClientStatus,
	ConnectionState,
	McpClientConfig,
	McpClientEvents,
	PendingRequest,
} from './types.js';

/**
 * Type-safe event emitter mixin.
 */
type EventHandler<T extends (...args: never[]) => void> = T;
type EventMap = { [K in keyof McpClientEvents]: McpClientEvents[K][] };

/**
 * MCP Client for connecting to MCP servers.
 *
 * @example
 * ```typescript
 * const client = new McpClient({ url: 'http://localhost:3100/sse' });
 *
 * await client.connect();
 *
 * // List available tools
 * const tools = await client.listTools();
 *
 * // Call a tool
 * const result = await client.call('document.create', { title: 'Test' });
 *
 * await client.disconnect();
 * ```
 */
export class McpClient {
	private readonly config: Required<McpClientConfig>;
	private transport: Transport | null = null;
	private state: ConnectionState = 'disconnected';
	private serverInfo: McpInitializeResult['serverInfo'] | null = null;
	private capabilities: McpInitializeResult['capabilities'] | null = null;
	private tools: McpTool[] = [];
	private connectedAt: Date | null = null;
	private reconnectAttempts = 0;
	private pendingRequests = new Map<string | number, PendingRequest>();
	private eventHandlers: EventMap = {
		stateChange: [],
		connected: [],
		disconnected: [],
		reconnecting: [],
		error: [],
		message: [],
		toolsChanged: [],
	};

	constructor(config: McpClientConfig) {
		this.config = {
			url: config.url,
			transport: config.transport ?? 'sse',
			clientName: config.clientName ?? '@afd/client',
			clientVersion: config.clientVersion ?? '0.1.0',
			timeout: config.timeout ?? 30000,
			autoReconnect: config.autoReconnect ?? true,
			maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
			reconnectDelay: config.reconnectDelay ?? 1000,
			headers: config.headers ?? {},
			debug: config.debug ?? false,
		};
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// CONNECTION MANAGEMENT
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Connect to the MCP server.
	 */
	async connect(): Promise<McpInitializeResult> {
		if (this.state === 'connected') {
			throw new Error('Already connected');
		}

		this.setState('connecting');

		try {
			// Create transport
			if (this.config.transport === 'stdio') {
				throw new Error('stdio transport not yet implemented');
			}

			this.transport = createTransport(
				this.config.transport,
				this.config.url,
				this.config.headers
			);

			// Set up transport handlers
			this.transport.onMessage((response) => this.handleMessage(response));
			this.transport.onError((error) => this.handleError(error));
			this.transport.onClose(() => this.handleClose());

			// Connect transport
			await this.transport.connect();

			// Initialize MCP session
			const initResult = await this.initialize();

			this.serverInfo = initResult.serverInfo;
			this.capabilities = initResult.capabilities;
			this.connectedAt = new Date();
			this.reconnectAttempts = 0;

			this.setState('connected');
			this.emit('connected', initResult);

			// Fetch initial tools list
			await this.refreshTools();

			return initResult;
		} catch (error) {
			this.setState('error');
			const err = error instanceof Error ? error : new Error(String(error));
			this.emit('error', err);
			throw err;
		}
	}

	/**
	 * Disconnect from the MCP server.
	 */
	async disconnect(): Promise<void> {
		if (this.transport) {
			this.transport.disconnect();
			this.transport = null;
		}

		// Reject all pending requests
		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			pending.reject(new Error('Client disconnected'));
		}
		this.pendingRequests.clear();

		this.setState('disconnected');
		this.emit('disconnected', 'Manual disconnect');

		this.serverInfo = null;
		this.capabilities = null;
		this.connectedAt = null;
		this.tools = [];
	}

	/**
	 * Get current client status.
	 */
	getStatus(): ClientStatus {
		return {
			state: this.state,
			url: this.state !== 'disconnected' ? this.config.url : null,
			serverInfo: this.serverInfo,
			capabilities: this.capabilities,
			connectedAt: this.connectedAt,
			reconnectAttempts: this.reconnectAttempts,
			pendingRequests: this.pendingRequests.size,
		};
	}

	/**
	 * Check if connected.
	 */
	isConnected(): boolean {
		return this.state === 'connected' && this.transport?.isConnected() === true;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// MCP OPERATIONS
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * List available tools.
	 */
	async listTools(): Promise<McpTool[]> {
		const response = await this.request<McpToolsListResult>('tools/list');
		this.tools = response.tools;
		return this.tools;
	}

	/**
	 * Get cached tools list.
	 */
	getTools(): McpTool[] {
		return this.tools;
	}

	/**
	 * Refresh tools list from server.
	 */
	async refreshTools(): Promise<McpTool[]> {
		const tools = await this.listTools();
		this.emit('toolsChanged', tools);
		return tools;
	}

	/**
	 * Call a tool and return raw MCP result.
	 *
	 * @param name - Tool name
	 * @param args - Tool arguments
	 */
	async callTool(name: string, args?: Record<string, unknown>): Promise<McpToolCallResult> {
		const params = {
			name,
			arguments: args,
		};

		return this.request<McpToolCallResult>('tools/call', params as Record<string, unknown>);
	}

	/**
	 * Call a command and return a CommandResult.
	 *
	 * This is the preferred method for AFD - it wraps the MCP response
	 * in a standardized CommandResult.
	 *
	 * @param name - Command/tool name
	 * @param args - Command arguments
	 */
	async call<T = unknown>(
		name: string,
		args?: Record<string, unknown>
	): Promise<CommandResult<T>> {
		try {
			const result = await this.callTool(name, args);

			if (result.isError) {
				// Extract error from content
				const errorText = result.content
					.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
					.map((c) => c.text)
					.join('\n');

				return failure({
					code: 'TOOL_ERROR',
					message: errorText || 'Tool execution failed',
					suggestion: 'Check the tool arguments and try again',
				});
			}

			// Try to parse JSON from text content
			const textContent = result.content
				.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
				.map((c) => c.text)
				.join('');

			try {
				const data = JSON.parse(textContent);

				// If the data is already a CommandResult, return it directly
				if (typeof data === 'object' && data !== null && 'success' in data) {
					return data as CommandResult<T>;
				}

				// Wrap raw data in a success result
				return success(data as T);
			} catch {
				// Return raw text as data
				return success(textContent as unknown as T);
			}
		} catch (error) {
			return failure(wrapError(error));
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// LOW-LEVEL REQUEST/RESPONSE
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Send a raw MCP request and wait for response.
	 */
	async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
		// Allow requests during 'connecting' (for initialize) and 'connected' states
		const canRequest = this.transport && 
			(this.state === 'connected' || this.state === 'connecting') &&
			this.transport.isConnected();
		
		if (!canRequest || !this.transport) {
			throw new Error('Not connected');
		}

		const request = createMcpRequest(method, params);
		this.debug(`Request [${request.id}]: ${method}`, params);

		// For transports that return response directly
		const response = await this.transport.send(request);

		this.debug(`Response [${request.id}]:`, response);

		if (response.error) {
			throw new Error(response.error.message);
		}

		return response.result as T;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// EVENT HANDLING
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Subscribe to an event.
	 */
	on<K extends keyof McpClientEvents>(
		event: K,
		handler: EventHandler<McpClientEvents[K]>
	): () => void {
		this.eventHandlers[event].push(handler as never);

		// Return unsubscribe function
		return () => {
			const index = this.eventHandlers[event].indexOf(handler as never);
			if (index > -1) {
				this.eventHandlers[event].splice(index, 1);
			}
		};
	}

	/**
	 * Emit an event.
	 */
	private emit<K extends keyof McpClientEvents>(
		event: K,
		...args: Parameters<McpClientEvents[K]>
	): void {
		for (const handler of this.eventHandlers[event]) {
			try {
				(handler as (...args: Parameters<McpClientEvents[K]>) => void)(...args);
			} catch (error) {
				console.error(`Error in event handler for '${event}':`, error);
			}
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// INTERNAL
	// ═══════════════════════════════════════════════════════════════════════════

	private async initialize(): Promise<McpInitializeResult> {
		const params = {
			protocolVersion: '2024-11-05',
			capabilities: {
				roots: { listChanged: false },
			},
			clientInfo: {
				name: this.config.clientName,
				version: this.config.clientVersion,
			},
		};

		return this.request<McpInitializeResult>('initialize', params as Record<string, unknown>);
	}

	private setState(state: ConnectionState): void {
		if (this.state !== state) {
			this.state = state;
			this.emit('stateChange', state);
		}
	}

	private handleMessage(response: McpResponse): void {
		this.emit('message', response);

		// Handle pending request if this is a response
		const pending = this.pendingRequests.get(response.id);
		if (pending) {
			clearTimeout(pending.timeout);
			this.pendingRequests.delete(response.id);

			if (response.error) {
				pending.reject(new Error(response.error.message));
			} else {
				pending.resolve(response.result);
			}
		}
	}

	private handleError(error: Error): void {
		this.emit('error', error);
	}

	private handleClose(): void {
		if (this.state === 'connected' && this.config.autoReconnect) {
			this.attemptReconnect();
		} else {
			this.setState('disconnected');
			this.emit('disconnected', 'Connection closed');
		}
	}

	private async attemptReconnect(): Promise<void> {
		if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
			this.setState('error');
			this.emit('error', new Error('Max reconnection attempts reached'));
			return;
		}

		this.reconnectAttempts++;
		this.setState('reconnecting');
		this.emit('reconnecting', this.reconnectAttempts, this.config.maxReconnectAttempts);

		// Exponential backoff
		const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

		await new Promise((resolve) => setTimeout(resolve, delay));

		try {
			await this.connect();
		} catch {
			// Will trigger another reconnect via handleClose
		}
	}

	private debug(message: string, data?: unknown): void {
		if (this.config.debug) {
			console.log(`[McpClient] ${message}`, data ?? '');
		}
	}
}

/**
 * Create a new MCP client.
 *
 * @param config - Client configuration
 * @returns New McpClient instance
 */
export function createClient(config: McpClientConfig): McpClient {
	return new McpClient(config);
}
