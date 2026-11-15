/**
 * @fileoverview The todo server's contexts.
 *
 * With no context entered every command is visible. Entering `todo-reading` limits an agent to
 * the commands that read, so it can review the list without changing it; `todo-editing` shows
 * every command. Agents list, enter and leave them with `afd-context-list`, `afd-context-enter`
 * and `afd-context-exit`.
 */

import type { ContextConfig } from '@lushly-dev/afd-server';

export const TODO_CONTEXTS: ContextConfig[] = [
	{
		name: 'todo-reading',
		description: 'Review todos without changing them: list, get and stats only',
		triggers: ['review', 'summarize', 'report', 'what is left'],
	},
	{
		name: 'todo-editing',
		description: 'Add, change, complete and remove todos',
		triggers: ['add', 'create', 'complete', 'update', 'delete', 'clear'],
	},
];

/** Commands that only read, visible in both contexts. */
export const TODO_READ_CONTEXTS = ['todo-reading', 'todo-editing'];

/** Commands that change todos, hidden while reading. */
export const TODO_EDIT_CONTEXTS = ['todo-editing'];
