/**
 * @fileoverview The instance's answer, by allow-list (phase 6 specification, 8.1 step 15): by status, then by media
 * type, with every body the relay passes back re-serialized by it, bound to the forwarded request's `id`. No header of
 * the instance's is read here but its `Content-Type`; the route passes back only that bare type and, on an
 * `initialize`'s answer, `Mcp-Session-Id`.
 */

import { isRecord, type RpcId } from './message.js';

/** One JSON-RPC response, as the relay re-serializes it. */
export interface RpcResponse {
	jsonrpc: '2.0';
	id: RpcId | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

export type ReadAnswer =
	| { kind: 'invalid' }
	| { kind: 'empty'; status: number }
	| { kind: 'body'; status: number; text?: string; response?: RpcResponse }
	| { kind: 'stream'; events: AsyncGenerator<StreamEvent, void, void> };

/** One event the relay writes to the page's stream: re-serialized, and the response when it is the stream's last. */
export interface StreamEvent {
	text: string;
	response?: RpcResponse;
}

/** Thrown inside a stream: the relay aborts the stream after its status, as phase 1's own bound does. */
export class StreamCut extends Error {
	constructor(readonly reason: 'size' | 'id') {
		super(`The relay cut the stream (${reason})`);
	}
}

const isId = (value: unknown): value is RpcId =>
	typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));

/** One JSON-RPC response re-serialized, or none: exactly one of `result` and `error`, no `method`. */
export function responseOf(value: unknown): RpcResponse | undefined {
	if (!isRecord(value) || value.jsonrpc !== '2.0' || 'method' in value || !('id' in value))
		return undefined;
	const { id } = value;
	if (id !== null && !isId(id)) return undefined;
	const hasResult = 'result' in value;
	const hasError = 'error' in value;
	if (hasResult === hasError) return undefined;
	if (hasResult) return { jsonrpc: '2.0', id, result: value.result };
	const { error } = value;
	if (!isRecord(error) || !Number.isInteger(error.code) || typeof error.message !== 'string')
		return undefined;
	return {
		jsonrpc: '2.0',
		id,
		error: {
			code: error.code as number,
			message: error.message,
			...(error.data !== undefined ? { data: error.data } : {}),
		},
	};
}

/** One JSON-RPC notification re-serialized, or none. */
function notificationOf(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value) || value.jsonrpc !== '2.0' || 'id' in value) return undefined;
	if (typeof value.method !== 'string') return undefined;
	if (value.params !== undefined && !isRecord(value.params)) return undefined;
	return {
		jsonrpc: '2.0',
		method: value.method,
		...(value.params !== undefined ? { params: value.params } : {}),
	};
}

const sameId = (a: RpcId | null, b: RpcId | undefined) => b !== undefined && a === b;

/** The bare media type, or `invalid` for a `charset` other than `utf-8`, compared ignoring case and quotes. */
export function mediaTypeOf(header: string | null): string | 'invalid' | undefined {
	if (header === null) return undefined;
	const [type, ...parameters] = header.split(';');
	for (const parameter of parameters) {
		const [name, ...rest] = parameter.split('=');
		if (name?.trim().toLowerCase() !== 'charset') continue;
		const value = rest
			.join('=')
			.trim()
			.replace(/^"(.*)"$/, '$1')
			.toLowerCase();
		if (value !== 'utf-8') return 'invalid';
	}
	return type?.trim().toLowerCase();
}

/** The body whole, decoded, or `undefined` past `max` bytes; nothing past it is read. */
async function readWhole(
	body: ReadableStream<Uint8Array> | null,
	max: number
): Promise<string | undefined> {
	if (!body) return '';
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let size = 0;
	let text = '';
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > max) return undefined;
			text += decoder.decode(value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		await reader.cancel().catch(() => {});
	}
}

/**
 * WHATWG's server-sent events, parsed: lines on `\r\n`, `\r` or `\n`; several `data:` lines joined with `\n`; `id:`,
 * `retry:` and comments dropped; an event whose `event` field is set and is not `message` dropped. Yields each event's
 * data.
 */
async function* sseData(
	body: ReadableStream<Uint8Array>,
	max: number
): AsyncGenerator<string, void, void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let size = 0;
	let buffer = '';
	let data: string[] = [];
	let type = '';
	const dispatch = function* (): Generator<string, void, void> {
		const lines = data;
		const eventType = type;
		data = [];
		type = '';
		if (lines.length === 0) return;
		if (eventType !== '' && eventType !== 'message') return;
		yield lines.join('\n');
	};
	const line = function* (text: string): Generator<string, void, void> {
		if (text === '') return yield* dispatch();
		if (text.startsWith(':')) return;
		const colon = text.indexOf(':');
		const field = colon === -1 ? text : text.slice(0, colon);
		let value = colon === -1 ? '' : text.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'data') data.push(value);
		else if (field === 'event') type = value;
	};
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				buffer += decoder.decode();
				break;
			}
			size += value.byteLength;
			if (size > max) throw new StreamCut('size');
			buffer += decoder.decode(value, { stream: true });
			for (;;) {
				const match = /\r\n|\r|\n/.exec(buffer);
				if (!match) break;
				// A `\r` at the end may be the first half of a `\r\n`: wait for the next chunk.
				if (match[0] === '\r' && match.index === buffer.length - 1) break;
				yield* line(buffer.slice(0, match.index));
				buffer = buffer.slice(match.index + match[0].length);
			}
		}
		// The lines that ended before the stream did; the last piece is a line that never ended, read only as a field. An
		// event with no blank line after it is never dispatched (WHATWG), so a cut stream's last event is not complete.
		const pieces = buffer.split(/\r\n|\r|\n/);
		const unended = pieces.pop() ?? '';
		for (const piece of pieces) yield* line(piece);
		if (unended !== '') yield* line(unended);
		data = [];
	} finally {
		await reader.cancel().catch(() => {});
	}
}

/**
 * The stream's events, each re-serialized as its only field: notifications before the response pass, a server-to-client
 * request, an array and anything that does not parse are dropped, and the stream ends after its one response, which
 * must carry the forwarded request's `id` or the stream is cut.
 */
async function* streamEvents(
	body: ReadableStream<Uint8Array>,
	id: RpcId | undefined,
	max: number
): AsyncGenerator<StreamEvent, void, void> {
	for await (const data of sseData(body, max)) {
		let value: unknown;
		try {
			value = JSON.parse(data);
		} catch {
			continue;
		}
		if (Array.isArray(value)) continue;
		const notification = notificationOf(value);
		if (notification) {
			yield { text: `data: ${JSON.stringify(notification)}\n\n` };
			continue;
		}
		const response = responseOf(value);
		if (!response) continue;
		if (!sameId(response.id, id)) throw new StreamCut('id');
		yield { text: `data: ${JSON.stringify(response)}\n\n`, response };
		return;
	}
}

/**
 * Step 15 on the instance's answer to a forwarded message whose `id` is `id` (none for a notification). It reads a JSON
 * body whole, up to `max` bytes, before the status is sent; a stream is read as the route writes it.
 */
export async function readAnswer(
	response: Response,
	options: { id: RpcId | undefined; max: number }
): Promise<ReadAnswer> {
	const { status } = response;
	if (status >= 300 && status < 400) return { kind: 'invalid' };
	const type = mediaTypeOf(response.headers.get('content-type'));
	if (status === 200 && type === 'text/event-stream') {
		if (!response.body) return { kind: 'empty', status };
		return { kind: 'stream', events: streamEvents(response.body, options.id, options.max) };
	}
	const text = await readWhole(response.body, options.max);
	if (text === undefined) return { kind: 'invalid' };
	if (status >= 200 && status < 300 && text === '') return { kind: 'empty', status };
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		value = undefined;
	}
	if (status === 200) {
		// A `200` with a body: one JSON-RPC response for this request, as JSON in UTF-8, and nothing else.
		if (type !== 'application/json') return { kind: 'invalid' };
		const message = responseOf(value);
		if (!message || !sameId(message.id, options.id)) return { kind: 'invalid' };
		return { kind: 'body', status, text: JSON.stringify(message), response: message };
	}
	// Any other status passes with at most one JSON-RPC error, bound to this request or to none, re-serialized.
	const message = responseOf(value);
	const passes =
		message?.error !== undefined && (message.id === null || sameId(message.id, options.id));
	return passes
		? { kind: 'body', status, text: JSON.stringify(message), response: message }
		: { kind: 'body', status };
}
