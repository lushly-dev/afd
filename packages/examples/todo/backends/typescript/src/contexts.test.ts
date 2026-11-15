/**
 * @fileoverview The todo contexts scope what an agent can call.
 */

import { createDirectRegistry, createDirectToolSurface } from '@lushly-dev/afd-server';
import { describe, expect, it } from 'vitest';
import { allCommands } from './commands/index.js';
import { TODO_CONTEXTS } from './contexts.js';

const registry = createDirectRegistry(allCommands, {
	interface: 'mcp',
	contexts: TODO_CONTEXTS,
	tools: createDirectToolSurface(),
});

describe('todo contexts', () => {
	it('shows only the reading commands while reading', () => {
		const reading = registry
			.listTools({ activeContext: 'todo-reading' })
			.map((tool) => tool.name)
			.filter((name) => name.startsWith('todo-'))
			.sort();
		expect(reading).toEqual(['todo-get', 'todo-list', 'todo-stats']);
	});

	it('shows every command while editing and with no context', () => {
		for (const activeContext of ['todo-editing', undefined]) {
			const names = registry.listTools({ activeContext }).map((tool) => tool.name);
			for (const command of allCommands) {
				expect(names, `${command.name} in ${activeContext}`).toContain(command.name);
			}
		}
	});

	it('refuses a change while reading, with a way out', async () => {
		const refused = await registry.execute(
			'todo-create',
			{ title: 'Not now' },
			{},
			{ activeContext: 'todo-reading' }
		);
		expect(refused.success).toBe(false);
		expect(refused.error?.code).toBe('COMMAND_NOT_IN_CONTEXT');
		expect(refused.error?.suggestion).toBeTruthy();

		const read = await registry.execute('todo-stats', {}, {}, { activeContext: 'todo-reading' });
		expect(read.success).toBe(true);
	});
});
