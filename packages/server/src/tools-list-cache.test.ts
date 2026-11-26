/**
 * @fileoverview The memoised tools list (#1746): `createToolsList` lists exactly what
 * `getToolsList` does, for every strategy, context and scope-narrowed command list; it reuses a
 * whole list only for the server's own command array; and no lane that serves the shared list
 * changes it (it is not frozen, which would slow its serialisation).
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { serveModernStdio } from './mcp-modern.js';
import { defineCommand, type ZodCommandDefinition } from './schema.js';
import { createSharedHttpRuntime } from './server.js';
import type { ToolStrategy } from './server-types.js';
import {
	createToolsList,
	GROUPED_PARAMS_SCHEMA_BUDGET,
	getToolsList,
	type ToolsListOptions,
} from './tools.js';

const ok = async () => success({});

const commands: ZodCommandDefinition[] = [
	defineCommand({
		name: 'todo-create',
		description: 'Create a todo',
		category: 'todo',
		expose: { mcp: true },
		mutation: true,
		requires: ['auth-sign-in', 'todo-list'],
		contexts: ['work'],
		input: z.object({ title: z.string() }),
		output: z.object({ id: z.string() }),
		handler: ok,
	}),
	defineCommand({
		name: 'todo-list',
		description: 'List todos',
		expose: { mcp: true },
		mutation: false,
		input: z.object({}),
		handler: ok,
	}),
	defineCommand({
		name: 'todo-wipe',
		description: 'Delete every todo',
		expose: { mcp: true },
		mutation: true,
		destructive: true,
		confirmPrompt: 'Delete every todo?',
		contexts: ['home'],
		input: z.object({}),
		handler: ok,
	}),
	defineCommand({
		name: 'note-add',
		description: 'Add a note',
		expose: { mcp: true },
		contexts: ['home'],
		input: z.object({ text: z.string().describe('The note') }),
		handler: ok,
	}),
	defineCommand({
		name: 'afd-context-list',
		description: 'List contexts',
		expose: { mcp: true },
		input: z.object({}),
		handler: ok,
	}),
	defineCommand({
		name: 'secret-read',
		description: 'Not listed over MCP',
		input: z.object({}),
		handler: ok,
	}),
];

const STRATEGIES: ToolStrategy[] = ['individual', 'grouped', 'lazy', 'hybrid'];
const OPTIONS: ToolsListOptions[] = [
	{},
	{ confirmations: 'enforce', outputSchema: false, firstClassTools: ['note-add', 'todo-list'] },
];
const CONTEXTS = ['work', 'home'];

/** As a scope view narrows a list: a command dropped, one copied with a shorter `requires`. */
function narrowed(): ZodCommandDefinition[] {
	return commands
		.filter((command) => command.name !== 'note-add')
		.map((command) =>
			command.requires ? { ...command, requires: command.requires.slice(0, 1) } : command
		);
}

describe('createToolsList', () => {
	for (const toolStrategy of STRATEGIES) {
		for (const options of OPTIONS) {
			const label = `${toolStrategy}, ${JSON.stringify(options)}`;

			it(`lists what getToolsList lists (${label})`, () => {
				const list = createToolsList({ commands, toolStrategy, options, contexts: CONTEXTS });
				// Compared as JSON too, which `toStrictEqual` is not: key order is part of the wire.
				const same = (actual: unknown, expected: unknown) => {
					expect(actual).toStrictEqual(expected);
					expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
				};
				for (const active of [undefined, null, ...CONTEXTS, 'unknown']) {
					const expected = getToolsList(commands, toolStrategy, undefined, active, options);
					// Twice: once built, once cached (or rebuilt from cached pieces).
					same(list(commands, active), expected);
					same(list(commands, active), expected);
					const view = narrowed();
					same(list(view, active), getToolsList(view, toolStrategy, undefined, active, options));
					// After a narrowed list, the full one is still the full one.
					same(list(commands, active), expected);
				}
			});
		}
	}

	it('reuses a whole list only for the server command array and a configured context', () => {
		const list = createToolsList({ commands, toolStrategy: 'individual', contexts: CONTEXTS });
		expect(list(commands, 'work')).toBe(list(commands, 'work'));
		expect(list(commands, undefined)).toBe(list(commands, null));
		expect(list(commands, 'work')).not.toBe(list(commands, 'home'));
		// A copy a scope view filtered nothing from (as under `auth`) is the server's own list.
		expect(list([...commands], 'work')).toBe(list(commands, 'work'));
		// A context no one configured is listed, never kept.
		expect(list(commands, 'unknown')).not.toBe(list(commands, 'unknown'));
		// A list a view narrowed is assembled each time, from the same tools.
		const view = commands.filter((command) => command.name !== 'note-add');
		const first = list(view, 'work');
		const second = list(view, 'work');
		expect(first).not.toBe(second);
		first.forEach((tool, index) => {
			expect(second[index]).toBe(tool);
		});
	});

	it('keeps every key of a tool in the order it had before #1746', () => {
		const options: ToolsListOptions = { confirmations: 'enforce' };
		const schemaKeys = (command: ZodCommandDefinition) => [
			'type',
			...Object.keys(command.jsonSchema).filter((key) => key !== 'type'),
		];
		const list = createToolsList({ commands, toolStrategy: 'individual', options });
		const individual = list(commands, undefined);
		const create = individual.find((tool) => tool.name === 'todo-create');
		expect(Object.keys(create ?? {})).toEqual([
			'name',
			'description',
			'inputSchema',
			'annotations',
			'outputSchema',
			'_meta',
		]);
		const wipe = individual.find((tool) => tool.name === 'todo-wipe');
		expect(Object.keys(wipe?.inputSchema.properties ?? {}).at(-1)).toBe('confirm');

		const grouped = createToolsList({ commands, toolStrategy: 'grouped', options });
		const todo = grouped(commands, undefined).find((tool) => tool.name === 'todo');
		if (!todo) throw new Error('No grouped tool todo');
		expect(Object.keys(todo)).toEqual(['name', 'description', 'inputSchema', '_meta']);
		expect(Object.keys(todo.inputSchema)).toEqual(['type', 'properties', 'required']);
		const properties = todo.inputSchema.properties as Record<string, Record<string, unknown>>;
		expect(Object.keys(properties)).toEqual(['action', 'params', 'confirm']);
		expect(Object.keys(properties.action ?? {})).toEqual(['type', 'enum', 'description']);
		expect(Object.keys(properties.params ?? {})).toEqual(['type', 'description', 'anyOf']);
		const members = commands.filter((command) => command.name.startsWith('todo-'));
		const branches = properties.params?.anyOf as Record<string, unknown>[];
		branches.forEach((branch, index) => {
			const keys = schemaKeys(members[index] as ZodCommandDefinition);
			expect(Object.keys(branch)).toEqual([
				...keys,
				'title',
				...(keys.includes('description') ? [] : ['description']),
			]);
		});
		for (const entry of (todo._meta?.actions ?? []) as Record<string, unknown>[]) {
			expect(Object.keys(entry).slice(0, 4)).toEqual([
				'action',
				'command',
				'description',
				'inputSchema',
			]);
		}
	});

	it('lazy and hybrid lists ignore the context, so one list serves every context', () => {
		for (const toolStrategy of ['lazy', 'hybrid'] as const) {
			const list = createToolsList({ commands, toolStrategy, contexts: CONTEXTS });
			expect(list(commands, 'work')).toBe(list(commands, 'home'));
		}
	});

	it('builds a command copied by a view for that copy, never from the original', () => {
		const list = createToolsList({ commands, toolStrategy: 'individual' });
		const full = list(commands, undefined).find((tool) => tool.name === 'todo-create');
		const view = narrowed();
		const copied = list(view, undefined).find((tool) => tool.name === 'todo-create');
		expect(full?._meta?.requires).toEqual(['auth-sign-in', 'todo-list']);
		expect(copied?._meta?.requires).toEqual(['auth-sign-in']);
	});

	it('is the same unchanged list after every lane serves it', async () => {
		const runtime = createSharedHttpRuntime({
			name: 'shared-list',
			version: '1.0.0',
			host: '127.0.0.1',
			toolStrategy: 'grouped',
			confirmations: 'enforce',
			contexts: CONTEXTS.map((name) => ({ name })),
			commands: commands.filter((command) => command.name !== 'afd-context-list'),
		});
		const server = createServer(runtime.handler);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const stdio = serveModernStdio(runtime.modernDeps, runtime.contextState, serverSide);
		const clients = [
			new Client({ name: 'mcp', version: '0' }, { versionNegotiation: { mode: 'auto' } }),
			new Client({ name: 'mcp-legacy', version: '0' }),
			new Client({ name: 'stdio', version: '0' }, { versionNegotiation: { mode: 'auto' } }),
		] as const;
		try {
			const before = runtime.getToolsList({});
			const snapshot = structuredClone(before);
			await clients[0].connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
			await clients[1].connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
			await clients[2].connect(clientSide);
			expect(clients.map((client) => client.getProtocolEra())).toEqual([
				'modern',
				'legacy',
				'modern',
			]);
			for (const client of clients) {
				expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
					snapshot.map((tool) => tool.name)
				);
			}
			const viaMessage = await fetch(`${base}/message`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			});
			expect(((await viaMessage.json()) as { result: { tools: unknown[] } }).result.tools).toEqual(
				JSON.parse(JSON.stringify(snapshot))
			);
			const after = runtime.getToolsList({});
			expect(after).toBe(before);
			expect(after).toStrictEqual(snapshot);
		} finally {
			await Promise.all(clients.map((client) => client.close()));
			await stdio.close();
			runtime.dispose();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});

describe('grouped params budget', () => {
	/** A group of `count` commands whose one property's description is `pad` characters long. */
	function group(count: number, pad: number): ZodCommandDefinition[] {
		return Array.from({ length: count }, (_, index) =>
			defineCommand({
				name: `big-action${index}`,
				description: `Action ${index}`,
				expose: { mcp: true },
				input: z.object({ value: z.string().describe('x'.repeat(pad)) }),
				handler: ok,
			})
		);
	}

	it('inlines the branches exactly when their JSON fits the budget', () => {
		for (const count of [1, 2, 3, 7]) {
			let inlined = 0;
			let withheld = 0;
			const step = Math.floor(GROUPED_PARAMS_SCHEMA_BUDGET / count);
			for (let pad = step - 260; pad <= step - 100; pad++) {
				const [tool] = getToolsList(group(count, pad), 'grouped').slice(5);
				if (!tool) throw new Error('No grouped tool');
				const actions = tool._meta?.actions as Array<{
					action: string;
					command: string;
					inputSchema: Record<string, unknown>;
				}>;
				// The branches as the tool would inline them, serialised in one piece.
				const branches = actions.map((entry) => ({
					...entry.inputSchema,
					title: entry.action,
					description: `Parameters for action '${entry.action}' (${entry.command})`,
				}));
				const fits = JSON.stringify(branches).length <= GROUPED_PARAMS_SCHEMA_BUDGET;
				const params = (tool.inputSchema.properties as Record<string, { anyOf?: unknown }>).params;
				expect(params?.anyOf !== undefined).toBe(fits);
				if (fits) {
					inlined++;
					expect(params?.anyOf).toStrictEqual(branches);
				} else withheld++;
			}
			// The padding range crosses the budget for this group size.
			expect([count, inlined > 0, withheld > 0]).toEqual([count, true, true]);
		}
	});
});
