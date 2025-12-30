/**
 * @fileoverview @afd/client - MCP client library for Agent-First Development
 *
 * This package provides a client for connecting to MCP servers:
 *
 * - **McpClient**: Main client class with connection management
 * - **Transports**: SSE and HTTP transports for communication
 * - **Type-safe**: Full TypeScript support with CommandResult integration
 *
 * @packageDocumentation
 */

export { McpClient, createClient } from './client.js';
export { createTransport, HttpTransport, SseTransport, type Transport } from './transport.js';
export type {
	ClientStatus,
	ConnectionState,
	McpClientConfig,
	McpClientEvents,
	PendingRequest,
	TransportType,
} from './types.js';

// Re-export core types that are commonly used with client
export type {
	CommandResult,
	McpRequest,
	McpResponse,
	McpTool,
	McpToolCallParams,
	McpToolCallResult,
} from '@afd/core';
