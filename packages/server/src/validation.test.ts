import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	formatEnhancedValidationError,
	formatValidationErrors,
	isValid,
	optional,
	patterns,
	ValidationException,
	validateInput,
	validateInputEnhanced,
	validateOrThrow,
	withDefault,
} from './validation.js';

describe('validateInput', () => {
	const schema = z.object({
		name: z.string(),
		age: z.number(),
	});

	it('returns success with valid data', () => {
		const result = validateInput(schema, { name: 'Alice', age: 30 });
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ name: 'Alice', age: 30 });
	});

	it('returns errors for invalid data', () => {
		const result = validateInput(schema, { name: 123 });
		expect(result.success).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0]?.code).toBe('invalid_type');
	});
});

describe('validateInputEnhanced', () => {
	const schema = z.object({
		title: z.string(),
		count: z.number(),
	});

	it('returns success with valid data', () => {
		const result = validateInputEnhanced(schema, { title: 'test', count: 5 });
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ title: 'test', count: 5 });
	});

	it('reports unexpected fields on invalid input', () => {
		// Need to make the input invalid so enhanced validation runs schemaInfo
		const result = validateInputEnhanced(schema, { count: 'not a number', extra: true });
		expect(result.success).toBe(false);
		expect(result.unexpectedFields).toContain('extra');
		expect(result.expectedFields).toContain('title');
		expect(result.expectedFields).toContain('count');
	});

	it('reports missing required fields', () => {
		const result = validateInputEnhanced(schema, {});
		expect(result.success).toBe(false);
		expect(result.missingFields).toContain('title');
		expect(result.missingFields).toContain('count');
	});

	it('handles non-object input gracefully', () => {
		const result = validateInputEnhanced(schema, 'not an object');
		expect(result.success).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});
});

describe('validateOrThrow', () => {
	const schema = z.object({ name: z.string() });

	it('returns valid data', () => {
		const data = validateOrThrow(schema, { name: 'test' });
		expect(data).toEqual({ name: 'test' });
	});

	it('throws ValidationException on invalid data', () => {
		expect(() => validateOrThrow(schema, {})).toThrow(ValidationException);
	});
});

describe('isValid', () => {
	const schema = z.string().min(1);

	it('returns true for valid input', () => {
		expect(isValid(schema, 'hello')).toBe(true);
	});

	it('returns false for invalid input', () => {
		expect(isValid(schema, '')).toBe(false);
		expect(isValid(schema, 42)).toBe(false);
	});
});

describe('formatValidationErrors', () => {
	it('returns "No validation errors" for empty array', () => {
		expect(formatValidationErrors([])).toBe('No validation errors');
	});

	it('formats single root error without path prefix', () => {
		const errors = [{ path: '(root)', message: 'Required', code: 'invalid_type' }];
		expect(formatValidationErrors(errors)).toBe('Required');
	});

	it('formats single field error with path prefix', () => {
		const errors = [{ path: 'name', message: 'Required', code: 'invalid_type' }];
		expect(formatValidationErrors(errors)).toBe('name: Required');
	});

	it('formats multiple errors as bullet list', () => {
		const errors = [
			{ path: 'name', message: 'Required', code: 'invalid_type' },
			{ path: '(root)', message: 'Extra fields', code: 'unrecognized_keys' },
		];
		const result = formatValidationErrors(errors);
		expect(result).toContain('- name: Required');
		expect(result).toContain('- Extra fields');
	});
});

describe('formatEnhancedValidationError', () => {
	it('combines validation errors and schema info', () => {
		const result = formatEnhancedValidationError(
			[{ path: 'name', message: 'Required', code: 'invalid_type' }],
			{
				unexpectedFields: ['foo'],
				missingFields: ['name'],
				expectedFields: ['name', 'age'],
			}
		);
		expect(result).toContain('name: Required');
		expect(result).toContain('Unknown field(s): foo');
		expect(result).toContain('Missing required field(s): name');
		expect(result).toContain('Expected fields: name, age');
	});

	it('handles errors only (no schema info)', () => {
		const result = formatEnhancedValidationError([{ path: 'x', message: 'bad', code: 'custom' }]);
		expect(result).toBe('x: bad');
	});

	it('handles schema info only (no errors)', () => {
		const result = formatEnhancedValidationError([], {
			unexpectedFields: ['extra'],
		});
		expect(result).toContain('Unknown field(s): extra');
	});

	it('handles empty schema info arrays', () => {
		const result = formatEnhancedValidationError([], {
			unexpectedFields: [],
			missingFields: [],
			expectedFields: [],
		});
		expect(result).toBe('');
	});
});

describe('ValidationException', () => {
	it('stores errors and has correct name', () => {
		const errors = [{ path: 'x', message: 'bad', code: 'custom' }];
		const ex = new ValidationException(errors);
		expect(ex.name).toBe('ValidationException');
		expect(ex.errors).toBe(errors);
		expect(ex.code).toBe('VALIDATION_ERROR');
		expect(ex.message).toBe('x: bad');
	});

	it('toCommandError produces correct structure', () => {
		const errors = [{ path: 'name', message: 'Required', code: 'invalid_type' }];
		const ex = new ValidationException(errors);
		const cmdErr = ex.toCommandError();
		expect(cmdErr.code).toBe('VALIDATION_ERROR');
		expect(cmdErr.message).toBe('Input validation failed');
		expect(cmdErr.suggestion).toBe('name: Required');
		expect(cmdErr.details).toEqual({ errors });
	});
});

describe('getSchemaShape edge cases', () => {
	it('handles ZodEffects (transform/refine)', () => {
		const schema = z
			.object({ name: z.string() })
			.transform((data) => ({ ...data, upper: data.name.toUpperCase() }));
		const result = validateInputEnhanced(schema, {});
		expect(result.missingFields).toContain('name');
	});

	it('handles ZodOptional wrapping object', () => {
		const schema = z.object({ name: z.string() }).optional();
		// When input is an object with missing fields, enhanced validation should still detect them
		const result = validateInputEnhanced(schema, { extra: true });
		expect(result.expectedFields).toContain('name');
	});

	it('handles ZodDefault wrapping object', () => {
		const schema = z.object({ name: z.string() }).default({ name: 'default' });
		const result = validateInputEnhanced(schema, { extra: true });
		expect(result.expectedFields).toContain('name');
	});

	it('handles ZodNullable wrapping object', () => {
		const schema = z.object({ name: z.string() }).nullable();
		const result = validateInputEnhanced(schema, { extra: true });
		expect(result.expectedFields).toContain('name');
	});

	it('handles non-object schemas', () => {
		const schema = z.string();
		const result = validateInputEnhanced(schema, 42);
		expect(result.success).toBe(false);
		// No expected/unexpected/missing fields for non-object schemas
		expect(result.expectedFields).toBeUndefined();
	});
});

describe('isRequiredField edge cases', () => {
	it('optional fields are not reported as missing', () => {
		const schema = z.object({
			required: z.string(),
			optional: z.string().optional(),
		});
		const result = validateInputEnhanced(schema, {});
		expect(result.missingFields).toContain('required');
		expect(result.missingFields).not.toContain('optional');
	});

	it('fields with defaults are not reported as missing', () => {
		const schema = z.object({
			required: z.string(),
			withDefault: z.string().default('hello'),
		});
		const result = validateInputEnhanced(schema, {});
		expect(result.missingFields).toContain('required');
		expect(result.missingFields).not.toContain('withDefault');
	});

	it('refined fields are still required', () => {
		const schema = z.object({
			email: z.string().refine((s) => s.includes('@'), 'Must be an email'),
		});
		const result = validateInputEnhanced(schema, {});
		expect(result.missingFields).toContain('email');
	});
});

describe('patterns', () => {
	it('uuid validates correct format', () => {
		expect(patterns.uuid.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
		expect(patterns.uuid.safeParse('not-a-uuid').success).toBe(false);
	});

	it('email validates correct format', () => {
		expect(patterns.email.safeParse('user@example.com').success).toBe(true);
		expect(patterns.email.safeParse('not-an-email').success).toBe(false);
	});

	it('url validates correct format', () => {
		expect(patterns.url.safeParse('https://example.com').success).toBe(true);
		expect(patterns.url.safeParse('not a url').success).toBe(false);
	});

	it('nonEmpty rejects empty string', () => {
		expect(patterns.nonEmpty.safeParse('').success).toBe(false);
		expect(patterns.nonEmpty.safeParse('a').success).toBe(true);
	});

	it('positiveInt accepts positive integers', () => {
		expect(patterns.positiveInt.safeParse(1).success).toBe(true);
		expect(patterns.positiveInt.safeParse(0).success).toBe(false);
		expect(patterns.positiveInt.safeParse(-1).success).toBe(false);
		expect(patterns.positiveInt.safeParse(1.5).success).toBe(false);
	});

	it('nonNegativeInt accepts zero and positive', () => {
		expect(patterns.nonNegativeInt.safeParse(0).success).toBe(true);
		expect(patterns.nonNegativeInt.safeParse(1).success).toBe(true);
		expect(patterns.nonNegativeInt.safeParse(-1).success).toBe(false);
	});

	it('isoDate validates ISO datetime', () => {
		expect(patterns.isoDate.safeParse('2024-01-15T10:30:00Z').success).toBe(true);
		expect(patterns.isoDate.safeParse('not a date').success).toBe(false);
	});

	it('pagination has correct defaults and constraints', () => {
		const result = patterns.pagination.safeParse({});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.limit).toBe(20);
			expect(result.data.offset).toBe(0);
		}

		expect(patterns.pagination.safeParse({ limit: 0 }).success).toBe(false);
		expect(patterns.pagination.safeParse({ limit: 101 }).success).toBe(false);
		expect(patterns.pagination.safeParse({ offset: -1 }).success).toBe(false);
	});

	it('sorting validates field name and direction', () => {
		const result = patterns.sorting.safeParse({ sortBy: 'createdAt' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.sortBy).toBe('createdAt');
			expect(result.data.sortDirection).toBe('asc');
		}

		expect(patterns.sorting.safeParse({ sortBy: 'name', sortDirection: 'desc' }).success).toBe(
			true
		);
		expect(patterns.sorting.safeParse({ sortBy: '' }).success).toBe(false);
		expect(patterns.sorting.safeParse({ sortBy: 'name', sortDirection: 'invalid' }).success).toBe(
			false
		);
		expect(patterns.sorting.safeParse({}).success).toBe(false);
	});

	it('search validates query and optional fields', () => {
		expect(patterns.search.safeParse({ query: 'hello' }).success).toBe(true);
		expect(patterns.search.safeParse({ query: 'hello', fields: ['title', 'body'] }).success).toBe(
			true
		);
		expect(patterns.search.safeParse({ query: '' }).success).toBe(false);
		expect(patterns.search.safeParse({}).success).toBe(false);
		expect(patterns.search.safeParse({ query: 'test', fields: [''] }).success).toBe(false);
	});

	it('dateRange validates ISO datetime pairs', () => {
		expect(
			patterns.dateRange.safeParse({
				startDate: '2024-01-01T00:00:00Z',
				endDate: '2024-12-31T23:59:59Z',
			}).success
		).toBe(true);
		expect(
			patterns.dateRange.safeParse({
				startDate: 'not-a-date',
				endDate: '2024-12-31T23:59:59Z',
			}).success
		).toBe(false);
		expect(patterns.dateRange.safeParse({ startDate: '2024-01-01T00:00:00Z' }).success).toBe(false);
		expect(patterns.dateRange.safeParse({}).success).toBe(false);
	});
});

describe('optional helper', () => {
	it('wraps schema as optional', () => {
		const schema = optional(z.string());
		expect(schema.safeParse(undefined).success).toBe(true);
		expect(schema.safeParse('hello').success).toBe(true);
	});
});

describe('withDefault helper', () => {
	it('applies default value', () => {
		const schema = withDefault(z.number(), 42);
		const result = schema.safeParse(undefined);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toBe(42);
		}
	});
});
