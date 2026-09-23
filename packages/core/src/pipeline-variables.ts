/**
 * @fileoverview Pipeline variable references, as specified in `spec/pipeline-variables.md`.
 *
 * A step input string is a reference only when the whole string is one of `$prev`, `$first`,
 * `$steps[N]`, `$steps.<alias>` or `$input`, optionally followed by `.<path>`. Every other string
 * is a literal, and a leading `$$` sends a literal `$`. Paths reach only own keys of plain JSON
 * objects and in-bounds array indices, never prototypes, getters or `__`-prefixed keys. A
 * reference that cannot be resolved is absent: omitted from objects, `null` in arrays, and never
 * equal to anything in a `when` condition.
 *
 * Separated from `pipeline.ts` to keep both modules within the repository file-size convention.
 */

import type { PipelineCondition, PipelineContext } from './pipeline.js';

/** Step inputs and the request `input` may nest at most this many objects and arrays. */
export const MAX_NESTING_DEPTH = 64;

/** Strings longer than this are literals and are never resolved. */
export const MAX_REFERENCE_LENGTH = 1024;

type Segment = { key: string; index?: number };
type Source =
	| { kind: 'prev' | 'first' | 'input' }
	| { kind: 'index'; index: number }
	| { kind: 'alias'; alias: string };
type Reference = { source: Source; path: Segment[] };

/** A key (no `.`, `[`, `]` or whitespace), optionally followed by one `[N]` index. */
const SEGMENT_PATTERN = /^([^.[\]\s]+)(?:\[(\d+)\])?$/;
const STEP_INDEX_PATTERN = /^\$steps\[(\d+)\]/;
const ALIAS_PATTERN = /^[^.[\]\s]+$/;
const DIGITS_PATTERN = /^\d+$/;
const NAMED_SOURCES = ['$prev', '$first', '$input'] as const;

/** True for objects whose prototype is `Object.prototype` or `null` (what JSON produces). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/**
 * Copy step data so that steps never share objects.
 *
 * Uses `structuredClone`. Data that cannot be structured-cloned (for example, objects holding
 * functions) falls back to its JSON view; data with no JSON view either is returned as is.
 */
export function copyPipelineData(value: unknown): unknown {
	if (typeof value !== 'object' || value === null) return value;
	try {
		return structuredClone(value);
	} catch {
		try {
			const json = JSON.stringify(value);
			return json === undefined ? undefined : JSON.parse(json);
		} catch {
			return value;
		}
	}
}

function parsePath(path: string): Segment[] | undefined {
	const segments: Segment[] = [];
	for (const part of path.split('.')) {
		const match = SEGMENT_PATTERN.exec(part);
		const key = match?.[1];
		if (match === null || key === undefined) return undefined;
		const index = match[2];
		segments.push(index === undefined ? { key } : { key, index: Number(index) });
	}
	return segments;
}

/** Parse a reference string, or return undefined when the string is a literal. */
function parseReference(ref: string): Reference | undefined {
	if (ref.length > MAX_REFERENCE_LENGTH || !ref.startsWith('$') || ref.startsWith('$$')) {
		return undefined;
	}
	let source: Source;
	let rest: string;
	const indexMatch = STEP_INDEX_PATTERN.exec(ref);
	const named = NAMED_SOURCES.find((name) => ref === name || ref.startsWith(`${name}.`));
	if (indexMatch !== null && indexMatch[1] !== undefined) {
		source = { kind: 'index', index: Number(indexMatch[1]) };
		rest = ref.slice(indexMatch[0].length);
	} else if (ref.startsWith('$steps.')) {
		const body = ref.slice('$steps.'.length);
		const dot = body.indexOf('.');
		const alias = dot < 0 ? body : body.slice(0, dot);
		if (!ALIAS_PATTERN.test(alias)) return undefined;
		source = { kind: 'alias', alias };
		rest = dot < 0 ? '' : body.slice(dot);
	} else if (named !== undefined) {
		source = { kind: named === '$prev' ? 'prev' : named === '$first' ? 'first' : 'input' };
		rest = ref.slice(named.length);
	} else {
		return undefined;
	}
	if (rest === '') return { source, path: [] };
	if (!rest.startsWith('.')) return undefined;
	const path = parsePath(rest.slice(1));
	return path === undefined ? undefined : { source, path };
}

/** The value of an own data property, without invoking getters. */
function ownData(container: object, key: string): unknown {
	if (!Object.hasOwn(container, key)) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(container, key);
	return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function element(array: readonly unknown[], index: number): unknown {
	return Number.isSafeInteger(index) && index < array.length
		? ownData(array, String(index))
		: undefined;
}

function child(container: unknown, key: string): unknown {
	if (key.startsWith('__')) return undefined;
	if (Array.isArray(container)) {
		return DIGITS_PATTERN.test(key) ? element(container, Number(key)) : undefined;
	}
	return isPlainObject(container) ? ownData(container, key) : undefined;
}

function traverse(root: unknown, path: readonly Segment[]): unknown {
	let current = root;
	for (const { key, index } of path) {
		current = child(current, key);
		if (index !== undefined) current = Array.isArray(current) ? element(current, index) : undefined;
		if (current === undefined) return undefined;
	}
	return current;
}

function sourceData(source: Source, context: PipelineContext): unknown {
	switch (source.kind) {
		case 'prev':
			return context.previousResult?.data;
		case 'first':
			return context.steps[0]?.data;
		case 'input':
			return context.pipelineInput;
		case 'index':
			return Number.isSafeInteger(source.index) && source.index < context.steps.length
				? context.steps[source.index]?.data
				: undefined;
		case 'alias':
			if (source.alias.startsWith('__')) return undefined;
			return context.steps.find((step) => step.alias === source.alias)?.data;
	}
}

function lookup(ref: Reference, context: PipelineContext): unknown {
	return traverse(sourceData(ref.source, context), ref.path);
}

/**
 * Resolve one step input string against the pipeline context.
 *
 * - A reference (`$prev`, `$first`, `$steps[N]`, `$steps.<alias>`, `$input`, each optionally
 *   followed by `.<path>`) resolves to that data, or to `undefined` (absent) when it cannot be
 *   resolved: unknown alias, index out of bounds, missing key, skipped or failed step, a
 *   `__`-prefixed segment, or no request `input`.
 * - A string starting with `$$` is a literal with one leading `$` removed.
 * - Any other string (`$9.99`, `$HOME`, `$prevx`, or anything longer than 1024 characters) is
 *   returned unchanged.
 *
 * `$input` is the pipeline request's own `input` field, never the host's execution context.
 * A path follows only own keys of plain JSON objects and in-bounds array indices; a purely
 * numeric segment (`items.2`) indexes an array. Prototype properties such as `constructor`
 * never match.
 *
 * @param ref - A step input string (e.g. '$prev.user.name', '$steps.order.items[0]', '$$literal')
 * @param context - Pipeline execution context
 * @returns The resolved value, the literal string, or undefined when a reference is unresolved
 *
 * @example
 * ```typescript
 * resolveVariable('$prev.user.name', context); // data of the previous step
 * resolveVariable('$steps.order.items[0]', context); // first item of the step aliased 'order'
 * resolveVariable('$9.99', context); // '$9.99' (not a reference)
 * resolveVariable('$$prev', context); // '$prev' (escaped literal)
 * ```
 */
export function resolveVariable(ref: string, context: PipelineContext): unknown {
	if (ref.startsWith('$$')) return ref.slice(1);
	const parsed = parseReference(ref);
	return parsed === undefined ? ref : lookup(parsed, context);
}

/** Marks a reference that could not be resolved, as opposed to a literal `undefined`. */
const ABSENT: unique symbol = Symbol('absent');

function resolveValue(value: unknown, context: PipelineContext, depth: number): unknown {
	if (typeof value === 'string') {
		if (value.startsWith('$$')) return value.slice(1);
		const parsed = parseReference(value);
		if (parsed === undefined) return value;
		const resolved = lookup(parsed, context);
		return resolved === undefined ? ABSENT : copyPipelineData(resolved);
	}
	const isArray = Array.isArray(value);
	if (!isArray && !isPlainObject(value)) return value;
	if (depth >= MAX_NESTING_DEPTH) {
		throw new Error(`Pipeline step input is nested deeper than ${MAX_NESTING_DEPTH} levels`);
	}
	if (isArray) {
		return value.map((item) => {
			const resolved = resolveValue(item, context, depth + 1);
			return resolved === ABSENT ? null : resolved;
		});
	}
	const entries: Array<[string, unknown]> = [];
	for (const [key, item] of Object.entries(value)) {
		const resolved = resolveValue(item, context, depth + 1);
		if (resolved !== ABSENT) entries.push([key, resolved]);
	}
	return Object.fromEntries(entries);
}

/**
 * Resolve every reference in a step input (see {@link resolveVariable}).
 *
 * Walks arrays and plain objects; other values pass through unchanged. An unresolved reference
 * is omitted as an object property and becomes `null` as an array element. Resolved values are
 * copies, so a handler that mutates its input cannot change another step's data.
 *
 * @param input - Step input potentially containing references
 * @param context - Pipeline execution context
 * @returns The input with all references resolved
 * @throws Error when arrays and objects nest deeper than 64 levels; `executePipeline` rejects
 *   such inputs with `VALIDATION_ERROR` before any step runs
 */
export function resolveVariables(input: unknown, context: PipelineContext): unknown {
	const resolved = resolveValue(input, context, 0);
	return resolved === ABSENT ? undefined : resolved;
}

/**
 * Get a nested value from plain JSON data using dot notation.
 *
 * Only own keys of plain objects and in-bounds array indices are followed; `__`-prefixed keys,
 * prototype properties and getters are never read.
 *
 * @param obj - The data to traverse
 * @param path - Dot-separated path (e.g., 'user.profile.name', 'items[1]', 'items.1')
 * @returns The value at the path, or undefined if not found
 *
 * @example
 * ```typescript
 * getNestedValue({ user: { name: 'Alice' } }, 'user.name'); // => 'Alice'
 * getNestedValue({ items: [1, 2, 3] }, 'items[1]'); // => 2
 * getNestedValue({}, 'constructor'); // => undefined
 * ```
 */
export function getNestedValue(obj: unknown, path: string): unknown {
	const segments = parsePath(path);
	return segments === undefined ? undefined : traverse(obj, segments);
}

/** A condition operand: a reference, or absent when it is not one or cannot be resolved. */
function operand(ref: unknown, context: PipelineContext): unknown {
	if (typeof ref !== 'string') return undefined;
	const parsed = parseReference(ref);
	return parsed === undefined ? undefined : lookup(parsed, context);
}

function compare(
	pair: readonly [unknown, unknown],
	context: PipelineContext,
	test: (value: unknown, expected: unknown) => boolean
): boolean {
	const value = operand(pair[0], context);
	const expected = pair[1];
	return value !== undefined && expected !== undefined && test(value, expected);
}

/** Structural equality of JSON values: objects and arrays compare by content, never identity. */
function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, i) => jsonEqual(item, b[i]))
		);
	}
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	return (
		aKeys.length === bKeys.length &&
		aKeys.every(
			(key) => Object.hasOwn(b, key) && jsonEqual(Reflect.get(a, key), Reflect.get(b, key))
		)
	);
}

function numeric(value: unknown, expected: unknown, test: (a: number, b: number) => boolean) {
	return typeof value === 'number' && typeof expected === 'number' && test(value, expected);
}

/**
 * Evaluate a pipeline condition against the current context.
 *
 * The first operand of every comparison is a reference. A string that is not a reference, or a
 * reference that cannot be resolved, is absent: `$exists` is false (as it is for `null`), and
 * `$eq`, `$ne`, `$gt`, `$gte`, `$lt` and `$lte` are false when either operand is absent. `$eq` and
 * `$ne` compare JSON values structurally.
 *
 * @param condition - The condition to evaluate
 * @param context - Pipeline execution context
 * @returns true if the condition is met, false otherwise
 */
export function evaluateCondition(condition: PipelineCondition, context: PipelineContext): boolean {
	if ('$exists' in condition) {
		const value = operand(condition.$exists, context);
		return value !== undefined && value !== null;
	}
	if ('$eq' in condition) return compare(condition.$eq, context, jsonEqual);
	if ('$ne' in condition) return compare(condition.$ne, context, (a, b) => !jsonEqual(a, b));
	if ('$gt' in condition) {
		return compare(condition.$gt, context, (a, b) => numeric(a, b, (x, y) => x > y));
	}
	if ('$gte' in condition) {
		return compare(condition.$gte, context, (a, b) => numeric(a, b, (x, y) => x >= y));
	}
	if ('$lt' in condition) {
		return compare(condition.$lt, context, (a, b) => numeric(a, b, (x, y) => x < y));
	}
	if ('$lte' in condition) {
		return compare(condition.$lte, context, (a, b) => numeric(a, b, (x, y) => x <= y));
	}
	if ('$and' in condition) return condition.$and.every((c) => evaluateCondition(c, context));
	if ('$or' in condition) return condition.$or.some((c) => evaluateCondition(c, context));
	if ('$not' in condition) return !evaluateCondition(condition.$not, context);
	return false;
}

/**
 * Alias for resolveVariable (backwards compatibility).
 *
 * @deprecated Use resolveVariable instead
 */
export const resolveReference = resolveVariable;
