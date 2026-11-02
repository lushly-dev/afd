/**
 * @fileoverview Input validation utilities
 */

import type { ZodType, z } from 'zod';
import {
	$ZodDefault,
	type $ZodIssue,
	$ZodNullable,
	$ZodObject,
	$ZodOptional,
	$ZodPipe,
	type $ZodType,
	safeParse,
} from 'zod/v4/core';
import { issueMessage } from './issue-message.js';

export interface ValidationError {
	path: string;
	message: string;
	code: string;
	expected?: string;
	received?: string;
}

export type ValidationResult<T> =
	| { success: true; data: T; errors: never[] }
	| { success: false; data: undefined; errors: ValidationError[] };

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
}

export function validateInput<T>(schema: $ZodType<T>, input: unknown): ValidationResult<T> {
	const result = safeParse(schema, input, { reportInput: true });
	if (result.success) return { success: true, data: result.data, errors: [] as never[] };
	return { success: false, data: undefined, errors: result.error.issues.map(formatZodIssue) };
}

export function validateInputEnhanced<T>(
	schema: $ZodType<T>,
	input: unknown
): EnhancedValidationResult<T> {
	const result = validateInput(schema, input);
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
	const error: ValidationError = {
		path: path || '(root)',
		message: issueMessage(issue),
		code: issue.code,
	};
	if (issue.code === 'invalid_type') {
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
	schemaInfo?: { expectedFields?: string[]; unexpectedFields?: string[]; missingFields?: string[] }
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

// Read through `_zod.def` and core's classes: a Zod Mini schema has no `.shape` or `.unwrap()`, and
// a classic one has the same def.
function getSchemaShape(schema: $ZodType): Readonly<Record<string, $ZodType>> | null {
	if (schema instanceof $ZodObject) return schema._zod.def.shape;
	if (schema instanceof $ZodPipe) return getSchemaShape(schema._zod.def.in);
	if (
		schema instanceof $ZodOptional ||
		schema instanceof $ZodNullable ||
		schema instanceof $ZodDefault
	) {
		return getSchemaShape(schema._zod.def.innerType);
	}
	return null;
}

function isRequiredField(schema: $ZodType): boolean {
	if (schema instanceof $ZodOptional) return false;
	if (schema instanceof $ZodDefault) return false;
	if (schema instanceof $ZodPipe) return isRequiredField(schema._zod.def.in);
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
