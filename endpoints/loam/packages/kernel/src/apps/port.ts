/**
 * @fileoverview The app port (phase 1 specification, 5.3): the checks an app's call passes before it
 * reaches a registry, and what the chrome renders from. For a view these checks are a boundary (D54).
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ManifestV1 } from '@lushly-dev/loam-manifest';
import type { AppDefinitionV1, LoamClientV1 } from '@lushly-dev/loam-sdk';
import { LoamKernelError } from '../errors.js';
import {
	APP_CALLABLE_SHELL_COMMANDS_V1,
	type AppPortV1,
	type CallOptionsV1,
	type KernelPortsV1,
	type ViewBrokerV1,
} from '../types.js';
import type { AppRecord } from './operations.js';
import { createAppStore } from './store.js';
import type { AppsHost } from './types.js';

const CALLABLE: ReadonlySet<string> = new Set(APP_CALLABLE_SHELL_COMMANDS_V1);
const SCOPED_TO_CALLER: ReadonlySet<string> = new Set(['app-selection-get', 'app-selection-set']);

export interface AppPortOptions {
	record: AppRecord;
	manifest: ManifestV1;
	config: Readonly<Record<string, unknown>>;
	packageUrl: string;
	host: AppsHost;
	ports: KernelPortsV1;
	granted: ReadonlySet<string>;
	load(): Promise<AppDefinitionV1>;
	view?: ViewBrokerV1;
}

/** A path of the package as an absolute URL, or undefined when it would leave the package. */
export function packageFile(packageUrl: string, path: string): string | undefined {
	const url = new URL(path, packageUrl).href;
	return url.startsWith(packageUrl) ? url : undefined;
}

export function createAppPort(options: AppPortOptions): {
	port: AppPortV1;
	nestedClient(parent: string): LoamClientV1;
} {
	const { record, manifest, config, packageUrl, host, ports, granted } = options;
	const { instance } = record;

	function checkedCall<T>(
		name: unknown,
		input: unknown,
		callOptions: CallOptionsV1 | undefined,
		parent: string | undefined
	): Promise<CommandResult<T>> {
		const command = typeof name === 'string' ? name : String(name);
		const fields = { caller: instance, ...(parent !== undefined ? { parent } : {}) };
		const refuse = (internal: string): Promise<CommandResult<T>> =>
			host.runAs<T>(internal, { command: command.slice(0, 256) }, callOptions, fields);
		const own = host.owners().get(command)?.instance === instance;
		if (!own && !CALLABLE.has(command)) return refuse('app-call-refuse');
		if (
			SCOPED_TO_CALLER.has(command) &&
			(input as { instance?: unknown } | null | undefined)?.instance !== instance
		) {
			return refuse('app-call-refuse');
		}
		if (parent !== undefined && host.isMutation(command)) return refuse('app-nested-refuse');
		return host.runAs<T>(command, input, callOptions, fields);
	}

	const port: AppPortV1 = {
		instance,
		manifest,
		config,
		packageUrl,
		load: options.load,
		async readResource(uri) {
			const resource = manifest.ui?.resources?.find((candidate) => candidate.uri === uri);
			const path = resource?.path ?? (uri === manifest.view?.handlers ? uri : undefined);
			const url = path === undefined ? undefined : packageFile(packageUrl, path);
			const unavailable = (message: string) =>
				new LoamKernelError({
					code: 'VIEW_RESOURCE_UNAVAILABLE',
					message,
					suggestion: 'Declare it under `ui.resources`, and run `loam app pack`',
				});
			if (url === undefined) throw unavailable(`'${uri}' is not a resource of this app`);
			try {
				return await ports.fetchText(url);
			} catch {
				throw unavailable(`'${uri}' could not be read from the package`);
			}
		},
		reportActivationFailed(message) {
			record.state = 'failed';
			record.error = {
				code: 'APP_ACTIVATION_FAILED',
				message,
				suggestion: 'Read the error; fix the app',
				retryable: false,
			};
		},
		call: (name, input, callOptions) => checkedCall(name, input, callOptions, undefined),
		async waitOverlay(overlayId) {
			const held = host.overlays.whenClosed(overlayId);
			if (!held) {
				throw new LoamKernelError({
					code: 'OVERLAY_NOT_FOUND',
					message: `Overlay '${overlayId}' is not open`,
					suggestion: 'Wait on the overlayId that modal-open returned',
				});
			}
			if (held.owner !== instance) {
				throw new LoamKernelError({
					code: 'OVERLAY_NOT_OWNER',
					message: `Overlay '${overlayId}' belongs to another app`,
					suggestion: 'Wait only on overlays this app opened',
				});
			}
			return held.settled;
		},
		...(granted.has('store')
			? {
					store: createAppStore({
						adapter: host.store,
						app: record.app,
						instance,
						now: () => host.clock(),
					}),
				}
			: {}),
		...(options.view ? { view: options.view } : {}),
	};
	return {
		port,
		nestedClient: (parent) => ({
			call: (name, input, callOptions) => checkedCall(name, input, callOptions, parent),
		}),
	};
}
