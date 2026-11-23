/**
 * @fileoverview The app port (phase 1 specification, 5.3) and a surface's own port (phase 2
 * specification, 3.6; D83): the checks an app's call passes before it reaches a registry, and what the
 * chrome renders from. For a view these checks are a boundary (D54), so they are in one place,
 * {@link createAppPort}'s `checkedCall`, which every path of an app's call goes through.
 */

import { type Actor, type CommandResult, failure } from '@lushly-dev/afd-core';
import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import type { AppDefinitionV1, LoamClientV1, OverlayResultV1, ScopeV1 } from '@lushly-dev/loam-sdk';
import { mountCallGranted } from '../call-grant.js';
import { BOOT_ONLY } from '../commands.js';
import type { KernelCallFields } from '../context-fields.js';
import { LoamKernelError } from '../errors.js';
import { measureJson } from '../limits.js';
import {
	APP_CALLABLE_SHELL_COMMANDS_BASE,
	type AppPort,
	type CallOptions,
	type KernelPorts,
	type SurfaceOptions,
	type SurfacePort,
	type ViewBroker,
} from '../types.js';
import { takeCall } from './call-rate.js';
import type { AppRecord } from './operations.js';
import { createAppStore } from './store.js';
import type { AppsHost } from './types.js';

/** Shell commands that act on the calling instance alone: an app may name only itself in them. */
const SCOPED_TO_CALLER: ReadonlySet<string> = new Set([
	'app-selection-get',
	'app-selection-set',
	'app-route-set',
]);

/** A call's options as an app may give them: a signal, and `level: 'workspace'`, the only widening. */
export type AppCallOptions = CallOptions & { level?: unknown; scope?: unknown };

export interface AppPortOptions {
	record: AppRecord;
	manifest: ManifestV2;
	config: Readonly<Record<string, unknown>>;
	packageUrl: string;
	host: AppsHost;
	ports: KernelPorts;
	granted: ReadonlySet<string>;
	load(): Promise<AppDefinitionV1>;
	/** A view's broker, closed over one caller's `call`: the port's, or a surface's (3.6). */
	/** `scope`, the surface's: a linked call's result reaches it only from a call in that scope. */
	view?(
		call: LoamClientV1['call'],
		readResource: (uri: string) => Promise<string>,
		scope?: ScopeV1,
		waitOverlay?: (overlayId: string) => Promise<OverlayResultV1>
	): ViewBroker;
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
	/** The outer call's actor, for a handler's nested call (phase 3 specification, 3.1). */
	actor?: Actor;
}

export function createAppPort(options: AppPortOptions): {
	port: AppPort;
	nestedClient(parent: string, scope: ScopeV1, actor: Actor | undefined): LoamClientV1;
} {
	const { record, manifest, config, packageUrl, host, ports, granted } = options;
	const { instance } = record;
	// `late/`'s list, which loads before any app (phase 2 specification, 11.2); with none, nothing is callable.
	const callable =
		host.scope.callable?.(granted, APP_CALLABLE_SHELL_COMMANDS_BASE) ?? new Set<string>();
	/**
	 * A mounted instance's command this app's `calls` grant names (phase 5 specification, 7.5; D30, D152): both the
	 * grant and `[[calls]]` naming it by the callee's app, and the callee's entry setting its `expose.apps`. Read at each
	 * call, since a mounted catalog is discovered after the port is made. Native callees wait for milestone B.
	 */
	const grantedMount = (command: string): boolean =>
		mountCallGranted(host.owners().get(command), command, instance, granted, manifest.calls);
	let modalRefusedUntil = 0;
	/**
	 * Set while this view's `modal-open` is in flight or the modal it opened is open, and cleared when both
	 * are done. A view's modal waits for it (7).
	 */
	let modalHeld: Promise<void> | undefined;

	/**
	 * Every check an app's call passes, in order, for every path: the chrome's port, a surface's port and a
	 * handler's nested client (phase 1 specification, 5.3; phase 2 specification, 3.6). Each refusal but
	 * the second runs an internal command, so it is journaled.
	 *
	 * 1. A scope the app names: only `level: 'workspace'` widens, anything else is `SCOPE_NOT_GRANTED`.
	 * 2. A boot-only command answers, here, as a name that does not exist, `COMMAND_NOT_FOUND`.
	 * 3. Neither its own nor callable with its grants, nor a mounted command its `calls` grant names that the
	 *    callee's entry exposes to apps (phase 5 specification, 7.5): `CALL_NOT_GRANTED`.
	 * 4. A command that names an instance, naming another: `CALL_NOT_GRANTED`.
	 * 5. A handler's nested mutation: `NESTED_MUTATION_REFUSED`.
	 * 6. An embed's mutation: `EMBED_READ_ONLY`.
	 * 7. A view's modal within the cooldown, checked once its earlier modal has closed: `OVERLAY_COOLDOWN`.
	 *
	 * Before all of them, the limits the port enforces (phase 4 specification, section 11): the instance's call rate,
	 * `RATE_LIMITED`, every call taking its place whatever answers it; then its input, over `inputBytes` of JSON,
	 * `INPUT_TOO_LARGE`. Each through `app-limit-refuse`, so it is journaled and counted for `limit-usage-get`.
	 *
	 * It then runs bound to the surface's scope, the handler's, or the active scope; a workspace-only app's
	 * call always at the workspace. The scope middleware's own lines follow (3.4).
	 */
	function checkedCall<T>(
		name: unknown,
		given: unknown,
		callOptions: AppCallOptions | undefined,
		binding: Binding
	): Promise<CommandResult<T>> {
		const command = typeof name === 'string' ? name : String(name);
		const { level, scope: _scope, ...rest } = callOptions ?? {};
		const bound = binding.scope ?? host.scope.active();
		// A workspace-only app runs at the workspace whatever is active, so it learns no project, even of
		// the shell's commands, as `scope-get` (phase 2 specification, 4.3).
		const wide = level === 'workspace' || !record.scopeLevels.includes('project');
		const fields: KernelCallFields = {
			caller: instance,
			...(binding.parent !== undefined ? { parent: binding.parent } : {}),
			...(binding.actor !== undefined ? { actor: binding.actor } : {}),
			...(binding.scope !== undefined || wide
				? { scope: wide ? { workspace: bound.workspace } : bound }
				: {}),
		};
		const refuse = (internal: string): Promise<CommandResult<T>> =>
			host.runAs<T>(internal, { command: command.slice(0, 256) }, rest, fields);
		const limits = host.limits;
		const refuseLimit = (
			limit: 'inputBytes' | 'callsPerSecond',
			bound: number,
			extra: { retryAfterMs?: number; reason?: 'json' } = {}
		): Promise<CommandResult<T>> =>
			host.runAs<T>(
				'app-limit-refuse',
				{ command: command.slice(0, 256), limit, bound, ...extra },
				rest,
				fields
			);
		let input = given;
		if (limits) {
			const { callsPerSecond, inputBytes } = limits.values();
			// The check and its count in one step, with no await between them (section 11).
			const wait = takeCall(limits, instance, host.clock());
			if (wait !== undefined)
				return refuseLimit('callsPerSecond', callsPerSecond, { retryAfterMs: wait });
			// One detached JSON copy, measured and then dispatched, so what was measured is what runs; a value with no JSON
			// form is over every limit (the trust review's R2).
			const measured = measureJson(given, inputBytes);
			if (measured.unserializable) return refuseLimit('inputBytes', inputBytes, { reason: 'json' });
			if (measured.over) return refuseLimit('inputBytes', inputBytes);
			input = measured.json === undefined ? undefined : JSON.parse(measured.json);
		}
		if (
			(callOptions !== undefined && 'scope' in callOptions) ||
			(level !== undefined && level !== 'workspace')
		) {
			return refuse('app-scope-refuse');
		}
		// Answered here, as a name that does not exist: never forwarded, whatever registered it since (2.2).
		if (BOOT_ONLY.includes(command)) {
			return Promise.resolve(
				failure({
					code: 'COMMAND_NOT_FOUND',
					message: `Command '${command}' not found`,
					suggestion: 'Use afd-discover to list all commands.',
				})
			);
		}
		const own = host.owners().get(command)?.instance === instance;
		if (!own && !callable.has(command) && !grantedMount(command)) return refuse('app-call-refuse');
		if (
			SCOPED_TO_CALLER.has(command) &&
			(input as { instance?: unknown } | null | undefined)?.instance !== instance
		) {
			return refuse('app-call-refuse');
		}
		if (binding.parent !== undefined && host.isMutation(command))
			return refuse('app-nested-refuse');
		if (binding.readOnly && host.isMutation(command)) return refuse('app-embed-refuse');
		if (record.kind === 'view' && (command === 'modal-open' || command === 'prompt-open')) {
			// One at a time, and none while the view's modal is open, so the cooldown is checked once that
			// modal has closed. Checked only on arrival, a call sent while it was open could reach the kernel
			// just after a person closed it, and open the next before the cooldown began (#1054).
			return (async () => {
				// A change of person, or a reload, while it waits ends it: it never opens for the next person (the review's 3).
				const person = host.overlays.people();
				while (modalHeld) await modalHeld;
				if (host.overlays.people() !== person) {
					return failure({
						code: 'SESSION_CHANGED',
						message: 'The person changed while this question waited, so it was not opened',
						suggestion: 'Ask again if the new person should answer it',
						retryable: false,
					}) as CommandResult<T>;
				}
				if (host.clock() < modalRefusedUntil) return refuse('app-modal-refuse');
				const opened = host.runAs<T>(command, input, rest, fields);
				modalHeld = opened
					.then(
						async (result) => {
							// A refusal opened nothing, and no overlay has the id `undefined`.
							const closed = await host.overlays.whenClosed(
								(result.data as { overlayId: string } | undefined)?.overlayId as string
							)?.settled;
							// A person's close: the cooldown begins before any waiting call checks it. An agent's or the app's
							// own cancel is no person's, so it starts none (the re-check of phase 4's step 4).
							const id = (result.data as { overlayId: string } | undefined)?.overlayId as string;
							if (closed?.reason === 'user' && host.overlays.closedByPerson(id))
								modalRefusedUntil = host.clock() + VIEW_MODAL_COOLDOWN_MS;
						},
						() => {}
					)
					// A call that threw holds nothing either: it answered its own caller, and those waiting run theirs.
					.finally(() => {
						modalHeld = undefined;
					});
				return opened;
			})();
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

	const port: AppPort = {
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
			if (held.owner.kind !== 'app' || held.owner.id !== instance) {
				throw new LoamKernelError({
					code: 'OVERLAY_NOT_OWNER',
					message: `Overlay '${overlayId}' belongs to another app`,
					suggestion: 'Wait only on overlays this app opened',
				});
			}
			return held.settled;
		},
		surface(surfaceOptions: SurfaceOptions): SurfacePort {
			// Copied, so a caller that keeps the object cannot move the surface afterwards.
			const scope: ScopeV1 = {
				workspace: surfaceOptions.scope.workspace,
				...(surfaceOptions.scope.project !== undefined
					? { project: surfaceOptions.scope.project }
					: {}),
			};
			const readOnly = surfaceOptions.readOnly === true;
			const surfaceCall: SurfacePort['call'] = (name, input, callOptions) =>
				checkedCall(name, input, callOptions, { scope, readOnly });
			return Object.freeze({
				scope,
				readOnly,
				call: surfaceCall,
				...(options.view
					? {
							view: options.view(surfaceCall, readResource, scope, (overlayId) =>
								port.waitOverlay(overlayId)
							),
						}
					: {}),
			});
		},
		...(granted.has('store')
			? {
					store: createAppStore({
						adapter: host.store,
						quota: host.storeQuota,
						app: record.app,
						instance,
						// The active scope at each operation; a workspace-only app's is the workspace, as its calls'.
						scope: () => {
							const active = host.scope.active();
							return record.scopeLevels.includes('project')
								? active
								: { workspace: active.workspace };
						},
						now: () => host.clock(),
					}),
				}
			: {}),
		// The port's own broker, unbound: it hears no linked call, and only tests use it (T4).
		...(options.view ? { view: options.view(call, readResource) } : {}),
	};
	return {
		port,
		nestedClient: (parent, scope, actor) => ({
			call: (name, input, callOptions) =>
				checkedCall(name, input, callOptions, { parent, scope, ...(actor ? { actor } : {}) }),
		}),
	};
}
