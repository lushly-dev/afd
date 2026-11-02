/**
 * @fileoverview The app commands' definitions (phase 1 specification, 9.1), in the first-paint chunk:
 * they hold no reader, and {@link AppsRuntime} does the work. With no app deployed they answer an empty
 * list.
 */

import { type CommandContext, success } from '@lushly-dev/afd-core';
import { defineCommand, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { z } from 'zod';
import type { AppCommandRowV1, AppsRuntime } from './apps-runtime.js';
import type { KernelFieldContext } from './context-fields.js';
import type { ShellState } from './shell-state.js';
import type { AppDetailV1, AppInstanceV1, AppSummaryV1 } from './types.js';

export type { AppCommandRowV1 } from './apps-runtime.js';

const empty = z.strictObject({});
const instanceInput = z.strictObject({ instance: z.string().min(1).max(64) });
const selectionInput = z.strictObject({
	instance: z.string().min(1).max(64),
	id: z.string().max(256).nullable(),
});
const statusInput = z.strictObject({
	id: z.string().min(1).max(64),
	value: z.string().max(40),
});

export interface AppCommandDeps {
	apps(): AppsRuntime;
	state: ShellState;
}

export function createAppCommands(deps: AppCommandDeps): ZodCommandDefinition[] {
	const { state, apps } = deps;

	const appList = defineCommand<typeof empty, { active: string | null; apps: AppSummaryV1[] }>({
		name: 'app-list',
		description: 'List the deployed apps with their state, and which one is active',
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: empty,
		async handler() {
			return success({ active: state.activeApp(), apps: apps().summaries() });
		},
	});

	const appGet = defineCommand<typeof instanceInput, AppDetailV1>({
		name: 'app-get',
		description: "Get one app's state, trust line, surfaces, grants and notices",
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: instanceInput,
		handler: async (input) => apps().detail(input.instance),
	});

	const appOpen = defineCommand<
		typeof instanceInput,
		{ active: string | null; previous: string | null }
	>({
		name: 'app-open',
		title: 'Open an app',
		description: "Make an app active; the previous app's overlays close and its surfaces leave",
		category: 'app',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: instanceInput,
		handler: async (input) => apps().open(input.instance),
	});

	const appClose = defineCommand<typeof empty, { active: null; previous: string | null }>({
		name: 'app-close',
		title: 'Close the active app',
		description: 'Return to the shell with no app active',
		category: 'app',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: empty,
		handler: async () => apps().close(),
	});

	const appCommandList = defineCommand<
		typeof instanceInput,
		{ commands: AppCommandRowV1[]; hidden: number }
	>({
		name: 'app-command-list',
		description: "List one app's commands with their input schemas, and how many are hidden",
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: instanceInput,
		handler: async (input) => apps().commandList(input.instance),
	});

	const appInstanceList = defineCommand<typeof empty, { instances: AppInstanceV1[] }>({
		name: 'app-instance-list',
		description: 'List the mounted instances with their state; never a location or a credential',
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: empty,
		handler: async () => success({ instances: apps().instances() }),
	});

	const appInstanceRefresh = defineCommand<typeof instanceInput, unknown>({
		name: 'app-instance-refresh',
		title: 'Refresh a mounted instance',
		description: "Discover a mounted instance's commands again; its answer is recorded",
		category: 'app',
		mutation: true,
		executionTime: 'slow',
		input: instanceInput,
		handler: (input) => apps().refreshInstance(input.instance),
	});

	const appSelectionGet = defineCommand<typeof instanceInput, { id: string | null }>({
		name: 'app-selection-get',
		description: "Get an app's selected id, which leaving the app clears",
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: instanceInput,
		handler: async (input) => apps().selection(input.instance),
	});

	const appSelectionSet = defineCommand<typeof selectionInput, { id: string | null }>({
		name: 'app-selection-set',
		title: 'Select an item',
		description: "Set an app's selected id; main and the inspector follow it",
		category: 'app',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: selectionInput,
		handler: async (input) => apps().setSelection(input.instance, input.id),
	});

	const statusItemSet = defineCommand<typeof statusInput, { id: string; value: string }>({
		name: 'status-item-set',
		title: 'Set a status item',
		description: "Set the value of one of the calling app's status items",
		category: 'status',
		mutation: true,
		executionTime: 'instant',
		input: statusInput,
		handler: async (input, context: CommandContext) =>
			apps().setStatusItem((context as KernelFieldContext).caller, input.id, input.value),
	});

	return [
		appList,
		appGet,
		appOpen,
		appClose,
		appCommandList,
		appInstanceList,
		appInstanceRefresh,
		appSelectionGet,
		appSelectionSet,
		statusItemSet,
	] as unknown as ZodCommandDefinition[];
}
