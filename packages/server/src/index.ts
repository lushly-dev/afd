/**
 * @fileoverview @lushly-dev/afd-server - Server-side utilities for AFD
 *
 * This package provides tools for building MCP servers with:
 * - Zod-based command definitions with automatic validation
 * - MCP server factory with multiple transport support:
 *   - stdio: For IDE/agent integration (Cursor, Claude Code, Antigravity)
 *   - http/SSE: For browser-based clients and web UIs
 *   - auto: Auto-detect based on environment (default)
 * - Middleware for logging, tracing, rate limiting
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { defineCommand, createMcpServer, success } from '@lushly-dev/afd-server';
 *
 * const greet = defineCommand({
 *   name: 'greet',
 *   description: 'Greet a user',
 *   input: z.object({
 *     name: z.string(),
 *   }),
 *   async handler(input) {
 *     return success({ message: `Hello, ${input.name}!` });
 *   },
 * });
 *
 * // Auto-detect transport (recommended)
 * const server = createMcpServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   commands: [greet],
 * });
 *
 * // Or explicitly set transport for IDE integration
 * const stdioServer = createMcpServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   commands: [greet],
 *   transport: 'stdio',
 * });
 *
 * await server.start();
 * ```
 *
 * @packageDocumentation
 */

// Re-export telemetry types from core for convenience
// Re-export handoff types from core for convenience
// Server factory
export type {
	CommandMiddleware,
	HandoffCredentials,
	HandoffMetadata,
	HandoffProtocol,
	HandoffResult,
	TelemetryEvent,
	TelemetrySink,
} from '@lushly-dev/afd-core';
// Re-export core helpers for convenience
export {
	createTelemetryEvent,
	failure,
	getHandoffProtocol,
	isFailure,
	isHandoff,
	isHandoffCommand,
	isHandoffProtocol,
	isSuccess,
	isTelemetryEvent,
	success,
} from '@lushly-dev/afd-core';
// Bootstrap tools
export {
	createAfdDocsCommand,
	createAfdHelpCommand,
	createAfdSchemaCommand,
	getBootstrapCommands,
} from './bootstrap/index.js';
// Handoff schemas
export {
	type HandoffCredentialsInput,
	type HandoffCredentialsOutput,
	HandoffCredentialsSchema,
	type HandoffMetadataInput,
	type HandoffMetadataOutput,
	HandoffMetadataSchema,
	type HandoffResultInput,
	type HandoffResultOutput,
	HandoffResultSchema,
} from './handoff-schema.js';
// Middleware
export {
	ConsoleTelemetrySink,
	type ConsoleTelemetrySinkOptions,
	composeMiddleware,
	createAutoTraceIdMiddleware,
	createLoggingMiddleware,
	createRateLimitMiddleware,
	createRetryMiddleware,
	createTelemetryMiddleware,
	createTimingMiddleware,
	createTracingMiddleware,
	type DefaultMiddlewareOptions,
	defaultMiddleware,
	type LoggingOptions,
	type RateLimitOptions,
	type RetryOptions,
	type Span,
	type TelemetryOptions,
	type TimingOptions,
	type TraceIdOptions,
	type Tracer,
	type TracingOptions,
} from './middleware.js';
// Schema and command definition
export {
	defineCommand,
	getRequiredFields,
	isObjectSchema,
	type ZodCommandDefinition,
	type ZodCommandOptions,
	zodToJsonSchema,
} from './schema.js';
export {
	createMcpServer,
	isStdinPiped,
	type McpServer,
	type McpServerOptions,
	type McpTransport,
} from './server.js';
// Validation utilities
export {
	type EnhancedValidationResult,
	formatEnhancedValidationError,
	formatValidationErrors,
	isValid,
	optional,
	patterns,
	type SchemaInfo,
	type ValidationError,
	ValidationException,
	type ValidationResult,
	validateInput,
	validateInputEnhanced,
	validateOrThrow,
	withDefault,
} from './validation.js';
