/**
 * @fileoverview The `allow` call option of `createDirectRegistry` (#577), and `DirectClient`'s
 * `allow` passed through it.
 *
 * `allow` covers every command a call runs: the name called, the `afd-call` target, each
 * `afd-batch` item, each `afd-pipe` step, a grouped tool's action and a command a handler runs
 * through its own context. `afd-discover`, `afd-detail`, the bootstrap tools and `listTools`
 * leave refused commands out. Without `allow`, nothing changes.
 */

import { createDirectClient, DirectTransport } from '@lushly-dev/afd-client';
import type { BatchResult, CommandContext, McpTool, PipelineResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDirectRegistry, type DirectCommandRegistry } from './direct-registry.js';
import { createDirectToolSurface, type DirectToolSurfaceOptions } from './direct-tool-surface.js';
import { defineCommand } from './schema.js';

/** The ids each `note-delete` call deleted, and the contexts its handlers saw. */
const deleted: string[] = [];
const seen: CommandContext[] = [];

/** The registry `note-purge` re-enters with its own context. */
let reentry: DirectCommandRegistry | undefined;

const commands = [
	defineCommand({
		name: 'note-list',
		description: 'List notes',
		input: z.object({}),
		handler: async (_input, context) => {
			seen.push(context);
			return success({ notes: ['milk'] });
		},
	}),
	defineCommand({
		name: 'note-delete',
		description: 'Delete a note forever',
		mutation: true,
		destructive: true,
		input: z.object({ id: z.string() }),
		handler: async ({ id }) => {
			deleted.push(id);
			return success({ deleted: id });
		},
	}),
	// Runs another command through the context it was given.
	defineCommand({
		name: 'note-purge',
		description: 'Purge notes',
		input: z.object({ id: z.string() }),
		handler: async ({ id }, context) => {
			const inner = await reentry?.execute('note-delete', { id }, context);
			return success({ inner });
		},
	}),
];

function surfaceRegistry(options: DirectToolSurfaceOptions = {}) {
	deleted.length = 0;
	seen.length = 0;
	const registry = createDirectRegistry(commands, { tools: createDirectToolSurface(options) });
	reentry = registry;
	return registry;
}

const ALLOW = ['afd-call', 'afd-batch', 'afd-pipe', 'note-list'];

function allowing(names: readonly string[]) {
	const allowed = new Set(names);
	return (name: string) => allowed.has(name);
}

const NOT_ALLOWED = {
	success: false,
	error: {
		code: 'COMMAND_NOT_ALLOWED',
		message: "Command 'note-delete' is not allowed for this client",
		suggestion: 'Call one of the commands returned by listCommandNames()',
		retryable: false,
	},
};

describe('DirectClient allow, through a registry with a tool surface', () => {
	it('refuses a command it does not allow through afd-call, and runs one it allows', async () => {
		const client = createDirectClient(surfaceRegistry(), { allow: allowing(ALLOW) });

		const refused = await client.call('afd-call', { command: 'note-delete', input: { id: 'n1' } });
		expect(refused).toEqual(NOT_ALLOWED);
		// A refused name that does not exist gives the same answer.
		const unknown = await client.call('afd-call', { command: 'note-gone', input: {} });
		expect(unknown.error?.code).toBe('COMMAND_NOT_ALLOWED');

		const listed = await client.call('afd-call', { command: 'note-list', input: {} });
		expect(listed).toEqual(expect.objectContaining({ success: true, data: { notes: ['milk'] } }));
		expect(deleted).toEqual([]);
	});

	it('refuses it as an afd-batch item, and runs the items it allows', async () => {
		const client = createDirectClient(surfaceRegistry(), { allow: allowing(ALLOW) });

		const result = await client.call<BatchResult>('afd-batch', {
			commands: [
				{ command: 'note-list', input: {} },
				{ command: 'note-delete', input: { id: 'n1' } },
			],
		});
		const batch = result as unknown as BatchResult;
		expect(batch.results.map((item) => item.result.error?.code ?? 'ok')).toEqual([
			'ok',
			'COMMAND_NOT_ALLOWED',
		]);
		expect(batch.results[1]?.result).toEqual(NOT_ALLOWED);
		expect(deleted).toEqual([]);
	});

	it('refuses it as an afd-pipe step, and runs the steps it allows', async () => {
		const client = createDirectClient(surfaceRegistry(), { allow: allowing(ALLOW) });

		const result = await client.call('afd-pipe', {
			steps: [
				{ command: 'note-list', input: {} },
				{ command: 'note-delete', input: { id: 'n1' } },
			],
		});
		const pipeline = result as unknown as PipelineResult;
		expect(pipeline.steps.map((step) => step.error?.code ?? step.status)).toEqual([
			'success',
			'COMMAND_NOT_ALLOWED',
		]);
		expect(deleted).toEqual([]);
	});

	it('passes allow with every client pipe() step', async () => {
		const client = createDirectClient(surfaceRegistry(), { allow: allowing(ALLOW) });

		const result = await client.pipe([
			{ command: 'afd-call', input: { command: 'note-list', input: {} } },
			{ command: 'afd-call', input: { command: 'note-delete', input: { id: 'n1' } } },
		]);
		expect(result.steps.map((step) => step.error?.code ?? step.status)).toEqual([
			'success',
			'COMMAND_NOT_ALLOWED',
		]);
		expect(deleted).toEqual([]);
	});

	it('refuses a grouped tool action it does not allow, and runs one it allows', async () => {
		const registry = surfaceRegistry({ strategy: 'grouped' });
		// The group's tool name is checked like any other name, so the client allows `note` too.
		const client = createDirectClient(registry, { allow: allowing([...ALLOW, 'note']) });

		// A refused action is invisible, so it reads as one the group does not have.
		const refused = await client.call('note', { action: 'delete', params: { id: 'n1' } });
		expect(refused.error?.code).toBe('COMMAND_NOT_FOUND');
		const listed = await client.call('note', { action: 'list', params: {} });
		expect(listed).toEqual(expect.objectContaining({ success: true, data: { notes: ['milk'] } }));
		expect(deleted).toEqual([]);

		// The group lists only the actions allow permits; a missing action names only those.
		const group = client.listTools().find((tool) => tool.name === 'note');
		expect(group?.inputSchema.properties?.action).toEqual(
			expect.objectContaining({ enum: ['list'] })
		);
		expect(JSON.stringify(group)).not.toContain('note-delete');
		const missing = await client.call('note', {});
		expect(missing.error?.code).toBe('INVALID_GROUPED_CALL');
		expect(missing.error?.suggestion).toContain('Available actions: list');
		expect(missing.error?.suggestion).not.toContain('delete');
	});

	it('leaves refused commands out of afd-discover and afd-detail', async () => {
		const client = createDirectClient(surfaceRegistry(), {
			allow: allowing([...ALLOW, 'afd-discover', 'afd-detail']),
		});

		const discovered = await client.call<{ commands: Array<{ name: string }>; total: number }>(
			'afd-discover',
			{}
		);
		expect(discovered.success).toBe(true);
		const found = discovered.data as { commands: Array<{ name: string }>; total: number };
		expect(found.commands.map((command) => command.name)).toEqual(['note-list']);
		expect(found.total).toBe(1);
		expect(JSON.stringify(discovered)).not.toContain('note-delete');

		const detail = await client.call('afd-detail', { command: ['note-list', 'note-delete'] });
		const entries = detail.data as Array<{ name: string; found: boolean; error?: unknown }>;
		expect(entries.map((entry) => [entry.name, entry.found])).toEqual([
			['note-list', true],
			['note-delete', false],
		]);
		expect(entries[1]?.error).toEqual(expect.objectContaining({ code: 'COMMAND_NOT_FOUND' }));
		expect(JSON.stringify(detail)).not.toContain('Delete a note forever');

		// A typo suggests only commands allow permits.
		const typo = await client.call('afd-detail', { command: 'note-delet' });
		expect(JSON.stringify(typo)).toContain('note-delet');
		expect(JSON.stringify(typo)).not.toContain('note-delete');
	});

	it('leaves refused commands out of the bootstrap tools', async () => {
		const client = createDirectClient(surfaceRegistry({ bootstrap: true }), {
			allow: allowing([...ALLOW, 'afd-help', 'afd-schema']),
		});

		const help = await client.call('afd-help', {});
		expect(help.success).toBe(true);
		expect(JSON.stringify(help)).toContain('note-list');
		expect(JSON.stringify(help)).not.toContain('note-delete');
		const schema = await client.call('afd-schema', {});
		expect(schema.success).toBe(true);
		expect(JSON.stringify(schema)).not.toContain('note-delete');
	});

	it('covers a command a handler runs through the context it was given', async () => {
		const client = createDirectClient(surfaceRegistry(), {
			allow: allowing([...ALLOW, 'note-purge']),
		});

		const purged = await client.call<{ inner: unknown }>('note-purge', { id: 'n1' });
		expect(purged.success).toBe(true);
		expect((purged.data as { inner: unknown }).inner).toEqual(NOT_ALLOWED);
		const viaCall = await client.call('afd-call', { command: 'note-purge', input: { id: 'n2' } });
		expect((viaCall.data as { inner: unknown }).inner).toEqual(NOT_ALLOWED);
		expect(deleted).toEqual([]);
	});

	it('changes nothing for a client without allow', async () => {
		const client = createDirectClient(surfaceRegistry());

		const viaCall = await client.call('afd-call', { command: 'note-delete', input: { id: 'n1' } });
		expect(viaCall).toEqual(expect.objectContaining({ success: true, data: { deleted: 'n1' } }));
		const batch = (await client.call('afd-batch', {
			commands: [{ command: 'note-delete', input: { id: 'n2' } }],
		})) as unknown as BatchResult;
		expect(batch.results[0]?.result.success).toBe(true);
		const purged = await client.call('note-purge', { id: 'n3' });
		expect((purged.data as { inner: { success: boolean } }).inner.success).toBe(true);
		expect(deleted).toEqual(['n1', 'n2', 'n3']);

		const discovered = await client.call('afd-discover', {});
		expect(JSON.stringify(discovered)).toContain('note-delete');
	});
});

describe('createDirectRegistry execute with the allow option', () => {
	const allow = allowing(ALLOW);

	it('refuses the name called and every command it runs that allow rejects', async () => {
		const registry = surfaceRegistry();

		expect(await registry.execute('note-delete', { id: 'n1' }, {}, { allow })).toEqual(NOT_ALLOWED);
		expect(
			await registry.execute(
				'afd-call',
				{ command: 'note-delete', input: { id: 'n1' } },
				{},
				{ allow }
			)
		).toEqual(NOT_ALLOWED);
		const batch = (await registry.execute(
			'afd-batch',
			{ commands: [{ command: 'note-delete', input: { id: 'n1' } }] },
			{},
			{ allow }
		)) as unknown as BatchResult;
		expect(batch.results[0]?.result).toEqual(NOT_ALLOWED);
		const pipeline = (await registry.execute(
			'afd-pipe',
			{ steps: [{ command: 'note-delete', input: { id: 'n1' } }] },
			{},
			{ allow }
		)) as unknown as PipelineResult;
		expect(pipeline.steps[0]?.error?.code).toBe('COMMAND_NOT_ALLOWED');
		expect(deleted).toEqual([]);

		// A meta-tool's own name is checked too, as DirectClient checks it.
		const noCall = await registry.execute(
			'afd-call',
			{ command: 'note-list', input: {} },
			{},
			{ allow: (name) => name !== 'afd-call' }
		);
		expect(noCall.error).toEqual(
			expect.objectContaining({
				code: 'COMMAND_NOT_ALLOWED',
				message: "Command 'afd-call' is not allowed for this client",
			})
		);
		expect(
			await registry.execute('afd-call', { command: 'note-list', input: {} }, {}, { allow })
		).toEqual(expect.objectContaining({ success: true }));
	});

	it('refuses a grouped action, and denies everything when the predicate throws', async () => {
		const registry = surfaceRegistry({ strategy: 'grouped' });
		const withGroup = allowing([...ALLOW, 'note']);

		const refusedAction = await registry.execute(
			'note',
			{ action: 'delete', params: { id: 'n1' } },
			{},
			{ allow: withGroup }
		);
		expect(refusedAction.error?.code).toBe('COMMAND_NOT_FOUND');
		expect(
			(await registry.execute('note', { action: 'list', params: {} }, {}, { allow: withGroup }))
				.success
		).toBe(true);

		const throwing = () => {
			throw new Error('policy unavailable');
		};
		const refused = await registry.execute('note-list', {}, {}, { allow: throwing });
		expect(refused.error?.code).toBe('COMMAND_NOT_ALLOWED');
		expect(deleted).toEqual([]);
	});

	it('refuses a group whose every action allow refuses, as it lists none of them', async () => {
		const registry = surfaceRegistry({ strategy: 'grouped' });
		const allow = allowing(['note']);
		for (const args of [{ action: 'list', params: {} }, {}]) {
			const result = await registry.execute('note', args, {}, { allow });
			expect(result.error).toMatchObject({
				code: 'COMMAND_NOT_ALLOWED',
				message: "Command 'note' is not allowed for this client",
			});
		}
		expect(registry.listTools({ strategy: 'grouped', allow }).map((tool) => tool.name)).toEqual([]);
		expect(deleted).toEqual([]);
	});

	it('does not let a refused command make a grouped action ambiguous', async () => {
		const archive = defineCommand({
			name: 'archive-list',
			description: 'List archived notes',
			category: 'note',
			input: z.object({}),
			handler: async () => success({ archived: [] }),
		});
		const registry = createDirectRegistry([...commands, archive], {
			tools: createDirectToolSurface({ strategy: 'grouped' }),
		});
		const call = (allow?: (name: string) => boolean) =>
			registry.execute('note', { action: 'list', params: {} }, {}, allow ? { allow } : {});

		expect((await call())?.error?.code).toBe('AMBIGUOUS_ACTION');
		// With archive-list refused, the action names one command, as if archive-list did not exist.
		expect(await call(allowing(['note', 'note-list']))).toEqual(
			expect.objectContaining({ success: true, data: { notes: ['milk'] } })
		);
		expect((await call(allowing(['note', 'archive-list'])))?.data).toEqual({ archived: [] });
	});

	it('lists only what allow permits from listTools', () => {
		const registry = surfaceRegistry();
		const names = (tools: McpTool[]) => tools.map((tool) => tool.name);

		expect(names(registry.listTools())).toEqual([
			'afd-batch',
			'afd-pipe',
			'afd-call',
			'note-list',
			'note-delete',
			'note-purge',
		]);
		expect(names(registry.listTools({ allow }))).toEqual([
			'afd-batch',
			'afd-pipe',
			'afd-call',
			'note-list',
		]);
		const grouped = registry.listTools({
			strategy: 'grouped',
			allow: allowing([...ALLOW, 'note']),
		});
		expect(names(grouped)).toEqual(['afd-batch', 'afd-pipe', 'afd-call', 'note']);
		expect(JSON.stringify(grouped)).not.toContain('note-delete');
		expect(names(registry.listTools({ strategy: 'grouped', allow }))).toEqual([
			'afd-batch',
			'afd-pipe',
			'afd-call',
		]);
	});

	it('keeps the predicate away from handlers, and ignores an allow key in the context', async () => {
		const registry = surfaceRegistry();
		await registry.execute('note-list', {}, {}, { allow });
		const context = seen[0] ?? {};
		expect(Object.keys(context)).not.toContain('allow');
		const symbolValues = Object.getOwnPropertySymbols(context).map(
			(key) => (context as Record<symbol, unknown>)[key]
		);
		expect(symbolValues.some((value) => typeof value === 'function')).toBe(false);

		// A command-context value named allow is a plain value, not the call option.
		const result = await registry.execute('note-delete', { id: 'n1' }, { allow: () => false });
		expect(result.success).toBe(true);
		expect(deleted).toEqual(['n1']);
	});

	it('changes nothing without allow', async () => {
		const registry = surfaceRegistry();

		expect(
			(await registry.execute('afd-call', { command: 'note-delete', input: { id: 'n1' } })).success
		).toBe(true);
		expect((await registry.execute('note-delete', { id: 'n2' }, {}, {})).success).toBe(true);
		expect(deleted).toEqual(['n1', 'n2']);
	});
});

describe('DirectTransport tools/list over createDirectRegistry', () => {
	async function listedNames(registry: DirectCommandRegistry): Promise<string[]> {
		const transport = new DirectTransport(registry);
		await transport.connect();
		const response = await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
		return (response.result as { tools: McpTool[] }).tools.map((tool) => tool.name);
	}

	it('lists the tool surface when the registry has one, and the commands otherwise', async () => {
		const registry = surfaceRegistry({ strategy: 'lazy' });
		expect(await listedNames(registry)).toEqual(registry.listTools().map((tool) => tool.name));
		expect(await listedNames(registry)).toContain('afd-discover');

		expect(await listedNames(createDirectRegistry(commands))).toEqual([
			'note-list',
			'note-delete',
			'note-purge',
		]);
	});
});
