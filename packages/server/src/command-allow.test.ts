import { describe, expect, it } from 'vitest';
import { bindCommandAllow, filterAllowed, isCommandAllowed } from './command-allow.js';

const onlyList = (name: string) => name === 'note-list';

describe('command allow binding', () => {
	it('leaves a context unchanged, and everything allowed, without a predicate', () => {
		const context = { traceId: 't-1' };
		expect(bindCommandAllow(context, undefined)).toBe(context);
		expect(isCommandAllowed(context, 'note-delete')).toBe(true);
		expect(isCommandAllowed(undefined, 'note-delete')).toBe(true);
		const items = [{ name: 'note-list' }, { name: 'note-delete' }];
		expect(filterAllowed(items, context)).toBe(items);
	});

	it('survives the copies made for batch items and pipeline steps', () => {
		const bound = bindCommandAllow({ traceId: 't-1' }, onlyList);
		const copy = { ...{ ...bound, traceId: 't-1-0' }, signal: new AbortController().signal };
		expect(isCommandAllowed(copy, 'note-list')).toBe(true);
		expect(isCommandAllowed(copy, 'note-delete')).toBe(false);
		expect(filterAllowed([{ name: 'note-list' }, { name: 'note-delete' }], copy)).toEqual([
			{ name: 'note-list' },
		]);
	});

	it('carries an opaque token, never the predicate, and serializes nothing', () => {
		const bound = bindCommandAllow({}, onlyList);
		expect(Object.keys(bound)).toEqual([]);
		expect(JSON.stringify(bound)).toBe('{}');
		const [key] = Object.getOwnPropertySymbols(bound);
		const token = key && (bound as Record<symbol, unknown>)[key];
		expect(token).toEqual({});
		expect(Object.isFrozen(token)).toBe(true);
		expect(typeof token).not.toBe('function');
	});

	it('denies everything for a token it did not mint', () => {
		const bound = bindCommandAllow({}, onlyList);
		const [key] = Object.getOwnPropertySymbols(bound);
		if (!key) throw new Error('expected a bound token');
		expect(isCommandAllowed({ [key]: {} }, 'note-list')).toBe(false);
		expect(isCommandAllowed({ [key]: () => true }, 'note-list')).toBe(false);
	});

	it('only narrows a context that already carries a predicate', () => {
		const outer = bindCommandAllow({}, (name) => name.startsWith('note-'));
		const inner = bindCommandAllow(outer, (name) => name !== 'note-delete');
		expect(isCommandAllowed(inner, 'note-list')).toBe(true);
		expect(isCommandAllowed(inner, 'note-delete')).toBe(false);
		expect(isCommandAllowed(inner, 'bill-pay')).toBe(false);
		// Without a new predicate, the carried one still applies.
		expect(isCommandAllowed(bindCommandAllow(outer, undefined), 'bill-pay')).toBe(false);
	});

	it('denies when the predicate throws or answers anything but true', () => {
		const throwing = bindCommandAllow({}, () => {
			throw new Error('policy unavailable');
		});
		expect(isCommandAllowed(throwing, 'note-list')).toBe(false);
		const truthy = bindCommandAllow({}, (() => 1) as unknown as (name: string) => boolean);
		expect(isCommandAllowed(truthy, 'note-list')).toBe(false);
	});
});
