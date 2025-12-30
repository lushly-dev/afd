/**
 * @fileoverview @afd/server - Server-side utilities for AFD
 *
 * This package provides tools for building MCP servers with:
 * - Zod-based command definitions with automatic validation
 * - MCP server factory with SSE/HTTP support
 * - Middleware for logging, tracing, rate limiting
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { defineCommand, createMcpServer, success } from '@afd/server';
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
 * const server = createMcpServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   commands: [greet],
 * });
 *
 * await server.start();
 * ```
 *
 * @packageDocumentation
 */

// Re-export core helpers for convenience
export { success, failure, isSuccess, isFailure } from '@afd/core';

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
	type McpServerOptions,
	type McpServer,
	type CommandMiddleware,
} from './server.js';

// Validation utilities
export {
	validateInput,
	validateOrThrow,
	isValid,
	formatValidationErrors,
	ValidationException,
	patterns,
	optional,
	withDefault,
	type ValidationResult,
	type ValidationError,
} from './validation.js';

// Middleware
export {
	createLoggingMiddleware,
	createTimingMiddleware,
	createRetryMiddleware,
	createTracingMiddleware,
	createRateLimitMiddleware,
	composeMiddleware,
	type LoggingOptions,
	type TimingOptions,
	type RetryOptions,
	type TracingOptions,
	type RateLimitOptions,
	type Tracer,
	type Span,
} from './middleware.js';
