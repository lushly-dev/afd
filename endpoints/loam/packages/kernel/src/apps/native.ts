/**
 * @fileoverview A native app's module: imported once through the port, its handlers checked against the
 * manifest, each called with an `AppCallContextV1` that holds only the grants (phase 1 specification,
 * 5.2, 5.3 and 5.5).
 */

import type { Actor, CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-core';
import {
	type AppCallContextV1,
	type AppDefinitionV1,
	type AppStoreV1,
	type LoamClientV1,
	projectsOver,
	type ScopeV1,
	settingsOver,
} from '@lushly-dev/loam-sdk';
import { kernelFailure, LoamKernelError } from '../errors.js';
import type { KernelPortsV1 } from '../types.js';
import { HANDLER_CALL_TIMEOUT_MS } from './handler-frame.js';
import type { AppRecord } from './operations.js';
import { createAppStore } from './store.js';
import {
	asError,
	handlerThrew,
	isCommandResult,
	markFailed,
	pageDecided,
	readClock,
	readRandom,
	resultInvalid,
	scopeOf,
} from './support.js';
import type { AppsHost } from './types.js';

/**
 * A native handler unanswered by then fails with `HANDLER_TIMEOUT`, releasing any document chain it holds
 * (#876; matches {@link HANDLER_CALL_TIMEOUT_MS} for view handlers).
 */
export const NATIVE_HANDLER_TIMEOUT_MS = HANDLER_CALL_TIMEOUT_MS;

class NativeDeadline extends Error {}

export interface NativeHostOptions {
	record: AppRecord;
	host: AppsHost;
	ports: KernelPortsV1;
	/** The entry's absolute URL, or undefined when it would leave the package. */
	entryUrl: string | undefined;
	config: Readonly<Record<string, unknown>>;
	granted: ReadonlySet<string>;
	commands: readonly string[];
	/** A handler's `context.client`: its calls carry `parent`, and the call's effective scope (3.2). */
	nestedClient(parent: string, scope: ScopeV1, actor: Actor | undefined): LoamClientV1;
}

export interface NativeHost {
	load(): Promise<AppDefinitionV1>;
	invoke(name: string, input: unknown, context: CommandContext): Promise<CommandResult>;
}

function handlerMismatch(
	definition: AppDefinitionV1,
	commands: readonly string[]
): string | undefined {
	const handlers = Object.keys(definition.handlers);
	const missing = commands.filter((name) => !handlers.includes(name));
	const extra = handlers.filter((name) => !commands.includes(name));
	if (missing.length === 0 && extra.length === 0) return undefined;
	const parts = [
		...(missing.length > 0 ? [`no handler for ${missing.join(', ')}`] : []),
		...(extra.length > 0 ? [`a handler with no command: ${extra.join(', ')}`] : []),
	];
	return `The module has ${parts.join(', and ')}`;
}

export function createNativeHost(options: NativeHostOptions): NativeHost {
	const { record, host, ports, entryUrl, config, granted, commands } = options;
	let loading: Promise<AppDefinitionV1> | undefined;

	async function importModule(): Promise<AppDefinitionV1> {
		if (entryUrl === undefined) {
			throw asError(
				markFailed(
					record,
					'APP_ACTIVATION_FAILED',
					'`native.entry` leaves the package',
					'Name a path inside the package; `loam app pack` checks it'
				)
			);
		}
		let definition: AppDefinitionV1;
		try {
			definition = await ports.importNative(entryUrl);
		} catch (cause) {
			// To the page's console and not the record, which `app-get` reports, and so journals (9.6).
			(globalThis as { reportError?: (error: unknown) => void }).reportError?.(cause);
			throw asError(
				markFailed(
					record,
					'APP_ACTIVATION_FAILED',
					"The app's module could not be imported; read the page's console for why",
					'Fix the app, and check that `native.entry` was built'
				)
			);
		}
		const mismatch =
			definition?.sdk === 1 &&
			typeof definition.handlers === 'object' &&
			definition.handlers !== null
				? handlerMismatch(definition, commands)
				: 'The module does not default-export `defineApp({ sdk: 1, handlers })`';
		if (mismatch !== undefined) {
			throw asError(
				markFailed(
					record,
					'APP_HANDLER_MISSING',
					mismatch,
					'Add the handler, or remove the command from the manifest'
				)
			);
		}
		return definition;
	}

	function callContext(
		name: string,
		context: CommandContext,
		signal: AbortSignal,
		isActive: () => boolean
	): AppCallContextV1 {
		const traceId = context.traceId ?? '';
		const scope = scopeOf(context);
		const expiredError = () =>
			new LoamKernelError({
				code: 'HANDLER_TIMEOUT',
				message: `The handler of '${name}' already timed out`,
				suggestion: 'Stop work when context.signal aborts',
				retryable: true,
			});
		const rawClient = options.nestedClient(traceId, scope, context.actor);
		const client: LoamClientV1 = {
			call(command, input, callOptions) {
				if (!isActive()) {
					return Promise.resolve(
						kernelFailure(
							'HANDLER_TIMEOUT',
							`The handler of '${name}' already timed out`,
							'Stop work when context.signal aborts',
							{ retryable: true, details: pageDecided() }
						)
					);
				}
				const callSignal = callOptions?.signal
					? AbortSignal.any([signal, callOptions.signal])
					: signal;
				return rawClient.call(command, input, { ...callOptions, signal: callSignal });
			},
		};
		const rawStore = granted.has('store')
			? createAppStore({
					adapter: host.store,
					quota: host.storeQuota,
					app: record.app,
					instance: record.instance,
					scope,
					readOnly: !host.isMutation(name),
					now: () => readClock(context),
					...(context.actor !== undefined ? { actor: context.actor } : {}),
					...(host.storeOrder ? { order: host.storeOrder(traceId, record.instance) } : {}),
					beforeCommit: () => {
						if (!isActive()) throw expiredError();
					},
				})
			: undefined;
		// After a handler times out and releases its document chain, late store operations must never run (#876).
		const store: AppStoreV1 | undefined = rawStore
			? {
					get: (key) => (isActive() ? rawStore.get(key) : Promise.reject(expiredError())),
					put: (key, value) =>
						isActive() ? rawStore.put(key, value) : Promise.reject(expiredError()),
					delete: (key) => (isActive() ? rawStore.delete(key) : Promise.reject(expiredError())),
					list: (prefix) => (isActive() ? rawStore.list(prefix) : Promise.reject(expiredError())),
				}
			: undefined;
		return {
			traceId,
			config,
			client,
			scope,
			signal,
			...(granted.has('projects') ? { projects: projectsOver(client, scope.project) } : {}),
			// The app's own sections, through `setting-get` and `setting-list` (phase 4 specification, 3.8).
			...(granted.has('settings') ? { settings: settingsOver(client) } : {}),
			...(context.actor !== undefined ? { actor: context.actor } : {}),
			...(granted.has('clock') ? { now: () => readClock(context) } : {}),
			...(granted.has('random') ? { random: () => readRandom(context) } : {}),
			...(store ? { store } : {}),
		};
	}

	const load = (): Promise<AppDefinitionV1> => {
		loading ??= importModule();
		return loading;
	};

	return {
		load,
		async invoke(name, input, context) {
			let definition: AppDefinitionV1;
			try {
				definition = await load();
			} catch (cause) {
				if (cause instanceof LoamKernelError) {
					return failure({
						code: cause.code,
						message: cause.message,
						suggestion: cause.suggestion,
						retryable: false,
						...(cause.code === 'APP_ACTIVATION_FAILED' ? { details: pageDecided() } : {}),
					});
				}
				throw cause;
			}
			const handler = definition.handlers[name] as (
				input: unknown,
				context: AppCallContextV1
			) => Promise<CommandResult>;
			const controller = new AbortController();
			const signal = context.signal
				? AbortSignal.any([context.signal, controller.signal])
				: controller.signal;
			let timedOut = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const call = Promise.resolve().then(() =>
				handler(
					input,
					callContext(name, context, signal, () => !timedOut)
				)
			);
			const deadline = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					timedOut = true;
					controller.abort();
					reject(new NativeDeadline());
				}, NATIVE_HANDLER_TIMEOUT_MS);
			});
			let result: unknown;
			try {
				result = await Promise.race([call, deadline]);
			} catch (cause) {
				if (cause instanceof NativeDeadline) {
					// Prevent an unhandled rejection if the timed-out handler later rejects.
					call.catch(() => {});
					return kernelFailure(
						'HANDLER_TIMEOUT',
						`The handler of '${name}' did not answer in time`,
						'Retry the call, and fix the native handler if it hangs',
						{ retryable: true, details: pageDecided() }
					);
				}
				// The kernel's own refusal, thrown into the handler by a grant (the store's `QUOTA_EXCEEDED`, phase 4's section
				// 11): answered as that refusal, its code and details, not as the handler's throw.
				if (cause instanceof LoamKernelError) {
					const { rpcCode: _rpc, ...details } = (cause.details ?? {}) as Record<string, unknown>;
					return failure({
						code: cause.code,
						message: cause.message,
						suggestion: cause.suggestion,
						retryable: cause.retryable === true,
						...(Object.keys(details).length > 0 ? { details } : {}),
					});
				}
				return handlerThrew(name, cause);
			} finally {
				clearTimeout(timer);
			}
			return isCommandResult(result) ? result : resultInvalid(name);
		},
	};
}
