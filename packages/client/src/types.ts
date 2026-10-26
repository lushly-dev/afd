/**
 * @fileoverview Client configuration and event types
 */

import type {
	McpInitializeResult,
	McpResponse,
	McpServerCapabilities,
	McpTool,
} from '@lushly-dev/afd-core';
import type { DirectRegistry } from './direct-types.js';

/**
 * Transport names that appear in AFD configuration. `McpClient` accepts only
 * {@link McpTransportType}; `websocket` and `stdio` are not implemented.
 */
export type TransportType = 'streamable-http' | 'sse' | 'http' | 'websocket' | 'stdio' | 'direct';

/**
 * Transports `McpClient` supports:
 *
 * - `'streamable-http'`: MCP Streamable HTTP, such as an AFD server's `/mcp` or any official MCP
 *   SDK server. Speaks MCP 2026-07-28 when the server offers it, else the 2025 handshake.
 * - `'sse'`: deprecated, an AFD server's `/sse` stream plus `POST /message`
 * - `'http'`: deprecated, `POST /message` request/response against an AFD server
 * - `'direct'`: an in-process `DirectRegistry` (set `registry`), no network
 */
export type McpTransportType = 'streamable-http' | 'sse' | 'http' | 'direct';

/**
 * How the `streamable-http` transport negotiates the MCP revision:
 *
 * - `'auto'` (default): probe `server/discover`; use 2026-07-28 when offered, else `initialize`
 * - `'legacy'`: always use the 2025 `initialize` handshake
 * - `'modern'`: require 2026-07-28 and fail otherwise
 */
export type ProtocolMode = 'auto' | 'legacy' | 'modern';

/**
 * Client configuration options.
 */
export interface McpClientConfig {
	/**
	 * Server URL to connect to. Required unless `transport` is `'direct'`.
	 * For Streamable HTTP: http://localhost:3100/mcp
	 * For SSE (deprecated): http://localhost:3100/sse
	 * For HTTP (deprecated): http://localhost:3100/message
	 */
	url?: string;

	/**
	 * Server endpoint (alias for url).
	 * Preferred for browser SDK usage.
	 * @example 'http://localhost:3100/message'
	 */
	endpoint?: string;

	/**
	 * Transport type to use. Default: `'sse'` for a URL ending in `/sse`, otherwise
	 * `'streamable-http'`.
	 */
	transport?: McpTransportType;

	/**
	 * Protocol negotiation of the `streamable-http` transport; ignored by the others.
	 * @default 'auto'
	 */
	protocolMode?: ProtocolMode;

	/**
	 * Registry for `transport: 'direct'`, such as `createDirectRegistry(commands)` from
	 * `@lushly-dev/afd-server`. Required with that transport and ignored otherwise.
	 */
	registry?: DirectRegistry;

	/**
	 * Client name for identification.
	 * @default '@lushly-dev/afd-client'
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
	 * Reconnect automatically when the connection is lost. The SSE transport notices a closed
	 * event stream; the HTTP transport, which has no persistent connection, reports the
	 * connection as lost after 3 consecutive requests get no HTTP response.
	 * @default true
	 */
	autoReconnect?: boolean;

	/**
	 * Maximum reconnection attempts.
	 * @default 5
	 */
	maxReconnectAttempts?: number;

	/**
	 * Base delay between reconnection attempts in ms. The delay doubles with each attempt, gets
	 * up to 100 ms of random jitter, and is capped at `maxReconnectDelay`.
	 * @default 1000
	 */
	reconnectDelay?: number;

	/**
	 * Upper bound for the delay between reconnection attempts in ms.
	 * @default 30000
	 */
	maxReconnectDelay?: number;

	/**
	 * Largest server-sent event `stream()` accepts, in characters. A bigger event ends the
	 * stream with a `STREAM_EVENT_TOO_LARGE` error chunk instead of buffering without bound.
	 * @default 1048576 (1 MiB)
	 */
	maxStreamEventSize?: number;

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

	/** Emitted when connected, initialized and the tools list is loaded (or failed to load) */
	connected: (result: McpInitializeResult) => void;

	/** Emitted when disconnected */
	disconnected: (reason?: string) => void;

	/** Emitted when a reconnection attempt starts */
	reconnecting: (attempt: number, maxAttempts: number) => void;

	/**
	 * Emitted on error: a failed `connect()`, a transport error on an established connection, or
	 * once when every reconnection attempt has failed (not for each failed attempt)
	 */
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
	controller: AbortController;
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
