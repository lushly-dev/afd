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

// Re-export core helpers for convenience
export { success, failure, isSuccess, isFailure } from '@lushly-dev/afd-core';

// Schema and command definition
export {
	defineCommand,
	zodToJsonSchema,
	getRequiredFields,
	isObjectSchema,
	type ZodCommandOptions,
	type ZodCommandDefinition,
} from './schema.js';

// Server factory
export {
	createMcpServer,
	isStdinPiped,
	type McpServerOptions,
	type McpServer,
	type McpTransport,
	type CommandMiddleware,
} from './server.js';

// Validation utilities
export {
	validateInput,
	validateInputEnhanced,
	validateOrThrow,
	isValid,
	formatValidationErrors,
	formatEnhancedValidationError,
	ValidationException,
	patterns,
	optional,
	withDefault,
	type ValidationResult,
	type ValidationError,
	type SchemaInfo,
	type EnhancedValidationResult,
} from './validation.js';

// Middleware
export {
	createLoggingMiddleware,
	createTimingMiddleware,
	createRetryMiddleware,
	createTracingMiddleware,
	createRateLimitMiddleware,
	createTelemetryMiddleware,
	composeMiddleware,
	ConsoleTelemetrySink,
	type LoggingOptions,
	type TimingOptions,
	type RetryOptions,
	type TracingOptions,
	type RateLimitOptions,
	type TelemetryOptions,
	type ConsoleTelemetrySinkOptions,
	type Tracer,
	type Span,
} from './middleware.js';

// Re-export telemetry types from core for convenience
export type { TelemetryEvent, TelemetrySink } from '@lushly-dev/afd-core';
export { createTelemetryEvent, isTelemetryEvent } from '@lushly-dev/afd-core';

// Bootstrap tools
export {
	getBootstrapCommands,
	createAfdHelpCommand,
	createAfdDocsCommand,
	createAfdSchemaCommand,
} from './bootstrap/index.js';

// Handoff schemas
export {
	HandoffResultSchema,
	HandoffCredentialsSchema,
	HandoffMetadataSchema,
	type HandoffCredentialsInput,
	type HandoffCredentialsOutput,
	type HandoffMetadataInput,
	type HandoffMetadataOutput,
	type HandoffResultInput,
	type HandoffResultOutput,
} from './handoff-schema.js';

// Re-export handoff types from core for convenience
export type {
	HandoffResult,
	HandoffCredentials,
	HandoffMetadata,
	HandoffProtocol,
} from '@lushly-dev/afd-core';
export {
	isHandoff,
	isHandoffProtocol,
	isHandoffCommand,
	getHandoffProtocol,
} from '@lushly-dev/afd-core';
