/**
 * @fileoverview Client configuration and event types
 */

import type {
	McpInitializeResult,
	McpResponse,
	McpServerCapabilities,
	McpTool,
} from '@afd/core';

/**
 * Transport type for MCP communication.
 */
export type TransportType = 'sse' | 'http' | 'stdio';

/**
 * Client configuration options.
 */
export interface McpClientConfig {
	/**
	 * Server URL to connect to.
	 * For SSE: http://localhost:3100/sse
	 * For HTTP: http://localhost:3100/message
	 */
	url: string;

	/**
	 * Transport type to use.
	 * @default 'sse'
	 */
	transport?: TransportType;

	/**
	 * Client name for identification.
	 * @default '@afd/client'
	 */
	clientName?: string;

	/**
	 * Client version.
	 * @default '0.1.0'
	 */
	clientVersion?: string;

	/**
	 * Request timeout in milliseconds.
	 * @default 30000
	 */
	timeout?: number;

	/**
	 * Enable automatic reconnection for SSE.
	 * @default true
	 */
	autoReconnect?: boolean;

	/**
	 * Maximum reconnection attempts.
	 * @default 5
	 */
	maxReconnectAttempts?: number;

	/**
	 * Base delay between reconnection attempts in ms.
	 * Uses exponential backoff.
	 * @default 1000
	 */
	reconnectDelay?: number;

	/**
	 * Custom headers to include in requests.
	 */
	headers?: Record<string, string>;

	/**
	 * Enable debug logging.
	 * @default false
	 */
	debug?: boolean;
}

/**
 * Connection state.
 */
export type ConnectionState =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'reconnecting'
	| 'error';

/**
 * Client events.
 */
export interface McpClientEvents {
	/** Emitted when connection state changes */
	stateChange: (state: ConnectionState) => void;

	/** Emitted when successfully connected and initialized */
	connected: (result: McpInitializeResult) => void;

	/** Emitted when disconnected */
	disconnected: (reason?: string) => void;

	/** Emitted when a reconnection attempt starts */
	reconnecting: (attempt: number, maxAttempts: number) => void;

	/** Emitted on error */
	error: (error: Error) => void;

	/** Emitted when a message is received */
	message: (response: McpResponse) => void;

	/** Emitted when tools list changes */
	toolsChanged: (tools: McpTool[]) => void;
}

/**
 * Pending request tracking.
 */
export interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
	method: string;
}

/**
 * Client status information.
 */
export interface ClientStatus {
	state: ConnectionState;
	url: string | null;
	serverInfo: McpInitializeResult['serverInfo'] | null;
	capabilities: McpServerCapabilities | null;
	connectedAt: Date | null;
	reconnectAttempts: number;
	pendingRequests: number;
}
