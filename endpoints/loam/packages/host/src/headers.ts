/**
 * @fileoverview The response headers (phase 6 specification, 3.5). Every response carries the common
 * headers; a shell page's `Content-Security-Policy` header is the `<meta>` policy `deployment write`
 * wrote into its file, plus `frame-ancestors 'none'`, and plus `form-action 'self'` on the four
 * account pages. Phase 0's directives are unchanged, so no source widens.
 */

import { isLoopbackHost } from '@lushly-dev/loam-manifest/server';

export const FRAME_ANCESTORS_NONE = "frame-ancestors 'none'";
export const FORM_ACTION_SELF = "form-action 'self'";

/** On shell pages (W30): `publickey-credentials-*` keep their default, `self`, which passkeys need. */
export const SHELL_PERMISSIONS_POLICY =
	'camera=(), microphone=(), geolocation=(), local-network=(), loopback-network=()';

/**
 * Every response on the shell's origin that is neither a shell page nor a script or style sheet: an HTML
 * file such as `sandbox/proxy.html` or one in an app's package, an SVG, the projection. Nothing navigates
 * to one there (a view's HTML reaches its sandbox as data), so a document it could make is inert. 3.5 names
 * no policy for it; approved by the coordinator 2026-11-09.
 */
export const INERT_POLICY = `sandbox; default-src 'none'; ${FRAME_ANCESTORS_NONE}`;

/** A file the shell loads as a script or a style sheet, which keeps no policy of its own. */
export function isScriptOrStyle(path: string): boolean {
	return /\.(m?js|css)$/i.test(path);
}

/** The account pages whose form posts stay on the origin (phase 3's 9.4, 5.6 and 5.7). */
const FORM_PAGES = new Set(['~/oauth/login', '~/oauth/consent', '~/join', '~/recover']);

/**
 * Directives a header adds, or that a `<meta>` cannot carry (`sandbox`, `report-uri`): a page whose policy
 * holds one is refused, since the header would then differ from the `<meta>` or let the page's value win.
 */
const HEADER_ONLY = /(^|;)\s*(frame-ancestors|form-action|sandbox|report-uri)(\s|;|$)/i;

/** Headers every response carries, `Strict-Transport-Security` only on a non-loopback origin. */
export function commonHeaders(origin: string): Record<string, string> {
	return {
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer',
		'cross-origin-opener-policy': 'same-origin',
		...(isLoopbackHost(new URL(origin).hostname)
			? {}
			: { 'strict-transport-security': 'max-age=31536000' }),
	};
}

export type MetaPolicy = { ok: true; policy: string } | { ok: false; reason: string };

/**
 * The `Content-Security-Policy` `<meta>` content of a page, as `deployment write` writes it. A policy with
 * an entity, a line break, or a directive only a header may carry is refused, since the header would
 * then differ from the `<meta>` or let the `<meta>`'s value win.
 */
export function metaPolicy(html: string): MetaPolicy {
	const tags =
		html.match(/<meta\b(?=[^>]*http-equiv=["']Content-Security-Policy["'])[^>]*>/gi) ?? [];
	if (tags.length !== 1)
		return {
			ok: false,
			reason: `it holds ${tags.length} Content-Security-Policy <meta> tags, not 1`,
		};
	const content = /\bcontent="([^"]*)"/.exec(tags[0] as string)?.[1];
	if (content === undefined) return { ok: false, reason: 'its policy <meta> has no content' };
	if (/[&\r\n]/.test(content))
		return { ok: false, reason: 'its policy holds an entity or a line break' };
	if (HEADER_ONLY.test(content))
		return { ok: false, reason: 'its policy already names a directive the header adds' };
	return { ok: true, policy: content };
}

/** `path` is the request's path after `<base>`, decoded once; the four account pages add `form-action`. */
export function isFormPage(path: string): boolean {
	return FORM_PAGES.has(path.replace(/\/$/, ''));
}

/** A shell page's header: the `<meta>` policy, then `frame-ancestors 'none'`, then `form-action 'self'` on the four pages. */
export function shellPagePolicy(meta: string, path: string): string {
	return `${meta}; ${FRAME_ANCESTORS_NONE}${isFormPage(path) ? `; ${FORM_ACTION_SELF}` : ''}`;
}

/** The sandbox's pages on the sandbox origin: framed only by the shell (D62). */
export function sandboxPolicy(origin: string): string {
	return `frame-ancestors ${origin}`;
}

/** `Cache-Control` for a file of the site, by its path after `<base>` (3.5). */
export function siteCacheControl(path: string, shellPage: boolean): string {
	if (shellPage || path === 'index.html' || path === '404.html' || path === 'deployment.json')
		return 'no-cache';
	if (path.startsWith('assets/')) return 'public, max-age=31536000, immutable';
	return 'no-cache';
}
