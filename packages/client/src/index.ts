/**
 * @fileoverview @lushly-dev/afd-client - MCP client library for Agent-First Development
 *
 * This package provides clients for AFD command servers:
 *
 * - **McpClient**: Client for AFD MCP servers (`createMcpServer()`), with connection management
 * - **Transports**: SSE and HTTP for AFD servers, direct for an in-process registry
 * - **DirectClient**: Zero-overhead in-process command execution
 * - **Type-safe**: Full TypeScript support with CommandResult integration
 * - **Handoff Support**: Protocol handlers for streaming connections
 *
 * McpClient does not implement the MCP Streamable HTTP transport, so it cannot talk to servers
 * built on the official MCP SDK.
 *
 * @packageDocumentation
 */

// Re-export core types that are commonly used with client
export type {
	CommandMiddleware,
	CommandResult,
	McpRequest,
	McpResponse,
	McpTool,
	McpToolCallParams,
	McpToolCallResult,
} from '@lushly-dev/afd-core';
export {
	createClient,
	McpClient,
	type RequestOptions,
	SERVER_DEADLINE_MARGIN_MS,
} from './client.js';
export {
	HttpStatusError,
	JsonRpcResponseError,
	NotConnectedError,
	RequestTimeoutError,
} from './client-errors.js';
export {
	type CommandDefinition,
	type CommandParameter,
	createDirectClient,
	type DirectCallContext,
	DirectClient,
	type DirectClientOptions,
	type DirectRegistry,
	DirectTransport,
	isUnknownToolError,
	type UnknownToolError,
} from './direct.js';
// Built-in protocol handlers
export { builtinHandlers, sseHandler, websocketHandler } from './handlers.js';
// Handoff protocol handlers and utilities
export {
	// Helper functions
	buildAuthenticatedEndpoint,
	clearProtocolHandlers,
	// Connection utilities
	connectHandoff,
	createReconnectingHandoff,
	getHandoffTTL,
	getProtocolHandler,
	type HandoffCommandClient,
	type HandoffConnection,
	type HandoffConnectionOptions,
	type HandoffConnectionState,
	type HandoffCredentials,
	type HandoffMetadata,
	type HandoffProtocol,
	// Types
	type HandoffResult,
	hasProtocolHandler,
	// Type guards (re-exported from core)
	isHandoff,
	isHandoffExpired,
	isHandoffProtocol,
	listProtocolHandlers,
	type ProtocolHandler,
	parseHandoffEndpoint,
	type ReconnectingHandoffConnection,
	type ReconnectionOptions,
	// Protocol handler registry
	registerProtocolHandler,
	unregisterProtocolHandler,
} from './handoff.js';
export { createTransport, HttpTransport, SseTransport, type Transport } from './transport.js';
export type {
	ClientStatus,
	ConnectionState,
	McpClientConfig,
	McpClientEvents,
	McpTransportType,
	PendingRequest,
	TransportType,
} from './types.js';
