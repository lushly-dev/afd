/**
 * @fileoverview Matcher detection and validation for scenario data assertions.
 *
 * An expected value is either a literal (compared with deep equality), a
 * matcher object whose keys are all matcher keys, or a nested object of field
 * assertions. Anything ambiguous is rejected instead of silently ignored.
 */

import type { AssertionMatcher, Expectation } from './scenario.js';

/** Keys that make an expectation object a matcher. */
const MATCHER_KEYS: ReadonlySet<string> = new Set([
	'equals',
	'contains',
	'matches',
	'exists',
	'notExists',
	'length',
	'includes',
	'gte',
	'lte',
	'between',
]);

/**
 * Thrown when a scenario expectation is malformed (for example a matcher
 * object mixed with field keys, or a matcher given the wrong type of value).
 */
export class InvalidExpectationError extends Error {
	readonly problems: string[];

	constructor(problems: string[]) {
		super(problems.join('; '));
		this.name = 'InvalidExpectationError';
		this.problems = problems;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function quoteList(keys: string[]): string {
	return keys.map((key) => `'${key}'`).join(', ');
}

/**
 * Check whether an expected value is an `AssertionMatcher`.
 *
 * An object is a matcher only when every one of its keys is a matcher key
 * (`equals`, `contains`, `matches`, `exists`, `notExists`, `length`,
 * `includes`, `gte`, `lte`, `between`). An object that mixes matcher keys with
 * other keys is ambiguous: the other keys would be ignored, and a typo such as
 * `matchs` next to a real matcher would pass. This function throws for it.
 *
 * @param value - The expected value
 * @param path - Location used in the error message, such as `data.user`
 * @throws Error when matcher keys and other keys are mixed
 */
export function isAssertionMatcher(value: unknown, path = 'value'): value is AssertionMatcher {
	if (!isPlainObject(value)) {
		return false;
	}
	const keys = Object.keys(value);
	const otherKeys = keys.filter((key) => !MATCHER_KEYS.has(key));
	if (otherKeys.length === keys.length) {
		return false;
	}
	if (otherKeys.length > 0) {
		const matcherKeys = keys.filter((key) => MATCHER_KEYS.has(key));
		throw new Error(
			`Invalid assertion at ${path}: ${quoteList(matcherKeys)} ${matcherKeys.length === 1 ? 'is a matcher key' : 'are matcher keys'} but ${quoteList(otherKeys)} ${otherKeys.length === 1 ? 'is' : 'are'} not. ` +
				`Use only matcher keys (${[...MATCHER_KEYS].join(', ')}), or nest field assertions in their own object. ` +
				`To compare against a literal object, use { equals: ... }.`
		);
	}
	return true;
}

function isValidRegex(source: string): boolean {
	try {
		return RegExp(source) instanceof RegExp;
	} catch {
		return false;
	}
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Describe what is wrong with a matcher value, or return undefined when it is valid.
 */
function matcherValueProblem(key: string, value: unknown): string | undefined {
	switch (key) {
		case 'contains':
			return typeof value === 'string' ? undefined : 'expects a string';
		case 'matches':
			if (typeof value !== 'string') return 'expects a regular expression string';
			return isValidRegex(value) ? undefined : 'is not a valid regular expression';
		case 'exists':
		case 'notExists':
			return typeof value === 'boolean' ? undefined : 'expects true or false';
		case 'length':
			return Number.isInteger(value) && (value as number) >= 0
				? undefined
				: 'expects a non-negative integer';
		case 'gte':
		case 'lte':
			return isFiniteNumber(value) ? undefined : 'expects a number';
		case 'between':
			return Array.isArray(value) &&
				value.length === 2 &&
				isFiniteNumber(value[0]) &&
				isFiniteNumber(value[1]) &&
				value[0] <= value[1]
				? undefined
				: 'expects [min, max] with min <= max';
		default:
			// `equals` and `includes` accept any value
			return undefined;
	}
}

function collectProblems(
	expected: Record<string, unknown>,
	basePath: string,
	problems: string[]
): void {
	for (const [key, value] of Object.entries(expected)) {
		const path = `${basePath}.${key}`;
		let matcher: boolean;
		try {
			matcher = isAssertionMatcher(value, path);
		} catch (err) {
			problems.push(err instanceof Error ? err.message : String(err));
			continue;
		}
		if (matcher) {
			for (const [matcherKey, matcherValue] of Object.entries(value as Record<string, unknown>)) {
				const problem = matcherValueProblem(matcherKey, matcherValue);
				if (problem) {
					problems.push(`Invalid assertion at ${path}: '${matcherKey}' ${problem}`);
				}
			}
		} else if (isPlainObject(value)) {
			collectProblems(value, path, problems);
		}
	}
}

/**
 * List every problem in an expectation that would otherwise be silently
 * ignored (empty when valid): malformed data assertions, `data` assertions on
 * an expected failure, and `error` assertions on an expected success.
 */
export function findExpectationProblems(
	expectation: Pick<Expectation, 'success' | 'data' | 'error'>
): string[] {
	const problems: string[] = [];
	if (expectation.data) {
		if (expectation.success) {
			collectProblems(expectation.data, 'data', problems);
		} else {
			problems.push("'data' assertions are only checked when 'success' is true");
		}
	}
	if (expectation.error && expectation.success) {
		problems.push("'error' assertions are only checked when 'success' is false");
	}
	const suggestion = expectation.error?.suggestion;
	if (suggestion !== undefined && typeof suggestion !== 'string') {
		const before = problems.length;
		collectProblems({ suggestion }, 'error', problems);
		if (problems.length === before && !isAssertionMatcher(suggestion)) {
			problems.push("'error.suggestion' must be a string or a matcher object");
		}
	}
	return problems;
}
