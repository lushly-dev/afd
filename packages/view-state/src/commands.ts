/**
 * @fileoverview View-state AFD commands: `@lushly-dev/afd-view-state/commands`.
 *
 * Imports `defineCommand` from `@lushly-dev/afd-server/define`, which loads
 * neither the MCP SDK nor any Node.js builtin, so this module can run in the
 * browser next to the UI it controls.
 */

import {
	defineCommand,
	type ExposeOptions,
	failure,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import { z } from 'zod';
import type { ViewStateRegistry } from './registry.js';
import type { ViewStateEntry } from './types.js';

const stateSchema = z.record(z.string(), z.unknown());

const viewStateEntrySchema = z.object({
	id: z.string(),
	state: stateSchema,
});

const getInput = z.object({
	id: z.string().describe('The registered view state ID'),
});

const setInput = z.object({
	id: z.string().describe('The registered view state ID'),
	state: stateSchema.describe('Partial state to merge'),
	replace: z
		.boolean()
		.optional()
		.describe('Replace the complete state; requires a handler with replace support'),
});

const listInput = z.object({});

/** Data returned by `view-state-set`. */
export interface ViewStateSetResult {
	id: string;
	state: Record<string, unknown>;
	previous: Record<string, unknown>;
}

/** Data returned by `view-state-list`. */
export interface ViewStateListResult {
	states: ViewStateEntry[];
	total: number;
}

/** The `view-state-get` command. */
export type ViewStateGetCommand = ZodCommandDefinition<typeof getInput, ViewStateEntry>;
/** The `view-state-set` command. */
export type ViewStateSetCommand = ZodCommandDefinition<typeof setInput, ViewStateSetResult>;
/** The `view-state-list` command. */
export type ViewStateListCommand = ZodCommandDefinition<typeof listInput, ViewStateListResult>;

/**
 * The commands returned by {@link createViewStateCommands}, in a fixed order,
 * so callers can destructure them with their exact types:
 *
 * ```ts
 * const [viewStateGet, viewStateSet, viewStateList] = createViewStateCommands(registry);
 * ```
 *
 * It is still an array, so it can be passed or spread wherever a
 * `ZodCommandDefinition[]` is expected.
 */
export type ViewStateCommands = [
	viewStateGet: ViewStateGetCommand,
	viewStateSet: ViewStateSetCommand,
	viewStateList: ViewStateListCommand,
];

/** Options for {@link createViewStateCommands}. */
export interface ViewStateCommandsOptions {
	/**
	 * Interfaces the three commands are exposed to, set as each command's
	 * `expose`. Omitted, the commands keep `defaultExpose`: command palette and
	 * in-app agent, but not MCP or CLI. Pass `{ mcp: true }` to list them as
	 * MCP tools.
	 */
	expose?: ExposeOptions;
}

/**
 * Creates the 3 AFD commands for view state management.
 *
 * - `view-state-get` — read current state for a UI surface
 * - `view-state-set` — apply partial or complete state (with capability-aware undo)
 * - `view-state-list` — list all registered view states
 *
 * @example
 * ```ts
 * import { createMcpServer } from '@lushly-dev/afd-server';
 * import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';
 *
 * const commands = createViewStateCommands(registry, { expose: { mcp: true } });
 * createMcpServer({ name: 'my-app', version: '1.0.0', commands });
 * ```
 */
export function createViewStateCommands(
	registry: ViewStateRegistry,
	options: ViewStateCommandsOptions = {}
): ViewStateCommands {
	const { expose } = options;

	const viewStateGet = defineCommand<typeof getInput, ViewStateEntry>({
		name: 'view-state-get',
		description: 'Get the current view state for a registered UI surface',
		category: 'view-state',
		mutation: false,
		executionTime: 'instant',
		expose,
		input: getInput,
		output: viewStateEntrySchema,
		examples: [{ title: 'Get panel state', input: { id: 'design-panel' } }],

		async handler(input) {
			const state = registry.get(input.id);
			if (state === null) {
				return failure({
					code: 'VIEW_STATE_NOT_FOUND',
					message: `View state "${input.id}" is not registered`,
					suggestion: 'Use view-state-list to see all registered view states',
				});
			}
			return success(
				{ id: input.id, state },
				{
					reasoning: `Retrieved view state for "${input.id}"`,
					confidence: 1.0,
				}
			);
		},
	});

	const viewStateSet = defineCommand<typeof setInput, ViewStateSetResult>({
		name: 'view-state-set',
		description: 'Apply partial or complete state to a registered UI surface',
		category: 'view-state',
		mutation: true,
		executionTime: 'instant',
		expose,
		input: setInput,
		output: z.object({
			id: z.string(),
			state: stateSchema,
			previous: stateSchema,
		}),
		examples: [
			{
				title: 'Open a panel',
				input: { id: 'design-panel', state: { open: true } },
			},
			{
				title: 'Switch tab and resize',
				input: { id: 'design-panel', state: { tab: 'styles', width: 400 } },
			},
		],

		async handler(input) {
			if (!registry.has(input.id)) {
				return failure({
					code: 'VIEW_STATE_NOT_FOUND',
					message: `View state "${input.id}" is not registered`,
					suggestion: 'Use view-state-list to see all registered view states',
				});
			}
			if (input.replace && !registry.supportsReplace(input.id)) {
				return failure({
					code: 'VIEW_STATE_REPLACE_UNSUPPORTED',
					message: `View state "${input.id}" does not support complete replacement`,
					suggestion:
						'Register a replace(state) handler or omit replace to use partial state merging',
				});
			}

			const canUndo = registry.supportsReplace(input.id);
			const previous = input.replace
				? registry.replace(input.id, input.state)
				: registry.set(input.id, input.state);
			const current = registry.get(input.id) ?? {};
			return success(
				{ id: input.id, state: current, previous },
				{
					reasoning: `Updated view state for "${input.id}"`,
					confidence: 1.0,
					...(canUndo
						? {
								undoCommand: 'view-state-set',
								undoArgs: { id: input.id, state: previous, replace: true },
							}
						: {
								warnings: [
									{
										code: 'VIEW_STATE_UNDO_UNAVAILABLE',
										message:
											'Exact undo is unavailable because this handler only supports partial state merging',
										severity: 'warning' as const,
									},
								],
							}),
				}
			);
		},
	});

	const viewStateList = defineCommand<typeof listInput, ViewStateListResult>({
		name: 'view-state-list',
		description: 'List all registered UI view states',
		category: 'view-state',
		mutation: false,
		executionTime: 'instant',
		expose,
		input: listInput,
		output: z.object({
			states: z.array(viewStateEntrySchema),
			total: z.number(),
		}),
		examples: [{ title: 'List all states', input: {} }],

		async handler() {
			const states = registry.list();
			return success(
				{ states, total: states.length },
				{
					reasoning: `Found ${states.length} registered view state(s)`,
					confidence: 1.0,
				}
			);
		},
	});

	return [viewStateGet, viewStateSet, viewStateList];
}
