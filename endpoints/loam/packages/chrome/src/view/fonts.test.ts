/**
 * `styles.css.fonts` (phase 1 specification, 6.2): the rewriting of the shell's `@font-face` rules. Reading them
 * from real style sheets, and a frame applying them under its policy, run in the Chromium suite (E2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type FontFaceSource, inlineFontFaces, originOf } from './fonts.js';

const ORIGIN = 'https://loam.example';
const BASE = `${ORIGIN}/assets/index.css`;
const face = (src: string, family = 'Inter'): FontFaceSource => ({
	cssText: `@font-face { font-family: ${family}; font-weight: 400; src: ${src}; unicode-range: U+0-FF, U+131; }`,
	base: BASE,
});
const data = (url: string) => `data:font/woff2;base64,${btoa(url)}`;

describe('inlineFontFaces', () => {
	it("writes each same-origin file as a data: URL, keeping the rule's other descriptors", async () => {
		const read = vi.fn(async (url: string) => data(url));
		const { css, complete } = await inlineFontFaces(
			[face('url("inter-400.woff2") format("woff2")')],
			ORIGIN,
			read
		);
		expect(read).toHaveBeenCalledWith(`${ORIGIN}/assets/inter-400.woff2`);
		expect(complete).toBe(true);
		expect(css).toBe(
			`@font-face { font-family: Inter; font-weight: 400; src: url("${data(`${ORIGIN}/assets/inter-400.woff2`)}") format("woff2"); unicode-range: U+0-FF, U+131; }`
		);
	});

	it('reads a file two rules share once, and keeps local() and a data: source as they are', async () => {
		const read = vi.fn(async (url: string) => data(url));
		const { css } = await inlineFontFaces(
			[
				face('local("Inter"), url(/f/a.woff2) format("woff2")'),
				face("url('/f/a.woff2') format('woff2')", 'Again'),
				face('url("data:font/woff2;base64,AA==") format("woff2")', 'Inline'),
			],
			ORIGIN,
			read
		);
		expect(read).toHaveBeenCalledTimes(1);
		expect(css).toContain(
			`src: local("Inter"), url("${data(`${ORIGIN}/f/a.woff2`)}") format("woff2");`
		);
		expect(css).toContain('src: url("data:font/woff2;base64,AA==") format("woff2"); unicode-range');
		expect(css.split('@font-face')).toHaveLength(4);
	});

	it("leaves out a face with a file that is not the shell's, and reads nothing for it", async () => {
		const read = vi.fn(async (url: string) => data(url));
		const { css, complete } = await inlineFontFaces(
			[
				face('url("https://fonts.example/x.woff2") format("woff2")', 'Remote'),
				face('url("https://fonts.example/y.woff2"), url("/f/b.woff2")', 'Mixed'),
				face('url("/f/c.woff2")', 'Own'),
			],
			ORIGIN,
			read
		);
		expect(read.mock.calls.map(([url]) => url)).toEqual([`${ORIGIN}/f/c.woff2`]);
		expect(css).not.toContain('Remote');
		expect(css).not.toContain('Mixed');
		expect(css).not.toContain('fonts.example');
		expect(css).toContain(
			`font-family: Own; font-weight: 400; src: url("${data(`${ORIGIN}/f/c.woff2`)}");`
		);
		expect(complete).toBe(true);
	});

	it('leaves out a face whose file cannot be read, and says the set is incomplete', async () => {
		const read = vi.fn(async (url: string) => (url.endsWith('b.woff2') ? undefined : data(url)));
		const rejecting = vi.fn(async () => {
			throw new Error('offline');
		});
		const missing = await inlineFontFaces(
			[face('url(/f/a.woff2)', 'Kept'), face('url(/f/b.woff2)', 'Gone')],
			ORIGIN,
			read
		);
		expect(missing.css).toContain('Kept');
		expect(missing.css).not.toContain('Gone');
		expect(missing.complete).toBe(false);
		const thrown = await inlineFontFaces([face('url(/f/a.woff2)')], ORIGIN, rejecting);
		expect(thrown).toEqual({ css: '', complete: false });
	});

	it("reads the desktop's custom scheme as its own origin, which URL calls null", async () => {
		expect(originOf(new URL('loam://localhost/assets/a.woff2'))).toBe('loam://localhost');
		expect(originOf(new URL('https://loam.example:8443/a'))).toBe('https://loam.example:8443');
		const read = vi.fn(async (url: string) => data(url));
		const { css } = await inlineFontFaces(
			[
				{
					cssText: '@font-face { font-family: Inter; src: url("/assets/a.woff2"); }',
					base: 'loam://localhost/',
				},
			],
			'loam://localhost',
			read
		);
		expect(read).toHaveBeenCalledWith('loam://localhost/assets/a.woff2');
		expect(css).toContain(data('loam://localhost/assets/a.woff2'));
	});

	it('gives nothing for no rules, and keeps a rule that names no file as it is', async () => {
		const read = vi.fn();
		expect(await inlineFontFaces([], ORIGIN, read)).toEqual({ css: '', complete: true });
		const local = '@font-face { font-family: X; src: local("X"); }';
		expect(await inlineFontFaces([{ cssText: local, base: BASE }], ORIGIN, read)).toEqual({
			css: local,
			complete: true,
		});
		expect(read).not.toHaveBeenCalled();
	});
});

/** A document with style sheets as CSSOM gives them: rules, imports, and a sheet from another origin that throws. */
function fakeDocument(sheets: unknown[], adopted: unknown[] = []) {
	class CSSFontFaceRule {
		constructor(readonly cssText: string) {}
	}
	class CSSImportRule {
		constructor(readonly styleSheet: unknown) {}
	}
	const view = { CSSFontFaceRule, CSSImportRule, location: { href: `${ORIGIN}/` } };
	return {
		document: {
			defaultView: view,
			styleSheets: sheets,
			adoptedStyleSheets: adopted,
		} as unknown as Document,
		face: (cssText: string) => new CSSFontFaceRule(cssText),
		imported: (sheet: unknown) => new CSSImportRule(sheet),
	};
}

const sheet = (href: string | null, rules: unknown[]) => ({ href, cssRules: rules });

describe('fontFaceRules', () => {
	it('reads @font-face rules from sheets, imports and adopted sheets, each once, past one it cannot read', async () => {
		const { fontFaceRules } = await import('./fonts.js');
		const made = fakeDocument([]);
		const nested = sheet(`${ORIGIN}/assets/fonts.css`, [
			made.face('@font-face { font-family: B; }'),
		]);
		const foreign = {
			href: 'https://cdn.example/x.css',
			get cssRules(): never {
				throw new Error('SecurityError');
			},
		};
		const top = sheet(`${ORIGIN}/assets/index.css`, [
			made.face('@font-face { font-family: A; }'),
			made.imported(nested),
			made.imported(nested),
			{ cssText: 'body { color: red; }' },
		]);
		const adopted = sheet(null, [made.face('@font-face { font-family: C; }')]);
		const { document } = made;
		Object.assign(document, { styleSheets: [top, foreign], adoptedStyleSheets: [adopted] });
		expect(fontFaceRules(document)).toEqual([
			{ cssText: '@font-face { font-family: A; }', base: `${ORIGIN}/assets/index.css` },
			{ cssText: '@font-face { font-family: B; }', base: `${ORIGIN}/assets/fonts.css` },
			{ cssText: '@font-face { font-family: C; }', base: `${ORIGIN}/` },
		]);
	});
});

describe('viewFonts', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	const woff2 = (type = 'font/woff2') =>
		new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), { headers: { 'content-type': type } });

	it('builds once for the page, and builds again after a set that missed a file', async () => {
		const { viewFonts } = await import('./fonts.js');
		const made = fakeDocument([]);
		Object.assign(made.document, {
			styleSheets: [
				sheet(`${ORIGIN}/assets/index.css`, [
					made.face('@font-face { font-family: A; src: url("a.woff2"); }'),
				]),
			],
		});
		const fetch = vi
			.fn()
			.mockRejectedValueOnce(new Error('offline'))
			.mockImplementation(async () => woff2());
		vi.stubGlobal('fetch', fetch);
		expect(await viewFonts(made.document)).toBe('');
		const css = await viewFonts(made.document);
		expect(css).toBe('@font-face { font-family: A; src: url("data:font/woff2;base64,d09GMg=="); }');
		expect(await viewFonts(made.document)).toBe(css);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[1]?.[0]).toBe(`${ORIGIN}/assets/a.woff2`);
	});

	it('keeps no empty set, so faces from sheets that load later still reach the next view', async () => {
		const { viewFonts } = await import('./fonts.js');
		const made = fakeDocument([]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => woff2())
		);
		expect(await viewFonts(made.document)).toBe('');
		Object.assign(made.document, {
			styleSheets: [
				sheet(`${ORIGIN}/`, [made.face('@font-face { font-family: A; src: url(/a.woff2); }')]),
			],
		});
		expect(await viewFonts(made.document)).toContain('font-family: A');
	});
});

describe('readAsDataUrl', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('types a bare file as woff2, keeps a font type without its parameters, and refuses a page', async () => {
		const { readAsDataUrl } = await import('./fonts.js');
		const respond = (type: string | null, ok = true) =>
			vi.stubGlobal(
				'fetch',
				vi.fn(
					async () =>
						new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), {
							status: ok ? 200 : 404,
							headers: type === null ? {} : { 'content-type': type },
						})
				)
			);
		respond('application/octet-stream');
		expect(await readAsDataUrl(`${ORIGIN}/a.woff2`)).toBe('data:font/woff2;base64,d09GMg==');
		respond('Font/WOFF; charset=binary');
		expect(await readAsDataUrl(`${ORIGIN}/a.woff`)).toBe('data:font/woff;base64,d09GMg==');
		respond('text/html');
		expect(await readAsDataUrl(`${ORIGIN}/a.woff2`)).toBeUndefined();
		respond('font/x"y');
		expect(await readAsDataUrl(`${ORIGIN}/a.woff2`)).toBeUndefined();
		respond('font/woff2', false);
		expect(await readAsDataUrl(`${ORIGIN}/a.woff2`)).toBeUndefined();
	});
});

describe('readAsDataUrl, a stalled file', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('reads under a 10 second timeout, so a stalled read cannot hold every later view', async () => {
		const { readAsDataUrl } = await import('./fonts.js');
		const controller = new AbortController();
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
		const fetch = vi.fn(
			(_url: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
				})
		);
		vi.stubGlobal('fetch', fetch);
		const read = readAsDataUrl(`${ORIGIN}/a.woff2`).catch(() => 'rejected');
		expect(timeout).toHaveBeenCalledWith(10_000);
		expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
		controller.abort();
		expect(await read).toBe('rejected');
	});
});
