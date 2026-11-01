import { afterEach, describe, expect, it } from 'vitest';
import { locate } from '../src/browser/locate.js';

// Selector targets in a real browser: CSS whose descendant and child combinators cross open
// shadow roots, as Playwright's CSS engine does.
function fixture(): HTMLElement {
	const root = document.createElement('main');
	root.innerHTML =
		'<section class="outer"><x-card id="card"></x-card><p class="note">Note</p><span>After</span></section>';
	const card = root.querySelector('x-card');
	const shadow = card?.attachShadow({ mode: 'open' });
	if (!shadow) throw new Error('No shadow root');
	shadow.innerHTML = '<div class="body"><button class="save">Save</button></div><x-icon></x-icon>';
	const icon = shadow.querySelector('x-icon')?.attachShadow({ mode: 'open' });
	if (!icon) throw new Error('No nested shadow root');
	icon.innerHTML = '<button class="inner">Icon</button>';
	document.body.append(root);
	return root;
}
const ids = (elements: Element[]) =>
	elements.map((element) => element.className || element.localName);

afterEach(() => document.body.replaceChildren());

describe('selector targets', () => {
	it('match descendants across open shadow roots and nested ones', () => {
		const root = fixture();
		expect(ids(locate(root, 'x-card button'))).toEqual(['save', 'inner']);
		expect(ids(locate(root, 'x-card x-icon button'))).toEqual(['inner']);
		expect(ids(locate(root, 'section .save'))).toEqual(['save']);
	});

	it('treat a shadow host as the parent of its shadow root for child combinators', () => {
		const root = fixture();
		expect(ids(locate(root, 'x-card > .body > button'))).toEqual(['save']);
		expect(ids(locate(root, 'x-icon > button'))).toEqual(['inner']);
		expect(locate(root, 'section > button')).toEqual([]);
	});

	it('keep sibling combinators within one tree and accept selector lists', () => {
		const root = fixture();
		expect(ids(locate(root, 'x-card + .note'))).toEqual(['note']);
		expect(ids(locate(root, 'x-card ~ span'))).toEqual(['span']);
		// Composed-tree order: a host's shadow content comes before the host's later siblings.
		expect(ids(locate(root, '.note, .inner'))).toEqual(['inner', 'note']);
		expect(ids(locate(root, '[id="card"] .body > :is(button, a)'))).toEqual(['save']);
	});

	it('read :scope as the mount root', () => {
		const root = fixture();
		expect(ids(locate(root, ':scope > section'))).toEqual(['outer']);
		expect(locate(root, ':scope > button')).toEqual([]);
	});

	it('reject Playwright selector syntax and invalid CSS', () => {
		const root = fixture();
		for (const selector of [
			'text=Save',
			'button >> nth=0',
			'button:has-text("Save")',
			'button:visible',
		])
			expect(() => locate(root, selector)).toThrow(/Playwright selector syntax/);
		for (const selector of ['button >', '> button', 'a,,b', '[unclosed'])
			expect(() => locate(root, selector)).toThrow(SyntaxError);
	});
});
