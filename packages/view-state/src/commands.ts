import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
import type { ViewStateRegistry } from './registry.js';

const stateSchema = z.record(z.string(), z.unknown());

const viewStateEntrySchema = z.object({
	id: z.string(),
	state: stateSchema,
});

/**
 * Creates the 3 AFD commands for view state management.
 *
 * - `view-state-get` — read current state for a UI surface
 * - `view-state-set` — apply partial state (with undo support)
 * - `view-state-list` — list all registered view states
 */
export function createViewStateCommands(registry: ViewStateRegistry) {
	const viewStateGet = defineCommand({
		name: 'view-state-get',
		description: 'Get the current view state for a registered UI surface',
		category: 'view-state',
		mutation: false,
		executionTime: 'instant',
		input: z.object({
			id: z.string().describe('The registered view state ID'),
		}),
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

	const viewStateSet = defineCommand({
		name: 'view-state-set',
		description: 'Apply partial state to a registered UI surface',
		category: 'view-state',
		mutation: true,
		executionTime: 'instant',
		input: z.object({
			id: z.string().describe('The registered view state ID'),
			state: stateSchema.describe('Partial state to merge'),
		}),
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
			const previous = registry.set(input.id, input.state);
			const current = registry.get(input.id) ?? {};
			return success(
				{ id: input.id, state: current, previous },
				{
					reasoning: `Updated view state for "${input.id}"`,
					confidence: 1.0,
					undoCommand: 'view-state-set',
					undoArgs: { id: input.id, state: previous },
				}
			);
		},
	});

	const viewStateList = defineCommand({
		name: 'view-state-list',
		description: 'List all registered UI view states',
		category: 'view-state',
		mutation: false,
		executionTime: 'instant',
		input: z.object({}),
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
