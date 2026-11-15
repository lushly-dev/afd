/**
 * @fileoverview The change history: a middleware that records every todo change from its
 * result, for todo-history to read.
 *
 * Each entry says who made the change (the context's actor), when (the context's clock), which
 * todos it touched, and the undo the result named. Recording it from the result in middleware,
 * rather than in each handler, keeps the commands unaware of it and records exactly what a
 * caller was told. It is not the journal: the journal records whole sessions for replay.
 */

import { type CommandMiddleware, systemClock } from '@lushly-dev/afd-core';
import { actorFrom } from './commands/shared.js';
import { store } from './store/index.js';

type Data = Record<string, unknown>;

const ids = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

const idsOf = (todos: unknown): string[] =>
	Array.isArray(todos) ? ids(todos.map((todo) => (todo as Data | null)?.id)) : [];

/** The todos a successful change touched, read from its result; by command name. */
const CHANGED_IDS: Record<string, (data: Data) => string[]> = {
	'todo-create': (data) => ids([data.id]),
	'todo-update': (data) => ids([data.id]),
	'todo-toggle': (data) => ids([data.id]),
	'todo-delete': (data) => ids([data.id]),
	'todo-create-batch': (data) => idsOf(data.succeeded),
	'todo-toggle-batch': (data) => idsOf(data.succeeded),
	'todo-delete-batch': (data) => ids(data.deletedIds),
	'todo-restore': (data) => ids(data.restoredIds),
	'todo-clear': (data) => ids(data.clearedIds),
};

/** The commands whose successful results are recorded. */
export const RECORDED_COMMANDS = Object.keys(CHANGED_IDS);

/**
 * Record each successful todo change that touched at least one todo. Place it inside the
 * approval middleware, so a held call, which never runs, is never recorded.
 */
export function createHistoryMiddleware(): CommandMiddleware {
	return async (commandName, _input, context, next) => {
		const result = await next();
		const changed = CHANGED_IDS[commandName];
		if (!result.success || !changed || typeof result.data !== 'object' || result.data === null) {
			return result;
		}
		const touched = changed(result.data as Data);
		if (touched.length === 0) {
			return result;
		}
		store.record({
			at: new Date((context.clock ?? systemClock).now()).toISOString(),
			actor: actorFrom(context),
			command: commandName,
			ids: touched,
			...(result.undoCommand && { undoCommand: result.undoCommand }),
			...(result.undoArgs && { undoArgs: result.undoArgs }),
		});
		return result;
	};
}
