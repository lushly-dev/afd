/**
 * The todo registry that recorded `spec/wire/journal.jsonl`, for the `afd replay` tests.
 *
 * The default export is a factory, so each replay starts from an empty todo list. It mirrors
 * `todoCommands()` in `packages/server/src/journal-wire.test.ts`. With
 * `AFD_REPLAY_FIXTURE_DRIFT=1` the create command titles todos in upper case, so the replay
 * diverges.
 */

import { failure, MemoryJournalSink, success } from '@lushly-dev/afd-core';
import { createJournalMiddleware, createMcpServer, defineCommand } from '@lushly-dev/afd-server';
import { z } from 'zod';

export default function createRegistry() {
	const drift = process.env.AFD_REPLAY_FIXTURE_DRIFT === '1';
	const todos = new Map();
	return createMcpServer({
		name: 'journal-fixture',
		version: '1.0.0',
		middleware: [createJournalMiddleware(new MemoryJournalSink(), { recordFailures: true })],
		// The fixture's declared context fields: `scope` is journaled, `locale` is not.
		contextFields: [
			{
				name: 'scope',
				meta: 'dev.example/scope',
				schema: z.object({ project: z.string() }),
				journal: true,
			},
			{ name: 'locale', meta: 'dev.example/locale', schema: z.string() },
		],
		commands: [
			defineCommand({
				name: 'todo-create',
				description: 'Create a todo',
				version: '1.0.0',
				mutation: true,
				input: z.object({ title: z.string() }),
				handler: async ({ title }, context) => {
					const id = `todo-${Math.floor((context?.random?.next() ?? 0) * 0x10000).toString(16)}`;
					const todo = {
						id,
						title: drift ? title.toUpperCase() : title,
						createdAt: new Date(context?.clock?.now() ?? 0).toISOString(),
					};
					todos.set(id, todo);
					return success(todo, { reasoning: `Created "${title}"`, confidence: 1 });
				},
			}),
			defineCommand({
				name: 'todo-get',
				description: 'Get a todo',
				version: '1.0.0',
				input: z.object({ id: z.string() }),
				handler: async ({ id }) => {
					const todo = todos.get(id);
					return todo
						? success(todo)
						: failure({
								code: 'NOT_FOUND',
								message: `Todo ${id} not found`,
								suggestion: 'Use todo-list to see the todo ids',
							});
				},
			}),
			defineCommand({
				name: 'todo-list',
				description: 'List todos',
				version: '1.0.0',
				input: z.object({}),
				handler: async () => success({ items: [...todos.values()], count: todos.size }),
			}),
			defineCommand({
				name: 'todo-scope',
				description: 'Report the declared scope the call carries',
				version: '1.0.0',
				input: z.object({}),
				handler: async (_input, context) => success({ project: context?.scope?.project ?? null }),
			}),
		],
	});
}
