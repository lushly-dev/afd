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
	 * May include stack traces, request IDs, timestamps, etc.
	 * Avoid exposing sensitive information.
	 */
	details?: Record<string, unknown>;

	/**
	 * Original error that caused this error, if any.
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
export function validationError(
	message: string,
	details?: Record<string, unknown>
): CommandError {
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
	return createError(
		ErrorCodes.NOT_FOUND,
		`${resourceType} with ID '${resourceId}' not found`,
		{
			suggestion: `Verify the ${resourceType.toLowerCase()} ID exists and try again`,
			retryable: false,
			details: { resourceType, resourceId },
		}
	);
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

/**
 * Create an internal error (use sparingly - prefer specific errors).
 */
export function internalError(message: string, cause?: Error): CommandError {
	return createError(ErrorCodes.INTERNAL_ERROR, message, {
		suggestion: 'Please try again. If this persists, contact support.',
		retryable: true,
		cause,
	});
}

/**
 * Wrap an unknown error in a CommandError.
 */
export function wrapError(error: unknown): CommandError {
	if (isCommandError(error)) {
		return error;
	}

	if (error instanceof Error) {
		return createError(ErrorCodes.INTERNAL_ERROR, error.message, {
			suggestion: 'Please try again. If this persists, contact support.',
			retryable: true,
			cause: error,
			details: { stack: error.stack },
		});
	}

	return createError(ErrorCodes.UNKNOWN_ERROR, String(error), {
		suggestion: 'Please try again. If this persists, contact support.',
		retryable: true,
	});
}

/**
 * Type guard to check if a value is a CommandError.
 */
export function isCommandError(value: unknown): value is CommandError {
	return (
		typeof value === 'object' &&
		value !== null &&
		'code' in value &&
		'message' in value &&
		typeof (value as CommandError).code === 'string' &&
		typeof (value as CommandError).message === 'string'
	);
}
