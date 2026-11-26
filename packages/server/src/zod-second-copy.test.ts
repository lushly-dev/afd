/**
 * A command built with an application's own copy of Zod (#1748).
 *
 * `zod-second` is `zod@4.6.6` installed under an alias, a module instance apart from the
 * `zod@4.6.7` this package imports, as an application that brings its own Zod gets. Its classes
 * are different objects. Zod 4 answers `instanceof` by trait name, so a check against this
 * package's classes still passes today; shape detection reads the structural marker
 * `_zod.def.type` instead, so it does not rest on that. What does differ is the types: the two
 * copies' declarations do not unify, which is why `asLocal` casts and why `zod` is a peer
 * dependency. This file guards the runtime half.
 */

import { type CommandResult, success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { $ZodObject } from 'zod/v4/core';
import { z as other } from 'zod-second';
import * as otherMini from 'zod-second/mini';
import { $ZodObject as OtherZodObject } from 'zod-second/v4/core';
import { createDirectRegistry } from './direct-registry.js';
import { defineCommand, getRequiredFields, isObjectSchema } from './schema.js';
import { validateInputEnhanced } from './validation.js';

interface ValidationDetails {
	errors: { path: string; code: string; expected?: string }[];
	expectedFields?: string[];
	unexpectedFields?: string[];
	missingFields?: string[];
}

function detailsOf(result: CommandResult): ValidationDetails {
	return (result.error?.details ?? {}) as unknown as ValidationDetails;
}

/** A second copy's schema as this package's `ZodType`: the runtime objects agree, the types do not. */
const asLocal = (schema: unknown) => schema as ZodType;

const input = other.object({
	title: other.string().min(1),
	priority: other.enum(['low', 'high']).default('low'),
	note: other.string().optional(),
});

describe('a schema from a second copy of Zod', () => {
	it('comes from a module instance apart from the one this package imports', () => {
		expect(OtherZodObject).not.toBe($ZodObject);
		expect(input._zod.def.type).toBe('object');
	});

	it('validates a registered command with expected, unexpected and missing fields', async () => {
		const create = defineCommand({
			name: 'todo-create',
			description: 'Create a todo',
			input: asLocal(input),
			async handler(data) {
				return success(data);
			},
		});
		const registry = createDirectRegistry([create]);

		const result = await registry.execute('todo-create', { extra: true });

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		const details = detailsOf(result);
		expect(details.errors).toEqual([
			expect.objectContaining({ path: 'title', code: 'invalid_type', expected: 'string' }),
		]);
		expect(details.expectedFields).toEqual(['title', 'priority', 'note']);
		expect(details.unexpectedFields).toEqual(['extra']);
		expect(details.missingFields).toEqual(['title']);
		expect(result.error?.suggestion).toContain('Missing required field(s): title');

		const tooShort = await registry.execute('todo-create', { title: '' });
		expect(detailsOf(tooShort).errors).toEqual([
			expect.objectContaining({ path: 'title', code: 'too_small' }),
		]);

		const ok = await registry.execute('todo-create', { title: 'Write tests' });
		expect(ok).toMatchObject({ success: true, data: { title: 'Write tests', priority: 'low' } });
	});

	it.each([
		['optional', other.object({ a: other.string() }).optional()],
		['nullable', other.object({ a: other.string() }).nullable()],
		['default', other.object({ a: other.string() }).default({ a: 'x' })],
		['a pipe', other.object({ a: other.string() }).transform((value) => value)],
		[
			'a Mini pipe',
			otherMini.pipe(
				otherMini.object({ a: otherMini.string() }),
				otherMini.transform((value) => value)
			),
		],
	])('finds the fields through %s', (_label, schema) => {
		const result = validateInputEnhanced(schema, { b: 1 });

		expect(result.expectedFields).toEqual(['a']);
		expect(result.unexpectedFields).toEqual(['b']);
		expect(result.missingFields).toEqual(['a']);
	});

	it('does not call a field missing when its default, optional or pipe makes it optional', () => {
		const schema = other.object({
			required: other.string(),
			withDefault: other.string().default('x'),
			optional: other.string().optional(),
			piped: other.string().optional().pipe(other.string().optional()),
		});

		expect(validateInputEnhanced(schema, {}).missingFields).toEqual(['required']);
	});

	it('answers isObjectSchema and getRequiredFields', () => {
		expect(isObjectSchema(asLocal(input))).toBe(true);
		expect(isObjectSchema(asLocal(other.string()))).toBe(false);
		expect(getRequiredFields(input)).toEqual(['title']);
	});
});
