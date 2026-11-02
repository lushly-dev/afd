/**
 * @fileoverview `@lushly-dev/loam-sdk/view`, for code inside a sandbox (phase 1 specification, 5.2,
 * 6.2 and 6.3). It uses only `window.parent.postMessage` and defines no element. A view that does not
 * use it, such as one built on `@modelcontextprotocol/ext-apps`, still works.
 */

import type { CommandError, CommandResult } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-core/result';
import type { AppCallContextV1, AppDefinitionV1, AppStoreV1, LoamClientV1 } from './index.js';
import { createPeer, RpcAborted, RpcFailure, type RpcPeer } from './rpc.js';

/** The MCP Apps version a view and the shell speak. */
const PROTOCOL_VERSION = '2026-01-26';

export interface ViewHostContextV1 {
	theme: 'light' | 'dark';
	platform: 'web';
	displayMode: 'inline';
	containerDimensions: { width: number; height: number };
	'dev.loam/tokens': Record<string, string>;
	'dev.loam/selection'?: string | null;
}

export interface ViewConnectionV1 {
	readonly hostContext: ViewHostContextV1;
	/** `tools/call`, through the broker. */
	readonly client: LoamClientV1;
	readResource(uri: string): Promise<string>;
	onToolInput(listener: (args: unknown) => void): () => void;
	onToolResult(listener: (result: CommandResult) => void): () => void;
	onToolCancelled(listener: (reason?: string) => void): () => void;
	onHostContext(listener: (context: Partial<ViewHostContextV1>) => void): () => void;
	onTeardown(listener: () => void | Promise<void>): () => void;
}

interface ToolsCallResult {
	content?: Array<{ type?: string; text?: string }>;
	structuredContent?: unknown;
}

function isCommandResult(value: unknown): value is CommandResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as CommandResult).success === 'boolean'
	);
}

/** A host that refuses a call by JSON-RPC names the code in `data.code`, as the handler frame does. */
function refusal(cause: RpcFailure): CommandError {
	const data = cause.data as { code?: unknown; suggestion?: unknown } | undefined;
	return {
		code: typeof data?.code === 'string' ? data.code : 'VIEW_CALL_REFUSED',
		message: cause.message,
		suggestion:
			typeof data?.suggestion === 'string'
				? data.suggestion
				: 'The shell answers only commands of this app and the shell commands an app may call.',
	};
}

function resultOf(answer: unknown): CommandResult {
	const { structuredContent, content } = (answer ?? {}) as ToolsCallResult;
	if (isCommandResult(structuredContent)) return structuredContent;
	try {
		const parsed: unknown = JSON.parse(content?.[0]?.text ?? '');
		if (isCommandResult(parsed)) return parsed;
	} catch {}
	return failure({
		code: 'VIEW_RESULT_INVALID',
		message: 'The host answered a tool call with no CommandResult.',
		suggestion: "Read the call's result in the host; this is not the view's fault.",
	});
}

function clientFor(peer: RpcPeer, meta?: Record<string, unknown>): LoamClientV1 {
	return {
		async call<T>(name: string, input?: unknown, options?: { signal?: AbortSignal }) {
			const params = { name, arguments: input ?? {}, ...(meta ? { _meta: meta } : {}) };
			try {
				return resultOf(
					await peer.request('tools/call', params, options?.signal)
				) as CommandResult<T>;
			} catch (cause) {
				if (cause instanceof RpcFailure) return failure(refusal(cause));
				if (cause instanceof RpcAborted) {
					return failure({
						code: 'CALL_ABORTED',
						message: cause.message,
						suggestion: 'Call again if the result is still wanted.',
					});
				}
				throw cause;
			}
		},
	};
}

/** Holds what arrives before anyone listens: a view may await something else first. */
function createChannel<T>() {
	const listeners = new Set<(value: T) => void>();
	let queue: T[] = [];
	return {
		emit(value: T): void {
			if (listeners.size === 0) queue.push(value);
			for (const listener of listeners) listener(value);
		},
		listen(listener: (value: T) => void): () => void {
			listeners.add(listener);
			const held = queue;
			queue = [];
			for (const value of held) listener(value);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

function applyTokens(tokens: Record<string, string> | undefined): void {
	if (!tokens) return;
	for (const [name, value] of Object.entries(tokens)) {
		document.documentElement.style.setProperty(name, value);
	}
}

/**
 * Sends `ui/initialize`, applies the shell's tokens, sends `ui/notifications/initialized` and
 * resolves. The shell sends a view nothing before that notification.
 */
export async function connectView(info?: {
	name: string;
	version: string;
}): Promise<ViewConnectionV1> {
	const peer = createPeer();
	const toolInput = createChannel<unknown>();
	const toolResult = createChannel<CommandResult>();
	const toolCancelled = createChannel<string | undefined>();
	const contextChanges = createChannel<Partial<ViewHostContextV1>>();
	const teardowns = new Set<() => void | Promise<void>>();

	peer.handle('ping', () => ({}));
	peer.handle('ui/resource-teardown', async () => {
		await Promise.all([...teardowns].map((listener) => listener()));
		return {};
	});
	peer.onNotification('ui/notifications/tool-input', (params) => {
		toolInput.emit((params as { arguments?: unknown }).arguments);
	});
	peer.onNotification('ui/notifications/tool-result', (params) => {
		toolResult.emit(resultOf(params));
	});
	peer.onNotification('ui/notifications/tool-cancelled', (params) => {
		toolCancelled.emit((params as { reason?: string }).reason);
	});

	const { hostContext } = (await peer.request('ui/initialize', {
		protocolVersion: PROTOCOL_VERSION,
		appInfo: info ?? { name: 'loam-view', version: '0.0.0' },
		appCapabilities: {},
	})) as { hostContext: ViewHostContextV1 };
	applyTokens(hostContext['dev.loam/tokens']);
	peer.onNotification('ui/notifications/host-context-changed', (params) => {
		const changed = params as Partial<ViewHostContextV1>;
		applyTokens(changed['dev.loam/tokens']);
		Object.assign(hostContext, changed);
		contextChanges.emit(changed);
	});
	peer.notify('ui/notifications/initialized');

	return {
		hostContext,
		client: clientFor(peer),
		async readResource(uri) {
			const { contents } = (await peer.request('resources/read', { uri })) as {
				contents: Array<{ text?: string }>;
			};
			return contents[0]?.text ?? '';
		},
		onToolInput: toolInput.listen,
		onToolResult: toolResult.listen,
		onToolCancelled: toolCancelled.listen,
		onHostContext: contextChanges.listen,
		onTeardown(listener) {
			teardowns.add(listener);
			return () => {
				teardowns.delete(listener);
			};
		},
	};
}

/** The frame's `context.random()`: deterministic from one value on the journal's tape. */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface HandlerCallParams {
	callId: string;
	command: string;
	input: unknown;
	context: {
		traceId: string;
		now?: number;
		randomSeed?: number;
		config: Readonly<Record<string, unknown>>;
		grants: string[];
	};
}

function storeFor(peer: RpcPeer, callId: string): AppStoreV1 {
	const store = (op: string, rest: Record<string, unknown>): Promise<unknown> =>
		peer.request('dev.loam/store', { callId, op, ...rest });
	return {
		async get<T>(key: string) {
			return (await store('get', { key })) as T | undefined;
		},
		async put(key, value) {
			await store('put', { key, value });
		},
		async delete(key) {
			await store('delete', { key });
		},
		async list(prefix) {
			return (await store('list', prefix === undefined ? {} : { prefix })) as Array<{
				key: string;
				value: unknown;
			}>;
		},
	};
}

function callContext(peer: RpcPeer, { callId, context }: HandlerCallParams): AppCallContextV1 {
	const { traceId, now, randomSeed, config, grants } = context;
	const granted = new Set(grants);
	return {
		traceId,
		config,
		client: clientFor(peer, { 'dev.loam/call': callId }),
		...(granted.has('clock') && now !== undefined ? { now: () => now } : {}),
		...(granted.has('random') && randomSeed !== undefined
			? { random: mulberry32(randomSeed) }
			: {}),
		...(granted.has('store') ? { store: storeFor(peer, callId) } : {}),
	};
}

/**
 * Runs a definition's handlers in the hidden handler frame. The same `defineApp` value runs native or
 * here, and `activate` does not run here: commands run without it.
 */
export function serveHandlers(definition: AppDefinitionV1): void {
	const peer = createPeer();
	peer.handle('ping', () => ({}));
	peer.handle('dev.loam/handler-call', async (params) => {
		const call = params as HandlerCallParams;
		const handler = definition.handlers[call.command];
		if (!handler) {
			return failure({
				code: 'APP_HANDLER_MISSING',
				message: `The module has no handler for \`${call.command}\`.`,
				suggestion: 'Add the handler, or remove the command from the manifest.',
			});
		}
		try {
			return await handler(call.input as never, callContext(peer, call));
		} catch (cause) {
			// To the frame's console and not the result, which is journaled: what a thrown error says is
			// not an app's answer, and may hold what a log should not, as for a native handler (9.6).
			(globalThis as { reportError?: (error: unknown) => void }).reportError?.(cause);
			return failure({
				code: 'HANDLER_THREW',
				message: `The handler of \`${call.command}\` threw.`,
				suggestion:
					"A handler returns `failure(...)`; read the handler frame's console, and fix the code that threw.",
			});
		}
	});
	peer.notify('dev.loam/handlers-ready', {
		sdk: definition.sdk,
		commands: Object.keys(definition.handlers),
	});
}
