/**
 * @fileoverview The desktop's mount transport, `DesktopMountTransport` (phase 6 specification, 10.4), in the
 * `mount` chunk. The page names an instance and nothing else: the Rust host holds the address, the bearer and
 * the command line, and carries one JSON-RPC message at a time over Loam's three IPC commands. The MCP
 * handshake is here, since the Rust side is a transport only. A rejection carries a code and the kernel's
 * words, never the host's.
 */

import type { McpTool, McpToolCallResult, MountTransportV2 } from '@lushly-dev/loam-kernel';

/**
 * What Tauri's IPC script puts in the page. On WebView2 the frames have it too, and their `invoke` reaches
 * nothing: their policies hold no IPC source and wry hears the main frame's messages alone (10.2, P6-D4).
 */
interface TauriInternals {
	invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
}

/** The version the handshake offers; the server answers with the one it speaks. */
export const DESKTOP_PROTOCOL_VERSION = '2025-06-18';

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

/** The host's code, as the kernel knows it: anything it does not name is an instance not there. */
function refusalOf(cause: unknown): MountRefusal {
	if (cause instanceof MountRefusal) return cause;
	return new MountRefusal(
		cause === 'MOUNT_UNAUTHORIZED' || cause === 'MOUNT_RESULT_INVALID' ? cause : 'MOUNT_UNREACHABLE'
	);
}

function internals(): TauriInternals {
	const found = (globalThis as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
	if (typeof found?.invoke !== 'function') throw new MountRefusal('MOUNT_UNREACHABLE');
	return found;
}

/** `invoke`, which an abort leaves behind: the host's answer, if it comes, is dropped. */
async function call(
	command: 'mount_open' | 'mount_send' | 'mount_close',
	args: Record<string, unknown>,
	signal?: AbortSignal
): Promise<unknown> {
	if (signal?.aborted) throw new MountRefusal('MOUNT_UNREACHABLE');
	const answer = internals().invoke(command, args);
	if (!signal) return answer;
	return new Promise((resolve, reject) => {
		const abort = () => reject(new MountRefusal('MOUNT_UNREACHABLE'));
		signal.addEventListener('abort', abort, { once: true });
		answer.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

/** A JSON-RPC response to `id`, or a refusal. The server's words stay out of it. */
function resultOf(answer: unknown, id: number): unknown {
	const message = answer as { id?: unknown; result?: unknown; error?: unknown } | null;
	if (typeof message !== 'object' || message === null || message.id !== id)
		throw new MountRefusal('MOUNT_RESULT_INVALID');
	if (message.error !== undefined || !('result' in message))
		throw new MountRefusal('MOUNT_RESULT_INVALID');
	return message.result;
}

export function createDesktopMountTransport(instance: string): MountTransportV2 {
	let handle: number | undefined;
	let id = 0;

	async function request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
		if (handle === undefined) throw new MountRefusal('MOUNT_UNREACHABLE');
		const sent = ++id;
		try {
			const answer = await call(
				'mount_send',
				{ handle, message: { jsonrpc: '2.0', id: sent, method, params } },
				signal
			);
			return resultOf(answer, sent);
		} catch (cause) {
			throw refusalOf(cause);
		}
	}

	return {
		async connect(signal) {
			try {
				const opened = await call('mount_open', { instance }, signal);
				if (typeof opened !== 'number' || !Number.isSafeInteger(opened))
					throw new MountRefusal('MOUNT_UNREACHABLE');
				handle = opened;
			} catch (cause) {
				throw refusalOf(cause);
			}
			const result = (await request(
				'initialize',
				{
					protocolVersion: DESKTOP_PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: 'loam', version: '1' },
				},
				signal
			)) as { protocolVersion?: unknown } | null;
			const protocolVersion = result?.protocolVersion;
			// A server that negotiated no version did not finish a handshake: what answered is not an MCP server.
			if (typeof protocolVersion !== 'string') throw new MountRefusal('MOUNT_UNREACHABLE');
			try {
				await call(
					'mount_send',
					{ handle, message: { jsonrpc: '2.0', method: 'notifications/initialized' } },
					signal
				);
			} catch (cause) {
				throw refusalOf(cause);
			}
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
				)) as { tools?: McpTool[]; nextCursor?: unknown } | null;
				tools.push(...(Array.isArray(listed?.tools) ? listed.tools : []));
				cursor = listed?.nextCursor;
				if (typeof cursor !== 'string') break;
			}
			return tools;
		},
		/** A command's call carries the kernel's `_meta`, its scope, which the host forwards untouched (10.4). */
		async callTool(name, args, signal, meta) {
			return (await request(
				'tools/call',
				{ name, arguments: args ?? {}, ...(meta ? { _meta: meta } : {}) },
				signal
			)) as McpToolCallResult;
		},
		async close() {
			const held = handle;
			handle = undefined;
			if (held === undefined) return;
			await call('mount_close', { handle: held }).catch(() => {});
		},
	};
}
