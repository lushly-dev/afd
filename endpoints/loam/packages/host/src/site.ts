/**
 * @fileoverview `serveSite` (phase 6 specification, 3.5): Loam's own static handler, so its refusals are
 * in one tested function. It reads the raw request path, never one a router normalized: it refuses any
 * path whose raw or once-decoded form holds `..`, `%2e`, `%2f`, `%5c`, `\` or NUL, resolves the rest with
 * `realpath`, and serves a file only when it resolves inside `realpath(root)`, so a symbolic link out of
 * the site is refused too. A refused path is a 404 whatever the request accepts.
 */

import { realpathSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

/** What a request asks of the site: its path after the prefix the site is served under, still raw. */
export interface SiteRequest {
	method: string;
	/** The raw path after `<base>` (or after `/sandbox/`), with no query: `assets/index-a1.js`. */
	path: string;
	/** The `Accept` header. */
	accept?: string | undefined;
}

export type SiteAnswer =
	/** `file` is the resolved path; `fallback` when it is the page answered for a path with no file. */
	| { status: 200; file: string; path: string; fallback: boolean }
	| { status: 404; refused: boolean };

export interface ServeSiteOptions {
	/** The page answered `200` for a path with no file, to a request naming `text/html` (D74). */
	fallback?: string;
}

/** Refused in the raw path and again in the decoded one, so `%252e` is refused as well as `%2e`. */
const REFUSED = /\.\.|%2e|%2f|%5c|\\|\0/i;

/** The request's `Accept` names `text/html`. */
export function acceptsHtml(accept: string | undefined): boolean {
	return (accept ?? '')
		.split(',')
		.some((part) => part.split(';')[0]?.trim().toLowerCase() === 'text/html');
}

/** The path once decoded, or `undefined` when it is refused or does not decode. */
export function sitePath(raw: string): string | undefined {
	if (REFUSED.test(raw)) return undefined;
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return undefined;
	}
	return REFUSED.test(decoded) ? undefined : decoded;
}

function isInside(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}${sep}`);
}

/**
 * The handler for one directory. `root` is resolved once, here, so a link to the root itself is followed
 * once and every answer is measured against what it pointed to then.
 */
export function serveSite(
	root: string,
	options: ServeSiteOptions = {}
): (request: SiteRequest) => Promise<SiteAnswer> {
	const base = realpathSync(root);
	const notFound: SiteAnswer = { status: 404, refused: false };
	const refused: SiteAnswer = { status: 404, refused: true };

	async function resolveFile(relative: string): Promise<string | 'missing' | 'refused'> {
		let real: string;
		try {
			real = await realpath(join(base, relative));
		} catch (cause) {
			const code = (cause as NodeJS.ErrnoException).code;
			return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'refused';
		}
		if (!isInside(real, base)) return 'refused';
		try {
			return (await stat(real)).isFile() ? real : 'missing';
		} catch {
			return 'refused';
		}
	}

	return async ({ method, path, accept }) => {
		if (method !== 'GET' && method !== 'HEAD') return notFound;
		const decoded = sitePath(path);
		if (decoded === undefined) return refused;
		if (decoded !== '' && !decoded.endsWith('/')) {
			const found = await resolveFile(decoded);
			if (found === 'refused') return refused;
			if (found !== 'missing') return { status: 200, file: found, path: decoded, fallback: false };
		}
		if (options.fallback === undefined || !acceptsHtml(accept)) return notFound;
		const page = await resolveFile(options.fallback);
		return typeof page === 'string' && page !== 'missing' && page !== 'refused'
			? { status: 200, file: page, path: decoded, fallback: true }
			: notFound;
	};
}
