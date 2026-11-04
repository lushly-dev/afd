/**
 * @fileoverview The web host's mount transport (phase 1 specification, 7.3), in the `mount` chunk. It reaches
 * an instance only at the same-origin route `mounts/<instance>/mcp` (D64), with no header of its own, so
 * the page holds no credential and `connect-src 'self'` does not widen. A rejection carries a code and the
 * kernel's words: an HTTP error's message can quote the refusal's body, which can name where a token is.
 */

import {
	StreamableHttpTransport,
	type StreamableHttpTransportOptions,
} from '@lushly-dev/afd-client/streamable-http';
import type { McpTool, McpToolCallResult, MountTransportV2 } from '@lushly-dev/loam-kernel';

/** More than a `CommandResult` needs, and the journal keeps 256 KiB of one (7.6). */
export const RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Every request of the transport. A server is untrusted, and the SDK reads each response whole, and after
 * `initialize` holds an event stream open with no deadline: a server could fill the tab's memory with no
 * person or command asking. So nothing reads past the limit, and phase 1, which uses no server push, opens
 * no such stream: 405 is how a server says it has none, and the SDK goes on without it (9.9).
 */
export async function boundedFetch(
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1]
): Promise<Response> {
	if ((init?.method ?? 'GET').toUpperCase() === 'GET') return new Response(null, { status: 405 });
	const response = await fetch(input, init);
	if (!response.body) return response;
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

type Failure = 'MOUNT_UNAUTHORIZED' | 'MOUNT_UNREACHABLE' | 'MOUNT_RESULT_INVALID';

/** A refusal that says only its code. */
class MountRefusal extends Error {
	constructor(readonly code: Failure) {
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

/** 401 and 403 are the credential. Everything else cannot be told from an instance that is not there. */
function refusalOf(cause: unknown): MountRefusal {
	const status = statusOf(cause);
	return new MountRefusal(
		status === 401 || status === 403 ? 'MOUNT_UNAUTHORIZED' : 'MOUNT_UNREACHABLE'
	);
}

type TransportClass = new (
	url: string,
	options: StreamableHttpTransportOptions
) => Pick<StreamableHttpTransport, 'connect' | 'disconnect' | 'send' | 'protocolVersion'>;

export function createMountTransport(
	url: string,
	Transport: TransportClass = StreamableHttpTransport
): MountTransportV2 {
	const transport = new Transport(url, CLIENT);
	let id = 0;

	async function request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
		let response: Awaited<ReturnType<StreamableHttpTransport['send']>>;
		try {
			response = await transport.send(
				{ jsonrpc: '2.0', id: ++id, method, params } as never,
				signal
			);
		} catch (cause) {
			throw refusalOf(cause);
		}
		// A JSON-RPC error is an answer, and not a `CommandResult`. The server's text stays out of it.
		if (response.error) throw new MountRefusal('MOUNT_RESULT_INVALID');
		return response.result;
	}

	return {
		async connect(signal) {
			try {
				await transport.connect(signal);
			} catch (cause) {
				throw refusalOf(cause);
			}
			// The port promises a version, and the AFD transport's can be undefined. A connection with none
			// negotiated did not finish a handshake, so what answered is not an MCP server.
			const { protocolVersion } = transport;
			if (protocolVersion === undefined) throw new MountRefusal('MOUNT_UNREACHABLE');
			return { protocolVersion };
		},
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
		 * `disconnect()` is synchronous, and the SDK's close, its session `DELETE`, runs behind it. So this
		 * resolves when no further call can go out, not when that `DELETE` has been answered.
		 */
		close() {
			transport.disconnect();
			return Promise.resolve();
		},
	};
}
