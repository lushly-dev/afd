/**
 * @fileoverview A store record's id and scope key (phase 2 specification, section 5; D77): one function
 * keys a record by scope. A module of its own, so `late/`'s resource check and `apps/`' store share it and
 * nothing else.
 */

import type { ScopeV1 } from './records.js';

/** Workspace level keeps phase 1's id, so a phase 1 store needs no migration (D77). */
export function storeRecordId(scope: ScopeV1, key: string): string {
	return scope.project === undefined ? key : `p~${scope.project}~${key}`;
}

/** The string `queryRows` filters a scope's rows on: `w`, or `p:<project>`. */
export const scopeKeyOf = (scope: ScopeV1): string =>
	scope.project === undefined ? 'w' : `p:${scope.project}`;

/** The project a row's id names, `p~<project>~<key>`, or undefined for a workspace row. */
export const rowProject = (id: string): string | undefined =>
	id.startsWith('p~') ? id.slice(2, id.indexOf('~', 2)) : undefined;
