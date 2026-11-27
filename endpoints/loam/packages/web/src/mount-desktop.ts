/**
 * @fileoverview The desktop's mount transport, `DesktopMountTransport` (phase 6 specification, 10.4), in the
 * `mount` chunk. The page names an instance and nothing else: the Rust host holds the address, the bearer and
 * the command line, and carries one JSON-RPC message at a time over Loam's three IPC commands. The MCP
 * handshake is here, since the Rust side is a transport only. A rejection carries a code and the kernel's
 * words, never the host's.
 */

import type { McpTool, McpToolCallResult, MountTransport } from '@lushly-dev/loam-kernel';
import { captureDesktopInvoke, type DesktopInvoke } from './desktop-ipc.js';

/** The version the handshake offers; the server answers with the one it speaks. */
export const DESKTOP_PROTOCOL_VERSION = '2025-06-18';

/**
 * MCP 2026-07-28, which an `approvals = "shell"` instance over `stdio` or `http` is opened in (phase 5 specification,
 * 7.2): the only era on which AFD accepts an approver's `_meta["dev.afd/approval"]`. Each request carries these keys, and
 * the connection opens with `server/discover`; a server that does not speak it is opened as before, with `initialize`.
 * Over `http` the Rust host reads the era from these keys and sends its headers (`MCP-Protocol-Version`, `Mcp-Method`,
 * `Mcp-Name`) with no session, as the era's stateless lane asks; the page sends no header itself.
 */
export const DESKTOP_MODERN_VERSION = '2026-07-28';
const MODERN_META = Object.freeze({
	'io.modelcontextprotocol/protocolVersion': DESKTOP_MODERN_VERSION,
	'io.modelcontextprotocol/clientCapabilities': {},
	'io.modelcontextprotocol/clientInfo': { name: 'loam', version: '1' },
});

export interface DesktopMountOptions {
	/** `modern` for an instance whose entry releases commands for a person (7.2). */
	era?: 'modern';
	/**
	 * Boot-captured Tauri IPC invoker (`desktop-ipc.ts`), or `null` when absent at boot so globals are never
	 * re-read later; omitted (`undefined`) captures on construction for direct unit callers.
	 */
	invoke?: DesktopInvoke | null;
}

/** Pages of `tools/list` read, so a server cannot keep a discovery in a loop. */
const TOOL_PAGES_MAX = 20;

type Failure =
	| 'MOUNT_UNAUTHORIZED'
	| 'MOUNT_UNREACHABLE'
	| 'MOUNT_RESULT_INVALID'
	| 'MOUNT_KEYCHAIN_MISSING';

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
		cause === 'MOUNT_UNAUTHORIZED' ||
			cause === 'MOUNT_RESULT_INVALID' ||
			cause === 'MOUNT_KEYCHAIN_MISSING'
			? cause
			: 'MOUNT_UNREACHABLE'
	);
}

/** `invoke`, which an abort leaves behind: the host's answer, if it comes, is dropped. */
async function call(
	invoke: DesktopInvoke | null,
	command: 'mount_open' | 'mount_send' | 'mount_close',
	args: Record<string, unknown>,
	signal?: AbortSignal
): Promise<unknown> {
	if (signal?.aborted || !invoke) throw new MountRefusal('MOUNT_UNREACHABLE');
	const answer = invoke(command, args);
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

export function createDesktopMountTransport(
	instance: string,
	options: DesktopMountOptions = {}
): MountTransport {
	const invoke = options.invoke !== undefined ? options.invoke : captureDesktopInvoke();
	let handle: number | undefined;
	let id = 0;
	/** Whether the connection is on the modern era: its keys go on every request's `_meta`, the kernel's beside them. */
	let modern = false;

	async function request(
		method: string,
		given: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<unknown> {
		if (handle === undefined) throw new MountRefusal('MOUNT_UNREACHABLE');
		const sent = ++id;
		const params = modern
			? { ...given, _meta: { ...((given._meta as object | undefined) ?? {}), ...MODERN_META } }
			: given;
		try {
			const answer = await call(
				invoke,
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
			if (signal?.aborted || !invoke) throw new MountRefusal('MOUNT_UNREACHABLE');
			let aborted = false;
			const opening = invoke('mount_open', { instance });
			try {
				const opened = await new Promise<unknown>((resolve, reject) => {
					const abort = () => {
						aborted = true;
						reject(new MountRefusal('MOUNT_UNREACHABLE'));
					};
					signal?.addEventListener('abort', abort, { once: true });
					opening.then(
						(value) => {
							signal?.removeEventListener('abort', abort);
							// If the caller aborted before `mount_open` settled (e.g. a keychain prompt),
							// close the late handle so Rust's `HANDLES_PER_INSTANCE` slots are never leaked.
							if (aborted) {
								if (typeof value === 'number' && Number.isSafeInteger(value)) {
									void invoke('mount_close', { handle: value }).catch(() => {});
								}
							} else {
								resolve(value);
							}
						},
						(error) => {
							signal?.removeEventListener('abort', abort);
							reject(error);
						}
					);
				});
				if (typeof opened !== 'number' || !Number.isSafeInteger(opened))
					throw new MountRefusal('MOUNT_UNREACHABLE');
				handle = opened;
			} catch (cause) {
				throw refusalOf(cause);
			}
			if (options.era === 'modern') {
				modern = true;
				const discovered = (await request('server/discover', {}, signal).catch(() => null)) as {
					supportedVersions?: unknown;
				} | null;
				const versions = discovered?.supportedVersions;
				// The lane's own word that it carries a person's approval (7.2): only here, never from a server's answer.
				if (Array.isArray(versions) && versions.includes(DESKTOP_MODERN_VERSION))
					return { protocolVersion: DESKTOP_MODERN_VERSION, approvals: true };
				// Not spoken: the 2025 handshake on the same connection, and the kernel releases nothing (7.2).
				modern = false;
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
					invoke,
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
		async close() {
			const held = handle;
			handle = undefined;
			if (held === undefined) return;
			await call(invoke, 'mount_close', { handle: held }).catch(() => {});
		},
	};
}
