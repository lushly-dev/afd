import type { CommandDefinition } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { createAfdDocsCommand } from './afd-docs.js';
import { createAfdHelpCommand } from './afd-help.js';
import { createAfdSchemaCommand } from './afd-schema.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

function makeMockCommands(): CommandDefinition[] {
	return [
		{
			name: 'todo-create',
			description: 'Create a todo',
			category: 'todos',
			tags: ['crud', 'write'],
			mutation: true,
			parameters: [
				{ name: 'title', type: 'string', description: 'Todo title', required: true },
				{ name: 'priority', type: 'string', description: 'Priority level', required: false },
			],
			handler: async () => success(null),
		},
		{
			name: 'todo-list',
			description: 'List todos',
			category: 'todos',
			tags: ['crud', 'read'],
			mutation: false,
			parameters: [],
			handler: async () => success([]),
		},
		{
			name: 'user-get',
			description: 'Get a user',
			category: 'users',
			tags: ['crud', 'read'],
			mutation: false,
			parameters: [{ name: 'id', type: 'number', description: 'User ID', required: true }],
			handler: async () => success(null),
		},
	];
}

// ═══════════════════════════════════════════════════════════════════════════════
// afd-help tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('createAfdHelpCommand', () => {
	it('creates command with correct metadata', () => {
		const cmd = createAfdHelpCommand(() => []);
		expect(cmd.name).toBe('afd-help');
		expect(cmd.category).toBe('bootstrap');
		expect(cmd.mutation).toBe(false);
	});

	it('lists all commands without filter', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'brief' });

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(3);
		expect(result.data?.filtered).toBe(false);
		expect(result.data?.commands).toHaveLength(3);
	});

	it('filters by tag', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ filter: 'write', format: 'brief' });

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(1);
		expect(result.data?.filtered).toBe(true);
		expect(result.data?.commands[0]?.name).toBe('todo-create');
	});

	it('filters by name', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ filter: 'user', format: 'brief' });

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(1);
		expect(result.data?.commands[0]?.name).toBe('user-get');
	});

	it('filters by category', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ filter: 'todos', format: 'brief' });

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(2);
	});

	it('brief format excludes extra fields', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'brief' });

		const info = result.data?.commands[0];
		expect(info?.name).toBeDefined();
		expect(info?.description).toBeDefined();
		expect(info?.category).toBeUndefined();
		expect(info?.tags).toBeUndefined();
	});

	it('full format includes extra fields', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'full' });

		const info = result.data?.commands[0];
		expect(info?.category).toBeDefined();
		expect(info?.tags).toBeDefined();
		expect(info?.mutation).toBeDefined();
	});

	it('groups commands by category', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'full' });

		const grouped = result.data?.groupedByCategory;
		expect(grouped).toBeDefined();
		expect(grouped?.todos).toHaveLength(2);
		expect(grouped?.users).toHaveLength(1);
	});

	it('uncategorized commands go to "uncategorized" group', async () => {
		const commands: CommandDefinition[] = [
			{
				name: 'no-cat',
				description: 'No category',
				parameters: [],
				handler: async () => success(null),
			},
		];
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'full' });

		expect(result.data?.groupedByCategory?.uncategorized).toHaveLength(1);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// afd-docs tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('createAfdDocsCommand', () => {
	it('creates command with correct metadata', () => {
		const cmd = createAfdDocsCommand(() => []);
		expect(cmd.name).toBe('afd-docs');
		expect(cmd.mutation).toBe(false);
	});

	it('generates docs for all commands', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({});

		expect(result.success).toBe(true);
		expect(result.data?.commandCount).toBe(3);
		expect(result.data?.markdown).toContain('# Command Documentation');
		expect(result.data?.markdown).toContain('`todo-create`');
		expect(result.data?.markdown).toContain('`user-get`');
	});

	it('generates docs for specific command', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({ command: 'todo-create' });

		expect(result.success).toBe(true);
		expect(result.data?.commandCount).toBe(1);
		expect(result.data?.markdown).toContain('`todo-create`');
		expect(result.data?.markdown).not.toContain('`user-get`');
	});

	it('returns empty docs for non-existent command', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({ command: 'nonexistent-cmd' });

		expect(result.success).toBe(true);
		expect(result.data?.commandCount).toBe(0);
		expect(result.data?.markdown).toBe('');
	});

	it('includes parameter table in markdown', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({ command: 'todo-create' });

		expect(result.data?.markdown).toContain('**Parameters:**');
		expect(result.data?.markdown).toContain('| title |');
		expect(result.data?.markdown).toContain('| Yes |');
	});

	it('includes tags in markdown', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({ command: 'todo-create' });

		expect(result.data?.markdown).toContain('**Tags:**');
		expect(result.data?.markdown).toContain('`crud`');
	});

	it('includes mutation info in markdown', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({ command: 'todo-create' });

		expect(result.data?.markdown).toContain('**Mutation:** Yes');
	});

	it('groups by category and sorts alphabetically', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({});

		const markdown = result.data?.markdown ?? '';
		// "todos" category should appear before "users" alphabetically
		const todosIdx = markdown.indexOf('## todos');
		const usersIdx = markdown.indexOf('## users');
		expect(todosIdx).toBeLessThan(usersIdx);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// afd-schema tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('createAfdSchemaCommand', () => {
	it('creates command with correct metadata', () => {
		const cmd = createAfdSchemaCommand(() => []);
		expect(cmd.name).toBe('afd-schema');
		expect(cmd.mutation).toBe(false);
	});

	it('exports schemas for all commands (json format)', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdSchemaCommand(() => commands);
		const result = await cmd.handler({ format: 'json' });

		expect(result.success).toBe(true);
		expect(result.data?.count).toBe(3);
		expect(result.data?.format).toBe('json');
		expect(result.data?.schemas).toHaveLength(3);
	});

	it('builds basic schema from parameters', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdSchemaCommand(() => commands);
		const result = await cmd.handler({ format: 'json' });

		const todoSchema = result.data?.schemas.find((s) => s.name === 'todo-create');
		expect(todoSchema?.inputSchema).toEqual({
			type: 'object',
			properties: {
				title: { type: 'string', description: 'Todo title' },
				priority: { type: 'string', description: 'Priority level' },
			},
			required: ['title'],
		});
	});

	it('uses getJsonSchema function when provided', async () => {
		const commands = makeMockCommands();
		const customSchema = { type: 'custom', fields: ['a', 'b'] };
		const cmd = createAfdSchemaCommand(
			() => commands,
			() => customSchema as unknown as Record<string, unknown>
		);
		const result = await cmd.handler({ format: 'json' });

		expect(result.data?.schemas[0]?.inputSchema).toEqual(customSchema);
	});

	it('typescript format returns schemas with note', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdSchemaCommand(() => commands);
		const result = await cmd.handler({ format: 'typescript' });

		expect(result.success).toBe(true);
		expect(result.data?.format).toBe('typescript');
		expect(result.confidence).toBe(0.8);
	});

	it('handles commands without parameters', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdSchemaCommand(() => commands);
		const result = await cmd.handler({ format: 'json' });

		const listSchema = result.data?.schemas.find((s) => s.name === 'todo-list');
		expect(listSchema?.inputSchema).toEqual({
			type: 'object',
			properties: {},
			required: [],
		});
	});
});
