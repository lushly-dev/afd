/**
 * `toolMeta` and `advertisedInputSchema` (`spec/mcp-resources.md`, T1 to T3, V1 and V2): extra
 * `_meta` entries on a command's tool, its grouped action entry and afd-detail, never on the
 * meta-tools; and an input schema shown apart from the one that validates.
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

const UI = { resourceUri: 'ui://notes/list.html', visibility: ['model', 'app'] };

const notes = defineCommand({
	name: 'notes-list',
	description: 'List notes',
	category: 'notes',
	mutation: false,
	expose: { mcp: true },
	input: z.object({ query: z.string().optional() }),
	toolMeta: { ui: UI, 'dev.umbel/origin': { plugin: 'notes' } },
	handler: async () => success({ notes: [] }),
});

const plain = defineCommand({
	name: 'notes-count',
	description: 'Count notes',
	expose: { mcp: true },
	input: z.object({}),
	handler: async () => success({ count: 0 }),
});

const commands = [notes, plain];
const EXTRA = { ui: UI, 'dev.umbel/origin': { plugin: 'notes' } };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('toolMeta', () => {
	it('is emitted on the individual tool beside the server entries, and omitted when unset', () => {
		const tools = getToolsList(commands, 'individual');
		expect(tools.find((tool) => tool.name === 'notes-list')?._meta).toEqual({
			category: 'notes',
			mutation: false,
			...EXTRA,
		});
		expect(tools.find((tool) => tool.name === 'notes-count')).not.toHaveProperty('_meta');
	});

	it('is emitted on a hybrid first-class tool, equal to the individual tool', () => {
		const individual = getToolsList(commands, 'individual').find(
			(tool) => tool.name === 'notes-list'
		);
		const hybrid = getToolsList(commands, 'hybrid', undefined, null, {
			firstClassTools: ['notes-list'],
		});
		expect(hybrid.find((tool) => tool.name === 'notes-list')).toEqual(individual);
	});

	it('is emitted on the grouped action entry, not on the tool, and never on meta-tools', () => {
		const grouped = getToolsList(commands, 'grouped');
		const tool = grouped.find((entry) => entry.name === 'notes');
		expect(tool?._meta?.actions).toEqual([
			expect.objectContaining({
				command: 'notes-list',
				category: 'notes',
				mutation: false,
				...EXTRA,
			}),
			expect.not.objectContaining({ ui: expect.anything() }),
		]);
		expect(Object.keys(tool?._meta ?? {})).toEqual(['actions']);
		for (const strategy of ['grouped', 'lazy', 'individual'] as const) {
			for (const meta of getToolsList(commands, strategy).filter((entry) =>
				entry.name.startsWith('afd-')
			)) {
				expect(JSON.stringify(meta)).not.toContain('dev.umbel/origin');
			}
		}
	});

	it('is reported by afd-detail as toolMeta, and only when set', () => {
		const detail = executeDetail(commands, new Set(commands.map((command) => command.name)), {
			command: ['notes-list', 'notes-count'],
		});
		const [withMeta, withoutMeta] = detail.data ?? [];
		expect(withMeta).toMatchObject({ found: true, toolMeta: EXTRA });
		expect(withoutMeta).not.toHaveProperty('toolMeta');
	});

	it('passes through the direct tool surface', async () => {
		const registry = createDirectRegistry(commands, {
			tools: createDirectToolSurface({ strategy: 'individual' }),
		});
		const tools = registry.listTools();
		expect(tools.find((tool) => tool.name === 'notes-list')?._meta).toMatchObject(EXTRA);
	});

	it.each(['auto', 'legacy'] as const)(
		'reaches an MCP client over Streamable HTTP (%s)',
		async (mode) => {
			const handler = createMcpHandler({
				name: 'tool-meta',
				version: '1.0.0',
				host: '127.0.0.1',
				commands,
				toolStrategy: 'individual',
			});
			const server = createServer(handler);
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
			const client = new Client(
				{ name: 'tool-meta-client', version: '0' },
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
			expect(tools.find((tool) => tool.name === 'notes-list')?._meta).toMatchObject(EXTRA);
			expect(tools.find((tool) => tool.name === 'afd-call')?._meta).toBeUndefined();
		}
	);

	it('is refused by createMcpServer for a command built by hand with a bad key', () => {
		const handBuilt = { ...plain, toolMeta: { approval: 'required' } } as unknown as typeof plain;
		expect(() => createMcpHandler({ name: 'x', version: '1', commands: [handBuilt] })).toThrow(
			/notes-count.*approval/
		);
	});

	it('is refused at registration when it is not an object', () => {
		const bad = defineCommand({
			name: 'notes-bad',
			description: 'Bad',
			expose: { mcp: true },
			input: z.object({}),
			toolMeta: ['x'] as never,
			handler: async () => success({}),
		});
		expect(() => createMcpHandler({ name: 'x', version: '1', commands: [bad] })).toThrow(
			/notes-bad.*toolMeta/
		);
	});

	it('survives toCommandDefinition', () => {
		expect(notes.toCommandDefinition().toolMeta).toEqual(EXTRA);
	});
});

describe('advertisedInputSchema', () => {
	const wrapped = defineCommand({
		name: 'wrapped-search',
		description: 'A wrapped tool',
		expose: { mcp: true },
		input: z.object({ q: z.string() }),
		advertisedInputSchema: {
			type: 'object',
			properties: { q: { type: 'string', pattern: '^(?=.*a)' } },
			required: ['q'],
			additionalProperties: false,
		},
		handler: async ({ q }) => success({ q }),
	});

	it('is shown on every surface, and Zod still validates', async () => {
		const tool = getToolsList([wrapped], 'individual').find(
			(entry) => entry.name === 'wrapped-search'
		);
		expect(tool?.inputSchema).toEqual({
			type: 'object',
			properties: { q: { type: 'string', pattern: '^(?=.*a)' } },
			required: ['q'],
			additionalProperties: false,
		});
		const detail = executeDetail([wrapped], new Set(['wrapped-search']), {
			command: 'wrapped-search',
		});
		expect(detail.data?.[0]).toMatchObject({ inputSchema: tool?.inputSchema });
		const grouped = getToolsList([wrapped], 'grouped').find((entry) => entry.name === 'wrapped');
		expect(JSON.stringify(grouped)).toContain('(?=.*a)');

		const registry = createDirectRegistry([wrapped]);
		expect((await registry.execute('wrapped-search', { q: 1 })).success).toBe(false);
		expect((await registry.execute('wrapped-search', { q: 'ok' })).success).toBe(true);
		expect(registry.listCommands()[0]?.inputSchema).toEqual(tool?.inputSchema);
	});

	it('does not generate a schema from input when one is advertised', () => {
		// A Zod schema JSON Schema cannot express would throw if it were converted.
		const odd = defineCommand({
			name: 'wrapped-odd',
			description: 'Cannot be converted',
			input: z.custom<string>(() => true),
			advertisedInputSchema: { type: 'object', properties: {} },
			handler: async () => success({}),
		});
		expect(odd.jsonSchema).toEqual({ type: 'object', properties: {} });
	});

	it.each([
		['not an object', 'x'],
		['an array', []],
		['another type', { type: 'string' }],
		['no type', { properties: {} }],
	])('is refused when it is %s', (_name, schema) => {
		expect(() =>
			defineCommand({
				name: 'wrapped-bad',
				description: 'Bad',
				input: z.object({}),
				advertisedInputSchema: schema as never,
				handler: async () => success({}),
			})
		).toThrow(/wrapped-bad.*advertisedInputSchema/);
	});
});
