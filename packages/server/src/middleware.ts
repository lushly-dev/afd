/**
 * @fileoverview Command middleware utilities
 *
 * Middleware functions that can be applied to command execution
 * for logging, tracing, rate limiting, telemetry, etc.
 */

import type {
	CommandContext,
	CommandMiddleware,
	CommandResult,
	TelemetryEvent,
	TelemetrySink,
} from '@lushly-dev/afd-core';
import { createTelemetryEvent } from '@lushly-dev/afd-core';

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO TRACE ID MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for auto trace ID middleware.
 */
export interface TraceIdOptions {
	/**
	 * Function to generate trace IDs.
	 * Default: () => crypto.randomUUID()
	 */
	generate?: () => string;
}

/**
 * Create a middleware that auto-generates `context.traceId` when not present.
 *
 * Named "Auto" to distinguish from `createTracingMiddleware` which creates
 * OpenTelemetry spans. This middleware only ensures a traceId exists in context
 * so that the base handler can propagate it to `result.metadata.traceId`.
 *
 * Must be outermost middleware so that logging and timing see the generated traceId.
 *
 * @example
 * ```typescript
 * const server = createMcpServer({
 *   middleware: [createAutoTraceIdMiddleware()],
 * });
 * ```
 */
export function createAutoTraceIdMiddleware(options: TraceIdOptions = {}): CommandMiddleware {
	const { generate = () => crypto.randomUUID() } = options;

	return async (_commandName, _input, context, next) => {
		if (!context.traceId) {
			context.traceId = generate();
		}
		return next();
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT MIDDLEWARE FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for the default middleware bundle.
 */
export interface DefaultMiddlewareOptions {
	/**
	 * Logging options, or `false` to disable logging middleware entirely.
	 * Default: enabled with default LoggingOptions.
	 */
	logging?: LoggingOptions | false;

	/**
	 * Timing (slow-command warning) options, or `false` to disable.
	 * Default: enabled with 1000ms threshold.
	 */
	timing?: TimingOptions | false;

	/**
	 * Trace ID auto-generation options, or `false` to disable.
	 * Default: enabled with crypto.randomUUID().
	 */
	traceId?: TraceIdOptions | false;
}

/**
 * Returns a pre-configured array of middleware covering common
 * observability needs: trace ID generation, structured logging,
 * and slow-command warnings.
 *
 * Designed to complement — not duplicate — the base handler's
 * built-in executionTimeMs, commandVersion, and traceId propagation.
 *
 * **Note:** The logging/timing middleware duration measures the full
 * middleware + handler chain, which is broader than
 * `result.metadata.executionTimeMs` (handler-only).
 *
 * @example Zero-config
 * ```typescript
 * const server = createMcpServer({
 *   middleware: defaultMiddleware(),
 * });
 * ```
 *
 * @example Selective disable
 * ```typescript
 * defaultMiddleware({ timing: false, logging: false });
 * // Returns [autoTraceIdMiddleware] only
 * ```
 */
export function defaultMiddleware(options: DefaultMiddlewareOptions = {}): CommandMiddleware[] {
	const stack: CommandMiddleware[] = [];

	// 1. Trace ID (outermost — ensures ID exists for logging/timing)
	if (options.traceId !== false) {
		stack.push(
			createAutoTraceIdMiddleware(options.traceId === undefined ? undefined : options.traceId)
		);
	}

	// 2. Logging
	if (options.logging !== false) {
		stack.push(
			createLoggingMiddleware(options.logging === undefined ? undefined : options.logging)
		);
	}

	// 3. Timing (slow-command warnings)
	if (options.timing !== false) {
		stack.push(createTimingMiddleware(options.timing === undefined ? undefined : options.timing));
	}

	return stack;
}

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
export function createLoggingMiddleware(options: LoggingOptions = {}): CommandMiddleware {
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
 *
 * @example
 * ```typescript
 * const server = createMcpServer({
 *   // ...
 *   middleware: [
 *     createTimingMiddleware({
 *       slowThreshold: 500,
 *       onSlow: (name, ms) => logger.warn(`Slow command: ${name} (${ms}ms)`),
 *     }),
 *   ],
 * });
 * ```
 */
export function createTimingMiddleware(options: TimingOptions = {}): CommandMiddleware {
	const {
		slowThreshold = 1000,
		onSlow = (name, ms) => console.warn(`Slow command: ${name} took ${ms}ms`),
	} = options;

	return async (commandName, _input, _context, next) => {
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
 *
 * @example
 * ```typescript
 * const server = createMcpServer({
 *   // ...
 *   middleware: [
 *     createRetryMiddleware({
 *       maxRetries: 3,
 *       retryDelay: 200,
 *       shouldRetry: (code) => code === 'TRANSIENT_ERROR' || code === 'TIMEOUT',
 *     }),
 *   ],
 * });
 * ```
 */
export function createRetryMiddleware(options: RetryOptions = {}): CommandMiddleware {
	const {
		maxRetries = 3,
		retryDelay = 100,
		shouldRetry = (code) => code === 'TRANSIENT_ERROR' || code === 'TIMEOUT',
	} = options;

	return async (_commandName, _input, _context, next) => {
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

		if (!lastResult) {
			const { failure } = await import('@lushly-dev/afd-core');
			return failure({
				code: 'RETRY_EXHAUSTED',
				message: 'No result after retry attempts',
				suggestion: 'Check the command implementation',
			});
		}
		return lastResult;
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
	startActiveSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>;
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
export function createTracingMiddleware(options: TracingOptions): CommandMiddleware {
	const { tracer, spanPrefix = 'command' } = options;

	return async (commandName, _input, context, next) => {
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
 *
 * @example
 * ```typescript
 * const server = createMcpServer({
 *   // ...
 *   middleware: [
 *     createRateLimitMiddleware({
 *       maxRequests: 100,
 *       windowMs: 60_000, // 100 requests per minute
 *       keyFn: (ctx) => ctx.traceId ?? 'global',
 *     }),
 *   ],
 * });
 * ```
 */
export function createRateLimitMiddleware(options: RateLimitOptions): CommandMiddleware {
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
			const { failure } = await import('@lushly-dev/afd-core');
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
// TELEMETRY MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for telemetry middleware.
 */
export interface TelemetryOptions {
	/** Telemetry sink to record events to */
	sink: TelemetrySink;

	/**
	 * Include command input in telemetry events.
	 * Warning: May contain sensitive data. Default: false.
	 */
	includeInput?: boolean;

	/**
	 * Include result metadata in telemetry events.
	 * Default: true.
	 */
	includeMetadata?: boolean;

	/**
	 * Filter function to determine which commands to track.
	 * Return true to track, false to skip.
	 * Default: track all commands.
	 */
	filter?: (commandName: string) => boolean;
}

/**
 * Create a telemetry middleware that records command execution events.
 *
 * @example
 * ```typescript
 * import { createTelemetryMiddleware, ConsoleTelemetrySink } from '@lushly-dev/afd-server';
 *
 * const server = createMcpServer({
 *   // ...
 *   middleware: [
 *     createTelemetryMiddleware({
 *       sink: new ConsoleTelemetrySink(),
 *     }),
 *   ],
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Custom sink with filtering
 * const server = createMcpServer({
 *   middleware: [
 *     createTelemetryMiddleware({
 *       sink: customDatabaseSink,
 *       includeInput: false, // Don't log potentially sensitive input
 *       filter: (name) => !name.startsWith('internal.'), // Skip internal commands
 *     }),
 *   ],
 * });
 * ```
 */
export function createTelemetryMiddleware(options: TelemetryOptions): CommandMiddleware {
	const { sink, includeInput = false, includeMetadata = true, filter = () => true } = options;

	return async (commandName, input, context, next) => {
		// Skip if filtered out
		if (!filter(commandName)) {
			return next();
		}

		const startedAt = new Date().toISOString();
		const startTime = Date.now();

		let result: CommandResult | undefined;
		let thrownError: Error | undefined;

		try {
			result = await next();
		} catch (error) {
			thrownError = error instanceof Error ? error : new Error(String(error));
			// Re-throw after recording telemetry
			throw error;
		} finally {
			const completedAt = new Date().toISOString();
			const durationMs = Date.now() - startTime;

			const event: TelemetryEvent = createTelemetryEvent({
				commandName,
				startedAt,
				completedAt,
				durationMs,
				success: thrownError ? false : (result?.success ?? false),
				...(thrownError && {
					error: {
						code: 'UNHANDLED_ERROR',
						message: thrownError.message,
					},
				}),
				...(!thrownError && !result?.success && result?.error && { error: result?.error }),
				...(context.traceId && { traceId: context.traceId }),
				...(includeInput && { input }),
				...(!thrownError && result?.confidence !== undefined && { confidence: result?.confidence }),
				...(!thrownError && includeMetadata && result?.metadata && { metadata: result?.metadata }),
				...(!thrownError &&
					result?.metadata?.commandVersion && {
						commandVersion: result?.metadata.commandVersion as string,
					}),
			});

			// Record asynchronously - don't block command execution
			try {
				const recordResult = sink.record(event);
				if (recordResult instanceof Promise) {
					// Fire and forget, but catch errors to prevent unhandled rejections
					recordResult.catch(() => {
						// Silently ignore sink errors to prevent affecting command execution
					});
				}
			} catch {
				// Silently ignore sink errors to prevent affecting command execution
			}
		}

		if (!result) {
			const { failure } = await import('@lushly-dev/afd-core');
			return failure({
				code: 'TELEMETRY_NO_RESULT',
				message: 'Command did not produce a result',
				suggestion: 'Check the command implementation',
			});
		}
		return result;
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSOLE TELEMETRY SINK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for the console telemetry sink.
 */
export interface ConsoleTelemetrySinkOptions {
	/**
	 * Log function to use.
	 * Default: console.log
	 */
	log?: (message: string) => void;

	/**
	 * Whether to format output as JSON.
	 * Default: false (human-readable format)
	 */
	json?: boolean;

	/**
	 * Prefix for log messages.
	 * Default: '[Telemetry]'
	 */
	prefix?: string;
}

/**
 * Default telemetry sink that logs events to the console.
 *
 * @example
 * ```typescript
 * // Human-readable output (default)
 * const sink = new ConsoleTelemetrySink();
 *
 * // JSON output for log aggregation
 * const jsonSink = new ConsoleTelemetrySink({ json: true });
 *
 * // Custom logger
 * const customSink = new ConsoleTelemetrySink({
 *   log: (msg) => myLogger.info(msg),
 *   prefix: '[CMD]',
 * });
 * ```
 */
export class ConsoleTelemetrySink implements TelemetrySink {
	private readonly log: (message: string) => void;
	private readonly json: boolean;
	private readonly prefix: string;

	constructor(options: ConsoleTelemetrySinkOptions = {}) {
		this.log = options.log ?? console.log;
		this.json = options.json ?? false;
		this.prefix = options.prefix ?? '[Telemetry]';
	}

	record(event: TelemetryEvent): void {
		if (this.json) {
			this.log(JSON.stringify({ ...event, _prefix: this.prefix }));
		} else {
			const status = event.success ? 'SUCCESS' : 'FAILURE';
			const traceInfo = event.traceId ? ` [${event.traceId}]` : '';
			const confidenceInfo =
				event.confidence !== undefined ? ` (confidence: ${event.confidence})` : '';
			const errorInfo = event.error ? ` - ${event.error.code}: ${event.error.message}` : '';

			this.log(
				`${this.prefix}${traceInfo} ${event.commandName} ${status} in ${event.durationMs}ms${confidenceInfo}${errorInfo}`
			);
		}
	}

	flush(): void {
		// Console sink doesn't buffer, nothing to flush
	}
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
export function composeMiddleware(...middlewares: CommandMiddleware[]): CommandMiddleware {
	return async (commandName, input, context, next) => {
		let index = 0;

		const dispatch = async (): Promise<CommandResult> => {
			if (index >= middlewares.length) {
				return next();
			}

			const middleware = middlewares[index++];
			if (!middleware) {
				return next();
			}
			return middleware(commandName, input, context, dispatch);
		};

		return dispatch();
	};
}
