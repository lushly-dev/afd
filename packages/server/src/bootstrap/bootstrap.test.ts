import type { CommandDefinition } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from '../schema.js';
import { createContextState } from './afd-context.js';
import { createAfdDocsCommand } from './afd-docs.js';
import { createAfdHelpCommand } from './afd-help.js';
import { createAfdSchemaCommand } from './afd-schema.js';
import { getBootstrapCommands } from './registry.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

function makeMockCommands(): CommandDefinition[] {
	return [
		{
			name: 'todo-create',
			expose: { mcp: true },
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
			expose: { mcp: true },
			description: 'List todos',
			category: 'todos',
			tags: ['crud', 'read'],
			mutation: false,
			parameters: [],
			handler: async () => success([]),
		},
		{
			name: 'user-get',
			expose: { mcp: true },
			description: 'Get a user',
			category: 'users',
			tags: ['crud', 'read'],
			mutation: false,
			parameters: [{ name: 'id', type: 'number', description: 'User ID', required: true }],
			handler: async () => success(null),
		},
		{
			name: 'todo-stats',
			expose: { mcp: true },
			description: 'Get todo statistics',
			category: 'todos',
			tags: ['crud', 'read'],
			mutation: false,
			requires: ['todo-list'],
			parameters: [],
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
		const result = await cmd.handler({ format: 'brief' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(4);
		expect(result.data?.filtered).toBe(false);
		expect(result.data?.commands).toHaveLength(4);
	});

	it('filters by tag', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ filter: 'write', format: 'brief' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(1);
		expect(result.data?.filtered).toBe(true);
		expect(result.data?.commands[0]?.name).toBe('todo-create');
	});

	it('filters by name', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ filter: 'user', format: 'brief' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(1);
		expect(result.data?.commands[0]?.name).toBe('user-get');
	});

	it('filters by category', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ filter: 'todos', format: 'brief' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.total).toBe(3);
	});

	it('brief format excludes extra fields', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'brief' }, {});

		const info = result.data?.commands[0];
		expect(info?.name).toBeDefined();
		expect(info?.description).toBeDefined();
		expect(info?.category).toBeUndefined();
		expect(info?.tags).toBeUndefined();
	});

	it('full format includes extra fields', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'full' }, {});

		const info = result.data?.commands[0];
		expect(info?.category).toBeDefined();
		expect(info?.tags).toBeDefined();
		expect(info?.mutation).toBeDefined();
	});

	it('groups commands by category', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'full' }, {});

		const grouped = result.data?.groupedByCategory;
		expect(grouped).toBeDefined();
		expect(grouped?.todos).toHaveLength(3);
		expect(grouped?.users).toHaveLength(1);
	});

	it('full format includes requires', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'full' }, {});

		const statsCmd = result.data?.commands.find((c) => c.name === 'todo-stats');
		expect(statsCmd?.requires).toEqual(['todo-list']);
	});

	it('brief format includes requires when present', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'brief' }, {});

		const statsCmd = result.data?.commands.find((c) => c.name === 'todo-stats');
		expect(statsCmd?.requires).toEqual(['todo-list']);
	});

	it('brief format omits requires when absent', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'brief' }, {});

		const listCmd = result.data?.commands.find((c) => c.name === 'todo-list');
		expect(listCmd?.requires).toBeUndefined();
	});

	it('uncategorized commands go to "uncategorized" group', async () => {
		const commands: CommandDefinition[] = [
			{
				name: 'no-cat',
				expose: { mcp: true },
				description: 'No category',
				parameters: [],
				handler: async () => success(null),
			},
		];
		const cmd = createAfdHelpCommand(() => commands);
		const result = await cmd.handler({ format: 'full' }, {});

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
		const result = await cmd.handler({}, {});

		expect(result.success).toBe(true);
		expect(result.data?.commandCount).toBe(4);
		expect(result.data?.markdown).toContain('# Command Documentation');
		expect(result.data?.markdown).toContain('`todo-create`');
		expect(result.data?.markdown).toContain('`user-get`');
	});

	it('generates docs for specific command', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({ command: 'todo-create' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.commandCount).toBe(1);
		expect(result.data?.markdown).toContain('`todo-create`');
		expect(result.data?.markdown).not.toContain('`user-get`');
	});

	it('returns empty docs for non-existent command', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({ command: 'nonexistent-cmd' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.commandCount).toBe(0);
		expect(result.data?.markdown).toBe('');
	});

	it('includes parameter table in markdown', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({ command: 'todo-create' }, {});

		expect(result.data?.markdown).toContain('**Parameters:**');
		expect(result.data?.markdown).toContain('| title |');
		expect(result.data?.markdown).toContain('| Yes |');
	});

	it('includes tags in markdown', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({ command: 'todo-create' }, {});

		expect(result.data?.markdown).toContain('**Tags:**');
		expect(result.data?.markdown).toContain('`crud`');
	});

	it('includes mutation info in markdown', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({ command: 'todo-create' }, {});

		expect(result.data?.markdown).toContain('**Mutation:** Yes');
	});

	it('groups by category and sorts alphabetically', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdDocsCommand(() => commands);
		const result = await cmd.handler({}, {});

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
		const result = await cmd.handler({ format: 'json' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.count).toBe(4);
		expect(result.data?.format).toBe('json');
		expect(result.data?.schemas).toHaveLength(4);
	});

	it('builds basic schema from parameters', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdSchemaCommand(() => commands);
		const result = await cmd.handler({ format: 'json' }, {});

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
		const result = await cmd.handler({ format: 'json' }, {});

		expect(result.data?.schemas[0]?.inputSchema).toEqual(customSchema);
	});

	it('typescript format adds generated input types', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdSchemaCommand(() => commands);
		const result = await cmd.handler({ format: 'typescript' }, {});

		expect(result.success).toBe(true);
		expect(result.data?.format).toBe('typescript');
		expect(result.confidence).toBe(1);
		expect(result.data?.schemas).toHaveLength(4);
		const source = result.data?.typescript ?? '';
		expect(source).toContain('export type TodoCreateInput = {');
		expect(source).toContain('\t/** Todo title */\n\ttitle: string;');
		expect(source).toContain('\tpriority?: string;');
		expect(source).toContain('export type TodoListInput = Record<string, never>;');
		expect(source).toContain('\tid: number;');
	});

	it('json format has no typescript output', async () => {
		const cmd = createAfdSchemaCommand(() => makeMockCommands());
		const result = await cmd.handler({ format: 'json' }, {});
		expect(result.data?.typescript).toBeUndefined();
	});

	it('handles commands without parameters', async () => {
		const commands = makeMockCommands();
		const cmd = createAfdSchemaCommand(() => commands);
		const result = await cmd.handler({ format: 'json' }, {});

		const listSchema = result.data?.schemas.find((s) => s.name === 'todo-list');
		expect(listSchema?.inputSchema).toEqual({
			type: 'object',
			properties: {},
			required: [],
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Exposure, Zod definitions and getBootstrapCommands
// ═══════════════════════════════════════════════════════════════════════════════

describe('bootstrap tools describe only MCP-exposed commands', () => {
	const hidden: CommandDefinition = {
		name: 'secret-reset',
		description: 'Private',
		expose: { mcp: false },
		parameters: [],
		handler: async () => success(null),
	};
	const implicit: CommandDefinition = {
		name: 'implicit-reset',
		description: 'Default exposure',
		parameters: [],
		handler: async () => success(null),
	};
	const getCommands = () => [...makeMockCommands(), hidden, implicit];

	it('afd-help, afd-docs and afd-schema skip unexposed commands', async () => {
		const help = await createAfdHelpCommand(getCommands).handler({ format: 'full' }, {});
		const docs = await createAfdDocsCommand(getCommands).handler({}, {});
		const schema = await createAfdSchemaCommand(getCommands).handler({ format: 'json' }, {});
		for (const result of [help, docs, schema]) {
			expect(JSON.stringify(result.data)).not.toContain('reset');
		}
		expect(help.data?.total).toBe(4);
		expect(docs.data?.commandCount).toBe(4);
		expect(schema.data?.count).toBe(4);
		const direct = await createAfdDocsCommand(getCommands).handler({ command: 'secret-reset' }, {});
		expect(direct.data).toEqual({ markdown: '', commandCount: 0 });
	});
});

describe('bootstrap tools built with defineCommand', () => {
	const search = defineCommand({
		name: 'item-search',
		description: 'Search items',
		expose: { mcp: true },
		requires: ['auth-sign-in'],
		input: z.object({
			query: z.string().describe('Search text'),
			limit: z.number().int().default(20).describe('Max results'),
		}),
		handler: async () => success([]),
	});

	it('have Zod input schemas, JSON schemas and MCP exposure', () => {
		for (const cmd of getBootstrapCommands(() => [search])) {
			expect(cmd.expose).toEqual({ mcp: true });
			expect(cmd.inputSchema.safeParse({}).success).toBe(true);
			expect(cmd.jsonSchema.type).toBe('object');
			expect(cmd.jsonSchema.required).toBeUndefined();
		}
		const names = getBootstrapCommands(() => []).map((cmd) => cmd.name);
		expect(names).toEqual(['afd-help', 'afd-docs', 'afd-schema']);
	});

	it('describe ZodCommandDefinitions: requires, parameters from jsonSchema, schemas', async () => {
		const [help, docs, schema] = getBootstrapCommands(() => [search]);
		const helpResult = await help?.handler({ format: 'brief' }, {});
		expect(helpResult?.data).toMatchObject({
			commands: [{ name: 'item-search', requires: ['auth-sign-in'] }],
		});
		const markdown = (await docs?.handler({}, {}))?.data as { markdown: string };
		expect(markdown.markdown).toContain('| query | string | Yes | Search text |');
		expect(markdown.markdown).toContain('| limit | integer | No | Max results |');
		const exported = (await schema?.handler({ format: 'typescript' }, {}))?.data as {
			schemas: Array<{ inputSchema: unknown }>;
			typescript: string;
		};
		expect(exported.schemas[0]?.inputSchema).toEqual(search.jsonSchema);
		expect(exported.typescript).toContain('\t/** Max results */\n\tlimit?: number;');
	});

	it('uses getJsonSchema when provided', async () => {
		const [, , schema] = getBootstrapCommands(() => [search], {
			getJsonSchema: (cmd) => ({ custom: cmd.name }),
		});
		const result = (await schema?.handler({ format: 'json' }, {}))?.data as {
			schemas: Array<{ inputSchema: unknown }>;
		};
		expect(result.schemas[0]?.inputSchema).toEqual({ custom: 'item-search' });
	});

	it('pass each invocation context to getCommands', async () => {
		const seen: unknown[] = [];
		const cmds = getBootstrapCommands((context) => {
			seen.push(context?.traceId);
			return [search];
		});
		for (const [index, cmd] of cmds.entries()) {
			await cmd.handler(cmd.inputSchema.parse({}), { traceId: `trace-${index}` });
		}
		expect(seen).toEqual(['trace-0', 'trace-1', 'trace-2']);
	});

	it('adds validated, exposed context commands when contexts are given', async () => {
		const contextState = createContextState();
		const cmds = getBootstrapCommands(() => [], {
			contexts: [{ name: 'editing' }],
			contextState,
		});
		expect(cmds.map((cmd) => cmd.name)).toEqual([
			'afd-help',
			'afd-docs',
			'afd-schema',
			'afd-context-list',
			'afd-context-enter',
			'afd-context-exit',
		]);
		const enter = cmds.find((cmd) => cmd.name === 'afd-context-enter');
		expect(enter?.expose).toEqual({ mcp: true });
		expect(enter?.jsonSchema.required).toEqual(['context']);
		expect(enter?.inputSchema.safeParse({ context: '' }).success).toBe(false);
		expect((await enter?.handler({ context: 'editing' }, {}))?.success).toBe(true);
		expect(contextState.getActive()).toBe('editing');
	});
});
