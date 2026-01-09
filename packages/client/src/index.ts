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

export { McpClient, createClient } from './client.js';
export { createTransport, HttpTransport, SseTransport, type Transport } from './transport.js';
export {
	DirectTransport,
	DirectClient,
	createDirectClient,
	type DirectRegistry,
	type DirectClientOptions,
	type DirectCallContext,
	type UnknownToolError,
	type CommandDefinition,
	type CommandParameter,
} from './direct.js';
export type {
	ClientStatus,
	ConnectionState,
	McpClientConfig,
	McpClientEvents,
	PendingRequest,
	TransportType,
} from './types.js';

// Handoff protocol handlers and utilities
export {
	// Type guards (re-exported from core)
	isHandoff,
	isHandoffProtocol,
	// Protocol handler registry
	registerProtocolHandler,
	unregisterProtocolHandler,
	getProtocolHandler,
	hasProtocolHandler,
	listProtocolHandlers,
	clearProtocolHandlers,
	// Connection utilities
	connectHandoff,
	createReconnectingHandoff,
	// Helper functions
	buildAuthenticatedEndpoint,
	parseHandoffEndpoint,
	isHandoffExpired,
	getHandoffTTL,
	// Types
	type HandoffResult,
	type HandoffCredentials,
	type HandoffMetadata,
	type HandoffProtocol,
	type HandoffConnectionState,
	type HandoffConnection,
	type HandoffConnectionOptions,
	type ProtocolHandler,
	type ReconnectionOptions,
	type ReconnectingHandoffConnection,
} from './handoff.js';

// Re-export core types that are commonly used with client
export type {
	CommandResult,
	McpRequest,
	McpResponse,
	McpTool,
	McpToolCallParams,
	McpToolCallResult,
} from '@lushly-dev/afd-core';
