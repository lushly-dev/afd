/**
 * The `approval` policy on `defineCommand` (#272): kept on the definition, through
 * `toCommandDefinition()`, and reported where the other trust fields are
 * (spec/command-metadata.md). A function policy is reported as `'conditional'`.
 */

import { approvalMode, commandToMcpTool } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAfdDocsCommand } from './bootstrap/afd-docs.js';
import { executeDetail } from './lazy-tools.js';
import { defineCommand } from './schema.js';
import { getToolsList } from './tools.js';

const handler = async () => ({ success: true as const, data: null });
const expose = { mcp: true, agent: true };

const remove = defineCommand({
	name: 'todo-delete',
	description: 'Delete a todo',
	category: 'todo',
	mutation: true,
	approval: 'required',
	expose,
	input: z.object({ id: z.string() }),
	handler,
});

const assign = defineCommand({
	name: 'todo-assign',
	description: 'Assign a todo',
	category: 'todo',
	mutation: true,
	approval: (input, context) =>
		context.actor?.kind === 'agent' && input.owner !== 'me' ? 'required' : 'not-required',
	expose,
	input: z.object({ owner: z.string() }),
	handler,
});

const list = defineCommand({
	name: 'todo-list',
	description: 'List todos',
	category: 'todo',
	approval: 'not-required',
	expose,
	input: z.object({}),
	handler,
});

const count = defineCommand({
	name: 'todo-count',
	description: 'Count todos',
	category: 'todo',
	expose,
	input: z.object({}),
	handler,
});

const commands = [remove, assign, list, count];

describe('approval metadata', () => {
	it('keeps the policy on the definition and through toCommandDefinition()', () => {
		expect(remove.approval).toBe('required');
		expect(remove.toCommandDefinition().approval).toBe('required');
		expect(typeof assign.toCommandDefinition().approval).toBe('function');
		expect(count.toCommandDefinition().approval).toBeUndefined();
	});

	it('reports a function policy as conditional', () => {
		expect(approvalMode('required')).toBe('required');
		expect(approvalMode('not-required')).toBe('not-required');
		expect(approvalMode(() => 'required')).toBe('conditional');
		expect(approvalMode(undefined)).toBeUndefined();
	});

	it('advertises approval in the individual tool _meta, and omits it when unset', () => {
		const tools = getToolsList(commands, 'individual');
		const meta = (name: string) => tools.find((tool) => tool.name === name)?._meta;
		expect(meta('todo-delete')).toMatchObject({ approval: 'required' });
		expect(meta('todo-assign')).toMatchObject({ approval: 'conditional' });
		expect(meta('todo-list')).toMatchObject({ approval: 'not-required' });
		expect(meta('todo-count')).not.toHaveProperty('approval');
	});

	it('advertises approval in the grouped tool _meta.actions', () => {
		const [group] = getToolsList(commands, 'grouped').filter((tool) => tool.name === 'todo');
		const actions = group?._meta?.actions ?? [];
		expect(actions.find((a) => a.command === 'todo-delete')).toMatchObject({
			approval: 'required',
		});
		expect(actions.find((a) => a.command === 'todo-count')).not.toHaveProperty('approval');
	});

	it('advertises approval for core definitions too', () => {
		expect(commandToMcpTool(assign.toCommandDefinition())._meta).toMatchObject({
			approval: 'conditional',
		});
	});

	it('reports approval in afd-detail', () => {
		const names = commands.map((command) => command.name);
		const result = executeDetail(commands, new Set(names), { command: names });
		const [deleted, assigned, , counted] = result.data ?? [];
		expect(deleted).toMatchObject({ approval: 'required' });
		expect(assigned).toMatchObject({ approval: 'conditional' });
		expect(JSON.parse(JSON.stringify(counted))).not.toHaveProperty('approval');
	});

	it('documents approval in afd-docs', async () => {
		const docs = createAfdDocsCommand(() => commands);
		const deleted = await docs.handler({ command: 'todo-delete' }, {});
		expect(deleted.data?.markdown).toContain('**Approval:** required');
		const counted = await docs.handler({ command: 'todo-count' }, {});
		expect(counted.data?.markdown).not.toContain('**Approval:**');
	});
});
