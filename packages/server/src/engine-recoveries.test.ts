/**
 * The recovery each engine error carries (`spec/recovery.md`, "Engine errors"), for the rows no
 * shared vector reaches: the rate limiter, the context commands, `afd-help`, `COMMAND_NOT_ALLOWED`,
 * a grouped tool's unknown action, `afd-detail`, batch items and pipeline steps, and every row that
 * turns on what the caller can call. Each refusal that names a command names one the caller can
 * call, in its suggestion and in its recovery alike, and names none it cannot (rules 1 and 2).
 */

import type { BatchResult, CommandResult, PipelineResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getBootstrapCommands } from './bootstrap/registry.js';
import { createDirectRegistry } from './direct-registry.js';
import { createDirectToolSurface } from './direct-tool-surface.js';
import { createRateLimitMiddleware } from './middleware.js';
import { defineCommand } from './schema.js';

const contexts = [{ name: 'writing' }, { name: 'billing' }];

const commands = [
	defineCommand({
		name: 'note-create',
		description: 'Create a note',
		contexts: ['writing'],
		input: z.object({ title: z.string() }),
		handler: async (input) => success(input),
	}),
	defineCommand({
		name: 'bill-pay',
		description: 'Pay a bill',
		contexts: ['billing'],
		input: z.object({ amount: z.number() }),
		handler: async (input) => success(input),
	}),
];

/** Every name but `refused`, as a DirectClient's `allow` list passes it. */
const allowAllBut =
	(...refused: string[]) =>
	(name: string) =>
		!refused.includes(name);

describe('COMMAND_NOT_FOUND', () => {
	it('names afd-discover where the caller can call it', async () => {
		const registry = createDirectRegistry(commands, { tools: createDirectToolSurface() });
		const result = await registry.execute('note-creat', {});
		expect(result.error).toEqual({
			code: 'COMMAND_NOT_FOUND',
			message: "Command 'note-creat' not found",
			suggestion: "Did you mean 'note-create'? Use afd-discover to list all commands.",
			recovery: { kind: 'call', command: 'afd-discover' },
		});
	});

	it('names afd-help when an allow list refuses afd-discover and admits afd-help', async () => {
		const registry = createDirectRegistry(commands, {
			tools: createDirectToolSurface({ bootstrap: true }),
		});
		const result = await registry.execute('zzzz', {}, {}, { allow: allowAllBut('afd-discover') });
		expect(result.error).toMatchObject({
			code: 'COMMAND_NOT_FOUND',
			suggestion: 'Use afd-help to list all commands.',
			recovery: { kind: 'call', command: 'afd-help' },
		});
		expect(
			(await registry.execute('afd-help', {}, {}, { allow: allowAllBut('afd-discover') })).success
		).toBe(true);
	});

	it('names afd-help registered as a plain command on a registry with no tool surface', async () => {
		const registry = createDirectRegistry([...commands, ...getBootstrapCommands(() => [])]);
		const result = await registry.execute('zzzz', {});
		expect(result.error?.suggestion).toBe('Use afd-help to list all commands.');
		expect(result.error?.recovery).toEqual({ kind: 'call', command: 'afd-help' });
		expect((await registry.execute('afd-help', {})).success).toBe(true);
	});

	it('names neither where the caller can call neither, and sets no recovery', async () => {
		const registry = createDirectRegistry(commands, {
			tools: createDirectToolSurface({ bootstrap: true }),
		});
		const result = await registry.execute(
			'zzzz',
			{},
			{},
			{ allow: allowAllBut('afd-discover', 'afd-help') }
		);
		expect(result.error?.suggestion).toBe('Check the command name against the available commands.');
		expect(result.error).not.toHaveProperty('recovery');
	});

	it('gives afd-call, a batch item and a pipeline step the same recovery', async () => {
		const registry = createDirectRegistry(commands, { tools: createDirectToolSurface() });
		const discover = { kind: 'call', command: 'afd-discover' };
		const called = await registry.execute('afd-call', { command: 'zzzz' });
		expect(called.error?.recovery).toEqual(discover);
		const batch = (await registry.execute('afd-batch', {
			commands: [{ command: 'zzzz' }],
		})) as unknown as BatchResult;
		expect(batch.results[0]?.result.error?.recovery).toEqual(discover);
		const pipe = (await registry.execute('afd-pipe', {
			steps: [{ command: 'zzzz' }],
		})) as unknown as PipelineResult;
		expect(pipe.steps[0]?.error?.recovery).toEqual(discover);
		// Refused by the allow list, afd-call's unknown name names neither tool.
		const narrowed = await registry.execute(
			'afd-call',
			{ command: 'zzzz' },
			{},
			{ allow: allowAllBut('afd-discover') }
		);
		expect(narrowed.error?.code).toBe('COMMAND_NOT_FOUND');
		expect(narrowed.error?.suggestion).toBe(
			'Check the command name against the available commands.'
		);
		expect(narrowed.error).not.toHaveProperty('recovery');
	});

	it('sets none for a grouped tool’s unknown action or an afd-detail entry', async () => {
		const grouped = createDirectRegistry(commands, {
			tools: createDirectToolSurface({ strategy: 'grouped' }),
		});
		const action = await grouped.execute('note', { action: 'nope' });
		expect(action.error?.code).toBe('COMMAND_NOT_FOUND');
		expect(action.error).not.toHaveProperty('recovery');

		const registry = createDirectRegistry(commands, { tools: createDirectToolSurface() });
		const detail = (await registry.execute('afd-detail', { command: 'zzzz' })) as CommandResult<
			Array<{ found: boolean; error?: Record<string, unknown> }>
		>;
		expect(detail.data?.[0]?.error).toMatchObject({ code: 'COMMAND_NOT_FOUND' });
		expect(detail.data?.[0]?.error).not.toHaveProperty('recovery');
		// Its suggestion names afd-discover only where the caller can call it.
		const narrowed = (await registry.execute(
			'afd-detail',
			{ command: 'zzzz' },
			{},
			{ allow: allowAllBut('afd-discover') }
		)) as CommandResult<Array<{ error?: { suggestion?: string } }>>;
		expect(narrowed.data?.[0]?.error?.suggestion).toBe(
			'Check the command name against the available commands.'
		);
	});
});

describe('COMMAND_NOT_IN_CONTEXT', () => {
	const surface = () =>
		createDirectRegistry(commands, { contexts, tools: createDirectToolSurface() });

	it('names afd-context-list where the caller can call it', async () => {
		const result = await surface().execute(
			'bill-pay',
			{ amount: 1 },
			{},
			{ activeContext: 'writing' }
		);
		expect(result.error).toEqual({
			code: 'COMMAND_NOT_IN_CONTEXT',
			message: "Command 'bill-pay' is not available in context 'writing'",
			suggestion: 'Use afd-context-list to see available contexts, or afd-context-enter to switch.',
			recovery: { kind: 'call', command: 'afd-context-list' },
		});
	});

	it('names the contexts instead when an allow list refuses afd-context-list', async () => {
		const result = await surface().execute(
			'bill-pay',
			{ amount: 1 },
			{},
			{ activeContext: 'writing', allow: allowAllBut('afd-context-list') }
		);
		expect(result.error).toEqual({
			code: 'COMMAND_NOT_IN_CONTEXT',
			message: "Command 'bill-pay' is not available in context 'writing'",
			suggestion:
				"Switch to a context this command belongs to ('billing'), or call it with no active context.",
		});
	});

	it('leaves out afd-context-enter when only it is refused', async () => {
		const result = await surface().execute(
			'afd-call',
			{ command: 'bill-pay', input: { amount: 1 } },
			{},
			{ activeContext: 'writing', allow: allowAllBut('afd-context-enter') }
		);
		expect(result.error?.suggestion).toBe('Use afd-context-list to see available contexts.');
		expect(result.error?.recovery).toEqual({ kind: 'call', command: 'afd-context-list' });
	});
});

describe('the context commands', () => {
	const registry = createDirectRegistry(commands, { contexts, tools: createDirectToolSurface() });

	it('CONTEXT_NOT_FOUND from afd-context-enter names afd-context-list where it can be called', async () => {
		const result = await registry.execute('afd-context-enter', { context: 'nope' });
		expect(result.error).toEqual({
			code: 'CONTEXT_NOT_FOUND',
			message: "Context 'nope' is not configured",
			suggestion: 'Available contexts: writing, billing. Use afd-context-list to see all contexts.',
			recovery: { kind: 'call', command: 'afd-context-list' },
		});
		const refused = await registry.execute(
			'afd-context-enter',
			{ context: 'nope' },
			{},
			{ allow: allowAllBut('afd-context-list') }
		);
		expect(refused.error).toEqual({
			code: 'CONTEXT_NOT_FOUND',
			message: "Context 'nope' is not configured",
			suggestion: 'Available contexts: writing, billing.',
		});
	});

	it('CONTEXT_NOT_FOUND for a direct registry’s unknown activeContext carries none', async () => {
		const result = await registry.execute(
			'note-create',
			{ title: 'a' },
			{},
			{ activeContext: 'nope' }
		);
		expect(result.error?.code).toBe('CONTEXT_NOT_FOUND');
		expect(result.error).not.toHaveProperty('recovery');
	});
});

describe('COMMAND_NOT_ALLOWED', () => {
	it('carries none: the remedy is the client’s own listCommandNames()', async () => {
		const registry = createDirectRegistry(commands, { tools: createDirectToolSurface() });
		for (const [name, input] of [
			['note-create', { title: 'a' }],
			['afd-call', { command: 'note-create', input: { title: 'a' } }],
		] as const) {
			const result = await registry.execute(name, input, {}, { allow: allowAllBut('note-create') });
			expect(result.error?.code).toBe('COMMAND_NOT_ALLOWED');
			expect(result.error).not.toHaveProperty('recovery');
		}
	});
});

describe('RATE_LIMITED from the rate limiter', () => {
	const echo = defineCommand({
		name: 'item-echo',
		description: 'Echo',
		input: z.object({}),
		handler: async () => success({}),
	});

	it('waits the same whole number of seconds the suggestion gives', async () => {
		const registry = createDirectRegistry([echo], {
			middleware: [createRateLimitMiddleware({ maxRequests: 1, windowMs: 30_000 })],
		});
		expect((await registry.execute('item-echo', {})).success).toBe(true);
		const limited = await registry.execute('item-echo', {});
		expect(limited.error?.code).toBe('RATE_LIMITED');
		expect(limited.error?.retryable).toBe(true);
		const seconds = Number(
			/^Try again in (\d+) seconds$/.exec(limited.error?.suggestion ?? '')?.[1]
		);
		expect(seconds).toBeGreaterThan(0);
		expect(limited.error?.recovery).toEqual({ kind: 'retry', afterMs: seconds * 1000 });
	});

	it('retries with no minimum wait when the client capacity is full', async () => {
		let key = 'a';
		const registry = createDirectRegistry([echo], {
			middleware: [
				createRateLimitMiddleware({
					maxRequests: 5,
					windowMs: 30_000,
					maxKeys: 1,
					keyFn: () => key,
				}),
			],
		});
		expect((await registry.execute('item-echo', {})).success).toBe(true);
		key = 'b';
		const full = await registry.execute('item-echo', {});
		expect(full.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
		expect(full.error?.recovery).toEqual({ kind: 'retry' });
	});
});
