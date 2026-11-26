/**
 * @fileoverview Input validation utilities
 */

import type { ZodType, z } from 'zod';
import {
	type $ZodDefault,
	type $ZodIssue,
	type $ZodNullable,
	type $ZodObject,
	type $ZodOptional,
	type $ZodPipe,
	type $ZodType,
	safeParse,
} from 'zod/v4/core';
import { issueMessage } from './issue-message.js';

/**
 * AFD's normative validation issue codes (`spec/validation.md`).
 *
 * Owned by AFD rather than any validator library; Zod issue codes are mapped explicitly into this
 * closed vocabulary so a validator upgrade cannot silently alter wire codes.
 */
export const VALIDATION_ISSUE_CODES = [
	'invalid_type',
	'invalid_value',
	'too_small',
	'too_big',
	'unrecognized_keys',
	'invalid_format',
	'invalid_union',
	'not_multiple_of',
	'custom',
] as const;

export type ValidationIssueCode = (typeof VALIDATION_ISSUE_CODES)[number];

/** Map a Zod issue code into AFD's closed validation issue code catalog. */
export function mapZodIssueCode(zodCode: string): ValidationIssueCode {
	return (VALIDATION_ISSUE_CODES as readonly string[]).includes(zodCode)
		? (zodCode as ValidationIssueCode)
		: 'custom';
}

/** Normative default cap on reported issues per `VALIDATION_ERROR` (`spec/execution-controls.md`). */
export const DEFAULT_MAX_VALIDATION_ISSUES = 100;

export function resolveMaxValidationIssues(maxIssues: number | undefined): number {
	if (maxIssues === undefined) return DEFAULT_MAX_VALIDATION_ISSUES;
	if (!Number.isSafeInteger(maxIssues) || maxIssues <= 0) {
		throw new RangeError('maxValidationIssues must be a positive integer');
	}
	return maxIssues;
}

export interface ValidationError {
	path: string;
	message: string;
	code: ValidationIssueCode | (string & {});
	expected?: string;
	received?: string;
}

export type ValidationResult<T> =
	| { success: true; data: T; errors: never[] }
	| {
			success: false;
			data: undefined;
			errors: ValidationError[];
			truncated?: boolean;
			limit?: number;
			totalErrors?: number;
	  };

export interface SchemaInfo {
	expectedFields: string[];
	unexpectedFields: string[];
	missingFields: string[];
}

export interface EnhancedValidationResult<T> {
	success: boolean;
	data: T | undefined;
	errors: ValidationError[];
	expectedFields?: string[];
	unexpectedFields?: string[];
	missingFields?: string[];
	truncated?: boolean;
	limit?: number;
	totalErrors?: number;
}

export function validateInput<T>(
	schema: $ZodType<T>,
	input: unknown,
	maxIssues = DEFAULT_MAX_VALIDATION_ISSUES
): ValidationResult<T> {
	const limit = resolveMaxValidationIssues(maxIssues);
	const result = safeParse(schema, input, { reportInput: true });
	if (result.success) return { success: true, data: result.data, errors: [] as never[] };
	const totalErrors = result.error.issues.length;
	const truncated = totalErrors > limit;
	const issues = truncated ? result.error.issues.slice(0, limit) : result.error.issues;
	return {
		success: false,
		data: undefined,
		errors: issues.map(formatZodIssue),
		...(truncated ? { truncated: true, limit, totalErrors } : {}),
	};
}

export function validateInputEnhanced<T>(
	schema: $ZodType<T>,
	input: unknown,
	maxIssues = DEFAULT_MAX_VALIDATION_ISSUES
): EnhancedValidationResult<T> {
	const result = validateInput(schema, input, maxIssues);
	if (result.success) return { success: true, data: result.data, errors: [] };
	const schemaInfo = extractSchemaInfo(schema, input);
	return {
		success: false,
		data: undefined,
		errors: result.errors,
		expectedFields: schemaInfo.expectedFields.length > 0 ? schemaInfo.expectedFields : undefined,
		unexpectedFields:
			schemaInfo.unexpectedFields.length > 0 ? schemaInfo.unexpectedFields : undefined,
		missingFields: schemaInfo.missingFields.length > 0 ? schemaInfo.missingFields : undefined,
		...(result.truncated
			? { truncated: true, limit: result.limit, totalErrors: result.totalErrors }
			: {}),
	};
}

export function validateOrThrow<T>(schema: $ZodType<T>, input: unknown): T {
	const result = validateInput(schema, input);
	if (!result.success) throw new ValidationException(result.errors);
	return result.data;
}

export function isValid<T>(schema: $ZodType<T>, input: unknown): input is T {
	return safeParse(schema, input).success;
}

function formatZodIssue(issue: $ZodIssue): ValidationError {
	const path = issue.path.join('.');
	const code = mapZodIssueCode(issue.code);
	const error: ValidationError = {
		path: path || '(root)',
		message: issueMessage(issue),
		code,
	};
	if (code === 'invalid_type' && 'expected' in issue && typeof issue.expected === 'string') {
		error.expected = issue.expected;
	}
	return error;
}

export function formatValidationErrors(errors: ValidationError[]): string {
	if (errors.length === 0) return 'No validation errors';
	if (errors.length === 1) {
		const err = errors[0];
		if (!err) return 'No validation errors';
		return err.path === '(root)' ? err.message : `${err.path}: ${err.message}`;
	}
	return errors
		.map((err) => (err.path === '(root)' ? `- ${err.message}` : `- ${err.path}: ${err.message}`))
		.join('\n');
}

export function formatEnhancedValidationError(
	errors: ValidationError[],
	schemaInfo?: {
		expectedFields?: string[];
		unexpectedFields?: string[];
		missingFields?: string[];
		truncated?: boolean;
		limit?: number;
	}
): string {
	const parts: string[] = [];
	if (errors.length > 0) parts.push(formatValidationErrors(errors));
	if (schemaInfo) {
		if (schemaInfo.unexpectedFields?.length)
			parts.push(`Unknown field(s): ${schemaInfo.unexpectedFields.join(', ')}`);
		if (schemaInfo.missingFields?.length)
			parts.push(`Missing required field(s): ${schemaInfo.missingFields.join(', ')}`);
		if (schemaInfo.expectedFields?.length)
			parts.push(`Expected fields: ${schemaInfo.expectedFields.join(', ')}`);
		if (schemaInfo.truncated) {
			const shown = schemaInfo.limit ?? errors.length;
			parts.push(`Showing first ${shown} validation issues; fix these and retry`);
		}
	}
	return parts.join('. ');
}

function extractSchemaInfo(schema: $ZodType, input: unknown): SchemaInfo {
	const expectedFields: string[] = [];
	const unexpectedFields: string[] = [];
	const missingFields: string[] = [];
	const shape = getSchemaShape(schema);
	if (shape) {
		for (const key of Object.keys(shape)) expectedFields.push(key);
		if (input && typeof input === 'object' && !Array.isArray(input)) {
			for (const key of Object.keys(input)) {
				if (!expectedFields.includes(key)) unexpectedFields.push(key);
			}
			for (const key of expectedFields) {
				const field = shape[key];
				if (!(key in input) && field && isRequiredField(field)) missingFields.push(key);
			}
		}
	}
	return { expectedFields, unexpectedFields, missingFields };
}

// Read the structural marker `_zod.def.type`, not `instanceof` against this package's classes: a
// schema may come from the application's own copy of Zod (#1748), whose classes match ours only
// through Zod's trait-name `Symbol.hasInstance`. A Zod Mini schema has no `.shape` or `.unwrap()`,
// and a classic one has the same def.
function getSchemaShape(schema: $ZodType): Readonly<Record<string, $ZodType>> | null {
	const def = schema._zod.def;
	switch (def.type) {
		case 'object':
			return (def as $ZodObject['_zod']['def']).shape;
		case 'pipe':
			return getSchemaShape((def as $ZodPipe['_zod']['def']).in);
		case 'optional':
		case 'nullable':
		case 'default':
			return getSchemaShape(
				(def as ($ZodOptional | $ZodNullable | $ZodDefault)['_zod']['def']).innerType
			);
		default:
			return null;
	}
}

function isRequiredField(schema: $ZodType): boolean {
	const def = schema._zod.def;
	if (def.type === 'optional' || def.type === 'default') return false;
	if (def.type === 'pipe') return isRequiredField((def as $ZodPipe['_zod']['def']).in);
	return true;
}

export class ValidationException extends Error {
	readonly errors: ValidationError[];
	readonly code = 'VALIDATION_ERROR';
	constructor(errors: ValidationError[]) {
		super(formatValidationErrors(errors));
		this.name = 'ValidationException';
		this.errors = errors;
	}
	toCommandError() {
		return {
			code: this.code,
			message: 'Input validation failed',
			suggestion: this.message,
			details: { errors: this.errors },
		};
	}
}

export function optional<T extends ZodType>(schema: T) {
	return schema.optional();
}
export function withDefault<T extends ZodType>(schema: T, defaultValue: z.infer<T>) {
	// biome-ignore lint/suspicious/noExplicitAny: zod 4's NoUndefined constraint doesn't infer through generic T
	return schema.default(defaultValue as any);
}
