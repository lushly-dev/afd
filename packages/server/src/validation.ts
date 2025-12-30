/**
 * @fileoverview Input validation utilities
 *
 * Provides type-safe validation of command inputs using Zod schemas.
 */

import { z, type ZodType, type ZodError, type ZodIssue } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validation error details.
 */
export interface ValidationError {
	/** Field path (e.g., 'user.email') */
	path: string;

	/** Error message */
	message: string;

	/** Zod error code */
	code: string;

	/** Expected value/type */
	expected?: string;

	/** Received value/type */
	received?: string;
}

/**
 * Validation result.
 */
export type ValidationResult<T> =
	| { success: true; data: T; errors: never[] }
	| { success: false; data: undefined; errors: ValidationError[] };

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate input against a Zod schema.
 *
 * @param schema - Zod schema to validate against
 * @param input - Input data to validate
 * @returns Validation result with typed data or errors
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   title: z.string().min(1),
 *   count: z.number().positive(),
 * });
 *
 * const result = validateInput(schema, { title: '', count: -1 });
 *
 * if (!result.success) {
 *   console.log(result.errors);
 *   // [{ path: 'title', message: 'String must contain at least 1 character(s)' }, ...]
 * }
 * ```
 */
export function validateInput<T>(
	schema: ZodType<T>,
	input: unknown
): ValidationResult<T> {
	const result = schema.safeParse(input);

	if (result.success) {
		return {
			success: true,
			data: result.data,
			errors: [] as never[],
		};
	}

	return {
		success: false,
		data: undefined,
		errors: formatZodErrors(result.error),
	};
}

/**
 * Validate input and throw if invalid.
 *
 * @param schema - Zod schema to validate against
 * @param input - Input data to validate
 * @returns Validated and typed data
 * @throws ValidationException if validation fails
 */
export function validateOrThrow<T>(schema: ZodType<T>, input: unknown): T {
	const result = validateInput(schema, input);

	if (!result.success) {
		throw new ValidationException(result.errors);
	}

	return result.data;
}

/**
 * Check if input matches a schema without throwing.
 *
 * @param schema - Zod schema to check against
 * @param input - Input data to check
 * @returns True if input matches schema
 */
export function isValid<T>(schema: ZodType<T>, input: unknown): input is T {
	return schema.safeParse(input).success;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format Zod errors into ValidationError array.
 */
function formatZodErrors(error: ZodError): ValidationError[] {
	return error.issues.map(formatZodIssue);
}

/**
 * Format a single Zod issue into ValidationError.
 */
function formatZodIssue(issue: ZodIssue): ValidationError {
	const path = issue.path.join('.');

	const error: ValidationError = {
		path: path || '(root)',
		message: issue.message,
		code: issue.code,
	};

	// Add expected/received for type errors
	if (issue.code === 'invalid_type') {
		error.expected = issue.expected;
		error.received = issue.received;
	}

	return error;
}

/**
 * Format validation errors into a human-readable string.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
	if (errors.length === 0) {
		return 'No validation errors';
	}

	if (errors.length === 1) {
		const err = errors[0]!;
		return err.path === '(root)'
			? err.message
			: `${err.path}: ${err.message}`;
	}

	return errors
		.map((err) =>
			err.path === '(root)' ? `- ${err.message}` : `- ${err.path}: ${err.message}`
		)
		.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEPTION CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Exception thrown when validation fails.
 */
export class ValidationException extends Error {
	/** Validation errors */
	readonly errors: ValidationError[];

	/** Error code for CommandResult */
	readonly code = 'VALIDATION_ERROR';

	constructor(errors: ValidationError[]) {
		super(formatValidationErrors(errors));
		this.name = 'ValidationException';
		this.errors = errors;
	}

	/**
	 * Convert to CommandError format.
	 */
	toCommandError() {
		return {
			code: this.code,
			message: 'Input validation failed',
			suggestion: this.message,
			details: { errors: this.errors },
		};
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common validation patterns.
 */
export const patterns = {
	/** UUID v4 pattern */
	uuid: z.string().uuid(),

	/** Email pattern */
	email: z.string().email(),

	/** URL pattern */
	url: z.string().url(),

	/** Non-empty string */
	nonEmpty: z.string().min(1),

	/** Positive integer */
	positiveInt: z.number().int().positive(),

	/** Non-negative integer */
	nonNegativeInt: z.number().int().nonnegative(),

	/** ISO date string */
	isoDate: z.string().datetime(),

	/** Pagination params */
	pagination: z.object({
		limit: z.number().int().min(1).max(100).default(20),
		offset: z.number().int().nonnegative().default(0),
	}),
};

/**
 * Create an optional field that defaults to undefined.
 */
export function optional<T extends ZodType>(schema: T) {
	return schema.optional();
}

/**
 * Create a field with a default value.
 */
export function withDefault<T extends ZodType>(
	schema: T,
	defaultValue: z.infer<T>
) {
	return schema.default(defaultValue);
}
