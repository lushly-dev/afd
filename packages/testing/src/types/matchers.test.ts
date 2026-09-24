/**
 * Matcher detection: an object is a matcher only when every key is a matcher
 * key, and ambiguous or malformed matchers are errors, never false greens.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { evaluateResult } from '../runner/evaluator.js';
import {
	findExpectationProblems,
	InvalidExpectationError,
	isAssertionMatcher,
} from './matchers.js';
import type { Expectation } from './scenario.js';

const alice: CommandResult<unknown> = {
	success: true,
	data: { user: { name: 'Alice', tags: ['a'] }, count: 3, settings: { exists: true } },
};

describe('isAssertionMatcher', () => {
	it('accepts objects whose keys are all matcher keys', () => {
		expect(isAssertionMatcher({ exists: true })).toBe(true);
		expect(isAssertionMatcher({ gte: 1, lte: 5 })).toBe(true);
		expect(isAssertionMatcher({ equals: { any: 'value' } })).toBe(true);
	});

	it('treats objects without matcher keys, empty objects and non-objects as values', () => {
		expect(isAssertionMatcher({ name: 'Bob' })).toBe(false);
		expect(isAssertionMatcher({})).toBe(false);
		expect(isAssertionMatcher(null)).toBe(false);
		expect(isAssertionMatcher(['exists'])).toBe(false);
		expect(isAssertionMatcher('exists')).toBe(false);
	});

	it('throws for an object that mixes matcher keys with other keys', () => {
		expect(() => isAssertionMatcher({ exists: true, name: 'Bob' }, 'data.user')).toThrow(
			/Invalid assertion at data\.user: 'exists' is a matcher key but 'name' is not/
		);
	});
});

describe('evaluateResult matcher safety', () => {
	it('does not pass {exists, name} against a different name (was a false green)', () => {
		const expected: Expectation = {
			success: true,
			data: { user: { exists: true, name: 'Bob' } },
		};

		expect(() => evaluateResult(alice, expected)).toThrow(InvalidExpectationError);
	});

	it('does not ignore a typo next to a real matcher (was a false green)', () => {
		const expected: Expectation = {
			success: true,
			data: { user: { name: { contains: 'Ali', matchs: '^Z' } } },
		};

		expect(() => evaluateResult(alice, expected)).toThrow("'matchs'");
	});

	it('fails a lone typo instead of passing it', () => {
		const expected: Expectation = {
			success: true,
			data: { user: { name: { matchs: '^A' } } },
		};

		expect(evaluateResult(alice, expected).passed).toBe(false);
	});

	it('supports equals, including for literal objects that look like matchers', () => {
		const passing: Expectation = {
			success: true,
			data: { count: { equals: 3 }, settings: { equals: { exists: true } } },
		};
		const failing: Expectation = { success: true, data: { count: { equals: 4 } } };

		const result = evaluateResult(alice, passing);

		expect(result.passed).toBe(true);
		expect(result.assertions.filter((a) => a.matcher === 'equals').map((a) => a.path)).toEqual([
			'success',
			'data.count',
			'data.settings',
		]);
		expect(evaluateResult(alice, failing).passed).toBe(false);
	});

	it('rejects matcher values of the wrong type', () => {
		const expected: Expectation = {
			success: true,
			data: { count: { gte: '2' }, user: { tags: { length: -1 } } },
		};

		expect(() => evaluateResult(alice, expected)).toThrow(/'gte' expects a number/);
	});

	it('checks error suggestions with a string or a matcher', () => {
		const actual: CommandResult<unknown> = {
			success: false,
			error: { code: 'NOT_FOUND', message: 'missing', suggestion: 'Use todo-list first' },
		};

		expect(
			evaluateResult(actual, { success: false, error: { suggestion: 'todo-list' } }).passed
		).toBe(true);
		expect(
			evaluateResult(actual, {
				success: false,
				error: { suggestion: { contains: 'todo-get' } },
			}).passed
		).toBe(false);
	});
});

describe('findExpectationProblems', () => {
	it('lists every problem that would otherwise be ignored', () => {
		expect(
			findExpectationProblems({
				success: true,
				data: {
					a: { exists: 'yes' },
					b: { between: [5, 1] },
					c: { matches: '[' },
					d: { contains: 3 },
					e: { nested: { lte: 'x' } },
				},
				error: { code: 'X' },
			})
		).toEqual([
			"Invalid assertion at data.a: 'exists' expects true or false",
			"Invalid assertion at data.b: 'between' expects [min, max] with min <= max",
			"Invalid assertion at data.c: 'matches' is not a valid regular expression",
			"Invalid assertion at data.d: 'contains' expects a string",
			"Invalid assertion at data.e.nested: 'lte' expects a number",
			"'error' assertions are only checked when 'success' is false",
		]);
	});

	it('rejects data assertions on an expected failure and malformed suggestions', () => {
		expect(
			findExpectationProblems({
				success: false,
				data: { id: 1 },
				error: { suggestion: { text: 'x' } as unknown as string },
			})
		).toEqual([
			"'data' assertions are only checked when 'success' is true",
			"'error.suggestion' must be a string or a matcher object",
		]);
		expect(
			findExpectationProblems({
				success: false,
				error: { suggestion: { contains: 'a', other: 1 } as unknown as string },
			})[0]
		).toContain('Invalid assertion at error.suggestion');
	});

	it('returns no problems for a valid expectation', () => {
		expect(
			findExpectationProblems({
				success: true,
				data: { id: { exists: true }, n: { between: [1, 2] }, s: { matches: '^a' }, t: 'x' },
			})
		).toEqual([]);
	});
});
