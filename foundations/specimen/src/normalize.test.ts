import { describe, expect, it } from 'vitest';
import { normalizeDom, normalizeElements } from './normalize.js';
import type { ElementObservation } from './types.js';

function observation(
	ref: string,
	attributes: Record<string, string>,
	state: ElementObservation['state'] = {}
): ElementObservation {
	return {
		ref,
		tag: 'input',
		attributes,
		box: { x: 0, y: 0, width: 10, height: 10 },
		scroll: { width: 10, height: 10, clientWidth: 10, clientHeight: 10 },
		styles: {},
		state,
	};
}

describe('normalizeDom', () => {
	it('sorts attributes without discarding comments or text whitespace', () => {
		expect(normalizeDom('<div z="1" a="2"> a  b\n<!--binding--></div>')).toBe(
			'<div a="2" z="1"> a  b\n<!--binding--></div>'
		);
	});

	it('preserves leading newlines, carriage returns and whitespace-sensitive content', () => {
		for (const raw of [
			'<pre>\na</pre>',
			'<pre>\n\na</pre>',
			'<pre>\n</pre>',
			'<textarea>\na</textarea>',
			'<div>\ra\r\nb</div>',
			'<style>\r.x { color:red }</style>',
		]) {
			expect(normalizeDom(raw)).toBe(raw);
		}
		expect(normalizeDom('<pre> a b </pre>')).not.toBe(normalizeDom('<pre> a  b </pre>'));
	});

	it('canonicalizes recognized generated ids and their relationships', () => {
		const html = (id: number) =>
			`<label for="specimen-generated-${id}">Name</label><input id="specimen-generated-${id}" aria-describedby="help"><a href="#specimen-generated-${id}">Jump</a>`;
		expect(normalizeDom(html(10))).toBe(normalizeDom(html(400)));
	});

	it('preserves arbitrary authored ids and generated-looking text', () => {
		expect(normalizeDom('<div id="user-1">specimen-generated-1</div>')).not.toBe(
			normalizeDom('<div id="user-2">specimen-generated-2</div>')
		);
		expect(normalizeDom('<div id="specimen-generated-a"></div>')).toBe(
			'<div id="specimen-generated-a"></div>'
		);
	});

	it('never repairs an unresolved generated reference through canonical naming', () => {
		const broken =
			'<label for="specimen-generated-1">Name</label><input id="specimen-generated-2">';
		const repaired =
			'<label for="specimen-generated-1">Name</label><input id="specimen-generated-1">';
		expect(normalizeDom(broken)).not.toBe(normalizeDom(repaired));
	});

	it('preserves the distinction between two missing references and a shared missing reference', () => {
		expect(
			normalizeDom('<div aria-controls="specimen-generated-1 specimen-generated-2"></div>')
		).not.toBe(
			normalizeDom('<div aria-controls="specimen-generated-9 specimen-generated-9"></div>')
		);
	});

	it('normalizes shadow templates independently and preserves cross-root broken links', () => {
		const html = (id: number) =>
			`<x-box aria-labelledby="specimen-generated-${id}"><template shadowrootmode="open"><label id="specimen-generated-${id}">Title</label><input aria-labelledby="specimen-generated-${id}"></template></x-box>`;
		expect(normalizeDom(html(1))).toBe(normalizeDom(html(90)));
		expect(normalizeDom(html(1))).toContain('missing_1');
	});

	it('does not confuse shadow-local and light-DOM ids', () => {
		const broken =
			'<div id="specimen-generated-1"><x-box><template shadowrootmode="open"><input aria-controls="specimen-generated-1"></template></x-box></div>';
		const repaired =
			'<div id="specimen-generated-1"><x-box><template shadowrootmode="open"><input id="specimen-generated-2" aria-controls="specimen-generated-2"></template></x-box></div>';
		expect(normalizeDom(broken)).not.toBe(normalizeDom(repaired));
	});

	it('preserves duplicate-id relationships', () => {
		expect(
			normalizeDom('<i id="specimen-generated-1"></i><i id="specimen-generated-1"></i>')
		).not.toBe(normalizeDom('<i id="specimen-generated-2"></i><i id="specimen-generated-3"></i>'));
	});

	it('normalizes attribute order before numbering missing references', () => {
		expect(
			normalizeDom(
				'<i aria-labelledby="specimen-generated-10" aria-controls="specimen-generated-20"></i>'
			)
		).toBe(
			normalizeDom(
				'<i aria-controls="specimen-generated-2" aria-labelledby="specimen-generated-1"></i>'
			)
		);
	});

	it('normalizes namespaced fragment hrefs while preserving external fragment links', () => {
		const before =
			'<svg><defs><path id="specimen-generated-1"></path></defs><use xlink:href="#specimen-generated-1"></use></svg><a href="/other#specimen-generated-1"></a>';
		const after =
			'<svg><defs><path id="specimen-generated-2"></path></defs><use xlink:href="#specimen-generated-2"></use></svg><a href="/other#specimen-generated-1"></a>';
		expect(normalizeDom(before)).toBe(normalizeDom(after));
	});
});

describe('normalizeElements', () => {
	it('normalizes identifier attributes and identifier state, retaining user control values', () => {
		const left = [
			observation(
				'root/input:1',
				{ id: 'specimen-generated-1', 'aria-controls': 'specimen-generated-1' },
				{ activeDescendant: 'specimen-generated-1', value: 'specimen-generated-1' }
			),
		];
		const right = [
			observation(
				'root/input:1',
				{ id: 'specimen-generated-20', 'aria-controls': 'specimen-generated-20' },
				{ activeDescendant: 'specimen-generated-20', value: 'specimen-generated-1' }
			),
		];
		expect(normalizeElements(left)).toEqual(normalizeElements(right));
		expect(normalizeElements(left)[0]?.state.value).toBe('specimen-generated-1');
	});

	it('keeps references scoped to their open shadow root and never mutates input', () => {
		const input = [
			observation('root/x-box:1', { id: 'specimen-generated-1' }),
			observation('root/x-box:1/shadow/input:1', { 'aria-controls': 'specimen-generated-1' }),
		];
		const output = normalizeElements(input);
		expect(output[1]?.attributes['aria-controls']).toContain('missing');
		expect(input[0]?.attributes.id).toBe('specimen-generated-1');
	});
});
