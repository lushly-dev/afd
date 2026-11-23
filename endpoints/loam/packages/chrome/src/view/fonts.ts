/**
 * @fileoverview `styles.css.fonts`: the shell's typefaces, handed to a view's frame (phase 1 specification, 6.2).
 * MCP Apps' host context carries font CSS for the view to apply; a frame is opaque-origin and loads nothing, so
 * each face's file goes inline as a `data:` URL, which the frame's policy admits with `font-src data:` alone (6.1).
 * The faces are whatever `@font-face` rules the shell's own style sheets hold (D159's, from `loam-fonts.css`), so a
 * theme that changes them changes the frames' with no code here. Files are read once per page, from the shell's
 * origin, where the shell already holds them. A face with a file that is not the shell's, or that cannot be read,
 * is left out, and the view falls back to the next family in the token's stack, as it did before.
 */

/** One `@font-face` rule as a style sheet serializes it, and the URL its relative sources resolve against. */
export interface FontFaceSource {
	cssText: string;
	base: string;
}

/** Reads a same-origin font file as a `data:` URL, or `undefined` when it cannot. */
export type FontReader = (url: string) => Promise<string | undefined>;

/**
 * A URL's origin as scheme and host: a custom scheme's (the desktop's `loam://localhost` on macOS) is `"null"` to
 * `URL`, though its files are the shell's own.
 */
export function originOf(url: URL): string {
	return url.origin !== 'null' ? url.origin : `${url.protocol}//${url.host}`;
}

/** A `url()` token, quoted or not; an unquoted `data:` URL holds no `)`, quote or space. */
const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/g;

/** The top-level `@font-face` rules of `document`'s style sheets, and of those they import. */
export function fontFaceRules(document: Document): FontFaceSource[] {
	const view = document.defaultView;
	if (!view) return [];
	const found: FontFaceSource[] = [];
	const seen = new Set<CSSStyleSheet>();
	const visit = (sheet: CSSStyleSheet | null): void => {
		if (!sheet || seen.has(sheet)) return;
		seen.add(sheet);
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			return; // Another origin's sheet: the shell's policy loads none, and its rules are not readable.
		}
		// An inline sheet's relative URLs resolve against the page's own URL (no `<base>`: `base-uri 'none'`).
		const base = sheet.href ?? view.location.href;
		for (const rule of Array.from(rules)) {
			if (rule instanceof view.CSSFontFaceRule) found.push({ cssText: rule.cssText, base });
			else if (rule instanceof view.CSSImportRule) visit(rule.styleSheet);
		}
	};
	for (const sheet of Array.from(document.styleSheets)) visit(sheet);
	for (const sheet of document.adoptedStyleSheets ?? []) visit(sheet);
	return found;
}

/**
 * Each rule with every `url()` read through `read` and written as a `data:` URL; a `data:` URL and `local()` stay.
 * A rule with a file on another origin, or one `read` cannot give, is left out whole. `complete` is false when a
 * same-origin file could not be read, so the caller may try again later.
 */
export async function inlineFontFaces(
	rules: readonly FontFaceSource[],
	origin: string,
	read: FontReader
): Promise<{ css: string; complete: boolean }> {
	const cache = new Map<string, Promise<string | undefined>>();
	let complete = true;
	const inline = async ({ cssText, base }: FontFaceSource): Promise<string | undefined> => {
		const files = new Map<string, string>();
		for (const [token, double, single, bare] of cssText.matchAll(URL_TOKEN)) {
			const raw = double ?? single ?? bare ?? '';
			if (raw.startsWith('data:')) continue;
			let url: URL;
			try {
				url = new URL(raw, base);
			} catch {
				return undefined;
			}
			if (originOf(url) !== origin) return undefined;
			let reading = cache.get(url.href);
			if (!reading) {
				reading = read(url.href).catch(() => undefined);
				cache.set(url.href, reading);
			}
			const data = await reading;
			if (data === undefined) {
				complete = false;
				return undefined;
			}
			files.set(token, `url("${data}")`);
		}
		return cssText.replace(URL_TOKEN, (token) => files.get(token) ?? token);
	};
	const faces = await Promise.all(rules.map(inline));
	return { css: faces.filter((face) => face !== undefined).join('\n'), complete };
}

/** How long one file may take before its face is left out, so a stalled read cannot hold every later view's. */
const READ_MS = 10_000;

/**
 * A same-origin font file as a `data:` URL. A file served with a bare type is typed `font/woff2`, Loam's only
 * format; one served as anything else (an HTML fallback page) is no font, and is left out.
 */
export async function readAsDataUrl(url: string): Promise<string | undefined> {
	const response = await fetch(url, { signal: AbortSignal.timeout(READ_MS) });
	if (!response.ok) return undefined;
	const given =
		(response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
	const font = /^font\/[a-z0-9.+-]+$/.test(given);
	if (given !== '' && !font && given !== 'application/octet-stream') return undefined;
	const bytes = new Uint8Array(await response.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return `data:${font ? given : 'font/woff2'};base64,${btoa(binary)}`;
}

let built: Promise<string> | undefined;

/**
 * The font CSS every view on this page gets, built on the first view and kept. A build that missed a file, or
 * found no face (the sheets not loaded yet), is not kept, so the next view tries again; this one gets what was read.
 */
export function viewFonts(document: Document): Promise<string> {
	if (built) return built;
	const href = document.defaultView?.location.href;
	const building = inlineFontFaces(
		fontFaceRules(document),
		href ? originOf(new URL(href)) : '',
		readAsDataUrl
	).then(
		({ css, complete }) => {
			if ((!complete || css === '') && built === building) built = undefined;
			return css;
		},
		() => {
			if (built === building) built = undefined;
			return '';
		}
	);
	built = building;
	return building;
}
