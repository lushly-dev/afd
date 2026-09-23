/** HTTP request validation and bounded body parsing shared by all remote routes. */
import type { IncomingMessage } from 'node:http';
import { TLSSocket } from 'node:tls';

export class HttpRequestError extends Error {
	/** JSON-RPC error code used when the route speaks JSON-RPC (default: -32000 server error). */
	readonly rpcCode: number;
	/** Recovery guidance; a generic one is used when omitted. */
	readonly suggestion?: string;

	constructor(
		readonly status: number,
		message: string,
		options: { rpcCode?: number; suggestion?: string } = {}
	) {
		super(message);
		this.rpcCode = options.rpcCode ?? -32000;
		this.suggestion = options.suggestion;
	}
}

export interface HttpSecurityOptions {
	host: string;
	devMode: boolean;
	allowedHosts?: string[];
	allowedOrigins?: string[];
	maxBodyBytes?: number;
}

export function validateHttpRequest(req: IncomingMessage, options: HttpSecurityOptions): URL {
	const host = req.headers.host;
	if (!host || /[\s/@\\?#]/.test(host)) throw new HttpRequestError(400, 'Invalid Host header');
	let base: URL;
	try {
		base = new URL(`${req.socket instanceof TLSSocket ? 'https' : 'http'}://${host}`);
	} catch {
		throw new HttpRequestError(400, 'Invalid Host header');
	}
	const allowedHosts = options.allowedHosts ?? [options.host, 'localhost', '127.0.0.1', '[::1]'];
	if (!allowedHosts.some((allowed) => allowed.toLowerCase() === base.hostname.toLowerCase())) {
		throw new HttpRequestError(403, 'Host is not allowed; configure allowedHosts for this host');
	}
	const origin = req.headers.origin;
	if (
		!options.devMode &&
		origin &&
		origin !== base.origin &&
		!options.allowedOrigins?.includes(origin)
	) {
		throw new HttpRequestError(
			403,
			'Origin is not allowed; configure allowedOrigins for browser access'
		);
	}
	// Covers navigation and no-cors GET requests that omit Origin, including legacy streams.
	const fetchSite = req.headers['sec-fetch-site'];
	if (
		!options.devMode &&
		!origin &&
		fetchSite &&
		fetchSite !== 'same-origin' &&
		fetchSite !== 'none'
	) {
		throw new HttpRequestError(403, 'Cross-origin browser requests require an allowed Origin');
	}
	const target = req.url ?? '/';
	if (!target.startsWith('/') || target.startsWith('//'))
		throw new HttpRequestError(400, 'Invalid request target');
	return new URL(target, base);
}

export function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
	if (req.destroyed || req.aborted) throw new HttpRequestError(400, 'Request body was interrupted');
	if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
		throw new HttpRequestError(415, 'Content-Type must be application/json');
	}
	const length = req.headers['content-length'];
	if (length && Number(length) > maxBytes)
		throw new HttpRequestError(413, 'Request body is too large');
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const cleanup = () => {
			req.off('data', onData);
			req.off('end', onEnd);
			req.off('aborted', onAborted);
		};
		const fail = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onData = (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxBytes) {
				fail(new HttpRequestError(413, 'Request body is too large'));
				return;
			}
			chunks.push(chunk);
		};
		const onEnd = () => {
			cleanup();
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
			} catch {
				reject(
					new HttpRequestError(400, 'Request body must be valid JSON', {
						rpcCode: -32700,
						suggestion: 'Send a UTF-8 JSON body',
					})
				);
			}
		};
		const onError = () => fail(new HttpRequestError(400, 'Request body could not be read'));
		const onAborted = () => fail(new HttpRequestError(400, 'Request body was interrupted'));
		req.on('data', onData);
		req.once('end', onEnd);
		req.on('error', onError);
		req.once('close', () => req.off('error', onError));
		req.once('aborted', onAborted);
	});
}
