/**
 * @fileoverview What the kernel knows of its apps, in the first-paint chunk (phase 1 specification,
 * 9.1). `apps/` implements it in stage B when a deployment lists an app, and it is imported dynamically,
 * so no first paint loads the readers or the validators (phase 2 specification, 2.2). Before then, and
 * when it cannot load, {@link bootApps} answers from the boot records.
 */

import {
	type CommandError,
	type CommandResult,
	type JournalRecord,
	success,
} from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { BootProjectionV2 } from '@lushly-dev/loam-manifest';
import type { KernelFieldContext } from './context-fields.js';
import { kernelFailure, LoamKernelError } from './errors.js';
import type { AppKeybinding } from './keybindings.js';
import type {
	AppDetailV1,
	AppInstanceV1,
	AppPortV2,
	AppSummaryV2,
	CommandSummaryV1,
	SelectionV2,
} from './types.js';

/** Who owns a command, for the context fields. */
export interface CommandOwner {
	app: string;
	instance: string;
	/** A mounted command: its call is recorded, and a replay does not reach the server (7.6). */
	recorded?: true;
}

/** One row of `app-command-list`. */
export type AppCommandRowV1 = CommandSummaryV1 & {
	inputSchema: unknown;
	destructive?: boolean;
	replay?: 'recorded';
	/** Reported by a mounted server. Displayed: enforcement is the server's own until phase 5 (7.4). */
	approval?: 'required';
};

/** What the app commands do, once `apps/` has loaded. */
export interface AppsRuntime {
	readonly commands: readonly ZodCommandDefinition[];
	readonly owners: ReadonlyMap<string, CommandOwner>;
	readonly keybindings: readonly AppKeybinding[];
	/**
	 * The port of `instance`.
	 *
	 * @throws LoamKernelError `APP_NOT_FOUND` or `APP_NOT_READY`
	 */
	port(instance: string): AppPortV2;
	/** The levels of the app owning `name`, or undefined for a command no app owns (phase 2 specification, 3.4). */
	scopeLevelsOf(name: string): ReadonlyArray<'workspace' | 'project'> | undefined;
	/** The input property `app.resource_keys` names for `name`, with its owner (3.5). */
	resourceKeyOf(name: string): { instance: string; property: string } | undefined;
	/** A change of scope clears every selection (4.3). */
	clearSelections(): void;
	/** After hydration: close what a record persisted before its manifest dropped a part. */
	reconcileLayouts(): void;
	/** The mounted instances, for `startInstances`. */
	mountedInstances(): string[];
	summaries(): AppSummaryV2[];
	/** `statusItems` answer for `project`, the call's scope, as `setStatusItem` keys them (7.6). */
	detail(instance: string, project?: string): CommandResult<AppDetailV1>;
	open(instance: string): CommandResult<{ active: string | null; previous: string | null }>;
	close(): CommandResult<{ active: null; previous: string | null }>;
	commandList(instance: string): CommandResult<{ commands: AppCommandRowV1[]; hidden: number }>;
	instances(): AppInstanceV1[];
	/** `app-instance-refresh`: a mounted instance's discovery, or why it cannot run. */
	refreshInstance(instance: string): Promise<CommandResult>;
	/**
	 * After `workspace-app-set` enabled `instance`: a mounted one's `app-instance-refresh`, nested in the
	 * call `parent`, or nothing (phase 2 specification, 4.1). Absent until stage B has loaded `apps/`.
	 */
	refreshEnabled?(instance: string, parent: string): Promise<unknown> | undefined;
	/** What a call of `name` carries in its context: who owns it, and whether it is recorded (7.6). */
	contextOf(name: string, input: unknown): KernelFieldContext;
	/** A journal entry as it is kept: a mounted server's result is bounded (7.6). */
	redact(record: JournalRecord): JournalRecord;
	/** Register a catalog a journal recorded, with no network. Only a replay has one. */
	applyCatalog(instance: string, catalog: unknown): void;
	/** The selected id in `project`'s scope, the call's, and the level it was made at (7.4). */
	selection(instance: string, project?: string): CommandResult<SelectionV2>;
	/** Refused for a level the app does not take, or `project` with no project in the call's scope. */
	setSelection(
		instance: string,
		id: string | null,
		level: SelectionV2['level'],
		project?: string
	): CommandResult<SelectionV2>;
	/** A value is per instance and scope: `project` is the call's, for an app that takes one (7.6). */
	setStatusItem(
		caller: string | undefined,
		id: string,
		value: string,
		project?: string
	): CommandResult<{ id: string; value: string }>;
	/** Forget each app's selection and status values, as a reload does. */
	resetSession(): void;
	/** Each handler frame closed. `deactivate` is the chrome's, since `activate` is (9.5). */
	dispose(): Promise<void>;
}

/** The rail's order: `order`, then the instance (phase 2 specification, 7.3). */
export const byOrder = (a: AppSummaryV2, b: AppSummaryV2): number =>
	a.order - b.order || (a.instance < b.instance ? -1 : 1);

/** The answer for an instance no deployment lists. */
export function unknownApp(instance: string): CommandResult<never> {
	return kernelFailure(
		'APP_NOT_FOUND',
		`No app instance '${instance}' is deployed`,
		'List the instances with app-list'
	);
}

/** No deployment, or one that lists no app. */
export const EMPTY_APPS: AppsRuntime = Object.freeze({
	commands: [],
	owners: new Map(),
	keybindings: [],
	port(instance: string): never {
		throw new LoamKernelError({
			code: 'APP_NOT_FOUND',
			message: `No app instance '${instance}' is deployed`,
			suggestion: 'List the instances with app-list',
		});
	},
	reconcileLayouts() {},
	scopeLevelsOf: () => undefined,
	resourceKeyOf: () => undefined,
	clearSelections() {},
	mountedInstances: () => [],
	summaries: () => [],
	detail: unknownApp,
	open: unknownApp,
	close: () => success({ active: null, previous: null }),
	commandList: unknownApp,
	instances: () => [],
	refreshInstance: (instance: string) => Promise.resolve(unknownApp(instance)),
	contextOf: () => ({}),
	redact: (record: JournalRecord) => record,
	applyCatalog() {},
	selection: unknownApp,
	setSelection: unknownApp,
	setStatusItem: () =>
		kernelFailure(
			'STATUS_ITEM_UNKNOWN',
			'No app is deployed, and only the app that declares a status item may set it',
			'Declare the item under `ui.surfaces.status.items`, and set it from that app'
		),
	resetSession() {},
	dispose: () => Promise.resolve(),
});

/** Why stage B could not read the apps: `APP_RUNTIME_UNAVAILABLE`, retryable, for a chunk that failed. */
export function runtimeUnavailable(reason: string): CommandError {
	return {
		code: 'APP_RUNTIME_UNAVAILABLE',
		message: `The app runtime could not load: ${reason}`,
		suggestion: 'Reload the page; if it persists, check that the deployment serves its assets',
		retryable: true,
	};
}

/** The reader refused `deployment.json` in stage B: the shell is on screen, so the rail says so (D66). */
export function deploymentRefused(message: string): CommandError {
	return {
		code: 'DEPLOYMENT_INVALID',
		message,
		suggestion: 'Run loam deployment write',
		retryable: false,
	};
}

/** How `bootApps` lists the entries. */
export interface BootAppsOptions {
	/** Every entry is `failed` with this, as stage B could not read the apps. */
	failure?: CommandError;
}

/**
 * What the kernel knows of its apps from their boot records alone (phase 2 specification, 2.2): before
 * stage B reads the manifests, or after it could not. In the first-paint chunk. Each entry is listed,
 * `refused` with its record's refusal or `loading`, or `failed` with `failure`. A record is display:
 * nothing here grants a command, a module or a surface. `port` answers `APP_NOT_READY`, retryable.
 * `detail`, `open` and `close` are answered only through late commands, so `late/boot-actions.ts` adds
 * them when stage B falls back to this.
 */
export function bootApps(boot: BootProjectionV2, options: BootAppsOptions = {}): AppsRuntime {
	const { failure } = options;
	const entries: AppSummaryV2[] = boot.apps
		.map((app): AppSummaryV2 => {
			const refusal =
				failure === undefined && app.refusal !== null
					? { ...app.refusal, retryable: false }
					: undefined;
			const error = failure ?? refusal;
			return {
				instance: app.instance,
				app: app.app,
				title: app.title,
				kind: app.kind,
				icon: app.icon,
				order: app.order,
				state: failure ? 'failed' : refusal ? 'refused' : 'loading',
				...(error !== undefined ? { error } : {}),
				scopeLevels: [...app.scopeLevels],
				rail: app.rail,
				// The kernel reads it against the active scope (phase 2 specification, 7.1).
				available: true,
			};
		})
		.sort(byOrder);
	return {
		...EMPTY_APPS,
		port(instance) {
			if (!entries.some((entry) => entry.instance === instance)) return EMPTY_APPS.port(instance);
			throw new LoamKernelError({
				code: 'APP_NOT_READY',
				message: `The app '${instance}' has not loaded`,
				suggestion: 'Ask again once the apps have loaded',
				retryable: failure === undefined,
			});
		},
		summaries: () => entries,
	};
}
