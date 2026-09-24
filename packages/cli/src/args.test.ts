import { describe, expect, it } from 'vitest';
import { describeArgsError, parseKeyValuePairs, parseToolArgs, splitPairs } from './args.js';

describe('parseToolArgs', () => {
	it('returns {} for missing or blank arguments', () => {
		expect(parseToolArgs(undefined)).toEqual({});
		expect(parseToolArgs('   ')).toEqual({});
	});

	it('parses a JSON object, keeping whitespace inside strings', () => {
		expect(parseToolArgs('  {"title": "Buy  milk\\tnow", "n": 1}  ')).toEqual({
			title: 'Buy  milk\tnow',
			n: 1,
		});
		expect(() => parseToolArgs('{broken')).toThrow(SyntaxError);
		expect(() => parseToolArgs('{"a": 1} trailing')).toThrow(SyntaxError);
	});

	it('parses key=value pairs, reading JSON values where possible', () => {
		expect(parseToolArgs('count=2 done=true label=hello id=007 empty= expr=a=b none=null')).toEqual(
			{
				count: 2,
				done: true,
				label: 'hello',
				id: '007',
				empty: '',
				expr: 'a=b',
				none: null,
			}
		);
	});
});

describe('parseKeyValuePairs', () => {
	it('keeps spaces in quoted values and in JSON array/object values', () => {
		expect(
			parseKeyValuePairs(
				`title="Buy oat milk" note='two  words' tags=["a b", "c"] meta={"k": [1, {"x": "}"}]}`
			)
		).toEqual({
			title: 'Buy oat milk',
			note: 'two  words',
			tags: ['a b', 'c'],
			meta: { k: [1, { x: '}' }] },
		});
	});

	it('treats quotes and brackets inside a bare value as ordinary characters', () => {
		expect(parseKeyValuePairs(`note=don't x=a[b c=d]`)).toEqual({
			note: "don't",
			x: 'a[b',
			c: 'd]',
		});
		expect(parseKeyValuePairs('bad="a"b')).toEqual({ bad: '"a"b' });
		expect(parseKeyValuePairs('esc="say \\"hi\\""')).toEqual({ esc: 'say "hi"' });
	});

	it('keeps a __proto__ key as an own argument', () => {
		const args = parseKeyValuePairs('__proto__=1');
		expect(Object.keys(args)).toEqual(['__proto__']);
		expect(Object.getPrototypeOf(args)).toBe(Object.prototype);
	});

	it('rejects tokens without a key, unterminated quotes and unbalanced brackets', () => {
		expect(() => parseKeyValuePairs('title')).toThrow('Expected key=value, got "title"');
		expect(() => parseKeyValuePairs('=value')).toThrow('Expected key=value, got "=value"');
		expect(() => parseKeyValuePairs('note="open')).toThrow('Unterminated " quote');
		expect(() => parseKeyValuePairs("note='open")).toThrow("Unterminated ' quote");
		expect(() => parseKeyValuePairs('tags=[1, 2')).toThrow('Unbalanced brackets');
	});
});

describe('splitPairs', () => {
	it('splits on any run of whitespace', () => {
		expect(splitPairs(' a=1 \t b=2\n c=3 ')).toEqual(['a=1', 'b=2', 'c=3']);
		expect(splitPairs('"quoted key"=1')).toEqual(['"quoted key"=1']);
	});
});

describe('describeArgsError', () => {
	it('explains the problem and the accepted formats', () => {
		expect(describeArgsError(new Error('Expected key=value, got "x"'))).toBe(
			'Invalid arguments (Expected key=value, got "x"). Use a JSON object or key=value pairs.'
		);
		expect(describeArgsError('odd')).toContain('(odd)');
	});
});
