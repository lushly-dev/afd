/**
 * @fileoverview A native app's module: imported once through the port, its handlers checked against the
 * manifest, each called with an `AppCallContextV1` that holds only the grants (phase 1 specification,
 * 5.2, 5.3 and 5.5).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-core';
import type { AppCallContextV1, AppDefinitionV1, LoamClientV1 } from '@lushly-dev/loam-sdk';
import { LoamKernelError } from '../errors.js';
import type { KernelPortsV1 } from '../types.js';
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
} from './support.js';
import type { AppsHost } from './types.js';

export interface NativeHostOptions {
	record: AppRecord;
	host: AppsHost;
	ports: KernelPortsV1;
	/** The entry's absolute URL, or undefined when it would leave the package. */
	entryUrl: string | undefined;
	config: Readonly<Record<string, unknown>>;
	granted: ReadonlySet<string>;
	commands: readonly string[];
	/** A handler's `context.client`: its calls carry `parent`. */
	nestedClient(parent: string): LoamClientV1;
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
			throw asError(
				markFailed(
					record,
					'APP_ACTIVATION_FAILED',
					`The app's module could not be imported: ${cause instanceof Error ? cause.message : String(cause)}`,
					'Read the error; fix the app, and check that `native.entry` was built'
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

	function callContext(context: CommandContext): AppCallContextV1 {
		const traceId = context.traceId ?? '';
		return {
			traceId,
			config,
			client: options.nestedClient(traceId),
			...(context.actor !== undefined ? { actor: context.actor } : {}),
			...(granted.has('clock') ? { now: () => readClock(context) } : {}),
			...(granted.has('random') ? { random: () => readRandom(context) } : {}),
			...(granted.has('store')
				? {
						store: createAppStore({
							adapter: host.store,
							app: record.app,
							instance: record.instance,
							now: () => readClock(context),
							...(context.actor !== undefined ? { actor: context.actor } : {}),
						}),
					}
				: {}),
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
			let result: unknown;
			try {
				result = await handler(input, callContext(context));
			} catch (cause) {
				return handlerThrew(name, cause);
			}
			return isCommandResult(result) ? result : resultInvalid(name);
		},
	};
}
