import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import { defineCommand, success, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SHELL_COMMAND_NAMES } from './commands.js';
import { LoamKernelError } from './errors.js';
import {
	COMMAND_NAME_SUGGESTION,
	createKernel,
	kernelJournalOptions,
	redactJournalRecord,
} from './kernel.js';
import { createDefaultLayout, type LayoutStateV0 } from './layout.js';
import { createFixedEnvironment, createSteppingClock } from './testing.js';
import type { KernelEventV0, KernelOptionsV0, LoamKernelV0 } from './types.js';

const kernels: LoamKernelV0[] = [];

afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

function options(overrides: Partial<KernelOptionsV0> = {}): KernelOptionsV0 {
	return {
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal: new MemoryJournalSink(),
		auth: new MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		clock: createSteppingClock(),
		...overrides,
	};
}

async function kernel(overrides: Partial<KernelOptionsV0> = {}) {
	const opts = options(overrides);
	const created = await createKernel(opts);
	kernels.push(created);
	return { kernel: created, journal: opts.journal as MemoryJournalSink, opts };
}

function command(name: string, extra: Record<string, unknown> = {}): ZodCommandDefinition {
	return defineCommand({
		name,
		description: `The ${name} command`,
		input: z.object({}),
		async handler() {
			return success({ ran: name });
		},
		...extra,
	}) as unknown as ZodCommandDefinition;
}

describe('E8: the kernel refuses a bad name', () => {
	it('rejects createKernel({ commands: [doThing] }) with COMMAND_NAME_INVALID', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const doThing = command('doThing');
		warn.mockRestore();
		const error = await createKernel(options({ commands: [doThing] })).catch(
			(caught: unknown) => caught
		);
		expect(error).toBeInstanceOf(LoamKernelError);
		const refusal = error as LoamKernelError;
		expect(refusal.code).toBe('COMMAND_NAME_INVALID');
		expect(refusal.suggestion).toBe(COMMAND_NAME_SUGGESTION);
		expect(refusal.suggestion).toBe('Rename it domain-action, e.g. notes-create');
		expect(refusal.details?.name).toBe('doThing');
		expect(String(refusal.details?.reason)).toContain('kebab-case');
		expect(refusal.message).toContain('doThing');
	});

	it.each(['notes', 'Notes-create', 'notes_create', ''])('refuses %j', async (name) => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const bad = command(name);
		warn.mockRestore();
		await expect(createKernel(options({ commands: [bad] }))).rejects.toMatchObject({
			code: 'COMMAND_NAME_INVALID',
		});
	});

	it('refuses a name given twice, including a shell name', async () => {
		await expect(
			createKernel(options({ commands: [command('layout-get')] }))
		).rejects.toMatchObject({ code: 'COMMAND_NAME_DUPLICATE', details: { name: 'layout-get' } });
	});

	it('accepts good extra names and runs them signed out', async () => {
		const { kernel: k } = await kernel({ commands: [command('notes-create')] });
		const result = await k.agent.call('notes-create');
		expect(result).toMatchObject({ success: true, data: { ran: 'notes-create' } });
	});
});

describe('registries and exposure', () => {
	it('lists every shell command on both interfaces, in order', async () => {
		const { kernel: k } = await kernel();
		expect(k.listCommands().map((summary) => summary.name)).toEqual([...SHELL_COMMAND_NAMES]);
		expect(k.agent.listCommands().map((summary) => summary.name)).toEqual([...SHELL_COMMAND_NAMES]);
	});

	it('summarizes needsInput, mutation, title and keybinding', async () => {
		const { kernel: k } = await kernel();
		const byName = new Map(k.listCommands().map((summary) => [summary.name, summary]));
		expect(byName.get('palette-open')).toEqual({
			name: 'palette-open',
			title: 'Open the command palette',
			description: 'Open the command palette, optionally with a query',
			mutation: false,
			needsInput: false,
			keybinding: 'Mod+K',
		});
		expect(byName.get('layout-set')).toMatchObject({ mutation: true, needsInput: false });
		expect(byName.get('layout-set')?.keybinding).toBeUndefined();
		expect(byName.get('palette-search')?.needsInput).toBe(true);
		expect(byName.get('view-state-get')?.needsInput).toBe(true);
		expect(byName.get('auth-sign-in')?.needsInput).toBe(true);
		expect(byName.get('auth-sign-out')?.needsInput).toBe(false);
		expect(byName.get('layout-get')?.title).toBeUndefined();
	});

	it('keeps an extra command to the interfaces it is exposed to', async () => {
		const { kernel: k } = await kernel({
			commands: [command('notes-sync', { expose: { palette: false, agent: true } })],
		});
		expect(k.listCommands().some((summary) => summary.name === 'notes-sync')).toBe(false);
		expect(k.agent.listCommands().some((summary) => summary.name === 'notes-sync')).toBe(true);
		expect((await k.call('notes-sync')).error?.code).toBe('COMMAND_NOT_EXPOSED');
	});

	it('returns COMMAND_NOT_FOUND for an unknown name, with a mutation-free event', async () => {
		const { kernel: k } = await kernel();
		const events: KernelEventV0[] = [];
		k.subscribe((event) => events.push(event));
		expect((await k.call('nothing-here')).error?.code).toBe('COMMAND_NOT_FOUND');
		expect(events).toEqual([
			{ command: 'nothing-here', interface: 'palette', success: false, mutation: false },
		]);
	});

	it('reports shell info echoing the options', async () => {
		const { kernel: k } = await kernel({ host: 'browser', storeKind: 'indexeddb' });
		expect((await k.call('shell-info-get')).data).toEqual({
			kernelInterface: 0,
			layoutState: 0,
			storeInterface: 0,
			tokenContract: 1,
			host: 'browser',
			store: 'indexeddb',
		});
		expect(k.version).toBe(0);
	});
});

describe('the journal', () => {
	it('gives both registries one sequence, and events carry seq', async () => {
		const { kernel: k, journal } = await kernel();
		const events: KernelEventV0[] = [];
		const unsubscribe = k.subscribe((event) => events.push(event));
		await k.call('layout-set', { sidebar: { open: false } });
		await k.agent.call('layout-get');
		await k.call('palette-search', { query: 'layout' });
		await k.agent.call('layout-set', { sidebar: { width: 9 } });
		unsubscribe();
		await k.call('layout-get');
		expect(events).toEqual([
			{ command: 'layout-set', interface: 'palette', success: true, mutation: true, seq: 1 },
			{ command: 'layout-get', interface: 'agent', success: true, mutation: false, seq: 2 },
			{ command: 'palette-search', interface: 'palette', success: true, mutation: false },
			{ command: 'layout-set', interface: 'agent', success: false, mutation: true, seq: 3 },
		]);
		const entries = await journal.read();
		expect(
			entries.map((entry) => [entry.seq, entry.command, entry.contextDigest.interface])
		).toEqual([
			[1, 'layout-set', 'palette'],
			[2, 'layout-get', 'agent'],
			[3, 'layout-set', 'agent'],
			[4, 'layout-get', 'palette'],
		]);
	});

	it('does not journal input-schema failures, which change nothing', async () => {
		const { kernel: k, journal } = await kernel();
		const result = await k.call('layout-set', { sidebar: { width: 'wide' } });
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(await journal.read()).toEqual([]);
	});

	it('journals sign-in without the password, and the next entry carries the actor', async () => {
		const { kernel: k, journal } = await kernel();
		const signedIn = await k.call('auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'hunter2',
		});
		expect(signedIn.success).toBe(true);
		await k.call('layout-get');
		const [signIn, next] = await journal.read();
		expect(signIn?.command).toBe('auth-sign-in');
		expect(signIn?.input).toEqual({ method: 'credentials', email: 'person@example.com' });
		expect(JSON.stringify(signIn)).not.toContain('hunter2');
		expect(next?.actor).toMatchObject({ kind: 'human', label: 'person' });
		expect((await k.call('auth-session-get')).data).toMatchObject({ status: 'authenticated' });
		expect((await k.call('auth-sign-out')).success).toBe(true);
	});

	it('runs every shell command signed out', async () => {
		const { kernel: k } = await kernel();
		for (const name of ['layout-get', 'appearance-get', 'palette-open', 'shell-info-get']) {
			expect((await k.call(name)).success).toBe(true);
		}
	});

	it('redacts only auth-sign-in passwords', () => {
		const base = {
			timestamp: '2026-01-01T00:00:00.000Z',
			contextDigest: { hash: 'sha256:0' },
			result: { success: true },
			durationMs: 0,
		};
		const other = { ...base, command: 'notes-create', input: { password: 'x' } };
		expect(redactJournalRecord(other)).toBe(other);
		const noPassword = { ...base, command: 'auth-sign-in', input: { email: 'a@b.c' } };
		expect(redactJournalRecord(noPassword)).toBe(noPassword);
		const nullInput = { ...base, command: 'auth-sign-in', input: null };
		expect(redactJournalRecord(nullInput)).toBe(nullInput);
	});

	it('records failures and filters only palette-search', () => {
		const journalOptions = kernelJournalOptions();
		expect(journalOptions.recordFailures).toBe(true);
		expect(journalOptions.filter?.('palette-search')).toBe(false);
		expect(journalOptions.filter?.('auth-sign-in')).toBe(true);
		expect(journalOptions.filter?.('layout-set')).toBe(true);
	});

	it('passes an abort signal to the call', async () => {
		const seen: unknown[] = [];
		const watch = defineCommand({
			name: 'signal-watch',
			description: 'Report the signal',
			input: z.object({}),
			async handler(_input, context) {
				seen.push(context.signal);
				return success(null);
			},
		}) as unknown as ZodCommandDefinition;
		const { kernel: k } = await kernel({ commands: [watch] });
		const controller = new AbortController();
		await k.call('signal-watch', {}, { signal: controller.signal });
		await k.call('signal-watch');
		expect(seen).toEqual([controller.signal, undefined]);
	});

	it('keeps a throwing listener from changing the result or the other listeners', async () => {
		const { kernel: k } = await kernel();
		const events: KernelEventV0[] = [];
		const reportError = vi.fn();
		vi.stubGlobal('reportError', reportError);
		try {
			k.subscribe(() => {
				throw new Error('listener');
			});
			k.subscribe((event) => events.push(event));
			expect((await k.call('layout-get')).success).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
		expect(events).toHaveLength(1);
		expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'listener' }));
	});
});

describe('E1 (kernel unit): every layout change goes through the shared validator', () => {
	it('refuses view-state-set with an out-of-range width, and journals the refusal', async () => {
		const { kernel: k, journal } = await kernel();
		const result = await k.agent.call('view-state-set', {
			id: 'loam.layout',
			state: { sidebar: { width: 4000 } },
		});
		expect(result.success).toBe(false);
		expect(result.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			details: { field: 'sidebar.width', min: 200, max: 480, value: 4000 },
		});
		expect(result.error?.message).toContain('from 200 to 480');
		expect(result.error?.suggestion).toBeTruthy();
		expect((await k.call<LayoutStateV0>('layout-get')).data).toEqual(createDefaultLayout());
		const entries = await journal.read();
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({ command: 'view-state-set', result: { success: false } });
	});

	it('refuses an incomplete or invalid replacement through view-state-set', async () => {
		const { kernel: k } = await kernel();
		const incomplete = await k.agent.call('view-state-set', {
			id: 'loam.layout',
			state: { version: 0, sidebar: { open: true, width: 300 } },
			replace: true,
		});
		expect(incomplete.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			details: { field: 'inspector.open' },
		});
		const appearance = await k.agent.call('view-state-set', {
			id: 'loam.appearance',
			state: { theme: 'dark' },
			replace: true,
		});
		expect(appearance.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			details: { field: 'density' },
		});
	});

	it('applies a valid view-state-set, which layout-get then returns, with an exact undo', async () => {
		const { kernel: k } = await kernel();
		const result = await k.agent.call<{ state: LayoutStateV0 }>('view-state-set', {
			id: 'loam.layout',
			state: { panel: { open: true } },
		});
		expect(result.success).toBe(true);
		const layout = (await k.call<LayoutStateV0>('layout-get')).data;
		expect(layout?.panel.open).toBe(true);
		expect((await k.call('view-state-get', { id: 'loam.layout' })).data).toEqual({
			id: 'loam.layout',
			state: layout,
		});
		expect(result.undoCommand).toBe('view-state-set');
		await k.call('view-state-set', result.undoArgs);
		expect((await k.call<LayoutStateV0>('layout-get')).data).toEqual(createDefaultLayout());
	});

	it('leaves other view-state ids to the package', async () => {
		const { kernel: k } = await kernel();
		expect((await k.call('view-state-set', { id: 'nope', state: {} })).error?.code).toBe(
			'VIEW_STATE_NOT_FOUND'
		);
		expect((await k.call<{ total: number }>('view-state-list')).data?.total).toBe(2);
	});

	it('sets, refuses and undoes with layout-set', async () => {
		const { kernel: k } = await kernel();
		const set = await k.call<LayoutStateV0>('layout-set', {
			sidebar: { width: 300 },
			panel: { open: true, height: 500 },
		});
		expect(set.data).toMatchObject({
			sidebar: { open: true, width: 300 },
			panel: { open: true, height: 500 },
		});
		expect(set.undoCommand).toBe('layout-set');
		expect(set.undoArgs).toEqual({ sidebar: { width: 260 }, panel: { open: false, height: 240 } });

		const refused = await k.call('layout-set', { panel: { height: 119 } });
		expect(refused.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			details: { field: 'panel.height', min: 120, value: 119 },
		});
		expect(refused.error?.message).toContain('120 or more');

		await k.call('layout-set', set.undoArgs);
		expect((await k.call<LayoutStateV0>('layout-get')).data).toEqual(createDefaultLayout());
	});

	it('resets the layout, with an undo to the previous state', async () => {
		const { kernel: k } = await kernel();
		await k.call('layout-set', { inspector: { open: true, width: 400 }, compact: { sheet: true } });
		const reset = await k.call<LayoutStateV0>('layout-reset');
		expect(reset.data).toEqual(createDefaultLayout());
		expect(reset.undoCommand).toBe('layout-set');
		await k.call('layout-set', reset.undoArgs);
		const layout = (await k.call<LayoutStateV0>('layout-get')).data;
		expect(layout?.inspector).toEqual({ open: true, width: 400 });
		expect(layout?.compact.sheet).toBe(true);
	});
});

describe('appearance', () => {
	it('resolves system from the environment and sets theme and density with undo', async () => {
		const { kernel: k } = await kernel({
			environment: createFixedEnvironment(['(prefers-color-scheme: dark)']),
		});
		expect((await k.call('appearance-get')).data).toEqual({
			theme: 'system',
			density: 'comfortable',
			resolved: 'dark',
		});
		const set = await k.call('appearance-set', { theme: 'high-contrast' });
		expect(set.data).toEqual({
			theme: 'high-contrast',
			density: 'comfortable',
			resolved: 'high-contrast',
		});
		expect(set.undoCommand).toBe('appearance-set');
		expect(set.undoArgs).toEqual({ theme: 'system' });
		const density = await k.call('appearance-set', { density: 'compact' });
		expect(density.undoArgs).toEqual({ density: 'comfortable' });
		expect((await k.call('appearance-set', { theme: 'sepia' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});

	it('refuses an invalid appearance through view-state-set', async () => {
		const { kernel: k } = await kernel();
		const result = await k.agent.call('view-state-set', {
			id: 'loam.appearance',
			state: { density: 'tiny' },
		});
		expect(result.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'density' } });
	});
});

describe('the palette commands', () => {
	it('opens and closes, and searches the palette registry', async () => {
		const { kernel: k } = await kernel({ commands: [command('notes-create')] });
		expect((await k.call('palette-open', { query: 'x' })).data).toEqual({ open: true });
		expect((await k.call('palette-close')).data).toEqual({ open: false });
		const search = await k.call<{ items: { name: string; field: string }[] }>('palette-search', {
			query: 'layset',
		});
		expect(search.data?.items[0]).toMatchObject({ name: 'layout-set', field: 'name' });
		const notes = await k.call<{ items: { name: string }[] }>('palette-search', { query: 'notes' });
		expect(notes.data?.items.map((item) => item.name)).toContain('notes-create');
		const limited = await k.call<{ items: unknown[] }>('palette-search', { query: '', limit: 3 });
		expect(limited.data?.items).toHaveLength(3);
		const all = await k.call<{ items: unknown[] }>('palette-search', { query: '' });
		expect(all.data?.items).toHaveLength(16);
		expect((await k.call('palette-search', { query: 'a', limit: 51 })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});
});

describe('boot and persistence', () => {
	it('hydrates the layout and appearance from the store before resolving', async () => {
		const store = new MemoryAdapter();
		const first = await kernel({ store });
		await first.kernel.call('layout-set', { sidebar: { width: 222 }, inspector: { open: true } });
		await first.kernel.call('appearance-set', { theme: 'dark' });
		await first.kernel.dispose();

		const second = await kernel({ store });
		expect((await second.kernel.call<LayoutStateV0>('layout-get')).data).toMatchObject({
			sidebar: { width: 222 },
			inspector: { open: true },
		});
		expect((await second.kernel.call('appearance-get')).data).toMatchObject({ theme: 'dark' });
	});

	it('ignores an invalid persisted record and keeps the defaults', async () => {
		const store = new MemoryAdapter();
		await store.create('settings', {
			id: 'loam.layout',
			category: 'view-state',
			value: { version: 0, sidebar: { width: 5000 } },
			updatedAt: '2026-01-01T00:00:00.000Z',
		});
		await store.create('settings', {
			id: 'loam.appearance',
			category: 'view-state',
			value: { theme: 'dark', density: 'compact' },
			updatedAt: '2026-01-01T00:00:00.000Z',
		});
		const { kernel: k } = await kernel({ store });
		expect((await k.call('layout-get')).data).toEqual(createDefaultLayout());
		expect((await k.call('appearance-get')).data).toMatchObject({
			theme: 'dark',
			density: 'compact',
		});
	});

	it('refuses calls after dispose, and disposes once', async () => {
		const { kernel: k } = await kernel();
		await k.dispose();
		await k.dispose();
		const result = await k.call('layout-get');
		expect(result.error?.code).toBe('KERNEL_DISPOSED');
		expect((await k.agent.call('layout-get')).error?.code).toBe('KERNEL_DISPOSED');
	});

	it('works with the system clock and random source', async () => {
		const { kernel: k, journal } = await kernel({ clock: undefined, random: Math.random });
		expect((await k.call('layout-get')).success).toBe(true);
		const [entry] = (await journal.read()) as JournalEntry[];
		expect(entry?.traceId).toMatch(/^loam-[0-9a-z]+-1$/);
	});
});
