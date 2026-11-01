/**
 * A skill's frontmatter (`spec/mcp-resources.md`, S2): one YAML mapping read with the YAML 1.2
 * core schema, with no tags, anchors or aliases. The cases follow the Rust reader's
 * (`packages/rust/src/server/frontmatter.rs`), so both languages produce the same JSON.
 */
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter.js';

const frontmatter = (yaml: string) => parseFrontmatter(`---\n${yaml}---\nbody\n`);

describe('parseFrontmatter', () => {
	it('reads the YAML 1.2 core schema', () => {
		expect(
			frontmatter(
				[
					'name: hello',
					'date: 2026-11-01',
					'yes: no',
					'when: 12:30:00',
					'n: -12',
					'plus: +7',
					'hex: 0x1F',
					'oct: 0o17',
					'legacy: 0777',
					'f: 1.5e3',
					'dot: 1.',
					'half: .5',
					'nothing: ~',
					'empty:',
					'up: TRUE',
					'quoted: "123"',
					"single: 'true'",
					'list: [a, 1, null]',
					'nested:\n  deep:\n    - x: y',
					'',
				].join('\n')
			)
		).toEqual({
			name: 'hello',
			date: '2026-11-01',
			yes: 'no',
			when: '12:30:00',
			n: -12,
			plus: 7,
			hex: 31,
			oct: 15,
			legacy: 777,
			f: 1500,
			dot: 1,
			half: 0.5,
			nothing: null,
			empty: null,
			up: true,
			quoted: '123',
			single: 'true',
			list: ['a', 1, null],
			nested: { deep: [{ x: 'y' }] },
		});
	});

	it('reads block scalars and CRLF line ends', () => {
		const parsed = parseFrontmatter(
			'---\r\nname: a\r\ndescription: |\r\n  one\r\n  two\r\n---\r\nbody'
		);
		expect(parsed.description).toBe('one\ntwo\n');
	});

	it('keeps large integers finite', () => {
		const parsed = frontmatter('big: 18446744073709551616\nmax: 18446744073709551615\n');
		expect(Number.isFinite(parsed.big)).toBe(true);
		expect(Number.isFinite(parsed.max)).toBe(true);
	});

	it('keeps a __proto__ key as data', () => {
		const parsed = frontmatter('"__proto__": {a: 1}\n');
		expect(Object.keys(parsed)).toEqual(['__proto__']);
		expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
	});

	it.each([
		['name: &n hello\ndescription: *n\n', 'anchor'],
		['name: hello\ndescription: *n\n', 'YAML'],
		['name: &n hello\n', 'anchor'],
		['name: !!str hello\n', 'tag'],
		['name: !custom hello\n', 'tag'],
		['a: .inf\n', 'finite'],
		['a: -.INF\n', 'finite'],
		['a: .nan\n', 'finite'],
		['a: 1e999\n', 'finite'],
		['1: x\n', 'key'],
		['true: x\n', 'key'],
		['~: x\n', 'key'],
		['? [a]\n: x\n', 'key'],
		['a: 1\na: 2\n', 'repeats'],
		['- a\n- b\n', 'mapping'],
		['just text\n', 'mapping'],
		['', 'mapping'],
		['a: [1\n', 'YAML'],
		['a: b: c\n', 'YAML'],
	])('refuses %j', (yaml, expected) => {
		expect(() => frontmatter(yaml)).toThrow(expected);
	});

	it('refuses a second document and deep nesting', () => {
		expect(() => frontmatter('a: 1\n...\n--- b\n')).toThrow('one YAML document');
		expect(() => frontmatter(`a: ${'['.repeat(200)}${']'.repeat(200)}\n`)).toThrow('nested');
		expect(() => frontmatter(`a: ${'['.repeat(20_000)}${']'.repeat(20_000)}\n`)).toThrow();
		expect(() => frontmatter(`a: ${'['.repeat(63)}${']'.repeat(63)}\n`)).not.toThrow();
	});

	it('needs both fences', () => {
		expect(() => parseFrontmatter('name: a\n')).toThrow('begin');
		expect(() => parseFrontmatter('# title\n---\nname: a\n---\n')).toThrow('begin');
		expect(() => parseFrontmatter('---\nname: a\n')).toThrow('closing');
		expect(parseFrontmatter('---\nname: a\n---').name).toBe('a');
	});
});
