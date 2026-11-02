/**
 * @fileoverview Browser-safe entry point: `@lushly-dev/afd-client/streamable-http`
 *
 * The package's first browser entry. It exports the MCP Streamable HTTP transport alone, on the
 * official MCP SDK's client, for a browser, web worker or webview. It loads none of `McpClient`,
 * the deprecated `sse` and `http` transports or this package's `eventsource` dependency.
 *
 * The root entry (`@lushly-dev/afd-client`) still exports the transport for Node.js hosts.
 *
 * Module-graph rule: everything but the transport is a type, so no runtime import reaches
 * `transport.ts` or `@lushly-dev/afd-core`. `entry-points.test.ts` bundles this entry with esbuild
 * for the browser to enforce the rule and a size budget.
 *
 * @packageDocumentation
 */

export type {
	McpInitializeResult,
	McpRequest,
	McpResponse,
	McpTool,
	McpToolCallParams,
	McpToolCallResult,
} from '@lushly-dev/afd-core';
export {
	MODERN_PROTOCOL_VERSION,
	type StreamableHttpMode,
	StreamableHttpTransport,
	type StreamableHttpTransportOptions,
} from './streamable-http-transport.js';
export type { Transport } from './transport.js';
export type { ElicitationHandler, ElicitationRequest, ElicitationResponse } from './types.js';
