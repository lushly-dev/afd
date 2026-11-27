/**
 * @fileoverview The web host's mount transport (phase 1 specification, 7.3), in the `mount` chunk. It reaches
 * an instance only at the same-origin route `mounts/<instance>/mcp` (D64), with no header of its own, so
 * the page holds no credential and `connect-src 'self'` does not widen. A rejection carries a code and the
 * kernel's words: an HTTP error's message can quote the refusal's body, which can name where a token is.
 *
 * On the hosted lane the route is the hosted relay (phase 6 specification, 8.1). **A body's code is read only from an
 * answer that carries `Loam-Relay-Refusal: 1`**, which the relay sets on its own refusals and never passes from an
 * instance, so an instance's error can neither trigger a session refresh nor choose the kernel's code: an instance's
 * `401 {"code":"UNAUTHORIZED"}` stays `MOUNT_UNAUTHORIZED`, as phase 1 reads every 401 and 403.
 */

import {
	StreamableHttpTransport,
	type StreamableHttpTransportOptions,
} from '@lushly-dev/afd-client/streamable-http';
import type { McpTool, McpToolCallResult, MountTransport } from '@lushly-dev/loam-kernel';
import type { MountFailureCode } from '@lushly-dev/loam-kernel/mounted';
import {
	isJSONRPCErrorResponse,
	isJSONRPCResultResponse,
	parseJSONRPCMessage,
} from '@modelcontextprotocol/client';

export { createDesktopMountTransport } from './mount-desktop.js';

/** More than a `CommandResult` needs, and the journal keeps 256 KiB of one (7.6). */
export const RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

/** The relay's mark on its own refusals (8.1), which an instance can never set: the relay never passes it back. */
export const RELAY_REFUSAL = 'loam-relay-refusal';

/** The most of a marked refusal's body read: `{ code, message, suggestion }` needs far less. */
const REFUSAL_BODY_MAX = 4 * 1024;

/**
 * The codes a marked refusal may carry: the kernel's `MountFailureCode`s, each of which the kernel answers with its own
 * message and suggestion, never the body's. Any other code under the mark is `MOUNT_UNREACHABLE`. A unit holds it equal
 * to the kernel's set, so the mount chunk loads no kernel code for it.
 */
export const MOUNT_FAILURE_CODES: ReadonlySet<MountFailureCode> = new Set<MountFailureCode>([
	'MOUNT_UNREACHABLE',
	'MOUNT_UNAUTHORIZED',
	'MOUNT_KEYCHAIN_MISSING',
	'MOUNT_NOT_AFD',
	'MOUNT_TIMEOUT',
	'MOUNT_RESULT_INVALID',
	'REQUEST_NOT_SAME_ORIGIN',
	'REQUEST_INVALID',
	'REQUEST_TOO_LARGE',
	'INSTANCE_UNKNOWN',
	'MOUNT_BATCH_REFUSED',
	'MOUNT_METHOD_REFUSED',
	'MOUNT_COMMAND_NOT_EXPOSED',
	'MOUNT_PROJECT_NOT_LISTED',
	'MOUNT_SPACE_PINNED',
	'MOUNT_SESSION_UNKNOWN',
	'MOUNT_LIMIT',
	'WORKSPACE_NOT_MEMBER',
	'PROJECT_NOT_FOUND',
	'PROJECT_ARCHIVED',
	'UNAUTHORIZED',
	'AGENT_CANNOT_SIGN_IN',
]);

/** At most `max` bytes of a body, or less if it ends first; never more is read. */
async function readAtMost(body: ReadableStream<Uint8Array>, max: number): Promise<string> {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (size < max) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			size += value.byteLength;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	const all = new Uint8Array(Math.min(size, max));
	let at = 0;
	for (const chunk of chunks) {
		const part = chunk.subarray(0, all.byteLength - at);
		all.set(part, at);
		at += part.byteLength;
		if (at >= all.byteLength) break;
	}
	return new TextDecoder().decode(all);
}

/** A marked refusal's code: the body's `code` when it is one of {@link MOUNT_FAILURE_CODES}, else `MOUNT_UNREACHABLE`. */
async function markedRefusal(response: Response): Promise<MountRefusal> {
	let code: unknown;
	try {
		code = response.body
			? (JSON.parse(await readAtMost(response.body, REFUSAL_BODY_MAX)) as { code?: unknown }).code
			: undefined;
	} catch {
		code = undefined;
	}
	return new MountRefusal(
		typeof code === 'string' && MOUNT_FAILURE_CODES.has(code as MountFailureCode)
			? (code as MountFailureCode)
			: 'MOUNT_UNREACHABLE'
	);
}

/**
 * The codes of the streams {@link watchStream} ended without their response, by the nonce it put in the JSON-RPC error
 * it wrote in their place. A nonce is never sent anywhere, so an instance cannot name one and choose a code. Each is
 * read once, when its call fails; one never read (the call was abandoned first) is dropped after {@link CUT_NONCE_MS}.
 */
const CUT_STREAMS = new Map<string, MountFailureCode>();

/** As long as a mounted call's own deadline: past it, no call is left to read its stream's nonce. */
const CUT_NONCE_MS = 60_000;

/**
 * The id of a body that is one `tools/call`, whose stream must end in its response. Only a call's: the SDK reads a
 * JSON-RPC error to `server/discover` or `initialize` as the era's answer, and a connection has its own deadline.
 */
function callIdOf(body: unknown): string | number | undefined {
	if (typeof body !== 'string') return undefined;
	try {
		const { id, method } = JSON.parse(body) as { id?: unknown; method?: unknown };
		return method === 'tools/call' && (typeof id === 'string' || typeof id === 'number')
			? id
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * What a whole event is to the call whose id is `id`, read **with the SDK's own guards**, as its stream reader reads an
 * event: only a `message` event (or one with no type) is read; its data must parse as the SDK's `JSONRPCMessageSchema`
 * and be a result or an error response by `isJSONRPCResultResponse` and `isJSONRPCErrorResponse`. Such a response is
 * `own` when its id is the call's, and `foreign` otherwise: the SDK settles a response by a client-wide map of pending
 * requests, so another id's would settle another call. Anything else passes as it came, and the SDK reads it as before.
 */
function responseOf(
	type: string,
	data: string[],
	id: string | number
): 'own' | 'foreign' | undefined {
	if ((type !== '' && type !== 'message') || data.length === 0) return undefined;
	let message: unknown;
	try {
		message = parseJSONRPCMessage(JSON.parse(data.join('\n')));
	} catch {
		return undefined;
	}
	if (!isJSONRPCResultResponse(message) && !isJSONRPCErrorResponse(message)) return undefined;
	return (message as { id?: unknown }).id === id ? 'own' : 'foreign';
}

/**
 * A call's event stream, read up to {@link RESPONSE_MAX_BYTES}, which ends in its response. **Only whole events pass,
 * each ending in `\n`**: an event is held until the blank line that ends it, and its lines are passed on with `\n`
 * whatever ended them, so the SDK reads exactly the events read here and never part of one. A response to another id
 * never passes, nor a second one. **A stream that ends, breaks or passes the limit before its response** drops the event
 * it was in the middle of (WHATWG never dispatches an unended event) and ends here with one JSON-RPC error for the
 * request's id instead, so the SDK, which waits for a response on a stream that ends without one, fails the call at
 * once: `MOUNT_RESULT_INVALID` past the limit, `MOUNT_UNREACHABLE` for a cut stream (phase 6 specification, 8.1 step 15;
 * the relay cuts a stream past its own limit or deadline). Lines are split as WHATWG's server-sent events define them:
 * on `\r\n`, `\r` or `\n`, a `\n` after a `\r` that ended a chunk belonging to it. Each piece of text is searched
 * once, so a long line costs what its length does.
 */
function watchStream(
	body: ReadableStream<Uint8Array>,
	id: string | number
): ReadableStream<Uint8Array> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const lineEnd = /\r|\n/g;
	let read = 0;
	/** The line being read, in the pieces that arrived; `afterCr` when the last piece ended a line on a `\r`. */
	let parts: string[] = [];
	let afterCr = false;
	/** The event being read: its lines, its `data` values and its type. */
	let lines: string[] = [];
	let data: string[] = [];
	let type = '';
	let answered = false;
	/** Set once the consumer cancels: nothing more is passed on, and no cut is recorded. */
	let cancelled = false;
	const ended = (): string => {
		const response = responseOf(type, data, id);
		const whole = lines;
		lines = [];
		data = [];
		type = '';
		if (whole.length === 0) return '';
		if (response === 'foreign' || (response === 'own' && answered)) return '';
		if (response === 'own') answered = true;
		return `${whole.join('\n')}\n\n`;
	};
	const line = (text: string): string => {
		if (text === '') return ended();
		lines.push(text);
		const colon = text.indexOf(':');
		const field = colon === -1 ? text : text.slice(0, colon);
		let value = colon === -1 ? '' : text.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'data') data.push(value);
		else if (field === 'event') type = value;
		return '';
	};
	/** The whole events `text` completes, as text to pass on; the rest is held. */
	const scan = (text: string): string => {
		let out = '';
		let at = 0;
		// An empty piece (a zero-length chunk) keeps a `\r` waiting for its `\n`.
		if (afterCr && text.length > 0) {
			afterCr = false;
			if (text.startsWith('\n')) at = 1;
		}
		for (;;) {
			lineEnd.lastIndex = at;
			const end = lineEnd.exec(text);
			if (!end) {
				if (at < text.length) parts.push(text.slice(at));
				return out;
			}
			parts.push(text.slice(at, end.index));
			const whole = parts.join('');
			parts = [];
			at = end.index + 1;
			if (end[0] === '\r') {
				if (at === text.length) afterCr = true;
				else if (text[at] === '\n') at++;
			}
			out += line(whole);
		}
	};
	const finish = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		code: MountFailureCode
	) => {
		if (cancelled) return;
		// The event the stream was in the middle of is never passed on, so nothing here completes an instance's event.
		// `crypto.randomUUID` needs a secure context, which the shell always is (`https:`, or `localhost`); without it the
		// stream just ends, and the call waits for its own deadline as it did before.
		const nonce = answered ? undefined : globalThis.crypto?.randomUUID?.();
		if (nonce !== undefined) {
			CUT_STREAMS.set(nonce, code);
			setTimeout(() => CUT_STREAMS.delete(nonce), CUT_NONCE_MS);
			const error = { code: -32000, message: code, data: { 'dev.loam/cut': nonce } };
			controller.enqueue(
				encoder.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id, error })}\n\n`)
			);
		}
		controller.close();
	};
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			for (;;) {
				let chunk: ReadableStreamReadResult<Uint8Array>;
				try {
					chunk = await reader.read();
				} catch {
					return finish(controller, 'MOUNT_UNREACHABLE');
				}
				if (chunk.done) {
					const rest = scan(decoder.decode());
					if (rest) controller.enqueue(encoder.encode(rest));
					return finish(controller, 'MOUNT_UNREACHABLE');
				}
				read += chunk.value.byteLength;
				if (read > RESPONSE_MAX_BYTES) {
					await reader.cancel().catch(() => {});
					return finish(controller, 'MOUNT_RESULT_INVALID');
				}
				const whole = scan(decoder.decode(chunk.value, { stream: true }));
				if (whole) return controller.enqueue(encoder.encode(whole));
			}
		},
		async cancel(reason) {
			cancelled = true;
			await reader.cancel(reason).catch(() => {});
		},
	});
}

/** The code of a JSON-RPC error {@link watchStream} wrote for a cut stream, once; none for an instance's own error. */
function cutCode(error: { data?: unknown }): MountFailureCode | undefined {
	const nonce = (error.data as { 'dev.loam/cut'?: unknown } | undefined)?.['dev.loam/cut'];
	if (typeof nonce !== 'string') return undefined;
	const code = CUT_STREAMS.get(nonce);
	CUT_STREAMS.delete(nonce);
	return code;
}

/**
 * Every request of the transport. A server is untrusted, and the SDK reads each response whole, and after
 * `initialize` holds an event stream open with no deadline: a server could fill the tab's memory with no
 * person or command asking. So nothing reads past the limit, and phase 1, which uses no server push, opens
 * no such stream: 405 is how a server says it has none, and the SDK goes on without it (9.9). An answer the relay
 * marked as its own refusal is thrown as its code (8.1); its `message` and `suggestion` are never read. A
 * call's event stream that ends without its response fails the call at once ({@link watchStream}).
 */
export async function boundedFetch(
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1]
): Promise<Response> {
	if ((init?.method ?? 'GET').toUpperCase() === 'GET') return new Response(null, { status: 405 });
	const response = await fetch(input, init);
	if (response.headers.get(RELAY_REFUSAL) === '1') throw await markedRefusal(response);
	if (!response.body) return response;
	const id = callIdOf(init?.body);
	const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
	if (id !== undefined && response.ok && response.status !== 202 && type === 'text/event-stream')
		return new Response(watchStream(response.body, id), {
			status: response.status,
			headers: response.headers,
		});
	let read = 0;
	const limited = response.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				read += chunk.byteLength;
				if (read > RESPONSE_MAX_BYTES) {
					controller.error(new MountRefusal('MOUNT_RESULT_INVALID'));
				} else controller.enqueue(chunk);
			},
		})
	);
	return new Response(limited, { status: response.status, headers: response.headers });
}

const CLIENT = {
	clientName: 'loam',
	clientVersion: '1',
	mode: 'auto',
	fetch: boundedFetch,
} as const;

/** Pages of `tools/list` read, so a server cannot keep a discovery in a loop. */
const TOOL_PAGES_MAX = 20;

/** A refusal that says only its code. */
class MountRefusal extends Error {
	constructor(readonly code: MountFailureCode) {
		super(code);
		this.name = 'MountRefusal';
	}
}

/** The HTTP status of the SDK's error: on `data` or `status`, or only in the message it wrote. */
function statusOf(cause: unknown): number | undefined {
	const { data, status, message } = (cause ?? {}) as {
		data?: { status?: unknown };
		status?: unknown;
		message?: unknown;
	};
	if (typeof data?.status === 'number') return data.status;
	if (typeof status === 'number') return status;
	const written = typeof message === 'string' ? /\bHTTP (\d{3})\b/.exec(message) : null;
	return written ? Number(written[1]) : undefined;
}

/** How far a `cause` chain is followed: the SDK wraps an error a few times at most. */
const CAUSE_DEPTH = 8;

/**
 * A `MountRefusal` on the error or anywhere on its `cause` chain, unchanged, so the SDK's wrapping never remaps the
 * relay's code to a status. Otherwise 401 and 403 are the credential, and everything else cannot be told from an
 * instance that is not there.
 */
export function refusalOf(cause: unknown): MountRefusal {
	let link: unknown = cause;
	for (let depth = 0; depth < CAUSE_DEPTH && link instanceof Error; depth++) {
		if (link instanceof MountRefusal) return link;
		link = (link as { cause?: unknown }).cause;
	}
	const status = statusOf(cause);
	return new MountRefusal(
		status === 401 || status === 403 ? 'MOUNT_UNAUTHORIZED' : 'MOUNT_UNREACHABLE'
	);
}

export interface MountTransportOptions {
	/**
	 * Phase 3's 4.3 refresh at once, the one `server-call.ts`'s 401 also runs: called when the relay itself refuses the
	 * session (`401` `UNAUTHORIZED` or `AGENT_CANNOT_SIGN_IN` under its mark), never on an instance's own answer.
	 */
	refreshSession?: () => void;
}

type TransportClass = new (
	url: string,
	options: StreamableHttpTransportOptions
) => Pick<StreamableHttpTransport, 'connect' | 'disconnect' | 'send' | 'protocolVersion'>;

export function createMountTransport(
	url: string,
	Transport: TransportClass = StreamableHttpTransport,
	options: MountTransportOptions = {}
): MountTransport {
	const transport = new Transport(url, CLIENT);
	let id = 0;
	/** The relay ended this session (`MOUNT_SESSION_UNKNOWN`): the next request connects again before it sends (8.1, 16). */
	let reconnect = false;

	/** The refusal for `cause`, after what it asks of the transport: a refresh, or a closed session. */
	function refused(cause: unknown): MountRefusal {
		const refusal = refusalOf(cause);
		if (refusal.code === 'UNAUTHORIZED' || refusal.code === 'AGENT_CANNOT_SIGN_IN') {
			options.refreshSession?.();
		} else if (refusal.code === 'MOUNT_SESSION_UNKNOWN') {
			// The SDK does not start a new session by itself, so the transport is closed and the next call reconnects.
			transport.disconnect();
			reconnect = true;
		}
		return refusal;
	}

	async function connect(signal?: AbortSignal): Promise<{ protocolVersion: string }> {
		try {
			await transport.connect(signal);
		} catch (cause) {
			throw refused(cause);
		}
		reconnect = false;
		// The port promises a version, and the AFD transport's can be undefined. A connection with none
		// negotiated did not finish a handshake, so what answered is not an MCP server.
		const { protocolVersion } = transport;
		if (protocolVersion === undefined) throw new MountRefusal('MOUNT_UNREACHABLE');
		return { protocolVersion };
	}

	async function request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
		if (reconnect) await connect(signal);
		let response: Awaited<ReturnType<StreamableHttpTransport['send']>>;
		try {
			response = await transport.send(
				{ jsonrpc: '2.0', id: ++id, method, params } as never,
				signal
			);
		} catch (cause) {
			throw refused(cause);
		}
		// A JSON-RPC error is an answer, and not a `CommandResult`. The server's text stays out of it. One that
		// `watchStream` wrote for a stream that ended without its response carries that stream's code.
		if (response.error) throw new MountRefusal(cutCode(response.error) ?? 'MOUNT_RESULT_INVALID');
		return response.result;
	}

	return {
		connect,
		async listTools(signal) {
			const tools: McpTool[] = [];
			let cursor: unknown;
			for (let page = 0; page < TOOL_PAGES_MAX; page++) {
				const listed = (await request(
					'tools/list',
					typeof cursor === 'string' ? { cursor } : {},
					signal
				)) as { tools?: McpTool[]; nextCursor?: unknown };
				tools.push(...(Array.isArray(listed?.tools) ? listed.tools : []));
				cursor = listed?.nextCursor;
				if (typeof cursor !== 'string') break;
			}
			return tools;
		},
		/** A command's call carries the kernel's `_meta`, its scope; discovery's carry none (phase 2, 9.2). */
		async callTool(name, args, signal, meta) {
			return (await request(
				'tools/call',
				{ name, arguments: args ?? {}, ...(meta ? { _meta: meta } : {}) },
				signal
			)) as McpToolCallResult;
		},
		/**
		 * `MountTransportV3` (phase 5 specification, 9.3): the server's resources, for `shell-open`'s mounted view, which the
		 * kernel bounds; a lane that refuses them (the hosted relay's) refuses the view.
		 */
		async listResources(signal) {
			const listed = (await request('resources/list', {}, signal)) as {
				resources?: Array<{ uri?: unknown; mimeType?: unknown }>;
			} | null;
			return (Array.isArray(listed?.resources) ? listed.resources : []).flatMap((resource) =>
				typeof resource?.uri === 'string'
					? [
							{
								uri: resource.uri,
								...(typeof resource.mimeType === 'string' ? { mimeType: resource.mimeType } : {}),
							},
						]
					: []
			);
		},
		async readResource(uri, signal) {
			const read = (await request('resources/read', { uri }, signal)) as {
				contents?: unknown;
			} | null;
			return {
				contents: (Array.isArray(read?.contents) ? read.contents : []) as Array<{
					uri: string;
					mimeType?: string;
					text?: string;
				}>,
			};
		},
		/**
		 * `disconnect()` is synchronous, and sends nothing: the SDK 2.4.0 client's `close()` does not call
		 * `terminateSession()`, so no session `DELETE` leaves the page. On the hosted lane the relay ends an idle
		 * upstream session itself (phase 6 specification, 8.1 step 16). This resolves when no further call can go out.
		 */
		close() {
			reconnect = false;
			transport.disconnect();
			return Promise.resolve();
		},
	};
}
