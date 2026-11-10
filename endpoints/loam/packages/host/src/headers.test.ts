import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withBasePath, withFrameSrc } from '@lushly-dev/loam-cli/deployment';
import { describe, expect, it } from 'vitest';
import {
	commonHeaders,
	isFormPage,
	metaPolicy,
	SHELL_PERMISSIONS_POLICY,
	sandboxPolicy,
	shellPagePolicy,
	siteCacheControl,
} from './headers.js';
import { WEB_DIST } from './test-support.js';

/** The `<meta>` policy's content, read the way a browser reads the attribute. */
function metaContent(html: string): string {
	const tag =
		/<meta\b(?=[^>]*http-equiv=["']Content-Security-Policy["'])[^>]*>/i.exec(html)?.[0] ?? '';
	return /\bcontent="([^"]*)"/.exec(tag)?.[1] ?? '';
}

/**
 * Every `index.html` the fixtures write: `deployment write` changes only `frame-src` (a sandbox origin or
 * `'none'`) and, under a `base_path`, the assets' URLs, so these are each page it can write from the build.
 */
function writtenPages(): Array<[string, string]> {
	const built = readFileSync(join(WEB_DIST, 'index.html'), 'utf8');
	const pages: Array<[string, string]> = [];
	for (const frameSrc of ["'none'", 'https://loam-sandbox.example.net', 'https://127.0.0.1:8444'])
		for (const base of ['/', '/loam/']) {
			const framed = withFrameSrc(built, frameSrc);
			if (framed === undefined) throw new Error('The built page holds no policy');
			pages.push([`frame-src ${frameSrc} under ${base}`, withBasePath(framed, base)]);
		}
	return pages;
}

const FORM_PAGES = ['~/oauth/login', '~/oauth/consent', '~/join', '~/recover'];

describe('P6-E2: the headers (3.5)', () => {
	it.each(writtenPages())(
		"P6-E2: a shell page's header is its <meta> policy plus frame-ancestors 'none', and nothing else (%s)",
		(_name, html) => {
			const read = metaPolicy(html);
			expect(read.ok).toBe(true);
			if (!read.ok) return;
			expect(read.policy).toBe(metaContent(html));
			for (const path of ['', 'acme', 'acme/p/atlas/hello', 'index.html', '404.html', '~/account'])
				expect(shellPagePolicy(read.policy, path), path).toBe(
					`${metaContent(html)}; frame-ancestors 'none'`
				);
		}
	);

	it.each(writtenPages())(
		"P6-E2: the four account pages add form-action 'self', and nothing else (%s)",
		(_name, html) => {
			const read = metaPolicy(html);
			if (!read.ok) throw new Error(read.reason);
			for (const path of FORM_PAGES) {
				expect(shellPagePolicy(read.policy, path), path).toBe(
					`${metaContent(html)}; frame-ancestors 'none'; form-action 'self'`
				);
				expect(isFormPage(`${path}/`), path).toBe(true);
			}
			for (const path of ['~/oauth', '~/oauth/login/x', 'acme/~/join', '~/joinx', 'oauth/login'])
				expect(isFormPage(path), path).toBe(false);
		}
	);

	it("P6-E2: phase 0's directives are the build's, so no source widens", () => {
		const built = metaContent(readFileSync(join(WEB_DIST, 'index.html'), 'utf8'));
		for (const [, page] of writtenPages()) {
			const directives = metaContent(page)
				.split(';')
				.map((part) => part.trim());
			const original = built.split(';').map((part) => part.trim());
			expect(directives.filter((part) => !part.startsWith('frame-src'))).toEqual(
				original.filter((part) => !part.startsWith('frame-src'))
			);
		}
	});

	it('P6-E2: refuses a page whose policy the header could not carry as it is', () => {
		const page = (content: string) =>
			`<head><meta http-equiv="Content-Security-Policy" content="${content}"></head>`;
		expect(metaPolicy('<head></head>').ok).toBe(false);
		expect(metaPolicy(`${page("default-src 'self'")}${page("default-src 'none'")}`).ok).toBe(false);
		expect(metaPolicy(page("default-src 'self'; frame-ancestors *")).ok).toBe(false);
		expect(metaPolicy(page("default-src 'self'; form-action *")).ok).toBe(false);
		expect(metaPolicy(page('default-src &#39;self&#39;')).ok).toBe(false);
		expect(metaPolicy(page("default-src 'self';\nimg-src 'self'")).ok).toBe(false);
		expect(metaPolicy(page("default-src 'self'"))).toEqual({
			ok: true,
			policy: "default-src 'self'",
		});
	});

	it('P6-E2: every response carries the common headers, and HSTS only on a non-loopback origin', () => {
		const common = {
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'no-referrer',
			'cross-origin-opener-policy': 'same-origin',
		};
		for (const origin of ['https://localhost:8443', 'https://127.0.0.1:8443', 'https://[::1]:8443'])
			expect(commonHeaders(origin), origin).toEqual(common);
		expect(commonHeaders('https://loam.example.com')).toEqual({
			...common,
			'strict-transport-security': 'max-age=31536000',
		});
	});

	it("P6-E2: shell pages' Permissions-Policy denies the local network, and leaves passkeys their default", () => {
		expect(SHELL_PERMISSIONS_POLICY).toBe(
			'camera=(), microphone=(), geolocation=(), local-network=(), loopback-network=()'
		);
		expect(SHELL_PERMISSIONS_POLICY).not.toContain('publickey');
	});

	it("P6-E2: the sandbox's pages may be framed by the shell's origin only", () => {
		expect(sandboxPolicy('https://localhost:8443')).toBe('frame-ancestors https://localhost:8443');
	});

	it('P6-E2: caches hashed assets for a year, and revalidates the pages and the projection', () => {
		expect(siteCacheControl('assets/index-a1b2c3.js', false)).toBe(
			'public, max-age=31536000, immutable'
		);
		for (const path of [
			'index.html',
			'404.html',
			'deployment.json',
			'sandbox/proxy.js',
			'apps/x/y.js',
		])
			expect(siteCacheControl(path, false), path).toBe('no-cache');
		expect(siteCacheControl('acme/p/atlas', true)).toBe('no-cache');
	});
});
