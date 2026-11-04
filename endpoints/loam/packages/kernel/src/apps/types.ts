/**
 * @fileoverview What `apps/` is given by the kernel that loads it: a seam, so this chunk reaches the
 * registries, the journal and the shell state only through trusted functions (phase 1 specification,
 * 9.1).
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import type { ProjectionV2 } from '@lushly-dev/loam-manifest';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { AppCommandRowV1, CommandOwner } from '../apps-runtime.js';
import type { KernelCallFields } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import { appLayoutId } from '../layout.js';
import type { OverlayStore } from '../overlays.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { ShellState } from '../shell-state.js';
import type { CallOptionsV1, CommandSummaryV1, KernelPortsV1 } from '../types.js';

export interface AppsHost {
	deployment: ProjectionV2;
	/** Absent when the host gave none: each app is then refused, and not the kernel. */
	ports?: KernelPortsV1;
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
		options: CallOptionsV1 | undefined,
		fields: KernelCallFields,
		unqueued?: true
	): Promise<CommandResult<T>>;
	clock(): number;
	/**
	 * The kernel's scope state, read only: the active scope, for the chrome's port and its store (phase 2
	 * specification, 3.6 and 5), the project and workspace-app records a mounted instance is checked
	 * against (4.1, 9), and `decideAccess` on them.
	 */
	scope: Pick<
		ScopeRuntime,
		'active' | 'actorKey' | 'allows' | 'projects' | 'workspaceApps' | 'oversized'
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
		rows: readonly CommandSummaryV1[];
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
