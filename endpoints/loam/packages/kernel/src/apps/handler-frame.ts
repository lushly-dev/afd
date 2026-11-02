/**
 * @fileoverview A view app's handlers, in a hidden sandboxed frame the port creates lazily (phase 1
 * specification, 6.3; D61). The kernel has no DOM: the frame arrives through `openHandlerFrame`, and a
 * test passes one that runs the same definition in process.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-core';
import type { AppStoreV1, LoamClientV1 } from '@lushly-dev/loam-sdk';
import { kernelFailure, LoamKernelError } from '../errors.js';
import type { HandlerFrameV1, KernelPortsV1 } from '../types.js';
import type { AppRecord } from './operations.js';
import { createAppStore } from './store.js';
import {
	isCommandResult,
	markFailed,
	pageDecided,
	readClock,
	readRandom,
	refuseRequest,
	resultInvalid,
} from './support.js';
import type { AppsHost } from './types.js';

/** A frame with no `handlers-ready` by then fails (6.3). */
export const HANDLER_READY_TIMEOUT_MS = 10_000;
/** A call unanswered by then fails, and the frame is discarded (6.3). */
export const HANDLER_CALL_TIMEOUT_MS = 30_000;

/** The `_meta` key that ties a frame's `tools/call` to the handler call it came from. */
export const CALL_META_KEY = 'dev.loam/call';

export interface FrameHostOptions {
	record: AppRecord;
	host: AppsHost;
	ports: KernelPortsV1;
	readHandlersHtml(): Promise<string>;
	config: Readonly<Record<string, unknown>>;
	granted: ReadonlySet<string>;
	commands: readonly string[];
	/** Whether the app's own `name` may be called from a view. */
	visibleToApp(name: string): boolean;
	nestedClient(parent: string): LoamClientV1;
}

export interface FrameHost {
	invoke(name: string, input: unknown, context: CommandContext): Promise<CommandResult>;
	dispose(): void;
}

class FrameDeadline extends Error {}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new FrameDeadline()), ms);
	});
	return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** The MCP shape the broker answers `tools/call` with (6.2). */
export function toolCallResult(result: CommandResult) {
	return {
		content: [{ type: 'text', text: JSON.stringify(result) }],
		structuredContent: result,
		isError: !result.success,
	};
}

export function createFrameHost(options: FrameHostOptions): FrameHost {
	const { record, host, ports, config, granted, commands } = options;
	const inFlight = new Map<string, CommandContext>();
	let opening: Promise<HandlerFrameV1> | undefined;
	let current: HandlerFrameV1 | undefined;

	/** Close `frame`, and open another on the next call if it is the current one. */
	const discard = (frame: HandlerFrameV1 | undefined = current): void => {
		frame?.close();
		if (frame !== current) return;
		current = undefined;
		opening = undefined;
	};

	function storeFor(context: CommandContext): AppStoreV1 {
		return createAppStore({
			adapter: host.store,
			app: record.app,
			instance: record.instance,
			now: () => readClock(context),
			...(context.actor !== undefined ? { actor: context.actor } : {}),
		});
	}

	function callOf(callId: unknown): CommandContext {
		const context = typeof callId === 'string' ? inFlight.get(callId) : undefined;
		if (context) return context;
		throw refuseRequest({
			code: 'HANDLER_NO_CALL',
			rpcCode: -32600,
			message: 'This request is not part of a handler call in flight',
			suggestion: 'Make calls and store changes from inside a handler, not from a timer',
		});
	}

	async function storeRequest(params: Record<string, unknown>): Promise<unknown> {
		if (!granted.has('store')) {
			throw refuseRequest({
				code: 'VIEW_CALL_REFUSED',
				rpcCode: -32601,
				message: 'This app declares no `store` grant',
				suggestion: 'Declare the `store` grant in the manifest',
			});
		}
		const store = storeFor(callOf(params.callId));
		const invalid = (message: string, suggestion: string) =>
			refuseRequest({ code: 'VALIDATION_ERROR', rpcCode: -32602, message, suggestion });
		const { op, key, prefix } = params;
		if (op === 'list') {
			if (prefix !== undefined && typeof prefix !== 'string') {
				throw invalid('A store prefix is a string', 'Pass a string, or leave it out');
			}
			return store.list(prefix);
		}
		if (op !== 'get' && op !== 'put' && op !== 'delete') {
			throw invalid('The store has no such operation', 'Use get, put, delete or list');
		}
		if (typeof key !== 'string' || key === '' || key === '.' || key === '..') {
			throw invalid('A store key is a nonempty string', 'Pass a key other than "." and ".."');
		}
		if (op === 'get') return store.get(key);
		if (op === 'put') await store.put(key, params.value);
		else await store.delete(key);
		return null;
	}

	async function toolsCall(params: Record<string, unknown>): Promise<unknown> {
		const meta = params._meta as Record<string, unknown> | undefined;
		const callId = meta?.[CALL_META_KEY];
		callOf(callId);
		const { name } = params;
		if (typeof name !== 'string') {
			throw refuseRequest({
				code: 'VALIDATION_ERROR',
				rpcCode: -32602,
				message: 'A tool name is a string',
				suggestion: 'Pass the command name as `name`',
			});
		}
		if (commands.includes(name) && !options.visibleToApp(name)) {
			throw refuseRequest({
				code: 'VIEW_CALL_REFUSED',
				rpcCode: -32602,
				message: `The command '${name}' is not visible to the app`,
				suggestion: 'Add `app` to its `tool_meta.ui.visibility`',
			});
		}
		const result = await options.nestedClient(callId as string).call(name, params.arguments);
		return toolCallResult(result);
	}

	async function open(): Promise<HandlerFrameV1> {
		const frame = await ports.openHandlerFrame(record.instance, await options.readHandlersHtml());
		frame.onRequest(async (method, params) => {
			const fields = (params ?? {}) as Record<string, unknown>;
			if (method === 'tools/call') return toolsCall(fields);
			if (method === 'dev.loam/store') return storeRequest(fields);
			throw refuseRequest({
				code: 'VIEW_CALL_REFUSED',
				rpcCode: -32601,
				message: `The shell answers no '${method}' from a handler frame`,
				suggestion: 'Use tools/call or dev.loam/store',
			});
		});
		current = frame;
		let names: string[];
		try {
			names = await withDeadline(frame.ready, HANDLER_READY_TIMEOUT_MS);
		} catch (cause) {
			discard(frame);
			throw cause;
		}
		const missing = commands.filter((name) => !names.includes(name));
		const extra = names.filter((name) => !commands.includes(name));
		if (missing.length > 0 || extra.length > 0) {
			const error = markFailed(
				record,
				'APP_HANDLER_MISSING',
				`The handler frame does not match the manifest: ${[...missing, ...extra].join(', ')}`,
				'Add the handler, or remove the command from the manifest'
			);
			discard(frame);
			throw new LoamKernelError({
				code: 'APP_HANDLER_MISSING',
				message: error.message,
				suggestion: error.suggestion ?? '',
			});
		}
		return frame;
	}

	async function frame(): Promise<HandlerFrameV1> {
		opening ??= open();
		try {
			return await opening;
		} catch (cause) {
			opening = undefined;
			throw cause;
		}
	}

	return {
		async invoke(name, input, context) {
			let target: HandlerFrameV1;
			try {
				target = await frame();
			} catch (cause) {
				if (cause instanceof FrameDeadline) {
					return kernelFailure(
						'HANDLER_READY_TIMEOUT',
						`The handler frame of '${record.instance}' did not report ready`,
						'Call serveHandlers(definition) as the frame loads, and retry',
						{ retryable: true, details: pageDecided() }
					);
				}
				if (cause instanceof LoamKernelError) {
					return failure({
						code: cause.code,
						message: cause.message,
						suggestion: cause.suggestion,
						retryable: false,
					});
				}
				return kernelFailure(
					'HANDLER_READY_TIMEOUT',
					`The handler frame of '${record.instance}' could not open: ${cause instanceof Error ? cause.message : String(cause)}`,
					'Check that `view.handlers` was built and packed, and retry',
					{ retryable: true, details: pageDecided() }
				);
			}
			const callId = context.traceId ?? `${record.instance}-call`;
			inFlight.set(callId, context);
			try {
				const result: unknown = await withDeadline(
					target.call(
						{
							callId,
							command: name,
							input,
							context: {
								traceId: callId,
								config,
								grants: [...granted],
								...(granted.has('clock') ? { now: readClock(context) } : {}),
								...(granted.has('random')
									? { randomSeed: Math.floor(readRandom(context) * 2 ** 32) }
									: {}),
							},
						},
						context.signal
					),
					HANDLER_CALL_TIMEOUT_MS
				);
				return isCommandResult(result) ? result : resultInvalid(name);
			} catch (cause) {
				if (cause instanceof FrameDeadline) {
					discard(target);
					return kernelFailure(
						'HANDLER_TIMEOUT',
						`The handler of '${name}' did not answer in time`,
						'The frame is discarded and re-created on the next call; retry',
						{ retryable: true, details: pageDecided() }
					);
				}
				return kernelFailure(
					'CALL_ABORTED',
					`The call of '${name}' did not finish: ${cause instanceof Error ? cause.message : String(cause)}`,
					'Retry the call',
					{ retryable: true, details: pageDecided() }
				);
			} finally {
				inFlight.delete(callId);
			}
		},
		dispose: () => discard(),
	};
}
