/**
 * @fileoverview Error types for AFD commands
 *
 * Errors should be actionable - they tell the user what went wrong
 * AND what they can do about it.
 */

/**
 * Standard error structure for command failures.
 *
 * All errors should be actionable - users should know what to do next.
 *
 * @example
 * ```typescript
 * const error: CommandError = {
 *   code: 'RATE_LIMITED',
 *   message: 'API rate limit exceeded',
 *   suggestion: 'Wait 60 seconds and try again, or upgrade to a higher tier',
 *   retryable: true,
 *   details: { retryAfterSeconds: 60 }
 * };
 * ```
 */
export interface CommandError {
	/**
	 * Machine-readable error code.
	 *
	 * Use SCREAMING_SNAKE_CASE for consistency.
	 * Should be unique within your application.
	 *
	 * @example 'DOCUMENT_NOT_FOUND', 'VALIDATION_ERROR', 'RATE_LIMITED'
	 */
	code: string;

	/**
	 * Human-readable error message.
	 *
	 * Should be clear and concise, describing what went wrong.
	 */
	message: string;

	/**
	 * What the user can do about this error.
	 *
	 * This is the most important field for UX - it turns an error
	 * from a dead-end into a recoverable situation.
	 *
	 * @example "Check the document ID and try again"
	 * @example "Wait 60 seconds and retry"
	 * @example "Contact support if this persists"
	 */
	suggestion?: string;

	/**
	 * Whether retrying the same request might succeed.
	 *
	 * - `true`: Transient error, retry may work (rate limits, timeouts)
	 * - `false`: Permanent error, retry won't help (not found, validation)
	 * - `undefined`: Unknown, treat as non-retryable
	 */
	retryable?: boolean;

	/**
	 * Additional technical details for debugging.
	 *
	 * Request IDs, timestamps, resource identifiers, etc. Details are sent to
	 * the caller, so avoid sensitive information: stack traces belong here only
	 * in development (`devMode`).
	 */
	details?: Record<string, unknown>;

	/**
	 * The `CommandError` that caused this error, if any.
	 *
	 * Serialized causes are always `CommandError`s. The core helpers never put a
	 * native `Error` here as an enumerable property: `wrapError()` keeps only a
	 * `CommandError` cause, and `internalError()` attaches its `Error` cause
	 * non-enumerably, so it is available to in-process logging but never
	 * serialized. The `Error` type is kept for compatibility.
	 */
	cause?: CommandError | Error;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STANDARD ERROR CODES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Standard error codes for common scenarios.
 *
 * Use these for consistency across AFD applications.
 */
export const ErrorCodes = {
	// Validation Errors (4xx range)
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	INVALID_INPUT: 'INVALID_INPUT',
	MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
	INVALID_FORMAT: 'INVALID_FORMAT',

	// Resource Errors
	NOT_FOUND: 'NOT_FOUND',
	ALREADY_EXISTS: 'ALREADY_EXISTS',
	CONFLICT: 'CONFLICT',

	// Authorization Errors
	UNAUTHORIZED: 'UNAUTHORIZED',
	FORBIDDEN: 'FORBIDDEN',
	TOKEN_EXPIRED: 'TOKEN_EXPIRED',

	// Rate Limiting
	RATE_LIMITED: 'RATE_LIMITED',
	QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

	// Network/Service Errors
	SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
	TIMEOUT: 'TIMEOUT',
	CONNECTION_ERROR: 'CONNECTION_ERROR',

	// Internal Errors
	INTERNAL_ERROR: 'INTERNAL_ERROR',
	NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
	UNKNOWN_ERROR: 'UNKNOWN_ERROR',

	// Command-specific
	COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
	INVALID_COMMAND_ARGS: 'INVALID_COMMAND_ARGS',
	COMMAND_CANCELLED: 'COMMAND_CANCELLED',
	COMMAND_EXECUTION_ERROR: 'COMMAND_EXECUTION_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a CommandError with standard fields.
 */
export function createError(
	code: string,
	message: string,
	options?: Omit<CommandError, 'code' | 'message'>
): CommandError {
	return {
		code,
		message,
		...options,
	};
}

/**
 * Create a validation error.
 */
export function validationError(message: string, details?: Record<string, unknown>): CommandError {
	return createError(ErrorCodes.VALIDATION_ERROR, message, {
		suggestion: 'Check the input and try again',
		retryable: false,
		details,
	});
}

/**
 * Create a not found error.
 */
export function notFoundError(resourceType: string, resourceId: string): CommandError {
	return createError(ErrorCodes.NOT_FOUND, `${resourceType} with ID '${resourceId}' not found`, {
		suggestion: `Verify the ${resourceType.toLowerCase()} ID exists and try again`,
		retryable: false,
		details: { resourceType, resourceId },
	});
}

/**
 * Create a rate limit error.
 */
export function rateLimitError(retryAfterSeconds?: number): CommandError {
	const suggestion = retryAfterSeconds
		? `Wait ${retryAfterSeconds} seconds and try again`
		: 'Wait a moment and try again';

	return createError(ErrorCodes.RATE_LIMITED, 'Rate limit exceeded', {
		suggestion,
		retryable: true,
		details: retryAfterSeconds ? { retryAfterSeconds } : undefined,
	});
}

/**
 * Create a timeout error.
 */
export function timeoutError(operationName: string, timeoutMs: number): CommandError {
	return createError(
		ErrorCodes.TIMEOUT,
		`Operation '${operationName}' timed out after ${timeoutMs}ms`,
		{
			suggestion: 'Try again with a simpler request or contact support if this persists',
			retryable: true,
			details: { operationName, timeoutMs },
		}
	);
}

const DEFAULT_SUGGESTION = 'Please try again. If this persists, contact support.';

/** Define a property that in-process code can read but that is never serialized or spread. */
function defineHidden(target: object, key: string, value: unknown): void {
	Object.defineProperty(target, key, {
		value,
		enumerable: false,
		writable: true,
		configurable: true,
	});
}

/**
 * Create an internal error (use sparingly - prefer specific errors).
 *
 * The `cause` is attached as a non-enumerable property: `error.cause` still
 * returns it for in-process logging, but it is never serialized, so a native
 * error's own fields (such as a Node system error's `path`) cannot reach the
 * caller.
 */
export function internalError(message: string, cause?: Error): CommandError {
	const error = createError(ErrorCodes.INTERNAL_ERROR, message, {
		suggestion: DEFAULT_SUGGESTION,
		retryable: true,
	});
	if (cause !== undefined) {
		defineHidden(error, 'cause', cause);
	}
	return error;
}

/**
 * Whether a value is a native `Error`, including one from another realm.
 */
function isNativeError(value: unknown): value is Error {
	return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]';
}

/**
 * Wrap an unknown error in a CommandError.
 *
 * - A `CommandError` is returned unchanged.
 * - A native `Error` becomes a new plain `CommandError` built only from its
 *   `message` and, when present and correctly typed, its own `code`,
 *   `suggestion` and `retryable` fields, so structured errors such as
 *   `AuthAdapterError` keep their code. Every other field, such as a Node
 *   system error's `errno`, `syscall` and `path`, is dropped. `cause` is set
 *   only when the error's cause is itself a `CommandError`. The stack is never
 *   put in `details`: it is kept on a non-enumerable `stack` property for
 *   logging, and is not serialized.
 * - Any other value becomes `UNKNOWN_ERROR` with its string form as the message.
 */
export function wrapError(error: unknown): CommandError {
	if (isCommandError(error)) {
		return error;
	}

	if (isNativeError(error)) {
		const fields = error as Error & { code?: unknown; suggestion?: unknown; retryable?: unknown };
		const code =
			typeof fields.code === 'string' && fields.code.length > 0
				? fields.code
				: ErrorCodes.INTERNAL_ERROR;
		const wrapped = createError(code, error.message, {
			suggestion: typeof fields.suggestion === 'string' ? fields.suggestion : DEFAULT_SUGGESTION,
			retryable: typeof fields.retryable === 'boolean' ? fields.retryable : true,
		});
		if (isCommandError(error.cause)) {
			wrapped.cause = error.cause;
		}
		if (error.stack !== undefined) {
			defineHidden(wrapped, 'stack', error.stack);
		}
		return wrapped;
	}

	return createError(ErrorCodes.UNKNOWN_ERROR, String(error), {
		suggestion: DEFAULT_SUGGESTION,
		retryable: true,
	});
}

/**
 * Type guard to check if a value is a CommandError.
 *
 * A CommandError is a plain object with a string `code` and `message`. Native
 * `Error` instances are rejected even when they carry a string `code`, as Node
 * system errors (`ENOENT`, ...) do: they do not serialize as CommandErrors and
 * their own fields can expose file paths. Convert them with `wrapError()`.
 */
export function isCommandError(value: unknown): value is CommandError {
	return (
		typeof value === 'object' &&
		value !== null &&
		!isNativeError(value) &&
		typeof (value as { code?: unknown }).code === 'string' &&
		typeof (value as { message?: unknown }).message === 'string'
	);
}
