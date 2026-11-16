/**
 * @fileoverview The view-state commands the person's page hosts, as the copilot calls them.
 *
 * View state is the page's: the list on screen follows the `todo-filter` view, which the page
 * serves with `view-state-get`, `-set` and `-list` through its own `createDirectRegistry`
 * (`@afd/example-todo-ui/view-state`). The copilot runs on the server, so its registry holds
 * stand-ins with the same names, schemas and metadata, whose handlers send the call to the page
 * that asked the question and return the page's own result. The model calls them like any other
 * command, through the same `allow`, validation and middleware.
 *
 * The page for the current turn is found through {@link pageHost}, which `Copilot.run` sets for
 * the length of a turn. With no page, a call fails with `PAGE_NOT_CONNECTED`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { type CommandResult, failure } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';

/** Runs a view-state command in the person's page and returns the page's result. */
export interface PageHost {
	run(
		command: string,
		input: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<CommandResult<unknown>>;
}

/** The page of the turn in progress, set by `Copilot.run`. */
export const pageHost = new AsyncLocalStorage<PageHost>();

/** The view the page's list follows, and the values it takes: for the model's instructions. */
export const PAGE_VIEW = {
	id: 'todo-filter',
	state: {
		status: ['all', 'pending', 'completed'],
		priority: ['all', 'low', 'medium', 'high'],
		search: 'text the title or description contains',
	},
} as const;

function isCommandResult(value: unknown): value is CommandResult<unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { success?: unknown }).success === 'boolean'
	);
}

/**
 * The page-hosted view-state commands: the view-state package's own definitions, with handlers
 * that run them in the page.
 */
export function createPageViewCommands(): ZodCommandDefinition[] {
	// The registry only gives the definitions their shape; the page holds the real one
	const definitions = createViewStateCommands(
		new ViewStateRegistry()
	) as unknown as ZodCommandDefinition[];
	return definitions.map(
		(definition): ZodCommandDefinition => ({
			...definition,
			description: `${definition.description}. Runs in the person's page, which shows the list as the ${PAGE_VIEW.id} view sets it`,
			async handler(input, context) {
				const page = pageHost.getStore();
				if (!page) {
					return failure({
						code: 'PAGE_NOT_CONNECTED',
						message: 'No page is open to show this in',
						suggestion:
							'Answer in the chat instead: the view changes only while the person has the page open',
					});
				}
				const result = await page.run(
					definition.name,
					(input ?? {}) as Record<string, unknown>,
					context?.signal
				);
				return isCommandResult(result)
					? result
					: failure({
							code: 'PAGE_BAD_RESULT',
							message: `The page answered ${definition.name} with something that is not a command result`,
							suggestion: 'Reload the page and ask again',
						});
			},
		})
	);
}
