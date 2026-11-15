/**
 * @fileoverview Who may decide: only a person with the steward's role. A volunteer, or an
 * agent acting for anyone (the steward included), is refused with `FORBIDDEN`.
 *
 * This is the application's authorization, in middleware. It is separate from the `approval`
 * on `loan-create`, which holds a loan of rare seed whoever asks.
 */

import type { Actor, CommandMiddleware } from '@lushly-dev/afd-core';
import { refuse } from './refusals.js';

/** The commands only a person with the steward's role may call, with the next step for anyone else. */
export const STEWARD_COMMANDS: Readonly<Record<string, string>> = {
	'variety-retire':
		'Ask the steward to retire it; variety-get shows the variety and its lots meanwhile',
	'request-decide': 'Ask the steward to decide it; request-list shows what waits for them',
	'request-reopen': 'Ask the steward to reopen it; request-list shows the request',
	'request-clear': 'Ask the steward to clear them; request-list shows the closed requests',
};

/**
 * Whether the actor holds the steward's role: a person whose id is one of `stewardIds`. The
 * test actor of the scenario runner stands for the steward, so the scenarios can run the
 * steward's jobs.
 */
export function isSteward(actor: Actor | undefined, stewardIds: readonly string[]): boolean {
	if (!actor) return false;
	if (actor.kind === 'test') return true;
	return actor.kind === 'human' && actor.id !== undefined && stewardIds.includes(actor.id);
}

export function createStewardMiddleware(stewardIds: readonly string[]): CommandMiddleware {
	return async (commandName, _input, context, next) => {
		const suggestion = STEWARD_COMMANDS[commandName];
		if (suggestion === undefined || isSteward(context.actor, stewardIds)) return next();
		const kind = context.actor?.kind ?? 'unknown';
		return refuse(
			'FORBIDDEN',
			kind === 'human'
				? `Only a person with the steward's role may call ${commandName}`
				: `Only a person with the steward's role may call ${commandName}; an agent may not, even for the steward`,
			suggestion,
			{ command: commandName, actorKind: kind }
		);
	};
}
