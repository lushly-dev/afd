/**
 * @fileoverview The app commands' definitions (phase 1 specification, 9.1), but `app-list`, which is a
 * boot command: they hold no reader, and {@link AppsRuntime} does the work. With no app deployed they
 * answer an empty list.
 */

import { type CommandContext, success } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	type JsonSchema,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import * as z from 'zod/mini';
import type { AppCommandRowV1, AppsRuntime } from '../apps-runtime.js';
import { EMPTY_INPUT_JSON, emptyInput } from '../boot-commands.js';
import type { KernelFieldContext } from '../context-fields.js';
import type { AppDetailV1, AppInstanceV1 } from '../types.js';

const instanceName = z.string().check(z.minLength(1), z.maxLength(64));
const instanceInput = z.strictObject({ instance: instanceName });
const selectionInput = z.strictObject({
	instance: instanceName,
	id: z.nullable(z.string().check(z.maxLength(256))),
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
}

export function createAppCommands(deps: AppCommandDeps): ZodCommandDefinition[] {
	const { apps } = deps;

	const appGet = defineCommandWithSchema<typeof instanceInput, AppDetailV1>({
		name: 'app-get',
		description: "Get one app's state, trust line, surfaces, grants and notices",
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: instanceInput,
		jsonSchema: INSTANCE_INPUT_JSON,
		handler: async (input) => apps().detail(input.instance),
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
		handler: async (input) => apps().open(input.instance),
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
		handler: async () => apps().close(),
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
		handler: async () => success({ instances: apps().instances() }),
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
		handler: (input) => apps().refreshInstance(input.instance),
	});

	const appSelectionGet = defineCommandWithSchema<typeof instanceInput, { id: string | null }>({
		name: 'app-selection-get',
		description: "Get an app's selected id, which leaving the app clears",
		category: 'app',
		mutation: false,
		executionTime: 'instant',
		input: instanceInput,
		jsonSchema: INSTANCE_INPUT_JSON,
		handler: async (input) => apps().selection(input.instance),
	});

	const appSelectionSet = defineCommandWithSchema<typeof selectionInput, { id: string | null }>({
		name: 'app-selection-set',
		title: 'Select an item',
		description: "Set an app's selected id; main and the inspector follow it",
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
			},
			required: ['instance', 'id'],
			additionalProperties: false,
		},
		handler: async (input) => apps().setSelection(input.instance, input.id),
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
		handler: async (input, context: CommandContext) =>
			apps().setStatusItem((context as KernelFieldContext).caller, input.id, input.value),
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
