/**
 * @fileoverview AFD contexts and the tool surface in `createDirectRegistry` (#527, part 3): the
 * per-call `activeContext` option, the stateless context tools, meta-tool routing in process, the
 * registry's own interface exposure, the surface's construction checks, and `DirectClient`'s
 * `activeContext` and `listTools`. `direct-tool-surface.test.ts` compares the surface with the
 * MCP server.
 */

import { createDirectClient } from '@lushly-dev/afd-client';
import {
	type CommandContext,
	type CommandMiddleware,
	type CommandResult,
	fixedClock,
	success,
} from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApprovalMiddleware } from './approval.js';
import { bindContextState, createContextState, resolveContextState } from './context-scope.js';
import { createDirectRegistry, type DirectRegistryOptions } from './direct-registry.js';
import { createDirectToolSurface } from './direct-tool-surface.js';
import { defineCommand } from './schema.js';
import type { ContextConfig } from './server-types.js';

const contexts: ContextConfig[] = [{ name: 'writing' }, { name: 'billing' }];

const seen: CommandContext[] = [];
const commands = [
	defineCommand({
		name: 'note-create',
		description: 'Create a note',
		contexts: ['writing'],
		input: z.object({ title: z.string() }),
		handler: async ({ title }, context) => {
			seen.push(context);
			return success({ title });
		},
	}),
	defineCommand({
		name: 'bill-pay',
		description: 'Pay a bill',
		contexts: ['billing'],
		input: z.object({ amount: z.number() }),
		handler: async ({ amount }) => success({ paid: amount }),
	}),
	// Agent-only: the default exposure (palette and agent on, mcp off).
	defineCommand({
		name: 'panel-open',
		description: 'Open a panel',
		input: z.object({}),
		handler: async () => success({ open: true }),
	}),
	defineCommand({
		name: 'vault-open',
		description: 'Open the vault',
		expose: { agent: false },
		input: z.object({}),
		handler: async () => success({ open: true }),
	}),
];

/** The active context the middleware sees, per call. */
function recordActiveContext(into: Array<string | null | undefined>): CommandMiddleware {
	return async (_name, _input, context, next) => {
		into.push(resolveContextState(context)?.getActive());
		return next();
	};
}

function surfaceRegistry(options: DirectRegistryOptions = {}) {
	return createDirectRegistry(commands, { contexts, tools: createDirectToolSurface(), ...options });
}

describe('createDirectRegistry contexts, without a tool surface', () => {
	const registry = createDirectRegistry(commands, { contexts });

	it('scopes one call to its activeContext, and every command runs without one', async () => {
		expect(
			(await registry.execute('note-create', { title: 'a' }, {}, { activeContext: 'writing' }))
				.success
		).toBe(true);
		expect((await registry.execute('note-create', { title: 'a' })).success).toBe(true);
		expect((await registry.execute('bill-pay', { amount: 1 })).success).toBe(true);

		const refused = await registry.execute(
			'bill-pay',
			{ amount: 1 },
			{},
			{ activeContext: 'writing' }
		);
		// Without a surface there is no afd-context-list to point to: name the command's contexts.
		expect(refused.error).toEqual({
			code: 'COMMAND_NOT_IN_CONTEXT',
			message: "Command 'bill-pay' is not available in context 'writing'",
			suggestion:
				"Switch to a context this command belongs to ('billing'), or call it with no active context.",
		});
	});

	it('does not point to afd-discover, which it does not serve', async () => {
		const result = await registry.execute('note-creat', {});
		expect(result.error?.suggestion).toBe(
			"Did you mean 'note-create'? Check the command name against the available commands."
		);
	});

	it('refuses an unknown context before anything else', async () => {
		for (const name of ['nope', 'vault-open']) {
			const result = await registry.execute(name, {}, {}, { activeContext: 'nope' });
			expect(result.error?.code).toBe('CONTEXT_NOT_FOUND');
			expect(result.error?.suggestion).toBe('Use one of: writing, billing');
		}
		const plain = createDirectRegistry(commands);
		const none = await plain.execute('panel-open', {}, {}, { activeContext: 'writing' });
		expect(none.error).toEqual(
			expect.objectContaining({
				code: 'CONTEXT_NOT_FOUND',
				suggestion:
					'This registry configures no contexts: pass contexts to createDirectRegistry, or leave activeContext unset',
			})
		);
	});

	it('checks exposure before the context, as D4 orders them', async () => {
		const result = await registry.execute('vault-open', {}, {}, { activeContext: 'writing' });
		expect(result.error?.code).toBe('COMMAND_NOT_EXPOSED');
	});

	it('keeps the active context out of the command context', async () => {
		seen.length = 0;
		await registry.execute(
			'note-create',
			{ title: 'a' },
			{ traceId: 't-1' },
			{ activeContext: 'writing' }
		);
		expect(seen).toHaveLength(1);
		expect(Object.keys(seen[0] ?? {})).not.toContain('activeContext');
		expect(seen[0]?.traceId).toBe('t-1');
	});

	it('ignores a context state carried in on the caller’s context', async () => {
		const carried = createContextState();
		carried.enter('billing');
		const context = bindContextState({}, carried);
		expect((await registry.execute('note-create', { title: 'a' }, context)).success).toBe(true);
		const plain = createDirectRegistry(commands);
		expect((await plain.execute('note-create', { title: 'a' }, context)).success).toBe(true);
	});

	it('lists no tools, and says how to get them', () => {
		expect(() => registry.listTools()).toThrow(TypeError);
		expect(() => registry.listTools()).toThrow('tools: createDirectToolSurface()');
		expect(registry.hasCommand('afd-call')).toBe(false);
		expect(registry.hasCommand('afd-context-list')).toBe(false);
	});
});

describe('createDirectRegistry with a tool surface', () => {
	it('answers the context tools as the stateless MCP lane does: nothing persists', async () => {
		const registry = surfaceRegistry();
		const entered = await registry.execute('afd-context-enter', { context: 'billing' });
		expect(entered).toEqual(
			expect.objectContaining({
				success: true,
				data: { entered: 'billing', previous: null, persisted: false },
				// The 2026-07-28 lane's hint, word for word, as Rust's in-process registry gives it.
				reasoning: expect.stringContaining('Context changes do not persist'),
			})
		);
		const listed = await registry.execute('afd-context-list', {});
		expect(listed.data).toEqual(expect.objectContaining({ activeContext: null }));

		const inWriting = { activeContext: 'writing' };
		const reentered = await registry.execute(
			'afd-context-enter',
			{ context: 'billing' },
			{},
			inWriting
		);
		expect(reentered.data).toEqual({ entered: 'billing', previous: 'writing', persisted: false });
		const exited = await registry.execute('afd-context-exit', {}, {}, inWriting);
		expect(exited.data).toEqual({ exited: null, current: 'writing', persisted: false });
		const unknown = await registry.execute('afd-context-enter', { context: 'nope' });
		expect(unknown.error?.code).toBe('CONTEXT_NOT_FOUND');
	});

	it('routes the meta-tools through the registry’s middleware and hooks', async () => {
		const ran: string[] = [];
		const onCommand = vi.fn();
		const registry = surfaceRegistry({
			onCommand,
			middleware: [
				async (name, _input, _context, next) => {
					ran.push(name);
					return next();
				},
			],
		});
		const called = await registry.execute('afd-call', { command: 'panel-open' });
		expect(called).toEqual(expect.objectContaining({ success: true, data: { open: true } }));
		expect(ran).toEqual(['panel-open']);
		expect(onCommand).toHaveBeenCalledWith('panel-open', {}, expect.anything());

		const batch = (await registry.execute(
			'afd-batch',
			{
				commands: [
					{ command: 'note-create', input: { title: 'a' } },
					{ command: 'bill-pay', input: { amount: 1 } },
				],
			},
			{},
			{ activeContext: 'writing' }
		)) as unknown as { results: Array<{ result: CommandResult }> };
		expect(batch.results.map((item) => item.result.error?.code ?? 'ok')).toEqual([
			'ok',
			'COMMAND_NOT_IN_CONTEXT',
		]);
	});

	it('answers hasCommand for the tools it routes, and lists its own commands', () => {
		const registry = surfaceRegistry();
		for (const tool of ['afd-call', 'afd-batch', 'afd-pipe', 'afd-discover', 'afd-detail']) {
			expect(registry.hasCommand(tool)).toBe(true);
		}
		expect(registry.listCommandNames()).toEqual([
			'note-create',
			'bill-pay',
			'panel-open',
			'afd-context-list',
			'afd-context-enter',
			'afd-context-exit',
		]);
		expect(registry.hasCommand('note')).toBe(false);
	});

	it('routes grouped tool names only under the grouped strategy', async () => {
		const grouped = surfaceRegistry({ tools: createDirectToolSurface({ strategy: 'grouped' }) });
		expect(grouped.hasCommand('note')).toBe(true);
		const result = await grouped.execute('note', { action: 'create', params: { title: 'g' } });
		expect(result).toEqual(expect.objectContaining({ success: true, data: { title: 'g' } }));
		const individual = surfaceRegistry();
		expect((await individual.execute('note', { action: 'create' })).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
	});

	it('lists and routes the commands exposed to its interface, as the server does MCP-exposed ones', async () => {
		const names = (options: DirectRegistryOptions) =>
			surfaceRegistry(options)
				.listTools()
				.map((tool) => tool.name);
		// panel-open is agent-only: an agent registry lists it, an MCP-interface one does not.
		expect(names({})).toContain('panel-open');
		expect(names({ interface: 'mcp' })).not.toContain('panel-open');
		expect(names({})).not.toContain('vault-open');
		const discovered = (await surfaceRegistry().execute('afd-discover', {})) as CommandResult<{
			commands: Array<{ name: string }>;
		}>;
		expect(discovered.data?.commands.map((command) => command.name)).toContain('panel-open');
		// The surface's own tools are exposed to whatever interface the registry serves.
		const cli = surfaceRegistry({ interface: 'cli' });
		expect(cli.listTools().map((tool) => tool.name)).toEqual([
			'afd-batch',
			'afd-pipe',
			'afd-call',
			'afd-context-list',
			'afd-context-enter',
			'afd-context-exit',
		]);
		expect((await cli.execute('afd-context-list', {})).success).toBe(true);
	});

	it('reports its strategy through afd-help, as an MCP server does', async () => {
		const registry = surfaceRegistry({
			tools: createDirectToolSurface({
				strategy: 'hybrid',
				firstClassTools: ['panel-open'],
				bootstrap: true,
			}),
		});
		const help = await registry.execute('afd-help', {});
		expect(help.data).toEqual(
			expect.objectContaining({ toolStrategy: 'hybrid', firstClassTools: ['panel-open'] })
		);
	});

	it('checks names and the first-class set when the registry is created', () => {
		const named = (name: string) =>
			defineCommand({
				name,
				description: name,
				input: z.object({}),
				handler: async () => success({}),
			});
		expect(() => createDirectRegistry([named('afd-call')])).not.toThrow();
		expect(() =>
			createDirectRegistry([named('afd-call')], { tools: createDirectToolSurface() })
		).toThrow(/reserved/);
		expect(() =>
			createDirectRegistry([named('afd-context-list')], { tools: createDirectToolSurface() })
		).not.toThrow();
		expect(() =>
			createDirectRegistry([named('afd-context-list')], {
				contexts,
				tools: createDirectToolSurface(),
			})
		).toThrow(/reserved/);
		expect(() =>
			createDirectRegistry([named('afd-help')], {
				tools: createDirectToolSurface({ bootstrap: true }),
			})
		).toThrow(/reserved/);
		expect(() =>
			surfaceRegistry({ tools: createDirectToolSurface({ strategy: 'hybrid' }) })
		).toThrow(/needs firstClassTools/);
		expect(() =>
			surfaceRegistry({ tools: createDirectToolSurface({ firstClassTools: ['panel-open'] }) })
		).toThrow(/only valid with toolStrategy: 'hybrid'/);
		expect(() =>
			surfaceRegistry({
				tools: createDirectToolSurface({ strategy: 'hybrid', firstClassTools: ['vault-open'] }),
			})
		).toThrow("'vault-open' is not exposed to agent (expose.agent is not true)");
		expect(() => createDirectToolSurface({ strategy: 'flat' as never })).toThrow(TypeError);
	});
});

describe('DirectClient with contexts and a tool surface', () => {
	it('passes activeContext to the registry for calls and every pipeline step', async () => {
		const client = createDirectClient(surfaceRegistry());
		const refused = await client.call('bill-pay', { amount: 1 }, { activeContext: 'writing' });
		expect(refused.error?.code).toBe('COMMAND_NOT_IN_CONTEXT');
		expect((await client.call('bill-pay', { amount: 1 })).success).toBe(true);

		const piped = await client.pipe(
			[
				{ command: 'note-create', input: { title: 'p' } },
				{ command: 'bill-pay', input: { amount: 1 } },
			],
			{ activeContext: 'writing' }
		);
		expect(piped.steps.map((step) => step.error?.code ?? step.status)).toEqual([
			'success',
			'COMMAND_NOT_IN_CONTEXT',
		]);

		seen.length = 0;
		await client.call('note-create', { title: 'a' }, { activeContext: 'writing', tenant: 't-1' });
		expect(seen[0]).toEqual(expect.objectContaining({ tenant: 't-1' }));
		expect(Object.keys(seen[0] ?? {})).not.toContain('activeContext');
	});

	it('lists the registry’s tools that allow permits, and refuses the rest', async () => {
		const registry = surfaceRegistry();
		const allowed = new Set(['note-create', 'afd-call']);
		const client = createDirectClient(registry, { allow: (name) => allowed.has(name) });
		expect(client.listTools().map((tool) => tool.name)).toEqual(['afd-call', 'note-create']);
		expect(client.listTools({ activeContext: 'billing' }).map((tool) => tool.name)).toEqual([
			'afd-call',
		]);
		expect(client.listTools({ strategy: 'lazy' }).map((tool) => tool.name)).toEqual(['afd-call']);
		expect(client.hasCommand('afd-batch')).toBe(false);
		expect((await client.call('afd-batch', { commands: [] })).error?.code).toBe(
			'COMMAND_NOT_ALLOWED'
		);
		const viaCall = await client.call('afd-call', {
			command: 'note-create',
			input: { title: 'c' },
		});
		expect(viaCall).toEqual(expect.objectContaining({ success: true, data: { title: 'c' } }));

		expect(() => createDirectClient(createDirectRegistry(commands)).listTools()).toThrow(TypeError);
	});

	it('runs the approval retry in the same active context, directly and through afd-call', async () => {
		const clock = fixedClock('2026-10-31T12:00:00Z');
		const gated = defineCommand({
			name: 'bill-refund',
			description: 'Refund a bill',
			approval: 'required',
			contexts: ['billing'],
			input: z.object({ amount: z.number() }),
			handler: async ({ amount }) => success({ refunded: amount }),
		});
		const active: Array<string | null | undefined> = [];
		const registry = createDirectRegistry([gated], {
			contexts,
			tools: createDirectToolSurface(),
			middleware: [
				recordActiveContext(active),
				createApprovalMiddleware({
					commands: [gated],
					secret: 'test-only-approval-secret-32-bytes-long',
					clock,
				}),
			],
		});
		const hook = vi.fn(async () => true);
		const client = createDirectClient(registry, { onApprovalNeeded: hook });

		const direct = await client.call('bill-refund', { amount: 5 }, { activeContext: 'billing' });
		expect(direct).toEqual(expect.objectContaining({ success: true, data: { refunded: 5 } }));
		expect(active).toEqual(['billing', 'billing']);

		active.length = 0;
		const routed = await client.call(
			'afd-call',
			{ command: 'bill-refund', input: { amount: 6 } },
			{ activeContext: 'billing' }
		);
		expect(routed).toEqual(expect.objectContaining({ success: true, data: { refunded: 6 } }));
		expect(active).toEqual(['billing', 'billing']);
		expect(hook).toHaveBeenCalledTimes(2);
	});
});
