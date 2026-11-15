/**
 * @fileoverview Surface validation findings kept on purpose, each with its reason. Used by
 * `surface.test.ts` and by `dx/run-scenarios.ts` (`afd validate --surface --strict --suppress`).
 *
 * The single-id commands all take `{ id }`, and todo-restore takes the ids todo-delete-batch
 * removed, because it is its undo.
 */
export const SURFACE_SUPPRESSIONS = [
	'schema-overlap:todo-get:todo-toggle',
	'schema-overlap:todo-get:todo-delete',
	'schema-overlap:todo-toggle:todo-delete',
	'schema-overlap:todo-delete-batch:todo-restore',
] as const;
