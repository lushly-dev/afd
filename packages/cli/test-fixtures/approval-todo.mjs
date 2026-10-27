/**
 * A registry with an approval-gated command, for the `afd call --module` approval tests.
 *
 * The default export is a factory, so each call starts from a fresh registry. The secret is a
 * fixed test value: a real application supplies its own and keeps it out of source.
 */

import { success } from '@lushly-dev/afd-core';
import { createApprovalMiddleware, createMcpServer, defineCommand } from '@lushly-dev/afd-server';
import { z } from 'zod';

export const deleted = [];

export default function createRegistry() {
	const commands = [
		defineCommand({
			name: 'todo-delete',
			description: 'Delete a todo',
			mutation: true,
			destructive: true,
			confirmPrompt: 'Delete the todo (permanent)',
			approval: 'required',
			input: z.object({ id: z.number() }),
			handler: async ({ id }) => {
				deleted.push(id);
				return success({ deleted: id });
			},
		}),
	];
	return createMcpServer({
		name: 'approval-fixture',
		version: '1.0.0',
		commands,
		middleware: [
			createApprovalMiddleware({ secret: 'approval-fixture-secret-0123456789abcdef', commands }),
		],
	});
}
