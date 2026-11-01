/**
 * @fileoverview `createDirectRegistry` with `createDirectToolSurface` against the MCP server
 * (#527, part 3).
 *
 * One set of commands with contexts runs through `createMcpHandler`, over the stateless MCP
 * 2026-07-28 lane with `_meta["dev.afd/context"]`, and through an in-process registry with a tool
 * surface and the per-call `activeContext` option. For every strategy, with and without the
 * bootstrap tools, and in every context including none, the tool lists are equal, and so are the
 * results of the same tool calls: successes, refusals, meta-tools and context tools.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { success } from '@lushly-dev/afd-core';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DirectRegistryOptions } from './direct-registry.js';
import { createDirectRegistry } from './direct-registry.js';
import { createDirectToolSurface } from './direct-tool-surface.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';
import type { ContextConfig, McpHandlerOptions, ToolStrategy } from './server-types.js';

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const contexts: ContextConfig[] = [
	{ name: 'writing', description: 'Write notes', triggers: ['draft'] },
	{ name: 'billing', description: 'Pay bills', priority: 2 },
];

const commands = [
	defineCommand({
		name: 'note-list',
		description: 'List notes',
		mutation: false,
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => success({ notes: ['milk'] }),
	}),
	defineCommand({
		name: 'note-create',
		description: 'Create a note',
		mutation: true,
		contexts: ['writing'],
		expose: { mcp: true },
		input: z.object({ title: z.string() }),
		output: z.object({ title: z.string() }),
		handler: async ({ title }) => success({ title }),
	}),
	defineCommand({
		name: 'bill-pay',
		description: 'Pay a bill',
		mutation: true,
		destructive: true,
		contexts: ['billing'],
		expose: { mcp: true },
		input: z.object({ amount: z.number() }),
		handler: async ({ amount }) => success({ paid: amount }),
	}),
	defineCommand({
		name: 'bill-list',
		description: 'List bills',
		contexts: ['billing', 'writing'],
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => success({ bills: [] }),
	}),
	// Private to both surfaces: neither the MCP server nor the agent registry exposes it.
	defineCommand({
		name: 'vault-open',
		description: 'Open the vault',
		expose: { mcp: false, agent: false },
		input: z.object({}),
		handler: async () => success({ open: true }),
	}),
];

const FIRST_CLASS = ['note-list', 'bill-pay'];

// ── MCP 2026-07-28 over HTTP ──────────────────────────────────────────────────────────────

const META = {
	'io.modelcontextprotocol/protocolVersion': '2026-07-28',
	'io.modelcontextprotocol/clientCapabilities': {},
	'io.modelcontextprotocol/clientInfo': { name: 'direct-surface-test', version: '0' },
};

async function serve(options: McpHandlerOptions): Promise<string> {
	const handler = createMcpHandler(options);
	const http = createServer(handler);
	await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		http.closeAllConnections();
		await new Promise<void>((resolve) => http.close(() => resolve()));
	});
	return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

async function modern(base: string, method: string, params: Record<string, unknown>) {
	const name = typeof params.name === 'string' ? params.name : undefined;
	const response = await fetch(`${base}/mcp`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': '2026-07-28',
			'Mcp-Method': method,
			...(name ? { 'Mcp-Name': name } : {}),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	const text = await response.text();
	const data = /^data: (.*)$/m.exec(text)?.[1];
	return JSON.parse(data ?? text) as {
		result?: Record<string, unknown>;
		error?: { code: number; message: string; data?: { suggestion?: string } };
	};
}

const meta = (context: string | null) => ({
	_meta: { ...META, ...(context ? { 'dev.afd/context': context } : {}) },
});

async function mcpTools(base: string, context: string | null) {
	const { result } = await modern(base, 'tools/list', meta(context));
	return (result as { tools: unknown[] }).tools;
}

async function mcpCall(base: string, tool: string, args: unknown, context: string | null) {
	const { result } = await modern(base, 'tools/call', {
		name: tool,
		arguments: args,
		...meta(context),
	});
	const content = (result as { content: Array<{ text: string }> }).content;
	return JSON.parse(content[0]?.text ?? 'null') as unknown;
}

// ── Comparison ────────────────────────────────────────────────────────────────────────────

/** Keys whose values differ from run to run: timings, timestamps and generated trace IDs. */
const VOLATILE = new Set([
	'executionTimeMs',
	'durationMs',
	'totalMs',
	'averageMs',
	'startedAt',
	'completedAt',
	'traceId',
]);

/** The JSON an agent reads, without the volatile fields. */
function normalize(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value), (key, item) => (VOLATILE.has(key) ? undefined : item));
}

const CALLS: Array<[tool: string, args: Record<string, unknown>]> = [
	['note-list', {}],
	['note-create', { title: 'Milk' }],
	['note-create', { title: 5 }],
	['bill-pay', { amount: 3 }],
	['bill-list', {}],
	['nope-command', {}],
	['afd-call', { command: 'bill-pay', input: { amount: 3 } }],
	['afd-call', { command: 'note-create', input: { title: 'Eggs' } }],
	['afd-call', { command: 'vault-open' }],
	['afd-call', { command: 'bill-pai' }],
	['afd-call', {}],
	['afd-discover', {}],
	['afd-discover', { search: 'bill' }],
	['afd-detail', { command: ['bill-pay', 'vault-open', 'note-create'] }],
	[
		'afd-batch',
		{ commands: [{ command: 'note-list' }, { command: 'bill-pay', input: { amount: 1 } }] },
	],
	['afd-batch', { commands: 'nope' }],
	[
		'afd-pipe',
		{ steps: [{ command: 'note-list' }, { command: 'note-create', input: { title: 'Pipe' } }] },
	],
	['afd-pipe', { steps: [{ command: 'vault-open' }] }],
	['afd-context-list', {}],
	['afd-context-enter', { context: 'billing' }],
	['afd-context-enter', { context: 'nope' }],
	['afd-context-exit', {}],
];

const GROUPED_CALLS: typeof CALLS = [
	['bill', { action: 'pay', params: { amount: 2 } }],
	['bill', {}],
	['note', { action: 'nope' }],
	['note', { action: 'create', params: { title: 'Grouped' } }],
];

const BOOTSTRAP_CALLS: typeof CALLS = [
	['afd-help', {}],
	['afd-help', { format: 'full' }],
	['afd-docs', {}],
	['afd-schema', {}],
];

const STRATEGIES: ToolStrategy[] = ['individual', 'grouped', 'lazy', 'hybrid'];
const CASES = STRATEGIES.flatMap((strategy) =>
	[false, true].map((bootstrap) => ({ strategy, bootstrap }))
);
const CONTEXTS = [null, 'writing', 'billing'];

function pair(strategy: ToolStrategy, bootstrap: boolean, options: DirectRegistryOptions = {}) {
	const firstClassTools = strategy === 'hybrid' ? FIRST_CLASS : undefined;
	const server = serve({
		name: 'parity',
		version: '1.0.0',
		host: '127.0.0.1',
		commands,
		contexts,
		toolStrategy: strategy,
		...(firstClassTools && { firstClassTools }),
		bootstrap,
	});
	const registry = createDirectRegistry(commands, {
		contexts,
		// The MCP server's remote engine calls as an agent; match it so metadata.actorKind agrees.
		actor: { kind: 'agent' },
		tools: createDirectToolSurface({ strategy, firstClassTools, bootstrap }),
		...options,
	});
	return { server, registry };
}

describe('createDirectToolSurface matches the MCP server', () => {
	describe.each(CASES)('$strategy strategy, bootstrap $bootstrap', ({ strategy, bootstrap }) => {
		const { server, registry } = pair(strategy, bootstrap);
		const calls = [
			...CALLS,
			...(strategy === 'grouped' ? GROUPED_CALLS : []),
			...(bootstrap ? BOOTSTRAP_CALLS : []),
		];

		it.each(CONTEXTS)('lists the same tools in context %s', async (context) => {
			const base = await server;
			const listed = registry.listTools(context ? { activeContext: context } : undefined);
			expect(normalize(listed)).toEqual(await mcpTools(base, context));
		});

		it.each(CONTEXTS)('answers every call the same way in context %s', async (context) => {
			const base = await server;
			for (const [tool, args] of calls) {
				const remote = await mcpCall(base, tool, args, context);
				const local = await registry.execute(
					tool,
					args,
					{},
					context ? { activeContext: context } : {}
				);
				expect(normalize(local), `${tool} ${JSON.stringify(args)}`).toEqual(normalize(remote));
			}
		});

		it('refuses an unknown context, as the MCP lane does', async () => {
			const base = await server;
			const listed = await modern(base, 'tools/list', meta('nope'));
			const called = await modern(base, 'tools/call', {
				name: 'note-list',
				arguments: {},
				...meta('nope'),
			});
			for (const answer of [listed, called]) {
				expect(answer.error?.code).toBe(-32602);
				expect(answer.error?.data?.suggestion).toBe('Use one of: writing, billing');
			}
			expect(() => registry.listTools({ activeContext: 'nope' })).toThrow(RangeError);
			expect(() => registry.listTools({ activeContext: 'nope' })).toThrow(
				'Use one of: writing, billing'
			);
			const result = await registry.execute('note-list', {}, {}, { activeContext: 'nope' });
			expect(result).toEqual({
				success: false,
				error: {
					code: 'CONTEXT_NOT_FOUND',
					message: "Context 'nope' is not configured",
					suggestion: 'Use one of: writing, billing',
					retryable: false,
				},
			});
		});
	});

	it('takes the listing strategy per call, defaulting to the surface’s', async () => {
		const { server, registry } = pair('lazy', false);
		const base = await server;
		const individual = await serve({
			name: 'parity',
			version: '1.0.0',
			host: '127.0.0.1',
			commands,
			contexts,
			toolStrategy: 'individual',
		});
		expect(normalize(registry.listTools())).toEqual(await mcpTools(base, null));
		expect(
			normalize(registry.listTools({ strategy: 'individual', activeContext: 'billing' }))
		).toEqual(await mcpTools(individual, 'billing'));
	});

	// The equalities above hold only if both sides answer something meaningful.
	it('compares real lists and real refusals', async () => {
		const { registry } = pair('individual', false);
		const names = (context?: string) =>
			registry.listTools(context ? { activeContext: context } : undefined).map((tool) => tool.name);
		expect(names()).toEqual([
			'afd-batch',
			'afd-pipe',
			'afd-call',
			'note-list',
			'note-create',
			'bill-pay',
			'bill-list',
			'afd-context-list',
			'afd-context-enter',
			'afd-context-exit',
		]);
		expect(names('writing')).not.toContain('bill-pay');
		expect(names('billing')).not.toContain('note-create');

		const code = async (tool: string, args: Record<string, unknown>, activeContext?: string) => {
			const result = (await registry.execute(tool, args, {}, { activeContext })) as {
				success: boolean;
				error?: { code: string; suggestion?: string };
			};
			return result.success ? 'ok' : result.error?.code;
		};
		expect(await code('bill-pay', { amount: 1 }, 'writing')).toBe('COMMAND_NOT_IN_CONTEXT');
		expect(await code('afd-call', { command: 'bill-pay', input: { amount: 1 } }, 'writing')).toBe(
			'COMMAND_NOT_IN_CONTEXT'
		);
		expect(await code('afd-call', { command: 'vault-open' })).toBe('COMMAND_NOT_FOUND');
		expect(await code('bill-pay', { amount: 1 }, 'billing')).toBe('ok');
		expect(await code('bill-pay', { amount: 1 })).toBe('ok');
		const refused = await registry.execute(
			'bill-pay',
			{ amount: 1 },
			{},
			{ activeContext: 'writing' }
		);
		expect(refused.error?.suggestion).toBe(
			'Use afd-context-list to see available contexts, or afd-context-enter to switch.'
		);
	});
});
