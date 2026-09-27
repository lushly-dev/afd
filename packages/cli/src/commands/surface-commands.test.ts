/**
 * Surface collection against real AFD servers (grouped, individual, lazy) over
 * HTTP, plus fake-client cases for servers that are not AFD TypeScript servers.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient, type McpClient } from '@lushly-dev/afd-client';
import type { CommandResult, McpTool } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import { createMcpHandler, defineCommand, type McpServerOptions } from '@lushly-dev/afd-server';
import { validateCommandSurface } from '@lushly-dev/afd-testing';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	collectSurfaceCommands,
	isOpaqueGroupedTool,
	mapToolsToSurfaceCommands,
	type SurfaceClient,
} from './surface-commands.js';

/** The quickstart server: two commands in category 'todo'. */
const quickstartCommands = [
	defineCommand({
		name: 'todo-create',
		description: 'Create a todo item from a title',
		category: 'todo',
		input: z.object({ title: z.string() }),
		expose: { mcp: true, cli: true },
		async handler(input) {
			return success({ id: '1', title: input.title });
		},
	}),
	defineCommand({
		name: 'todo-get',
		description: 'Get a todo item by its id',
		category: 'todo',
		input: z.object({ id: z.string() }),
		expose: { mcp: true, cli: true },
		async handler(input) {
			return success({ id: input.id, title: 'Buy milk' });
		},
	}),
];

const running: Array<{ server: Server; dispose: () => void; client: McpClient }> = [];

afterEach(async () => {
	for (const { server, dispose, client } of running.splice(0)) {
		await client.disconnect();
		dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

/** Serve the quickstart commands over HTTP and connect a real client. */
async function connect(options: Partial<McpServerOptions> = {}): Promise<McpClient> {
	const handler = createMcpHandler({
		name: 'todo',
		version: '0.1.0',
		commands: quickstartCommands,
		host: '127.0.0.1',
		port: 0,
		...options,
	});
	const dispose = handler.dispose;
	const server = createServer((req, res) => void handler(req, res));
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	const client = createClient({
		url: `http://127.0.0.1:${port}/message`,
		transport: 'http',
		autoReconnect: false,
	});
	await client.connect();
	running.push({ server, dispose, client });
	return client;
}

async function collect(options: Partial<McpServerOptions> = {}) {
	const client = await connect(options);
	return collectSurfaceCommands(await client.listTools(), client);
}

/** Findings that name a built-in tool or a grouped tool instead of a command. */
function misattributed(commands: Parameters<typeof validateCommandSurface>[0]) {
	return validateCommandSurface(commands).findings.filter((finding) =>
		finding.commands.some((name) => name === 'todo' || name.startsWith('afd-'))
	);
}

describe('surface commands from a real server', () => {
	it('grouped (the default): validates each action as its command', async () => {
		const set = await collect();

		expect(set.commands.map((command) => command.name)).toEqual(['todo-create', 'todo-get']);
		expect(set.commands[0]).toMatchObject({
			description: 'Create a todo item from a title',
			category: 'todo',
			jsonSchema: { type: 'object', properties: { title: { type: 'string' } } },
		});
		expect(set.expandedGroups).toEqual(['todo']);
		expect(set.skippedBuiltins.sort()).toEqual(['afd-batch', 'afd-call', 'afd-detail', 'afd-pipe']);
		expect(set.discovered).toBe(false);

		const result = validateCommandSurface(set.commands);
		expect(misattributed(set.commands)).toEqual([]);
		expect(result.summary).toMatchObject({ commandCount: 2, errorCount: 0, warningCount: 0 });
	});

	it('individual: validates each command tool and skips the built-in tools', async () => {
		const set = await collect({ toolStrategy: 'individual' });

		expect(set.commands.map((command) => command.name)).toEqual(['todo-create', 'todo-get']);
		expect(set.commands[1]).toMatchObject({ category: 'todo' });
		expect(set.expandedGroups).toEqual([]);
		expect(set.skippedBuiltins.sort()).toEqual(['afd-batch', 'afd-call', 'afd-pipe']);
		expect(misattributed(set.commands)).toEqual([]);
	});

	it('lazy: lists commands with afd-discover and afd-detail', async () => {
		const set = await collect({ toolStrategy: 'lazy' });

		expect(set.discovered).toBe(true);
		expect(set.commands.map((command) => command.name)).toEqual(['todo-create', 'todo-get']);
		expect(set.commands[1]).toMatchObject({
			description: 'Get a todo item by its id',
			category: 'todo',
			jsonSchema: { type: 'object', properties: { id: { type: 'string' } } },
		});
		expect(set.skippedBuiltins.sort()).toEqual([
			'afd-batch',
			'afd-call',
			'afd-detail',
			'afd-discover',
			'afd-pipe',
		]);
		expect(set.warnings).toEqual([]);
		expect(misattributed(set.commands)).toEqual([]);
	});

	it('skips bootstrap and context commands in every strategy', async () => {
		const contexts = [{ name: 'editing', description: 'Editing todos' }];
		for (const toolStrategy of ['grouped', 'individual', 'lazy'] as const) {
			const set = await collect({ toolStrategy, bootstrap: true, contexts });
			expect(set.commands.map((command) => command.name)).toEqual(['todo-create', 'todo-get']);
			expect(set.skippedBuiltins).toEqual(
				expect.arrayContaining(['afd-help', 'afd-docs', 'afd-schema', 'afd-context-list'])
			);
			// A group made only of built-ins (category 'bootstrap') is not reported as expanded.
			expect(set.expandedGroups).toEqual(toolStrategy === 'grouped' ? ['todo'] : []);
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Servers that are not AFD TypeScript servers
// ═══════════════════════════════════════════════════════════════════════════════

/** A grouped tool that does not list its actions (as the Python server advertises them). */
const opaqueGroup: McpTool = {
	name: 'todo',
	description: 'todo operations: create, get',
	inputSchema: {
		type: 'object',
		properties: {
			action: { type: 'string', enum: ['create', 'get'] },
			params: { type: 'object' },
		},
		required: ['action'],
	},
};

const builtinTool = (name: string): McpTool => ({
	name,
	description: `${name} built-in`,
	inputSchema: { type: 'object' },
});

/** A fake client serving afd-discover and afd-detail over a fixed command list. */
function fakeClient(names: string[], pageSize = 200): SurfaceClient & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async call<T>(name: string, args: Record<string, unknown> = {}): Promise<CommandResult<T>> {
			calls.push(name);
			if (name === 'afd-discover') {
				const offset = Number(args.offset ?? 0);
				const page = names.slice(offset, offset + pageSize);
				const data = {
					commands: page.map((n) => ({ name: n, description: 'short' })),
					hasMore: offset + pageSize < names.length,
				};
				return success(data) as CommandResult<T>;
			}
			if (name === 'afd-detail') {
				const requested = args.command as string[];
				expect(requested.length).toBeLessThanOrEqual(10);
				const data = requested.map((n) => ({
					name: n,
					found: true,
					description: `Run the ${n} operation on stored items`,
					category: n.split('-')[0],
					inputSchema: { type: 'object', properties: {} },
					examples: [{ title: 'Basic', input: {} }],
				}));
				return success(data) as CommandResult<T>;
			}
			return failure({ code: 'COMMAND_NOT_FOUND', message: name, suggestion: 'none' });
		},
	};
}

describe('surface commands from other servers', () => {
	it('lists the commands of grouped tools without _meta.actions via afd-discover', async () => {
		const client = fakeClient(['afd-help', 'todo-create', 'todo-get']);
		const set = await collectSurfaceCommands(
			[builtinTool('afd-batch'), builtinTool('afd-help'), opaqueGroup],
			client
		);

		expect(isOpaqueGroupedTool(opaqueGroup)).toBe(true);
		expect(set.commands.map((command) => command.name)).toEqual(['todo-create', 'todo-get']);
		expect(set.commands[0]?.examples).toEqual([{ title: 'Basic', input: {} }]);
		expect(set.expandedGroups).toEqual(['todo']);
		expect(set.skippedBuiltins).toEqual(['afd-batch', 'afd-help']);
		expect(set.discovered).toBe(true);
	});

	it('pages afd-discover and batches afd-detail by 10 on large lazy servers', async () => {
		const names = Array.from({ length: 25 }, (_, i) => `item-op${i}`);
		const client = fakeClient(names, 10);
		const set = await collectSurfaceCommands(
			[builtinTool('afd-discover'), builtinTool('afd-detail')],
			client
		);

		expect(set.commands.map((command) => command.name)).toEqual(names);
		expect(client.calls.filter((name) => name === 'afd-discover')).toHaveLength(3);
		expect(client.calls.filter((name) => name === 'afd-detail')).toHaveLength(3);
	});

	it('validates grouped tools as tools, with a warning, when discovery fails', async () => {
		const client: SurfaceClient = {
			async call<T>() {
				return failure({
					code: 'COMMAND_NOT_FOUND',
					message: 'Unknown tool',
					suggestion: 'none',
				}) as CommandResult<T>;
			},
		};
		const set = await collectSurfaceCommands([opaqueGroup], client);

		expect(set.commands.map((command) => command.name)).toEqual(['todo']);
		expect(set.discovered).toBe(false);
		expect(set.warnings).toEqual([expect.stringContaining('afd-discover failed: Unknown tool')]);
	});

	it('keeps a command whose input merely looks like a grouped tool', async () => {
		const client = fakeClient(['todo']);
		const set = await collectSurfaceCommands([opaqueGroup], client);

		expect(set.commands.map((command) => command.name)).toEqual(['todo']);
		expect(set.expandedGroups).toEqual([]);
	});

	it('does not call the server when the listing carries every command', async () => {
		const client = fakeClient([]);
		const tools: McpTool[] = [
			builtinTool('afd-call'),
			{ name: 'todo-list', description: 'List todo items', inputSchema: { type: 'object' } },
		];
		const set = await collectSurfaceCommands(tools, client);

		expect(set.commands.map((command) => command.name)).toEqual(['todo-list']);
		expect(client.calls).toEqual([]);
	});
});

describe('mapToolsToSurfaceCommands', () => {
	it('expands _meta.actions and skips built-in tools and built-in actions', () => {
		const grouped: McpTool = {
			name: 'items',
			description: 'items operations: add, help',
			inputSchema: { type: 'object' },
			_meta: {
				actions: [
					{
						action: 'add',
						command: 'items-add',
						description: 'Add an item to the list',
						inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
						category: 'items',
						requires: ['auth-login'],
						contexts: ['editing'],
					},
					{
						action: 'help',
						command: 'afd-help',
						description: 'List commands',
						inputSchema: { type: 'object' },
					},
				],
			},
		};

		expect(mapToolsToSurfaceCommands([builtinTool('afd-pipe'), grouped])).toEqual([
			{
				name: 'items-add',
				description: 'Add an item to the list',
				category: 'items',
				jsonSchema: { type: 'object', properties: { name: { type: 'string' } } },
				requires: ['auth-login'],
				examples: undefined,
				outputJsonSchema: undefined,
				contexts: ['editing'],
			},
		]);
	});
});
