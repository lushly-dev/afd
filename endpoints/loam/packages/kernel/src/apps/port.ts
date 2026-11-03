/**
 * @fileoverview The app port (phase 1 specification, 5.3) and a surface's own port (phase 2
 * specification, 3.6; D83): the checks an app's call passes before it reaches a registry, and what the
 * chrome renders from. For a view these checks are a boundary (D54), so they are in one place,
 * {@link createAppPort}'s `checkedCall`, which every path of an app's call goes through.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import type { AppDefinitionV1, LoamClientV1, ScopeV1 } from '@lushly-dev/loam-sdk';
import { BOOT_ONLY } from '../commands.js';
import type { KernelCallFields } from '../context-fields.js';
import { LoamKernelError } from '../errors.js';
import {
	APP_CALLABLE_SHELL_COMMANDS_V1,
	type AppPortV2,
	type CallOptionsV1,
	type KernelPortsV1,
	type SurfaceOptionsV2,
	type SurfacePortV2,
	type ViewBrokerV1,
} from '../types.js';
import type { AppRecord } from './operations.js';
import { createAppStore } from './store.js';
import type { AppsHost } from './types.js';

/** Shell commands that act on the calling instance alone: an app may name only itself in them. */
const SCOPED_TO_CALLER: ReadonlySet<string> = new Set([
	'app-selection-get',
	'app-selection-set',
	'app-route-set',
]);

/**
 * What an app may call besides its own commands (phase 2 specification, 11.2): phase 1's nine,
 * `scope-get` and `app-route-set` always, and `project-list` and `project-get` with `projects`. Anything
 * else is `CALL_NOT_GRANTED`.
 */
export function appCallable(grants: ReadonlySet<string>): ReadonlySet<string> {
	return new Set<string>([
		...APP_CALLABLE_SHELL_COMMANDS_V1,
		'scope-get',
		'app-route-set',
		...(grants.has('projects') ? ['project-list', 'project-get'] : []),
	]);
}

/** A call's options as an app may give them: a signal, and `level: 'workspace'`, the only widening. */
export type AppCallOptions = CallOptionsV1 & { level?: unknown; scope?: unknown };

export interface AppPortOptions {
	record: AppRecord;
	manifest: ManifestV2;
	config: Readonly<Record<string, unknown>>;
	packageUrl: string;
	host: AppsHost;
	ports: KernelPortsV1;
	granted: ReadonlySet<string>;
	load(): Promise<AppDefinitionV1>;
	/** A view's broker, closed over one caller's `call`: the port's, or a surface's (3.6). */
	view?(call: LoamClientV1['call'], readResource: (uri: string) => Promise<string>): ViewBrokerV1;
}

/**
 * How long a view may not open a modal after a person closes one (9.7). A view that reopens at once would
 * otherwise hold the whole shell inert, across a reload too, since its app is reopened (D66).
 */
export const VIEW_MODAL_COOLDOWN_MS = 5_000;

/**
 * A path of the package as an absolute URL, or undefined when it would leave the package. `%` and `\\`
 * are refused, since what a server makes of `..%2f` is its own affair, and no URL here can check that.
 */
export function packageFile(packageUrl: string, path: string): string | undefined {
	if (/[%\\]/.test(path)) return undefined;
	const url = new URL(path, packageUrl).href;
	return url.startsWith(packageUrl) ? url : undefined;
}

/** Where a call is bound, and what it may not do (3.6). */
interface Binding {
	/** A surface's scope, or a handler's effective scope. Absent: the active scope, for the chrome's port. */
	scope?: ScopeV1;
	/** An embed: every mutation is refused. */
	readOnly?: boolean;
	/** The outer call's trace ID, for a handler's nested call. */
	parent?: string;
}

export function createAppPort(options: AppPortOptions): {
	port: AppPortV2;
	nestedClient(parent: string, scope: ScopeV1): LoamClientV1;
} {
	const { record, manifest, config, packageUrl, host, ports, granted } = options;
	const { instance } = record;
	const callable = appCallable(granted);
	let modalRefusedUntil = 0;

	/** A view's `modal-open`: a person who closes one gets time to leave before the next. */
	async function viewModal<T>(run: () => Promise<CommandResult<T>>): Promise<CommandResult<T>> {
		const opened = await run();
		const overlayId = (opened.data as { overlayId?: string } | undefined)?.overlayId;
		const held = overlayId === undefined ? undefined : host.overlays.whenClosed(overlayId);
		void held?.settled.then(({ reason }) => {
			if (reason === 'user') modalRefusedUntil = host.clock() + VIEW_MODAL_COOLDOWN_MS;
		});
		return opened;
	}

	/**
	 * Every check an app's call passes, in order, for every path: the chrome's port, a surface's port and a
	 * handler's nested client (phase 1 specification, 5.3; phase 2 specification, 3.6). Each refusal runs
	 * an internal command, so it is journaled.
	 *
	 * 1. A scope the app names: only `level: 'workspace'` widens, anything else is `SCOPE_NOT_GRANTED`.
	 * 2. A boot-only command answers as a name that does not exist, `COMMAND_NOT_FOUND`.
	 * 3. Neither its own nor callable with its grants: `CALL_NOT_GRANTED`.
	 * 4. A command that names an instance, naming another: `CALL_NOT_GRANTED`.
	 * 5. A handler's nested mutation: `NESTED_MUTATION_REFUSED`.
	 * 6. An embed's mutation: `EMBED_READ_ONLY`.
	 * 7. A view's modal within the cooldown: `OVERLAY_COOLDOWN`.
	 *
	 * It then runs bound to the surface's scope, the handler's, or the active scope, and the scope
	 * middleware's own lines follow (3.4).
	 */
	function checkedCall<T>(
		name: unknown,
		input: unknown,
		callOptions: AppCallOptions | undefined,
		binding: Binding
	): Promise<CommandResult<T>> {
		const command = typeof name === 'string' ? name : String(name);
		const { level, scope: _scope, ...rest } = callOptions ?? {};
		const bound = binding.scope ?? host.activeScope();
		const fields: KernelCallFields = {
			caller: instance,
			...(binding.parent !== undefined ? { parent: binding.parent } : {}),
			...(binding.scope !== undefined || level !== undefined
				? { scope: level === 'workspace' ? { workspace: bound.workspace } : bound }
				: {}),
		};
		const refuse = (internal: string): Promise<CommandResult<T>> =>
			host.runAs<T>(internal, { command: command.slice(0, 256) }, rest, fields);
		if (
			(callOptions !== undefined && 'scope' in callOptions) ||
			(level !== undefined && level !== 'workspace')
		) {
			return refuse('app-scope-refuse');
		}
		if (BOOT_ONLY.includes(command)) return host.runAs<T>(command, input, rest, fields);
		const own = host.owners().get(command)?.instance === instance;
		if (!own && !callable.has(command)) return refuse('app-call-refuse');
		if (
			SCOPED_TO_CALLER.has(command) &&
			(input as { instance?: unknown } | null | undefined)?.instance !== instance
		) {
			return refuse('app-call-refuse');
		}
		if (binding.parent !== undefined && host.isMutation(command))
			return refuse('app-nested-refuse');
		if (binding.readOnly && host.isMutation(command)) return refuse('app-embed-refuse');
		if (record.kind === 'view' && command === 'modal-open') {
			if (host.clock() < modalRefusedUntil) return refuse('app-modal-refuse');
			return viewModal(() => host.runAs<T>(command, input, rest, fields));
		}
		return host.runAs<T>(command, input, rest, fields);
	}

	async function readResource(uri: string): Promise<string> {
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
	}

	const call: LoamClientV1['call'] = (name, input, callOptions) =>
		checkedCall(name, input, callOptions, {});

	const port: AppPortV2 = {
		instance,
		manifest,
		config,
		packageUrl,
		load: options.load,
		readResource,
		reportActivationFailed(message) {
			record.state = 'failed';
			record.error = {
				code: 'APP_ACTIVATION_FAILED',
				message,
				suggestion: 'Read the error; fix the app',
				retryable: false,
			};
		},
		call,
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
		surface(surfaceOptions: SurfaceOptionsV2): SurfacePortV2 {
			// Copied, so a caller that keeps the object cannot move the surface afterwards.
			const scope: ScopeV1 = {
				workspace: surfaceOptions.scope.workspace,
				...(surfaceOptions.scope.project !== undefined
					? { project: surfaceOptions.scope.project }
					: {}),
			};
			const readOnly = surfaceOptions.readOnly === true;
			const surfaceCall: SurfacePortV2['call'] = (name, input, callOptions) =>
				checkedCall(name, input, callOptions, { scope, readOnly });
			return Object.freeze({
				scope,
				readOnly,
				call: surfaceCall,
				...(options.view ? { view: options.view(surfaceCall, readResource) } : {}),
			});
		},
		...(granted.has('store')
			? {
					store: createAppStore({
						adapter: host.store,
						app: record.app,
						instance,
						scope: () => host.activeScope(),
						now: () => host.clock(),
					}),
				}
			: {}),
		...(options.view ? { view: options.view(call, readResource) } : {}),
	};
	return {
		port,
		nestedClient: (parent, scope) => ({
			call: (name, input, callOptions) => checkedCall(name, input, callOptions, { parent, scope }),
		}),
	};
}
