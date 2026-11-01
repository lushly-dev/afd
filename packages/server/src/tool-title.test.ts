/**
 * A command's optional `title` (`spec/command-metadata.md`, "Tool titles"): the MCP tool `title`
 * of its own tool, afd-detail, afd-help (full) and `listCommands()`. Nothing is derived from the
 * name, grouped tools carry none, and the meta-tools carry fixed titles.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDirectRegistry } from './direct-registry.js';
import { createDirectToolSurface } from './direct-tool-surface.js';
import { executeDetail } from './lazy-tools.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import { getToolsList } from './tools.js';

const titled = defineCommand({
	name: 'todo-create',
	title: 'New todo',
	description: 'Create a todo item',
	expose: { mcp: true },
	input: z.object({ text: z.string() }),
	handler: async ({ text }) => success({ text }),
});

const untitled = defineCommand({
	name: 'todo-list',
	description: 'List todo items',
	expose: { mcp: true },
	input: z.object({}),
	handler: async () => success({ todos: [] }),
});

const commands = [titled, untitled];

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('tool titles', () => {
	it("give a command's own tool its title, and an untitled command none", () => {
		const tools = getToolsList(commands, 'individual');
		expect(tools.find((tool) => tool.name === 'todo-create')?.title).toBe('New todo');
		expect(tools.find((tool) => tool.name === 'todo-list')).not.toHaveProperty('title');

		const hybrid = getToolsList(commands, 'hybrid', undefined, null, {
			firstClassTools: ['todo-create'],
		});
		expect(hybrid.find((tool) => tool.name === 'todo-create')?.title).toBe('New todo');
	});

	it('give the meta-tools fixed titles and grouped tools none', () => {
		const grouped = getToolsList(commands, 'grouped');
		expect(Object.fromEntries(grouped.map((tool) => [tool.name, tool.title]))).toEqual({
			'afd-batch': 'Run commands in a batch',
			'afd-pipe': 'Run a command pipeline',
			'afd-call': 'Call a command',
			'afd-detail': 'Describe commands',
			todo: undefined,
		});
		expect(getToolsList(commands, 'lazy').find((tool) => tool.name === 'afd-discover')?.title).toBe(
			'Discover commands'
		);
		expect(JSON.stringify(grouped.find((tool) => tool.name === 'todo')?._meta)).not.toContain(
			'New todo'
		);
	});

	it('are reported by afd-detail, afd-help (full) and listCommands', async () => {
		const detail = executeDetail(commands, new Set(['todo-create', 'todo-list']), {
			command: ['todo-create', 'todo-list'],
		});
		expect(detail.data?.map((entry) => ('title' in entry ? entry.title : null))).toEqual([
			'New todo',
			undefined,
		]);

		const registry = createDirectRegistry(commands, {
			tools: createDirectToolSurface({ bootstrap: true }),
		});
		const help = await registry.execute<{ commands: Array<{ name: string; title?: string }> }>(
			'afd-help',
			{ format: 'full' }
		);
		const byName = Object.fromEntries(
			(help.data?.commands ?? []).map((command) => [command.name, command])
		);
		expect(byName['todo-create']?.title).toBe('New todo');
		expect(byName['todo-list']?.title).toBeUndefined();
		const brief = await registry.execute<{ commands: Array<{ title?: string }> }>('afd-help', {});
		expect(JSON.stringify(brief.data)).not.toContain('New todo');

		const listed = registry.listCommands();
		expect(listed.find((command) => command.name === 'todo-create')?.title).toBe('New todo');
		expect(listed.find((command) => command.name === 'todo-list')).not.toHaveProperty('title');
	});

	it.each(['auto', 'legacy'] as const)(
		'reach an MCP client over Streamable HTTP (%s)',
		async (mode) => {
			const handler = createMcpHandler({
				name: 'titles',
				version: '1.0.0',
				host: '127.0.0.1',
				commands,
				toolStrategy: 'individual',
			});
			const server = createServer(handler);
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
			const client = new Client(
				{ name: 'titles-client', version: '0' },
				mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {}
			);
			cleanups.push(async () => {
				await client.close();
				handler.dispose();
				server.closeAllConnections();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			});
			const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
			await client.connect(new StreamableHTTPClientTransport(new URL(url)));
			const { tools } = await client.listTools();
			const titles = Object.fromEntries(tools.map((tool) => [tool.name, tool.title]));
			expect(titles).toMatchObject({ 'todo-create': 'New todo', 'afd-call': 'Call a command' });
			expect(titles['todo-list']).toBeUndefined();
		}
	);
});
