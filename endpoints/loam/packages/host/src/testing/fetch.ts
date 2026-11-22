/**
 * @fileoverview A `fetch` that trusts only the development profile's certificate (phase 6 specification, 5.2), for an
 * MCP client in a test's own process: AFD's `StreamableHttpTransport` takes it, so a test speaks to the hosted server
 * over its real TLS without `NODE_EXTRA_CA_CERTS` or turning verification off. Bodies stream, so an SSE answer does too.
 */

import { request } from 'node:https';
import { Readable } from 'node:stream';

/** `fetch` over `node:https`, trusting `ca` alone; `Host` and SNI from the URL. */
export function trustingFetch(ca: string | Buffer): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const asked = new Request(input, init);
		const url = new URL(asked.url);
		const headers: Record<string, string> = {};
		asked.headers.forEach((value, name) => {
			headers[name] = value;
		});
		const body = asked.body ? Buffer.from(await asked.arrayBuffer()) : undefined;
		if (body) headers['content-length'] = String(body.length);
		return new Promise<Response>((done, fail) => {
			const outgoing = request(
				{
					host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
					port: Number(url.port || 443),
					servername: url.hostname,
					path: `${url.pathname}${url.search}`,
					method: asked.method,
					headers: { ...headers, host: url.host },
					ca,
					...(asked.signal ? { signal: asked.signal } : {}),
				},
				(incoming) => {
					const answer = new Headers();
					for (const [name, value] of Object.entries(incoming.headers)) {
						if (value === undefined) continue;
						for (const one of Array.isArray(value) ? value : [value]) answer.append(name, one);
					}
					const status = incoming.statusCode ?? 0;
					const empty = status === 204 || status === 304 || asked.method === 'HEAD';
					done(
						new Response(
							empty ? null : (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>),
							{ status, statusText: incoming.statusMessage ?? '', headers: answer }
						)
					);
				}
			);
			outgoing.on('error', fail);
			outgoing.end(body);
		});
	}) as typeof fetch;
}
