/**
 * @fileoverview A Zod Mini schema with no locale says what the same classic schema says.
 *
 * Classic registers English in `zod/v4/core`'s shared configuration when it builds its first type, so
 * every row clears that first and shows the Mini schema really does come back bare.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as m from 'zod/mini';
import { type $ZodType, config, locales, safeParse } from 'zod/v4/core';
import { defineCommandWithSchema } from './define-core.js';
import { createDirectRegistry } from './direct-registry.js';
import { issueMessage } from './issue-message.js';
import type { ZodCommandDefinition } from './schema.js';
import { defineCommand } from './schema.js';

const ENGLISH = locales.en();

afterEach(() => {
	config({ ...ENGLISH, customError: undefined });
});

function withoutLocale<T>(run: () => T): T {
	config({ localeError: undefined });
	try {
		return run();
	} finally {
		config(ENGLISH);
	}
}

async function withoutLocaleAsync<T>(run: () => Promise<T>): Promise<T> {
	config({ localeError: undefined });
	try {
		return await run();
	} finally {
		config(ENGLISH);
	}
}

async function validationError(command: ZodCommandDefinition, input: unknown) {
	const result = await createDirectRegistry([command]).execute(command.name, input);
	expect(result.success).toBe(false);
	return result.error;
}

const noop = async () => ({ success: true as const, data: null });

function miniCommand(input: $ZodType) {
	return defineCommandWithSchema({
		name: 'row-mini',
		description: 'A row',
		input,
		jsonSchema: { type: 'object' },
		handler: noop,
	}) as unknown as ZodCommandDefinition;
}

function classicCommand(input: z.ZodType) {
	return defineCommand({
		name: 'row-classic',
		description: 'A row',
		input,
		// Some rows have no JSON Schema form, and this table is about messages.
		advertisedInputSchema: { type: 'object' },
		handler: noop,
	}) as unknown as ZodCommandDefinition;
}

class Thing {}

/** The same field in each API, with a value it refuses. */
const ROWS: [string, $ZodType, z.ZodType, unknown][] = [
	['a wrong type', m.string(), z.string(), 7],
	['null', m.string(), z.string(), null],
	['an array', m.string(), z.string(), []],
	['a class instance', m.string(), z.string(), new Thing()],
	['a literal', m.literal('a'), z.literal('a'), 'b'],
	['a numeric literal', m.literal(1), z.literal(1), 2],
	['several literals', m.literal(['a', 'b']), z.literal(['a', 'b']), 'c'],
	['an enum', m.enum(['a', 'b']), z.enum(['a', 'b']), 'c'],
	['a short string', m.string().check(m.minLength(2)), z.string().min(2), 'a'],
	['a long string', m.string().check(m.maxLength(2)), z.string().max(2), 'abc'],
	['an exact length', m.string().check(m.length(2)), z.string().length(2), 'a'],
	['an exact length, long', m.string().check(m.length(2)), z.string().length(2), 'abc'],
	['a number below', m.number().check(m.gte(2)), z.number().min(2), 1],
	['a number at', m.number().check(m.gt(2)), z.number().gt(2), 2],
	['a number above', m.number().check(m.lte(2)), z.number().max(2), 3],
	['a number at the top', m.number().check(m.lt(2)), z.number().lt(2), 2],
	['a bigint', m.bigint().check(m.gte(2n)), z.bigint().min(2n), 1n],
	['an integer', m.int(), z.int(), 1.5],
	['a short array', m.array(m.string()).check(m.minLength(1)), z.array(z.string()).min(1), []],
	['a long array', m.array(m.string()).check(m.maxLength(0)), z.array(z.string()).max(0), ['a']],
	['a set', m.set(m.string()).check(m.minSize(1)), z.set(z.string()).min(1), new Set()],
	['an element', m.array(m.string()), z.array(z.string()), [7]],
	['a regex', m.string().check(m.regex(/^a$/)), z.string().regex(/^a$/), 'b'],
	['a nanoid', m.nanoid(), z.nanoid(), '!'],
	['a cuid', m.cuid(), z.cuid(), '!'],
	[
		'an unknown key',
		m.strictObject({ a: m.string() }),
		z.strictObject({ a: z.string() }),
		{ a: 'a', b: 1 },
	],
	[
		'two unknown keys',
		m.strictObject({ a: m.string() }),
		z.strictObject({ a: z.string() }),
		{ a: 'a', b: 1, c: 2 },
	],
	['a union', m.union([m.string(), m.number()]), z.union([z.string(), z.number()]), true],
	[
		'a discriminator',
		m.discriminatedUnion('kind', [
			m.object({ kind: m.literal('a') }),
			m.object({ kind: m.literal('b') }),
		]),
		z.discriminatedUnion('kind', [
			z.object({ kind: z.literal('a') }),
			z.object({ kind: z.literal('b') }),
		]),
		{ kind: 'c' },
	],
	['a nested wrong type', m.object({ b: m.string() }), z.object({ b: z.string() }), { b: 7 }],
	['a nested missing field', m.object({ b: m.string() }), z.object({ b: z.string() }), {}],
];

/**
 * Where the text falls short of English, to stay inside `/direct`'s budget: what a Mini schema says
 * and what the same classic schema says. Each still comes with the field's path.
 */
const SAYS_LESS: [string, $ZodType, unknown, string, string][] = [
	[
		'an expected NaN',
		m.nan(),
		7,
		'Invalid input: expected nan, received number',
		'Invalid input: expected NaN, received number',
	],
	[
		'-Infinity',
		m.string(),
		Number.NEGATIVE_INFINITY,
		'Invalid input: expected string, received number',
		'Invalid input: expected string, received -Infinity',
	],
	[
		'a template literal',
		m.templateLiteral(['a', m.number()]),
		'b',
		'Invalid template_literal',
		'Invalid input',
	],
	[
		'a file size',
		m.file().check(m.maxSize(1)),
		new File(['ab'], 'a.txt'),
		'Too big: expected file to be <=1',
		'Too big: expected file to have <=1 bytes',
	],
	['an email', m.email(), 'x', 'Invalid email', 'Invalid email address'],
	['a URL', m.url(), 'x', 'Invalid url', 'Invalid URL'],
	['a UUID', m.uuid(), 'x', 'Invalid uuid', 'Invalid UUID'],
	['a datetime', m.iso.datetime(), 'x', 'Invalid datetime', 'Invalid ISO datetime'],
	[
		'a prefix',
		m.string().check(m.startsWith('a')),
		'b',
		'Invalid starts_with',
		'Invalid string: must start with "a"',
	],
	[
		'a multiple',
		m.number().check(m.multipleOf(2)),
		3,
		'Invalid input',
		'Invalid number: must be a multiple of 2',
	],
	[
		'NaN',
		m.string(),
		Number.NaN,
		'Invalid input: expected string, received nan',
		'Invalid input: expected string, received NaN',
	],
	[
		'Infinity',
		m.string(),
		Number.POSITIVE_INFINITY,
		'Invalid input: expected string, received number',
		'Invalid input: expected string, received Infinity',
	],
	[
		'a record key',
		m.record(m.string().check(m.minLength(2)), m.string()),
		{ a: 'a' },
		'Invalid input',
		'Invalid key in record',
	],
	[
		'a map key',
		m.map(m.string(), m.string()),
		new Map([[{}, 1]]),
		'Invalid input',
		'Invalid key in map',
	],
	[
		'xor',
		m.xor([m.string(), m.string()]),
		'a',
		'Invalid input',
		'Invalid input: more than one option matched',
	],
];

describe('a Zod Mini schema with no locale', () => {
	it.each(ROWS)('says what classic says for %s', async (_label, mini, classic, value) => {
		const input = { field: value };
		const miniSchema = m.object({ field: mini });
		const expected = await validationError(classicCommand(z.object({ field: classic })), input);

		const actual = await withoutLocaleAsync(() => validationError(miniCommand(miniSchema), input));
		// A failed parse builds its error on the first read, so read it here.
		const bare = withoutLocale(() => safeParse(miniSchema, input).error?.issues[0]?.message);

		expect(bare).toBe('Invalid input');
		expect(actual?.message).toBe(expected?.message);
		expect(actual?.suggestion).toBe(expected?.suggestion);
		expect(actual?.details).toEqual(expected?.details);
	});

	it('says what classic says for a missing field, a field left out and an unknown one', async () => {
		const input = { extra: 1 };
		const expected = await validationError(
			classicCommand(
				z.object({ a: z.string(), b: z.string().optional(), c: z.number().default(1) })
			),
			input
		);

		const actual = await withoutLocaleAsync(() =>
			validationError(
				miniCommand(
					m.object({
						a: m.string(),
						b: m.optional(m.string()),
						c: m._default(m.number(), 1),
					})
				),
				input
			)
		);

		expect(actual).toEqual(expected);
		expect(actual?.suggestion).toContain('Missing required field(s): a');
		expect(actual?.suggestion).toContain('Unknown field(s): extra');
	});
});

describe('where a Zod Mini schema with no locale says less than English', () => {
	it.each(SAYS_LESS)('%s', (_label, mini, value, says, english) => {
		const issue = withoutLocale(
			() => safeParse(mini, value, { reportInput: true }).error?.issues[0] as never
		);
		const ours = withoutLocale(() => issueMessage(issue));

		expect(ours).toBe(says);
		expect(safeParse(mini, value).error?.issues[0]?.message).toBe(english);
	});
});

describe('issueMessage leaves everything else alone', () => {
	const issue = { code: 'invalid_type', expected: 'string', input: 7, message: 'Invalid input' };

	it('with a locale loaded, even a schema whose own message is the bare text', () => {
		expect(issueMessage(issue)).toBe('Invalid input');
	});

	it('with a schema of its own message and no locale', () => {
		const schema = m.string({ error: 'Name it' });

		const message = withoutLocale(() =>
			issueMessage(safeParse(schema, 7, { reportInput: true }).error?.issues[0] as never)
		);

		expect(message).toBe('Name it');
	});

	it('with a locale someone chose', async () => {
		config(locales.fr());

		const error = await validationError(classicCommand(z.object({ field: z.string() })), {
			field: 7,
		});

		expect(error?.suggestion).toContain('Entrée invalide');
	});

	it('with a custom error map', async () => {
		config({ customError: () => 'Mapped' });

		const error = await validationError(classicCommand(z.object({ field: z.string() })), {
			field: 7,
		});

		expect(error?.suggestion).toContain('field: Mapped');
	});
});
