/**
 * @fileoverview @lushly-dev/afd-client - MCP client library for Agent-First Development
 *
 * This package provides a client for connecting to MCP servers:
 *
 * - **McpClient**: Main client class with connection management
 * - **Transports**: SSE and HTTP transports for communication
 * - **Type-safe**: Full TypeScript support with CommandResult integration
 * - **Handoff Support**: Protocol handlers for streaming connections
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
export { createClient, McpClient } from './client.js';
export {
	type CommandDefinition,
	type CommandParameter,
	createDirectClient,
	type DirectCallContext,
	DirectClient,
	type DirectClientOptions,
	type DirectRegistry,
	DirectTransport,
	type UnknownToolError,
} from './direct.js';
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
	PendingRequest,
	TransportType,
} from './types.js';
