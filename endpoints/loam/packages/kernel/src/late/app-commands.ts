/**
 * @fileoverview The app commands' definitions (phase 1 specification, 9.1), but `app-list`, which is a
 * boot command: they hold no reader, and {@link AppsRuntime} does the work. With no app deployed they
 * answer an empty list.
 */

import { type CommandContext, type CommandResult, success } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	type JsonSchema,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import * as z from 'zod/mini';
import type { AppCommandRowV1, AppsRuntime } from '../apps-runtime.js';
import { EMPTY_INPUT_JSON, emptyInput } from '../boot-commands.js';
import type { KernelFieldContext } from '../context-fields.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { ShellState } from '../shell-state.js';
import type { AppDetailV1, AppInstanceV1, SelectionV2 } from '../types.js';
import { canOpen, disabledRefusal, setMain } from './main-state.js';

const instanceName = z.string().check(z.minLength(1), z.maxLength(64));
const instanceInput = z.strictObject({ instance: instanceName });
const selectionInput = z.strictObject({
	instance: instanceName,
	id: z.nullable(z.string().check(z.maxLength(256))),
	level: z.optional(z.enum(['workspace', 'project'])),
});
const statusInput = z.strictObject({
	id: z.string().check(z.minLength(1), z.maxLength(64)),
	value: z.string().check(z.maxLength(40)),
});

const INSTANCE_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 64 };
const INSTANCE_INPUT_JSON: JsonSchema = {
	type: 'object',
	properties: { instance: INSTANCE_JSON },
	required: ['instance'],
	additionalProperties: false,
};

export interface AppCommandDeps {
	apps(): AppsRuntime;
	scope: ScopeRuntime;
	state: ShellState;
	viewState: ViewStateRegistry;
}

export function createAppCommands(deps: AppCommandDeps): ZodCommandDefinition[] {
	const { apps, scope } = deps;
	/** An instance's notices, with `APP_DISABLED` and its suggestion when the workspace disables it. */
	const noticesOf = (instance: string, notices: AppInstanceV1['notices']) => {
		const off = disabledRefusal(scope, instance)?.error;
		return off
			? [...notices, { code: off.code, message: `${off.message}. ${off.suggestion}.` }]
			: notices;
	};
	/**
	 * A change of what main shows moves the URL (phase 2 specification, 6.3). Every success reports
	 * `mainChanged`, so an app reopened from "Nothing here" brings the URL back to it; one that names the same
	 * place moves nothing.
	 */
	const moved = (
		result: CommandResult<{ active: string | null; previous: string | null }>,
		context: CommandContext
	) => {
		if (!result.success) return result;
		if (result.data?.active !== result.data?.previous) {
			setMain(deps.viewState, { section: null, path: '' });
		}
		scope.note(context.traceId, { mainChanged: 'push' });
		return result;
	};

	/**
	 * `app-close`: main with no app. At workspace level that is the landing, so an open section closes too,
	 * as Back to `/` asks; in a project it is the project's home, the projects section, which the project's
	 * URL names (4.3, 6.3). Closing a section with no app is undone by reopening it.
	 */
	const closed = (context: CommandContext) => {
		const before = deps.state.main();
		const result = apps().close();
		if (!result.success) return result;
		const section = scope.active().project === undefined ? null : 'projects';
		setMain(deps.viewState, { section, path: '' });
		scope.note(context.traceId, { mainChanged: 'push' });
		const reopen =
			result.undoCommand === undefined &&
			before.section !== null &&
			(before.section !== section || before.path !== '');
		return reopen
			? success(result.data, {
					undoCommand: 'section-open',
					undoArgs: { section: before.section, path: before.path },
				})
			: result;
	};

	const appGet = defineCommandWithSchema<typeof instanceInput, AppDetailV1>({
		name: 'app-get',
		description: "Get one app's state, trust line, surfaces, grants and notices",
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: instanceInput,
		jsonSchema: INSTANCE_INPUT_JSON,
		// The status values of the call's scope, the active one for a person (phase 2 specification, 7.6),
		// and a disabled instance's `APP_DISABLED` notice, as `app-instance-list` carries it (4.1).
		handler: async (input, context) => {
			const found = apps().detail(input.instance, (context as KernelFieldContext).scope?.project);
			return found.data
				? {
						...found,
						data: { ...found.data, notices: noticesOf(input.instance, found.data.notices) },
					}
				: found;
		},
	});

	const appOpen = defineCommandWithSchema<
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
		jsonSchema: INSTANCE_INPUT_JSON,
		async handler(input, context) {
			const { instance } = input;
			// A disabled app, or a dimmed entry: a project-only app with no project, or an instance that does
			// not list this project (phase 2 specification, 4.1, 7.1, 9.1).
			const refused = canOpen(apps(), scope, instance, scope.active().project);
			return refused ?? moved(apps().open(instance), context);
		},
	});

	const appClose = defineCommandWithSchema<
		typeof emptyInput,
		{ active: null; previous: string | null }
	>({
		name: 'app-close',
		title: 'Close the active app',
		description: 'Return to the shell with no app active',
		category: 'app',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		handler: async (_input, context) =>
			closed(context) as CommandResult<{ active: null; previous: string | null }>,
	});

	const appCommandList = defineCommandWithSchema<
		typeof instanceInput,
		{ commands: AppCommandRowV1[]; hidden: number }
	>({
		name: 'app-command-list',
		description: "List one app's commands with their input schemas, and how many are hidden",
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: instanceInput,
		jsonSchema: INSTANCE_INPUT_JSON,
		handler: async (input) => apps().commandList(input.instance),
	});

	const appInstanceList = defineCommandWithSchema<
		typeof emptyInput,
		{ instances: AppInstanceV1[] }
	>({
		name: 'app-instance-list',
		description: 'List the mounted instances with their state; never a location or a credential',
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		handler: async (_input, context) =>
			success({
				instances: apps()
					.instances()
					.map((row) => ({
						...row,
						// Disabled: never discovered, so its state stays as discovery left it, and the row says why
						// (4.1). `AppInstanceV1.state` is version 1's, so this is a notice and not a state.
						notices: noticesOf(row.instance, row.notices),
						// A listed slug of no project the caller may enter (9.1): one that does not exist yet and one
						// restricted to others look the same, so a non-member learns of no restricted project.
						warnings: [
							...row.warnings,
							...(scope.workspaceApps.get(row.instance)?.projects ?? [])
								.filter((slug) => {
									const project = scope.project(slug);
									return (
										!project ||
										!scope.allows(scope.actorKey(context), {
											workspace: scope.workspace.id,
											project: project.id,
										})
									);
								})
								.map((slug) => ({
									code: 'INSTANCE_PROJECT_UNKNOWN',
									message: `No project you can open has the slug \`${slug}\`, so this instance serves you none there`,
								})),
						],
					})),
			}),
	});

	const appInstanceRefresh = defineCommandWithSchema<typeof instanceInput, unknown>({
		name: 'app-instance-refresh',
		title: 'Refresh a mounted instance',
		description: "Discover a mounted instance's commands again; its answer is recorded",
		category: 'app',
		mutation: true,
		executionTime: 'slow',
		input: instanceInput,
		jsonSchema: INSTANCE_INPUT_JSON,
		// A disabled instance is not discovered until it is enabled (4.1).
		handler: async (input) =>
			disabledRefusal(scope, input.instance) ?? apps().refreshInstance(input.instance),
	});

	const appSelectionGet = defineCommandWithSchema<typeof instanceInput, SelectionV2>({
		name: 'app-selection-get',
		description: "Get an app's selected id and its level, which leaving the app clears",
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: instanceInput,
		jsonSchema: INSTANCE_INPUT_JSON,
		handler: async (input, context) =>
			apps().selection(input.instance, (context as KernelFieldContext).scope?.project),
	});

	const appSelectionSet = defineCommandWithSchema<typeof selectionInput, SelectionV2>({
		name: 'app-selection-set',
		title: 'Select an item',
		description:
			"Set an app's selected id, and the level it is at; main and the inspector follow it",
		category: 'app',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: selectionInput,
		jsonSchema: {
			type: 'object',
			properties: {
				instance: INSTANCE_JSON,
				id: { anyOf: [{ type: 'string', maxLength: 256 }, { type: 'null' }] } as JsonSchema,
				level: { type: 'string', enum: ['workspace', 'project'] },
			},
			required: ['instance', 'id'],
			additionalProperties: false,
		},
		// Left out, the level is the call's: a project's for an app that takes one (7.4).
		handler: async (input, context) => {
			const project = (context as KernelFieldContext).scope?.project;
			const takes = apps()
				.summaries()
				.find((app) => app.instance === input.instance)
				?.scopeLevels.includes('project');
			const level = input.level ?? (project !== undefined && takes ? 'project' : 'workspace');
			return apps().setSelection(input.instance, input.id, level, project);
		},
	});

	const statusItemSet = defineCommandWithSchema<typeof statusInput, { id: string; value: string }>({
		name: 'status-item-set',
		title: 'Set a status item',
		description: "Set the value of one of the calling app's status items",
		category: 'status',
		mutation: true,
		executionTime: 'instant',
		input: statusInput,
		jsonSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', minLength: 1, maxLength: 64 },
				value: { type: 'string', maxLength: 40 },
			},
			required: ['id', 'value'],
			additionalProperties: false,
		},
		handler: async (input, context: CommandContext) => {
			const { caller, scope: called } = context as KernelFieldContext;
			return apps().setStatusItem(caller, input.id, input.value, called?.project);
		},
	});

	return [
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
