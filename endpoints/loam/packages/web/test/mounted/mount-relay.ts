/**
 * The test-only mount relay (phase 1 specification, 7.1; D64). In the suite's server and in no `dist`: a
 * deployment has nothing at `mounts/<instance>/mcp` in phase 1, and phase 6's hosted server takes this route.
 * It is a test harness with no auth, membership, limits or deployment, so it proves none of those. What it
 * does prove is that the page needs no CORS, no CSP change and no token. It never logs a token. It reads each
 * request's body whole to log what it asked (P2-E6), then sends it on unchanged.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** `writeDeployment`'s `mounts`. */
export interface MountAccessLike {
	instance: string;
	url: string;
	bearer?: string;
}

const FORWARDED_REQUEST_HEADERS = [
	'content-type',
	'accept',
	'mcp-protocol-version',
	'mcp-session-id',
	'mcp-method',
	'mcp-name',
	'last-event-id',
] as const;

const ROUTE = /^\/mounts\/([a-z][a-z0-9]{0,31})\/mcp$/;

/** What a request's JSON-RPC body asked: for P2-E6, which tool, and the `_meta` it carried. */
export interface RelayedCall {
	method: string;
	/** `params.name`, a `tools/call`'s tool. */
	name?: string;
	/** `params._meta`, as the page sent it. */
	meta?: Record<string, unknown>;
	/** A batch body's requests, each read as one is, under the method `batch`, so none slips past a filter. */
	batch?: RelayedCall[];
}

/** One request the relay saw: its method, and the names of the headers the page sent. */
export interface RelayedRequest {
	instance: string;
	method: string;
	/** What the page sent, for E4: every name, and the value of `authorization` if it sent one. */
	pageHeaders: string[];
	pageAuthorization?: string;
	/** Its body's JSON-RPC request, once the body has been read; none for a body that is not one. */
	rpc?: RelayedCall;
	status: number;
}

/** One JSON-RPC message's method, tool and `_meta`. */
function messageOf(message: unknown): RelayedCall | undefined {
	const { method, params } = (message ?? {}) as {
		method?: unknown;
		params?: { name?: unknown; _meta?: unknown };
	};
	if (typeof method !== 'string') return undefined;
	const { name, _meta: meta } = params ?? {};
	return {
		method,
		...(typeof name === 'string' ? { name } : {}),
		...(meta && typeof meta === 'object' ? { meta: meta as Record<string, unknown> } : {}),
	};
}

/**
 * A body's JSON-RPC request, or a batch of them logged as a batch. Never a token: a page's body holds
 * none (D64).
 */
export function callOf(body: Buffer): RelayedCall | undefined {
	try {
		const parsed: unknown = JSON.parse(body.toString('utf8'));
		if (Array.isArray(parsed)) {
			return { method: 'batch', batch: parsed.flatMap((item) => messageOf(item) ?? []) };
		}
		return messageOf(parsed);
	} catch {
		return undefined;
	}
}

export interface MountRelay {
	/** Answers the request if it is on the route. Everything else is the static server's. */
	handle(request: IncomingMessage, response: ServerResponse): boolean;
	log: RelayedRequest[];
	/** The page's origin, known only once it is served. A request from any other origin is 403. */
	setOrigin(origin: string): void;
	/** Lets an open response end, so a server can close. */
	abort(): void;
}

export function createMountRelay(mounts: readonly MountAccessLike[]): MountRelay {
	const byInstance = new Map(mounts.map((mount) => [mount.instance, mount]));
	const log: RelayedRequest[] = [];
	const open = new Set<{ destroy(): void }>();
	let pageOrigin = '';

	return {
		log,
		setOrigin(origin) {
			pageOrigin = origin;
		},
		abort() {
			for (const stream of open) stream.destroy();
			open.clear();
		},
		handle(request, response) {
			const path = new URL(request.url ?? '/', 'http://relay.invalid').pathname;
			if (!path.startsWith('/mounts/')) return false;
			const method = request.method ?? 'GET';
			const instance = ROUTE.exec(path)?.[1] ?? '';
			const entry: RelayedRequest = {
				instance,
				method,
				pageHeaders: Object.keys(request.headers),
				...(typeof request.headers.authorization === 'string'
					? { pageAuthorization: request.headers.authorization }
					: {}),
				status: 0,
			};
			log.push(entry);
			const answer = (status: number) => {
				entry.status = status;
				response.writeHead(status).end();
			};
			if (request.headers.origin !== undefined && request.headers.origin !== pageOrigin) {
				answer(403);
				return true;
			}
			const mount = byInstance.get(instance);
			if (!mount) {
				answer(404);
				return true;
			}
			if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
				answer(405);
				return true;
			}
			const target = new URL(mount.url);
			const headers: Record<string, string> = { host: target.host };
			for (const name of FORWARDED_REQUEST_HEADERS) {
				const value = request.headers[name];
				if (typeof value === 'string') headers[name] = value;
			}
			if (mount.bearer !== undefined) headers.authorization = `Bearer ${mount.bearer}`;
			const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
			const outbound = send(target, { method, headers }, (inbound) => {
				entry.status = inbound.statusCode ?? 502;
				const back: Record<string, string> = {};
				for (const name of ['content-type', 'mcp-session-id'] as const) {
					const value = inbound.headers[name];
					if (typeof value === 'string') back[name] = value;
				}
				response.writeHead(entry.status, back);
				open.add(inbound);
				inbound.on('close', () => open.delete(inbound));
				inbound.pipe(response);
			});
			open.add(outbound);
			outbound.on('close', () => open.delete(outbound));
			outbound.on('error', () => {
				if (!response.headersSent) answer(502);
				else response.destroy();
			});
			response.on('close', () => outbound.destroy());
			// Read whole, so the log says what each request asked; the body goes on unchanged.
			const chunks: Buffer[] = [];
			request.on('data', (chunk: Buffer) => chunks.push(chunk));
			request.on('end', () => {
				const body = Buffer.concat(chunks);
				const rpc = callOf(body);
				if (rpc) entry.rpc = rpc;
				outbound.end(body);
			});
			return true;
		},
	};
}
