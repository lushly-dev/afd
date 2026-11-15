/**
 * @fileoverview The `Host` check (phase 6 specification, 3.2), run on the raw Node request before the
 * adapter builds a `Request`: every request's `Host` must be `origin`'s host and port, or `[sandbox]
 * origin`'s, and any other is `421 Misdirected Request` with nothing run (`HOST_MISDIRECTED`). No
 * `X-Forwarded-*` header is read. The common headers are set here with `setHeader`, so they reach every
 * answer, including the ones a later route writes itself and answers `RESPONSE_ALREADY_SENT` (3.5).
 *
 * A7 (3.7): before any route, every incoming `x-forwarded-for` and `x-loam-client-ip` is deleted, and
 * `x-loam-client-ip` is set from the socket's address, the one header the provider reads a client's address
 * from, so a forged header can neither pick a rate-limit bucket nor escape one.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export type NodeListener = (incoming: IncomingMessage, outgoing: ServerResponse) => void;

/** The header only the host sets, from the socket (A7); `createLoamAuthOptions` reads no other. */
export const CLIENT_ADDRESS_HEADER = 'x-loam-client-ip';
/** Headers a client could forge an address with, deleted before any route (A7). */
const FORGEABLE_ADDRESS_HEADERS: ReadonlySet<string> = new Set([
	'x-forwarded-for',
	CLIENT_ADDRESS_HEADER,
]);

/**
 * Deletes every incoming copy of a forgeable address header from `headers` and `rawHeaders` (from which
 * `@hono/node-server` builds the `Request`), then sets `x-loam-client-ip` from the socket (A7).
 */
export function setClientAddress(incoming: IncomingMessage): void {
	for (const name of FORGEABLE_ADDRESS_HEADERS) delete incoming.headers[name];
	const kept: string[] = [];
	for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
		const name = incoming.rawHeaders[index] as string;
		if (!FORGEABLE_ADDRESS_HEADERS.has(name.toLowerCase()))
			kept.push(name, incoming.rawHeaders[index + 1] as string);
	}
	const address = incoming.socket.remoteAddress;
	if (address !== undefined) {
		incoming.headers[CLIENT_ADDRESS_HEADER] = address;
		kept.push(CLIENT_ADDRESS_HEADER, address);
	}
	incoming.rawHeaders.splice(0, incoming.rawHeaders.length, ...kept);
}

/** The authority a browser sends for an origin: `host` or `host:port`, the default port left out. */
export function authorityOf(origin: string): string {
	return new URL(origin).host.toLowerCase();
}

/**
 * The request's host, or `undefined` when it has none or two. An absolute-form target's authority must
 * equal its `Host`, and the target is rewritten to the origin form, unnormalized, for what follows.
 */
/**
 * Every origin is `https:`, so `:443` is its default port, which a browser leaves out. It is dropped only
 * from a host with no other port: `localhost:8443:443` stays as it is, and is refused.
 */
export function withoutDefaultPort(host: string): string {
	return host.toLowerCase().replace(/^([^:]+|\[[^\]]+\]):443$/, '$1');
}

export function requestAuthority(incoming: IncomingMessage): string | undefined {
	const raw = incoming.headersDistinct?.host ?? [];
	if (raw.length !== 1) return undefined;
	const host = withoutDefaultPort(raw[0] as string);
	const target = incoming.url ?? '';
	if (target.startsWith('/')) return host;
	const absolute = /^https?:\/\/([^/?#]*)(.*)$/i.exec(target);
	if (!absolute || withoutDefaultPort(absolute[1] as string) !== host) return undefined;
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
		// What follows reads the authority the gate decided on, `:443` already left out: the adapter builds
		// the `Request`'s headers from `rawHeaders`, and the socket's dispatch reads `headers`.
		incoming.headers.host = authority;
		for (let index = 0; index < incoming.rawHeaders.length; index += 2)
			if (incoming.rawHeaders[index]?.toLowerCase() === 'host')
				incoming.rawHeaders[index + 1] = authority;
		setClientAddress(incoming);
		next(incoming, outgoing);
	};
}
