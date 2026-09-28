/**
 * Safety metadata (`destructive`, `confirmPrompt`, `undoable`) on `defineCommand`:
 * kept on the definition, through `toCommandDefinition()`, and on every surface that
 * reports it (spec/command-metadata.md).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAfdDocsCommand } from './bootstrap/afd-docs.js';
import { createAfdHelpCommand } from './bootstrap/afd-help.js';
import { createDirectRegistry } from './direct-registry.js';
import { executeDetail } from './lazy-tools.js';
import { defineCommand } from './schema.js';
import { getToolsList } from './tools.js';

const archive = defineCommand({
	name: 'todo-archive',
	description: 'Archive a todo',
	category: 'todo',
	mutation: true,
	destructive: true,
	confirmPrompt: 'Archive this todo?',
	undoable: true,
	expose: { mcp: true, agent: true },
	input: z.object({ id: z.string() }),
	handler: async () => ({ success: true as const, data: null }),
});

const list = defineCommand({
	name: 'todo-list',
	description: 'List todos',
	category: 'todo',
	expose: { mcp: true, agent: true },
	input: z.object({}),
	handler: async () => ({ success: true as const, data: [] }),
});

describe('defineCommand safety metadata', () => {
	it('keeps destructive, confirmPrompt and undoable on the definition', () => {
		expect(archive).toMatchObject({
			destructive: true,
			confirmPrompt: 'Archive this todo?',
			undoable: true,
		});
	});

	it('keeps destructive, confirmPrompt and undoable through toCommandDefinition()', () => {
		expect(archive.toCommandDefinition()).toMatchObject({
			destructive: true,
			confirmPrompt: 'Archive this todo?',
			undoable: true,
		});
	});

	it('keeps an explicit false', () => {
		const rename = defineCommand({
			name: 'todo-rename',
			description: 'Rename a todo',
			undoable: false,
			destructive: false,
			input: z.object({}),
			handler: async () => ({ success: true as const, data: null }),
		});
		expect(rename.toCommandDefinition()).toMatchObject({ destructive: false, undoable: false });
	});

	it('leaves unset fields undefined', () => {
		const def = list.toCommandDefinition();
		expect(def.destructive).toBeUndefined();
		expect(def.confirmPrompt).toBeUndefined();
		expect(def.undoable).toBeUndefined();
	});
});

describe('surfaces', () => {
	it('advertises undoable in the individual tool _meta, and omits it when unset', () => {
		const tools = getToolsList([archive, list], 'individual');
		expect(tools.find((t) => t.name === 'todo-archive')?._meta).toMatchObject({
			destructive: true,
			undoable: true,
		});
		expect(tools.find((t) => t.name === 'todo-list')?._meta).not.toHaveProperty('undoable');
	});

	it('advertises undoable in the grouped tool _meta.actions', () => {
		const [group] = getToolsList([archive, list], 'grouped').filter((t) => t.name === 'todo');
		const actions = group?._meta?.actions ?? [];
		expect(actions.find((a) => a.command === 'todo-archive')).toMatchObject({
			destructive: true,
			undoable: true,
		});
		expect(actions.find((a) => a.command === 'todo-list')).not.toHaveProperty('undoable');
	});

	it('does not put confirmPrompt in _meta; afd-detail carries it', () => {
		const tool = getToolsList([archive], 'individual').find((t) => t.name === 'todo-archive');
		expect(tool?._meta).not.toHaveProperty('confirmPrompt');
	});

	it('reports all three in afd-detail', () => {
		const result = executeDetail([archive, list], new Set(['todo-archive', 'todo-list']), {
			command: ['todo-archive', 'todo-list'],
		});
		const [archived, listed] = result.data ?? [];
		expect(archived).toMatchObject({
			destructive: true,
			confirmPrompt: 'Archive this todo?',
			undoable: true,
		});
		expect(JSON.parse(JSON.stringify(listed))).not.toHaveProperty('undoable');
	});

	it('reports destructive and undoable in afd-help full format only', async () => {
		const help = createAfdHelpCommand(() => [archive, list]);
		const full = await help.handler({ format: 'full' }, {});
		expect(full.data?.commands.find((c) => c.name === 'todo-archive')).toMatchObject({
			destructive: true,
			undoable: true,
		});
		const brief = await help.handler({ format: 'brief' }, {});
		expect(brief.data?.commands.find((c) => c.name === 'todo-archive')).not.toHaveProperty(
			'undoable'
		);
	});

	it('documents all three in afd-docs', async () => {
		const docs = createAfdDocsCommand(() => [archive, list]);
		const result = await docs.handler({ command: 'todo-archive' }, {});
		const markdown = result.data?.markdown ?? '';
		expect(markdown).toContain('**Destructive:** Yes');
		expect(markdown).toContain('**Confirmation prompt:** Archive this todo?');
		expect(markdown).toContain('**Undoable:** Yes');

		const listDocs = await docs.handler({ command: 'todo-list' }, {});
		expect(listDocs.data?.markdown).not.toContain('**Undoable:**');
	});

	it('lists undoable in DirectRegistry.listCommands()', () => {
		const registry = createDirectRegistry([archive, list]);
		expect(registry.listCommands().find((c) => c.name === 'todo-archive')).toMatchObject({
			destructive: true,
			undoable: true,
		});
	});
});
