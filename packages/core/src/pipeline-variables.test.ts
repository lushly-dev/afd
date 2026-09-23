/**
 * Conformance tests for spec/pipeline-variables.md: reference forms, literals and escaping,
 * own-key traversal, `$input`, unresolved references, limits and `when` conditions.
 */
import { describe, expect, it } from 'vitest';
import type { PipelineContext, StepResult } from './pipeline.js';
import {
	copyPipelineData,
	evaluateCondition,
	getNestedValue,
	isPlainObject,
	MAX_NESTING_DEPTH,
	MAX_REFERENCE_LENGTH,
	resolveVariable,
	resolveVariables,
} from './pipeline-variables.js';

function step(index: number, data: unknown, extra: Partial<StepResult> = {}): StepResult {
	return { index, command: `cmd-${index}`, status: 'success', executionTimeMs: 0, data, ...extra };
}

const user = { id: 7, name: 'Ada', tags: ['a', 'b', 'c'], profile: { email: 'ada@example.com' } };
const order = { id: 'o-1', items: [{ sku: 'x1' }, { sku: 'x2' }], 2: 'two' };
const context: PipelineContext = {
	pipelineInput: { tenant: 'acme', limits: [10, 20] },
	previousResult: step(1, order, { alias: 'order' }),
	steps: [step(0, user, { alias: 'user' }), step(1, order, { alias: 'order' })],
};

/** Nest `levels` arrays/objects: level 1 is the outermost object. */
function nested(levels: number): Record<string, unknown> {
	let value: Record<string, unknown> = { leaf: '$prev.id' };
	for (let level = 1; level < levels; level++) value = { next: value };
	return value;
}

describe('reference forms', () => {
	it.each([
		['$prev', order],
		['$prev.id', 'o-1'],
		['$first', user],
		['$first.profile.email', 'ada@example.com'],
		['$steps[0]', user],
		['$steps[1].items[1].sku', 'x2'],
		['$steps.user', user],
		['$steps.user.tags[2]', 'c'],
		['$steps.order.items.0.sku', 'x1'],
		['$input', { tenant: 'acme', limits: [10, 20] }],
		['$input.limits[1]', 20],
		['$input.limits.0', 10],
	])('%s resolves', (ref, expected) => {
		expect(resolveVariable(ref, context)).toEqual(expected);
		expect(resolveVariables({ value: ref }, context)).toEqual({ value: expected });
	});

	it('resolves a numeric segment as an own key of an object', () => {
		expect(resolveVariable('$prev.2', context)).toBe('two');
	});

	it('does not interpolate references inside longer strings', () => {
		expect(resolveVariables({ text: 'id is $prev.id' }, context)).toEqual({
			text: 'id is $prev.id',
		});
	});
});

describe('literals and escaping', () => {
	it.each([
		'$9.99',
		'$HOME',
		'$prevx',
		'$prev.',
		'$prev..id',
		'$prev[0]',
		'$prev.a b',
		'$steps',
		'$steps[x]',
		'$steps[0][1]',
		'$steps.',
		'$steps.user[0]',
		'$',
		'$input_',
		'plain text',
		'',
	])('%j passes through unchanged', (literal) => {
		expect(resolveVariable(literal, context)).toBe(literal);
		expect(resolveVariables({ value: literal, list: [literal] }, context)).toEqual({
			value: literal,
			list: [literal],
		});
	});

	it.each([
		['$$prev', '$prev'],
		['$$9.99', '$9.99'],
		['$$$prev', '$$prev'],
		['$$', '$'],
	])('%j is a literal with one $ removed', (escaped, literal) => {
		expect(resolveVariable(escaped, context)).toBe(literal);
		expect(resolveVariables({ value: escaped, list: [escaped] }, context)).toEqual({
			value: literal,
			list: [literal],
		});
	});

	it('treats strings over 1024 characters as literals', () => {
		const long = `$prev.${'a'.repeat(MAX_REFERENCE_LENGTH)}`;
		expect(long.length).toBeGreaterThan(MAX_REFERENCE_LENGTH);
		expect(resolveVariables({ value: long }, context)).toEqual({ value: long });
		const atLimit = `$prev.${'a'.repeat(MAX_REFERENCE_LENGTH - 6)}`;
		expect(atLimit).toHaveLength(MAX_REFERENCE_LENGTH);
		expect(resolveVariables({ value: atLimit }, context)).toEqual({});
	});

	it('still unescapes a long $$ string', () => {
		const long = `$$${'x'.repeat(2000)}`;
		expect(resolveVariables({ value: long }, context)).toEqual({ value: long.slice(1) });
	});

	it('keeps literal undefined values, which are not unresolved references', () => {
		const resolved = resolveVariables({ a: undefined, list: [undefined] }, context) as {
			list: unknown[];
		};
		expect(Object.hasOwn(resolved, 'a')).toBe(true);
		expect(resolved.list).toStrictEqual([undefined]);
	});

	it('leaves non-string values and non-plain objects untouched', () => {
		const date = new Date(0);
		const resolved = resolveVariables({ n: 1, b: false, z: null, date }, context);
		expect(resolved).toEqual({ n: 1, b: false, z: null, date });
		expect((resolved as { date: unknown }).date).toBe(date);
	});
});

describe('what a path may reach', () => {
	const hostile = JSON.parse('{"__proto__": {"polluted": true}, "__class__": "x", "ok": 1}');
	const ctx: PipelineContext = {
		previousResult: step(0, { value: hostile, list: [1] }),
		steps: [step(0, { value: hostile, list: [1] }, { alias: 'data' })],
	};

	it.each([
		'$prev.constructor',
		'$prev.constructor.constructor',
		'$prev.list.constructor.constructor',
		'$prev.toString',
		'$prev.hasOwnProperty',
		'$prev.__proto__',
		'$prev.value.__proto__',
		'$prev.value.__proto__.polluted',
		'$prev.value.__class__',
		'$prev.value.__globals__',
		'$prev.list.length',
		'$prev.list.map',
		'$steps.data.__proto__',
		'$steps.__proto__',
		'$steps.constructor',
	])('%s is unresolved', (ref) => {
		expect(resolveVariable(ref, ctx)).toBeUndefined();
		expect(resolveVariables({ value: ref }, ctx)).toEqual({});
	});

	it('never reaches Function through constructor.constructor', () => {
		const resolved = resolveVariables({ fn: '$prev.constructor.constructor' }, ctx);
		expect(resolved).toEqual({});
		expect(Object.values(resolved as object)).not.toContain(Function);
	});

	it('resolves own keys next to hostile ones', () => {
		expect(resolveVariable('$prev.value.ok', ctx)).toBe(1);
	});

	it('does not match an alias that starts with __', () => {
		const aliased: PipelineContext = { steps: [step(0, { id: 1 }, { alias: '__secret' })] };
		expect(resolveVariable('$steps.__secret.id', aliased)).toBeUndefined();
	});

	it.each([
		'$prev.list[1]',
		'$prev.list.1',
		'$prev.list[99999999999999999999]',
		'$steps[2]',
		'$steps[99999999999999999999]',
		'$first.list[5]',
	])('out-of-bounds index %s is unresolved', (ref) => {
		expect(resolveVariable(ref, ctx)).toBeUndefined();
	});

	it('does not traverse class instances, maps or getters', () => {
		class Account {
			secret = 'hidden';
		}
		let getterCalls = 0;
		const data = {
			account: new Account(),
			map: new Map([['k', 'v']]),
			get computed() {
				getterCalls++;
				return 'computed';
			},
		};
		expect(getNestedValue(data, 'account.secret')).toBeUndefined();
		expect(getNestedValue(data, 'map.k')).toBeUndefined();
		expect(getNestedValue(data, 'map.size')).toBeUndefined();
		expect(getNestedValue(data, 'computed')).toBeUndefined();
		expect(getterCalls).toBe(0);
	});

	it('reads null-prototype objects', () => {
		const bare = Object.assign(Object.create(null) as Record<string, unknown>, { id: 3 });
		expect(isPlainObject(bare)).toBe(true);
		expect(getNestedValue({ bare }, 'bare.id')).toBe(3);
	});

	it('returns undefined for malformed paths', () => {
		expect(getNestedValue({ a: 1 }, '')).toBeUndefined();
		expect(getNestedValue({ a: 1 }, 'a.')).toBeUndefined();
		expect(getNestedValue({ a: [1] }, 'a[x]')).toBeUndefined();
	});
});

describe('$input', () => {
	it('resolves to the request input of any JSON type', () => {
		expect(resolveVariable('$input', { steps: [], pipelineInput: 'text' })).toBe('text');
		expect(resolveVariable('$input', { steps: [], pipelineInput: null })).toBeNull();
		expect(resolveVariable('$input.1', { steps: [], pipelineInput: ['a', 'b'] })).toBe('b');
	});

	it('is unresolved without a request input', () => {
		const ctx: PipelineContext = { steps: [] };
		expect(resolveVariable('$input', ctx)).toBeUndefined();
		expect(resolveVariables({ all: '$input', one: '$input.x' }, ctx)).toEqual({});
	});
});

describe('unresolved references', () => {
	it('are omitted as object properties', () => {
		const resolved = resolveVariables(
			{ keep: 'x', alias: '$steps.missing', field: '$prev.missing', nested: { gone: '$steps[9]' } },
			context
		);
		expect(resolved).toEqual({ keep: 'x', nested: {} });
		expect(Object.hasOwn(resolved as object, 'alias')).toBe(false);
		expect(Object.hasOwn(resolved as object, 'field')).toBe(false);
	});

	it('become null in arrays', () => {
		expect(resolveVariables(['$steps.missing', '$prev.id', '$input.none'], context)).toEqual([
			null,
			'o-1',
			null,
		]);
	});

	it('are unresolved for skipped or failed steps', () => {
		const ctx: PipelineContext = {
			steps: [
				{ index: 0, command: 'a', status: 'skipped', executionTimeMs: 0, alias: 'a' },
				{
					index: 1,
					command: 'b',
					status: 'failure',
					executionTimeMs: 0,
					alias: 'b',
					error: { code: 'X', message: 'failed' },
				},
			],
		};
		expect(resolveVariables({ a: '$steps.a', b: '$steps[1]', first: '$first' }, ctx)).toEqual({});
	});

	it('resolve to undefined at the top level', () => {
		expect(resolveVariables('$steps.missing', context)).toBeUndefined();
	});
});

describe('copies', () => {
	it('returns copies of resolved data, not the context objects', () => {
		const resolved = resolveVariables({ user: '$first', tags: '$first.tags' }, context) as {
			user: typeof user;
			tags: string[];
		};
		expect(resolved.user).toEqual(user);
		expect(resolved.user).not.toBe(user);
		resolved.tags.push('mutated');
		resolved.user.profile.email = 'mutated';
		expect(user.tags).toEqual(['a', 'b', 'c']);
		expect(user.profile.email).toBe('ada@example.com');
	});

	it('falls back to the JSON view, then to the value itself', () => {
		const withFunction = { id: 1, fn: () => 1 };
		expect(copyPipelineData(withFunction)).toEqual({ id: 1 });
		const cyclic: Record<string, unknown> = { fn: () => 1 };
		cyclic.self = cyclic;
		expect(copyPipelineData(cyclic)).toBe(cyclic);
		expect(copyPipelineData({ toJSON: () => undefined, fn: () => 1 })).toBeUndefined();
		expect(copyPipelineData('text')).toBe('text');
	});
});

describe('limits', () => {
	it(`resolves ${MAX_NESTING_DEPTH} levels of nesting`, () => {
		expect(() => resolveVariables(nested(MAX_NESTING_DEPTH), context)).not.toThrow();
	});

	it('throws a plain Error, not a stack overflow, past the limit', () => {
		expect(() => resolveVariables(nested(MAX_NESTING_DEPTH + 1), context)).toThrow(
			/nested deeper than 64 levels/
		);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => resolveVariables(cyclic, context)).toThrow(/nested deeper than 64 levels/);
	});
});

describe('when conditions over unresolved references', () => {
	const missing = '$steps.missing.value';

	it('$exists is false', () => {
		expect(evaluateCondition({ $exists: missing }, context)).toBe(false);
		expect(evaluateCondition({ $exists: '$prev.constructor' }, context)).toBe(false);
		expect(evaluateCondition({ $exists: '$input.none' }, { steps: [] })).toBe(false);
	});

	it('comparisons with an absent operand are false', () => {
		expect(evaluateCondition({ $eq: [missing, 1] }, context)).toBe(false);
		expect(evaluateCondition({ $ne: [missing, 1] }, context)).toBe(false);
		expect(evaluateCondition({ $gt: [missing, 0] }, context)).toBe(false);
		expect(evaluateCondition({ $gte: [missing, 0] }, context)).toBe(false);
		expect(evaluateCondition({ $lt: [missing, 0] }, context)).toBe(false);
		expect(evaluateCondition({ $lte: [missing, 0] }, context)).toBe(false);
		expect(evaluateCondition({ $eq: [missing, undefined] }, context)).toBe(false);
		expect(evaluateCondition({ $eq: ['$prev.id', undefined] }, context)).toBe(false);
	});

	it('$not of a false comparison is true', () => {
		expect(evaluateCondition({ $not: { $eq: [missing, 1] } }, context)).toBe(true);
	});

	it('treats operands that are not references as absent', () => {
		expect(evaluateCondition({ $exists: 'literal' }, context)).toBe(false);
		expect(evaluateCondition({ $eq: ['$9.99', '$9.99'] }, context)).toBe(false);
		expect(evaluateCondition({ $eq: ['$$prev', '$prev'] }, context)).toBe(false);
	});

	it('compares resolved values', () => {
		expect(evaluateCondition({ $eq: ['$steps.user.name', 'Ada'] }, context)).toBe(true);
		expect(evaluateCondition({ $ne: ['$steps.user.name', 'Bob'] }, context)).toBe(true);
		expect(evaluateCondition({ $gte: ['$input.limits[1]', 20] }, context)).toBe(true);
		expect(evaluateCondition({ $lt: ['$steps.user.name', 20] }, context)).toBe(false);
	});
});
