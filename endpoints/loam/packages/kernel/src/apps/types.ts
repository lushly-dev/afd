/**
 * @fileoverview What `apps/` is given by the kernel that loads it: a seam, so this chunk reaches the
 * registries, the journal and the shell state only through trusted functions (phase 1 specification,
 * 9.1).
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { ProjectionV4 } from '@lushly-dev/loam-manifest';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { AppCommandRowV1, CommandOwner } from '../apps-runtime.js';
import type { KernelCallFields } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { StoreOrderV1 } from '../journal-order.js';
import { appLayoutId } from '../layout.js';
import type { KernelLimits } from '../limits.js';
import type { OverlayStore } from '../overlays/store.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { ShellState } from '../shell-state.js';
import type { CallOptions, CommandSummary, KernelPorts } from '../types.js';
import type { StoreQuota } from './store.js';

export interface AppsHost {
	deployment: ProjectionV4;
	/** Absent when the host gave none: each app is then refused, and not the kernel. */
	ports?: KernelPorts;
	store: DataAdapter;
	/** Every command name the shell and `options.commands` hold. */
	taken: ReadonlySet<string>;
	state: ShellState;
	viewState: ViewStateRegistry;
	overlays: OverlayStore;
	owners(): ReadonlyMap<string, CommandOwner>;
	isMutation(name: string): boolean;
	/** The palette registry's commands of `instance`, which `loadApps` builds from `palette`. */
	commandRows(instance: string): AppCommandRowV1[];
	/** A discovery changed the apps' commands: build the registries again (7.3). */
	setCommands(commands: readonly ZodCommandDefinition[]): void;
	/**
	 * Run a command on the palette registry with fields set by trusted code. It joins the calls queued
	 * behind stage B, as a person's call does, unless it is nested (`fields.parent`) or `unqueued`, which
	 * only a handler's own follow-up may ask for: it would otherwise wait behind the call that made it.
	 */
	runAs<T>(
		name: string,
		input: unknown,
		options: CallOptions | undefined,
		fields: KernelCallFields,
		unqueued?: true
	): Promise<CommandResult<T>>;
	/**
	 * Run an app's call to another app's command on the `apps` registry (phase 5 specification, 9.1), queued as `runAs`
	 * is: AFD's `createAppCallRegistry`, which refuses it `CALL_NOT_GRANTED` before lookup unless the grant check admits
	 * it, marking `fields[ADMISSION]` when it does.
	 */
	runApps<T>(
		name: string,
		input: unknown,
		options: CallOptions | undefined,
		fields: KernelCallFields
	): Promise<CommandResult<T>>;
	clock(): number;
	/**
	 * The limits the kernel enforces from boot (phase 4 specification, section 11). `loadApps` makes its own with the
	 * defaults when none is given, so an app is never unbounded.
	 */
	limits?: KernelLimits;
	/**
	 * Whether two bindings' keys collide (phase 4 specification, 8.1): the kernel's `keysCollide`, given here so this
	 * chunk imports nothing of first paint (phase 3 specification, 13). Absent, only the same keys collide.
	 */
	keysCollide?(a: string, b: string): boolean;
	/**
	 * The experiments' gates (phase 4 specification, 5.3), from the `late-settings` chunk once it has loaded: whether an
	 * experiment is on for the person the shell is for, and whether an instance's app gate holds it out now. Absent, or
	 * before the chunk answers, every gate is closed and no app is held out, as nothing gated can be on yet.
	 */
	gate?: { open(experiment: string): boolean; gated(instance: string): boolean };
	/** The `store` grant's quota, one per runtime, which `loadApps` makes (section 11). */
	storeQuota?: StoreQuota;
	/** What a call's store operations tell the journal's order, by its trace ID and the instance (#1936). */
	storeOrder?(traceId: string, instance: string): StoreOrderV1;
	/**
	 * The kernel's scope state, read only: the active scope, for the chrome's port and its store (phase 2
	 * specification, 3.6 and 5), the project and workspace-app records a mounted instance is checked
	 * against (4.1, 9), and `decideAccess` on them.
	 */
	scope: Pick<
		ScopeRuntime,
		'active' | 'allows' | 'projects' | 'workspaceApps' | 'oversized' | 'callable' | 'opensIn'
	>;
}

/**
 * What the kernel gives `loadApps`: the host, with the palette registry's commands and their rows in
 * place of `commandRows`, which is built here so first paint does not hold it (phase 2 specification,
 * 2.4).
 */
export type AppsHostInput = Omit<AppsHost, 'commandRows'> & {
	palette(): {
		commands: ReadonlyArray<{ name: string; inputSchema: unknown; destructive?: boolean }>;
		rows: readonly CommandSummary[];
	};
};

/** What a frame's refused request answers with. */
export interface HandlerRefusal {
	code: LoamKernelErrorCode;
	rpcCode: number;
	message: string;
	suggestion: string;
}

/**
 * The names `state.registerAppLayout` keys an instance's layout records by: the instance, and
 * `<instance>@<project>` for each project's record stage A or a call registered (phase 2 specification,
 * 7.6). Read from the view-state registry, so first paint holds none of it.
 */
export function layoutNamesOf(host: Pick<AppsHost, 'viewState'>, instance: string): string[] {
	const own = appLayoutId(instance);
	const prefix = appLayoutId('');
	return [
		instance,
		...host.viewState
			.list()
			.map(({ id }) => id)
			.filter((id) => id.startsWith(`${own}@`))
			.map((id) => id.slice(prefix.length)),
	];
}
