/**
 * @fileoverview Command middleware utilities
 *
 * Middleware functions that can be applied to command execution
 * for logging, tracing, rate limiting, etc.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { CommandMiddleware } from './server.js';

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for logging middleware.
 */
export interface LoggingOptions {
	/** Log function (defaults to console.log) */
	log?: (message: string, data?: unknown) => void;

	/** Include input in logs (may contain sensitive data) */
	logInput?: boolean;

	/** Include full result in logs */
	logResult?: boolean;
}

/**
 * Create a logging middleware.
 *
 * @example
 * ```typescript
 * const server = createMcpServer({
 *   // ...
 *   middleware: [
 *     createLoggingMiddleware({ logInput: true }),
 *   ],
 * });
 * ```
 */
export function createLoggingMiddleware(
	options: LoggingOptions = {}
): CommandMiddleware {
	const { log = console.log, logInput = false, logResult = false } = options;

	return async (commandName, input, context, next) => {
		const startTime = Date.now();
		const traceId = context.traceId ?? 'no-trace';

		log(`[${traceId}] Executing: ${commandName}`, logInput ? { input } : undefined);

		try {
			const result = await next();
			const duration = Date.now() - startTime;

			log(
				`[${traceId}] Completed: ${commandName} (${duration}ms) - ${result.success ? 'SUCCESS' : 'FAILURE'}`,
				logResult ? { result } : undefined
			);

			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			log(`[${traceId}] Error: ${commandName} (${duration}ms)`, { error });
			throw error;
		}
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMING MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for timing middleware.
 */
export interface TimingOptions {
	/** Slow threshold in ms (logs warning if exceeded) */
	slowThreshold?: number;

	/** Warning function */
	onSlow?: (commandName: string, durationMs: number) => void;
}

/**
 * Create a timing middleware that tracks execution duration.
 */
export function createTimingMiddleware(
	options: TimingOptions = {}
): CommandMiddleware {
	const {
		slowThreshold = 1000,
		onSlow = (name, ms) => console.warn(`Slow command: ${name} took ${ms}ms`),
	} = options;

	return async (commandName, input, context, next) => {
		const startTime = Date.now();
		const result = await next();
		const duration = Date.now() - startTime;

		if (duration > slowThreshold) {
			onSlow(commandName, duration);
		}

		return result;
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for retry middleware.
 */
export interface RetryOptions {
	/** Maximum number of retries */
	maxRetries?: number;

	/** Delay between retries in ms */
	retryDelay?: number;

	/** Whether to retry based on error code */
	shouldRetry?: (errorCode: string) => boolean;
}

/**
 * Create a retry middleware for transient failures.
 */
export function createRetryMiddleware(
	options: RetryOptions = {}
): CommandMiddleware {
	const {
		maxRetries = 3,
		retryDelay = 100,
		shouldRetry = (code) => code === 'TRANSIENT_ERROR' || code === 'TIMEOUT',
	} = options;

	return async (commandName, input, context, next) => {
		let lastResult: CommandResult | undefined;
		let attempts = 0;

		while (attempts <= maxRetries) {
			const result = await next();

			if (result.success) {
				return result;
			}

			lastResult = result;

			// Check if we should retry
			if (result.error && shouldRetry(result.error.code)) {
				attempts++;
				if (attempts <= maxRetries) {
					await sleep(retryDelay * attempts); // Exponential backoff
					continue;
				}
			}

			// Not retryable or max retries reached
			break;
		}

		return lastResult!;
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRACING MIDDLEWARE (OpenTelemetry-compatible)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Span interface compatible with OpenTelemetry.
 */
export interface Span {
	setAttribute(key: string, value: string | number | boolean): void;
	setStatus(status: { code: number; message?: string }): void;
	end(): void;
}

/**
 * Tracer interface compatible with OpenTelemetry.
 */
export interface Tracer {
	startActiveSpan<T>(
		name: string,
		fn: (span: Span) => Promise<T>
	): Promise<T>;
}

/**
 * Options for tracing middleware.
 */
export interface TracingOptions {
	/** OpenTelemetry tracer instance */
	tracer: Tracer;

	/** Span name prefix */
	spanPrefix?: string;
}

/**
 * Create a tracing middleware for OpenTelemetry integration.
 *
 * @example
 * ```typescript
 * import { trace } from '@opentelemetry/api';
 *
 * const tracer = trace.getTracer('my-app');
 *
 * const server = createMcpServer({
 *   // ...
 *   middleware: [
 *     createTracingMiddleware({ tracer }),
 *   ],
 * });
 * ```
 */
export function createTracingMiddleware(
	options: TracingOptions
): CommandMiddleware {
	const { tracer, spanPrefix = 'command' } = options;

	return async (commandName, input, context, next) => {
		return tracer.startActiveSpan(`${spanPrefix}.${commandName}`, async (span) => {
			span.setAttribute('command.name', commandName);
			span.setAttribute('command.trace_id', context.traceId ?? 'none');

			try {
				const result = await next();

				span.setAttribute('command.success', result.success);
				if (!result.success && result.error) {
					span.setAttribute('error.code', result.error.code);
					span.setStatus({ code: 2, message: result.error.message });
				} else {
					span.setStatus({ code: 1 });
				}

				if (result.confidence !== undefined) {
					span.setAttribute('command.confidence', result.confidence);
				}

				span.end();
				return result;
			} catch (error) {
				span.setAttribute('error', true);
				span.setStatus({
					code: 2,
					message: error instanceof Error ? error.message : 'Unknown error',
				});
				span.end();
				throw error;
			}
		});
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMITING MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for rate limiting middleware.
 */
export interface RateLimitOptions {
	/** Maximum requests per window */
	maxRequests: number;

	/** Window size in ms */
	windowMs: number;

	/** Key function to identify clients (defaults to 'global') */
	keyFn?: (context: CommandContext) => string;
}

/**
 * Create a simple in-memory rate limiting middleware.
 */
export function createRateLimitMiddleware(
	options: RateLimitOptions
): CommandMiddleware {
	const { maxRequests, windowMs, keyFn = () => 'global' } = options;
	const windows = new Map<string, { count: number; resetAt: number }>();

	return async (_commandName, _input, context, next) => {
		const key = keyFn(context);
		const now = Date.now();

		let window = windows.get(key);
		if (!window || now >= window.resetAt) {
			window = { count: 0, resetAt: now + windowMs };
			windows.set(key, window);
		}

		if (window.count >= maxRequests) {
			const { failure } = await import('@afd/core');
			return failure({
				code: 'RATE_LIMITED',
				message: 'Too many requests',
				suggestion: `Try again in ${Math.ceil((window.resetAt - now) / 1000)} seconds`,
				retryable: true,
			});
		}

		window.count++;
		return next();
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compose multiple middleware functions into one.
 */
export function composeMiddleware(
	...middlewares: CommandMiddleware[]
): CommandMiddleware {
	return async (commandName, input, context, next) => {
		let index = 0;

		const dispatch = async (): Promise<CommandResult> => {
			if (index >= middlewares.length) {
				return next();
			}

			const middleware = middlewares[index++]!;
			return middleware(commandName, input, context, dispatch);
		};

		return dispatch();
	};
}
