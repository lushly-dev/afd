import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VioletRuntime } from '../client.js';
import type { SourceToken } from '../types.js';

const DARK: SourceToken[] = [
	{ id: 'color.surface', value: '#121212' },
	{ id: 'color.text', value: '#ffffff' },
	{ id: 'spacing.md', value: 12 },
	{ id: 'shadow.card', value: { x: 0, y: 1 } },
];
const LIGHT: SourceToken[] = [
	{ id: 'color.surface', value: '#ffffff' },
	{ id: 'color.text', value: '#000000' },
];

const inline = (name: string) => document.documentElement.style.getPropertyValue(name);

/** The sheet's single rule: its selector and its declarations by property. */
function rule(sheet: CSSStyleSheet): { selector: string; properties: Record<string, string> } {
	expect(sheet.cssRules).toHaveLength(1);
	const only = sheet.cssRules[0] as CSSStyleRule;
	const properties: Record<string, string> = {};
	for (let index = 0; index < only.style.length; index++) {
		const name = only.style.item(index);
		properties[name] = only.style.getPropertyValue(name).trim();
	}
	return { selector: only.selectorText.replace(/\s+/g, ' '), properties };
}

function dark(options: { cssPrefix?: string; autoApply?: boolean } = {}): VioletRuntime {
	return new VioletRuntime({ nodeId: 'loam/dark', source: { tokens: DARK }, ...options });
}

describe('VioletRuntime.adopt()', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
		document.documentElement.removeAttribute('style');
		document.adoptedStyleSheets = [];
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("adopts one sheet with violet-elements' selectors, once, and writes no inline property", async () => {
		const runtime = dark();
		const own = new CSSStyleSheet();
		document.adoptedStyleSheets = [own];

		const sheet = runtime.adopt();
		await runtime.load();

		expect(runtime.adopt(document)).toBe(sheet);
		expect(document.adoptedStyleSheets).toEqual([own, sheet]);
		expect(rule(sheet)).toEqual({
			selector: ':root, [data-violet-theme-root]',
			properties: { '--color-surface': '#121212', '--color-text': '#ffffff', '--spacing-md': '12' },
		});
		expect(inline('--color-surface')).toBe('');
		expect(document.querySelector('style')).toBeNull();
	});

	it('rewrites the sheet on every switch, for the document and its shadow roots at once', async () => {
		const runtime = dark({ cssPrefix: 'loam' });
		await runtime.load();
		const host = document.createElement('div');
		const shadowRoot = host.attachShadow({ mode: 'open' });

		const sheet = runtime.adopt(document);
		expect(runtime.adopt(shadowRoot)).toBe(sheet);
		expect(shadowRoot.adoptedStyleSheets).toEqual([sheet]);
		expect(rule(sheet).properties['--loam-color-surface']).toBe('#121212');

		await runtime.switchNode('loam/light', { tokens: LIGHT });

		expect(rule(sheet).properties).toEqual({
			'--loam-color-surface': '#ffffff',
			'--loam-color-text': '#000000',
		});
		expect(document.adoptedStyleSheets).toEqual([sheet]);
		expect(shadowRoot.adoptedStyleSheets).toEqual([sheet]);
	});

	it('removes the inline properties autoApply wrote, and stops writing them', async () => {
		const runtime = dark();
		await runtime.load();
		expect(inline('--color-surface')).toBe('#121212');

		runtime.adopt();
		expect(inline('--color-surface')).toBe('');

		await runtime.switchNode('loam/light', { tokens: LIGHT });
		expect(inline('--color-surface')).toBe('');
		expect(
			rule(document.adoptedStyleSheets[0] as CSSStyleSheet).properties['--color-surface'],
		).toBe('#ffffff');
	});

	it('narrows the selectors to a preset, and keeps one preset per runtime', async () => {
		const runtime = dark();
		await runtime.load();

		const sheet = runtime.adopt(document, { preset: 'dark' });

		expect(rule(sheet).selector).toBe(
			':root[data-violet-theme="dark"], [data-violet-theme-root][data-violet-theme="dark"]',
		);
		expect(() => runtime.adopt(document)).toThrow(
			/adopts its tokens as preset "dark", not the default preset/,
		);
		expect(() => runtime.adopt(document, { preset: 'light' })).toThrow(
			/Create another VioletRuntime/,
		);
		expect(() => dark().adopt(document, { preset: 'dark"] { x' })).toThrow(
			/must be letters, digits/,
		);
		expect(runtime.adopt(document, { preset: 'dark' })).toBe(sheet);
	});

	it('cannot be broken out of by a value', async () => {
		const runtime = new VioletRuntime({
			nodeId: 'evil',
			source: { tokens: [{ id: 'color.text', value: 'red; } body { display: none' }] },
		});
		const sheet = runtime.adopt();
		await runtime.load();

		expect(sheet.cssRules).toHaveLength(1);
		expect(rule(sheet).selector).toBe(':root, [data-violet-theme-root]');
	});

	it('unadopt() removes only its own sheet', async () => {
		const runtime = dark();
		const own = new CSSStyleSheet();
		const sheet = runtime.adopt();
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, own];

		runtime.unadopt(document);
		runtime.unadopt(document);

		expect(document.adoptedStyleSheets).toEqual([own]);
		expect(runtime.adopt()).toBe(sheet);
		expect(document.adoptedStyleSheets).toEqual([own, sheet]);
	});

	it('leaves a page inline override alone when switching after adopt()', async () => {
		const runtime = dark();
		const sheet = runtime.adopt();
		await runtime.load();
		document.documentElement.style.setProperty('--color-surface', 'hotpink');
		document.documentElement.style.setProperty('--page-own', '1px');

		await runtime.switchNode('loam/light', { tokens: LIGHT });

		expect(inline('--color-surface')).toBe('hotpink');
		expect(inline('--page-own')).toBe('1px');
		expect(rule(sheet).properties['--color-surface']).toBe('#ffffff');
	});

	it('adopt() with autoApply off touches no inline style', async () => {
		const runtime = dark({ autoApply: false });
		document.documentElement.style.setProperty('--color-surface', 'hotpink');
		await runtime.load();

		runtime.adopt();
		await runtime.switchNode('loam/light', { tokens: LIGHT });

		expect(inline('--color-surface')).toBe('hotpink');
		expect(document.documentElement.style.length).toBe(1);
	});

	it('removes only the inline values autoApply wrote, not a page value set since', async () => {
		const runtime = dark();
		await runtime.load();
		document.documentElement.style.setProperty('--color-text', 'tomato');

		runtime.adopt();

		expect(inline('--color-surface')).toBe('');
		expect(inline('--color-text')).toBe('tomato');
	});

	it('restores a value the page set before autoApply overwrote it', async () => {
		document.documentElement.style.setProperty('--color-surface', 'hotpink', 'important');
		const runtime = dark();
		await runtime.load();
		expect(inline('--color-surface')).not.toBe('hotpink');

		runtime.removeFromDocument();

		expect(inline('--color-surface')).toBe('hotpink');
		expect(document.documentElement.style.getPropertyPriority('--color-surface')).toBe('important');
		expect(document.documentElement.style.length).toBe(1);
	});

	it('refuses a document with no window, and a target that is not a document or shadow root', () => {
		const runtime = dark();
		const noWindow =
			/this document has no window; a constructed stylesheet cannot be adopted into it/;
		const created = document.implementation.createHTMLDocument('created');
		expect(created.defaultView).toBeNull();
		const host = created.createElement('div');
		const createdShadow = host.attachShadow({ mode: 'open' });

		expect(() => runtime.adopt(created)).toThrow(TypeError);
		expect(() => runtime.adopt(created)).toThrow(noWindow);
		expect(() => runtime.adopt(createdShadow)).toThrow(noWindow);
		expect(created.adoptedStyleSheets).toEqual([]);
		const element = document.createElement('div') as unknown as Document;
		expect(() => runtime.adopt(element)).toThrow(TypeError);
		expect(() => runtime.adopt(element)).toThrow(/must be a Document or a ShadowRoot/);
		expect(() => runtime.unadopt(element)).toThrow(/must be a Document or a ShadowRoot/);

		// Nothing was committed: a later adopt() may still choose its preset.
		expect(runtime.adopt(document, { preset: 'dark' }).cssRules).toHaveLength(1);
	});

	it('commits nothing when the target refuses the sheet', async () => {
		const runtime = dark();
		await runtime.load();
		const offered: CSSStyleSheet[] = [];
		const host = document.createElement('div');
		const shadowRoot = host.attachShadow({ mode: 'open' });
		Object.defineProperty(document, 'adoptedStyleSheets', {
			configurable: true,
			get: () => [],
			set: (sheets: CSSStyleSheet[]) => {
				offered.push(...sheets);
				throw new DOMException('refused', 'NotAllowedError');
			},
		});
		try {
			expect(() => runtime.adopt(document, { preset: 'dark' })).toThrow('refused');
		} finally {
			delete (document as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
		}

		// The preset was not fixed, the inline values stay, and the refused sheet is not reused.
		expect(inline('--color-surface')).toBe('#121212');
		const sheet = runtime.adopt(shadowRoot);
		expect(sheet).not.toBe(offered[0]);
		expect(rule(sheet).selector).toBe(':root, [data-violet-theme-root]');
		expect(inline('--color-surface')).toBe('');
	});

	it('keeps rewriting the other sheets when one cannot be written, and drops that one', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const runtime = dark();
		const sheet = runtime.adopt(document);
		await runtime.load();
		// A second owner document (given this window, as an iframe's would have its own), whose
		// sheet then fails to be written.
		const other = document.implementation.createHTMLDocument('other');
		Object.defineProperty(other, 'defaultView', { configurable: true, value: window });
		const broken = runtime.adopt(other);
		const write = vi.spyOn(broken, 'replaceSync').mockImplementation(() => {
			throw new DOMException('gone', 'NotAllowedError');
		});
		Object.defineProperty(broken, 'cssRules', { configurable: true, get: () => [] });

		await runtime.switchNode('loam/light', { tokens: LIGHT });

		expect(rule(sheet).properties['--color-surface']).toBe('#ffffff');
		expect(error).toHaveBeenCalledWith(
			expect.stringMatching(/could not be rewritten/),
			expect.any(DOMException),
		);
		expect(write).toHaveBeenCalledTimes(1);
		await runtime.switchNode('loam/dark', { tokens: DARK });
		expect(write).toHaveBeenCalledTimes(1);
		expect(rule(sheet).properties['--color-surface']).toBe('#121212');
		expect(runtime.adopt(other)).not.toBe(broken);
		error.mockRestore();
	});
});
