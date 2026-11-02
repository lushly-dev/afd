/**
 * @fileoverview What the kernel knows of its apps, in the first-paint chunk (phase 1 specification,
 * 9.1). `apps/` implements it when a deployment lists an app, and it is imported dynamically, so the
 * empty shell loads neither the readers nor the validators, and holds only {@link EMPTY_APPS}.
 */

import { type CommandResult, success } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { kernelFailure, LoamKernelError } from './errors.js';
import type { AppKeybinding } from './keybindings.js';
import type {
	AppDetailV1,
	AppInstanceV1,
	AppPortV1,
	AppSummaryV1,
	CommandSummaryV1,
} from './types.js';

/** Who owns a command, for the context fields. */
export interface CommandOwner {
	app: string;
	instance: string;
}

/** One row of `app-command-list`. */
export type AppCommandRowV1 = CommandSummaryV1 & {
	inputSchema: unknown;
	destructive?: boolean;
	replay?: 'recorded';
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
	port(instance: string): AppPortV1;
	/** After hydration: close what a record persisted before its manifest dropped a part. */
	reconcileLayouts(): void;
	/** The mounted instances, for `startInstances`. */
	mountedInstances(): string[];
	summaries(): AppSummaryV1[];
	detail(instance: string): CommandResult<AppDetailV1>;
	open(instance: string): CommandResult<{ active: string | null; previous: string | null }>;
	close(): CommandResult<{ active: null; previous: string | null }>;
	commandList(instance: string): CommandResult<{ commands: AppCommandRowV1[]; hidden: number }>;
	instances(): AppInstanceV1[];
	/** `app-instance-refresh`: discovery arrives with step 7, so this answers why it cannot run. */
	refreshInstance(instance: string): Promise<CommandResult>;
	selection(instance: string): CommandResult<{ id: string | null }>;
	setSelection(instance: string, id: string | null): CommandResult<{ id: string | null }>;
	setStatusItem(
		caller: string | undefined,
		id: string,
		value: string
	): CommandResult<{ id: string; value: string }>;
	/** Forget each app's selection and status values, as a reload does. */
	resetSession(): void;
	/** Each handler frame closed. `deactivate` is the chrome's, since `activate` is (9.5). */
	dispose(): Promise<void>;
}

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
	mountedInstances: () => [],
	summaries: () => [],
	detail: unknownApp,
	open: unknownApp,
	close: () => success({ active: null, previous: null }),
	commandList: unknownApp,
	instances: () => [],
	refreshInstance: (instance: string) => Promise.resolve(unknownApp(instance)),
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
