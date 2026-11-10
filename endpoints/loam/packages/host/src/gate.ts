/**
 * @fileoverview The `Host` check (phase 6 specification, 3.2), run on the raw Node request before the
 * adapter builds a `Request`: every request's `Host` must be `origin`'s host and port, or `[sandbox]
 * origin`'s, and any other is `421 Misdirected Request` with nothing run (`HOST_MISDIRECTED`). No
 * `X-Forwarded-*` header is read. The common headers are set here with `setHeader`, so they reach every
 * answer, including the ones a later route writes itself and answers `RESPONSE_ALREADY_SENT` (3.5).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export type NodeListener = (incoming: IncomingMessage, outgoing: ServerResponse) => void;

/** The authority a browser sends for an origin: `host` or `host:port`, the default port left out. */
export function authorityOf(origin: string): string {
	return new URL(origin).host.toLowerCase();
}

/**
 * The request's host, or `undefined` when it has none or two. An absolute-form target's authority must
 * equal its `Host`, and the target is rewritten to the origin form, unnormalized, for what follows.
 */
export function requestAuthority(incoming: IncomingMessage): string | undefined {
	const raw = incoming.headersDistinct?.host ?? [];
	if (raw.length !== 1) return undefined;
	const host = (raw[0] as string).toLowerCase();
	const target = incoming.url ?? '';
	if (target.startsWith('/')) return host;
	const absolute = /^https?:\/\/([^/?#]*)(.*)$/i.exec(target);
	if (!absolute || (absolute[1] as string).toLowerCase() !== host) return undefined;
	const rest = absolute[2] as string;
	incoming.url = rest.startsWith('/') ? rest : `/${rest}`;
	return host;
}

/** Writes a plain-text answer the host makes itself (section 15: never HTML). */
export function plainAnswer(outgoing: ServerResponse, status: number, text: string): void {
	const body = `${text}\n`;
	outgoing.writeHead(status, {
		'content-type': 'text/plain; charset=utf-8',
		'content-length': Buffer.byteLength(body),
		'cache-control': 'no-cache',
	});
	outgoing.end(body);
}

/**
 * Wraps the adapter's listener for one socket, which serves the authorities in `allowed`: the common
 * headers go on first, then the `Host` decides, and only then does the adapter build a `Request`.
 */
export function gate(
	allowed: ReadonlySet<string>,
	common: Record<string, string>,
	next: NodeListener
): NodeListener {
	return (incoming, outgoing) => {
		for (const [name, value] of Object.entries(common)) outgoing.setHeader(name, value);
		const authority = requestAuthority(incoming);
		if (authority === undefined || !allowed.has(authority)) {
			plainAnswer(
				outgoing,
				421,
				'Misdirected Request: this server answers only its configured origin.'
			);
			return;
		}
		next(incoming, outgoing);
	};
}
