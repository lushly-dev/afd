/**
 * @fileoverview What the todo commands share: the stamp from the command context, who made a
 * change, and the not-found error that says where deleted todos are.
 */

import {
	type CommandContext,
	type CommandError,
	systemClock,
	systemRandom,
} from '@lushly-dev/afd-core';
import type { ChangeActor, Stamp } from '../types.js';

/**
 * The time and id source for a change, from the command context's clock and random (the
 * system's when a caller sets neither), so tests and replays control both.
 */
export function stampFrom(context?: CommandContext): Stamp {
	const clock = context?.clock ?? systemClock;
	const random = context?.random ?? systemRandom;
	const at = clock.now();
	return {
		now: new Date(at).toISOString(),
		newId: () =>
			`todo-${at}-${Math.floor(random.next() * 36 ** 7)
				.toString(36)
				.padStart(7, '0')}`,
	};
}

/** Who is calling, from `context.actor`; `unknown` when the surface set none. */
export function actorFrom(context?: CommandContext): ChangeActor {
	const actor = context?.actor;
	if (!actor) return { kind: 'unknown' };
	return { kind: actor.kind, ...(actor.id !== undefined && { id: actor.id }) };
}

/** How to find a todo that is not live: the list, or the deleted list and todo-restore. */
export const NOT_FOUND_SUGGESTION =
	'Use todo-list to see available todos. If it was deleted, find it with todo-list { deleted: true } and bring it back with todo-restore.';

/** The error for an id with no live todo. */
export function todoNotFound(id: string): CommandError {
	return {
		code: 'NOT_FOUND',
		message: `Todo with ID "${id}" not found`,
		suggestion: NOT_FOUND_SUGGESTION,
	};
}
