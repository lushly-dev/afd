/**
 * #1936's units: a replay of an agent's write to an app matches the live session. An app's surface reads again when a
 * command changes its store, through its own port, while the write is still on its way out of the kernel's chain: the
 * confirmations' gate stores a confirmed run's outcome on its row (phase 4's 7.2), and the enforcement gate counts an
 * `act` write (phase 5's 6.3), each after the handler. That read is journaled after the write, or a replay reads before
 * it (phase 4's R5: a replay of an honest journal matches live).
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import {
	type CommandResult,
	type JournalEntry,
	type JournalRecord,
	MemoryJournalSink,
} from '@lushly-dev/afd-core';
import { createMcpHandler } from '@lushly-dev/afd-server';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { ManifestV1, ProjectionV3 } from '@lushly-dev/loam-manifest';
import { type AppCallContextV1, defineApp, type ManifestV3, success } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { APPROVAL_HEALTH_TABLE } from '../copilot/health.js';
import { PAGE_DECIDED } from '../errors.js';
import type { NestedRerunV1 } from '../journal-order.js';
import { createKernelParts } from '../kernel.js';
import { createScopedWorkspace, type ScopedWorkspace, scopedPackages } from '../scope/fixtures.js';
import { NOTIFICATION_TABLE } from '../settings/notifications.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	nestedReplay,
	replayKernel,
} from '../testing.js';
import { PROBE_DOCUMENTS_DEFINITION, PROBE_DOCUMENTS_MANIFEST } from '../testing-documents.js';
import type { LoamKernel, McpToolCallResult, MountTransport } from '../types.js';

const kernels: LoamKernel[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
	listeners.clear();
});

const EMPTY = { type: 'object', properties: {}, additionalProperties: false };

/** A guest book whose surface reads it again on every change, as hello's does. */
const BOOK_MANIFEST = {
	manifest_version: 2,
	protocol: 1,
	plugin: {
		id: 'book',
		title: 'Book',
		version: '1.0.0',
		description: 'Keeps the names it greets, and shows them.',
		kind: 'native',
		domains: ['book'],
	},
	native: { entry: 'dist/native.js' },
	app: { scope_levels: ['workspace', 'project'] },
	grants: [{ name: 'store', reason: 'Keeps the names.' }],
	commands: [
		{
			name: 'book-sign',
			title: 'Sign the book',
			description: 'Add a name to the book.',
			effects: ['store-write'],
			input_schema: {
				type: 'object',
				properties: { name: { type: 'string', minLength: 1 } },
				required: ['name'],
				additionalProperties: false,
			},
		},
		{
			name: 'book-greet',
			title: 'Greet a name',
			description:
				'Read the book through its own client, then add a name to it, as hello-greet reads its setting.',
			effects: ['store-write'],
			input_schema: {
				type: 'object',
				properties: { name: { type: 'string', minLength: 1 } },
				required: ['name'],
				additionalProperties: false,
			},
		},
		{
			name: 'book-list',
			title: 'List the names',
			description: 'List the names in the book.',
			effects: ['inspect'],
			input_schema: EMPTY,
		},
	],
	ui: { surfaces: { main: { element: 'book-main' } } },
} as unknown as ManifestV3;

/** Told after `book-sign` changes the store, before its handler returns: hello's `changed()`. */
const listeners = new Set<() => void>();

const BOOK = defineApp({
	sdk: 1,
	handlers: {
		'book-sign': (async (input: { name: string }, context: AppCallContextV1) => {
			await context.store?.put(input.name, true);
			for (const listener of listeners) listener();
			return success({ name: input.name });
		}) as never,
		'book-greet': (async (input: { name: string }, context: AppCallContextV1) => {
			const seen = await context.client?.call<{ names: string[] }>('book-list', {});
			await context.store?.put(input.name, true);
			for (const listener of listeners) listener();
			return success({ name: input.name, before: seen?.data?.names ?? null });
		}) as never,
		'book-list': (async (_input: unknown, context: AppCallContextV1) =>
			success({
				names: ((await context.store?.list()) ?? []).map(({ key }) => key),
			})) as never,
	},
});

const deployment = () => ({
	deployment_version: 2 as const,
	generation: 'parity',
	workspace: { id: 'personal', name: 'Personal' },
	sandbox_origin: null,
	apps: ['tasks', 'dual', 'solo', 'book'].map((id) => ({
		instance: id,
		app: id,
		package: `fixtures/${id}/`,
	})),
});
const ports = () =>
	createFixturePorts({
		...scopedPackages(),
		'fixtures/book/': { manifest: BOOK_MANIFEST, definition: BOOK },
	});

/**
 * The browser's store, whose writes take a while (IndexedDB): the kernel's own bookkeeping after a handler, a confirmed
 * run's row and an `act` write's count, is written well after the surface's read has run. Without the wait, the read
 * finishes first.
 */
class SlowBookkeeping extends MemoryAdapter {
	slow = false;
	private async wait(table: string): Promise<void> {
		if (this.slow && (table === NOTIFICATION_TABLE || table === APPROVAL_HEALTH_TABLE))
			await new Promise((resolve) => setTimeout(resolve, 20));
	}
	override async create<T>(table: string, data: Partial<T>): Promise<T> {
		await this.wait(table);
		return super.create(table, data);
	}
	override async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
		await this.wait(table);
		return super.update(table, id, patch);
	}
	override async batch(operations: Parameters<MemoryAdapter['batch']>[0]) {
		const table = operations[0]?.path.split('/')[1] ?? '';
		await this.wait(table);
		return super.batch(operations);
	}
}

/** The scoped workspace with the book, its surface reading through the app's port on every change. */
async function boot(
	agentsAct: boolean,
	later = false
): Promise<ScopedWorkspace & { reads: Promise<unknown>[] }> {
	const store = new SlowBookkeeping();
	const workspace = await createScopedWorkspace({
		store,
		deployment: deployment(),
		ports: ports(),
		agentsAct,
	});
	kernels.push(workspace.kernel);
	store.slow = true;
	const reads: Promise<unknown>[] = [];
	const read = () => reads.push(workspace.kernel.appPort('book').call('book-list', {}));
	// At once, as hello's surface reads, or on a later tick, after the handler has returned.
	listeners.add(() => (later ? setTimeout(read, 0) : read()));
	return Object.assign(workspace, { reads });
}

const commandsOf = (entries: readonly JournalEntry[]) =>
	entries
		.filter(({ command, result }) => command.startsWith('book-') && result.success)
		.map(({ command, result }) => ({
			command,
			names: (result.data as { names?: unknown })?.names,
		}));

/** The confirmation an asked call raised. */
const notificationOf = (asked: { error?: { details?: unknown } }): string =>
	(asked.error?.details as { notification?: string } | undefined)?.notification ?? '';

async function replayed(entries: readonly JournalEntry[]) {
	const { report } = await replayKernel(entries, { deployment: deployment(), ports: ports() });
	return report.entries.filter(({ status }) => status !== 'same');
}

describe('#1936: a replay of an agent’s write to an app', () => {
	it('journals a read made on a later tick after the confirmed run it saw, and replays it the same (Astra 1)', async () => {
		const { kernel, journal, reads } = await boot(false, true);
		await kernel.call('book-sign', { name: 'Ada' });
		const asked = await kernel.agent.call('book-sign', { name: 'Bot' });
		await kernel.call('notification-act', {
			notification: notificationOf(asked),
			answer: 'confirm',
		});
		await new Promise((resolve) => setTimeout(resolve, 30));
		await Promise.all(reads);
		const entries = await journal.read();
		expect(commandsOf(entries)).toEqual([
			{ command: 'book-sign', names: undefined },
			{ command: 'book-list', names: ['Ada'] },
			{ command: 'book-sign', names: undefined },
			{ command: 'book-list', names: ['Ada', 'Bot'] },
		]);
		expect(await replayed(entries)).toEqual([]);
	});

	it('journals the read a confirmed run caused after the run, and replays it the same', async () => {
		const { kernel, journal, reads } = await boot(false);
		await kernel.call('book-sign', { name: 'Ada' });
		const asked = await kernel.agent.call('book-sign', { name: 'Bot' });
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const notification = notificationOf(asked);
		const acted = await kernel.call('notification-act', { notification, answer: 'confirm' });
		expect(acted.data).toMatchObject({ state: 'confirmed' });
		await Promise.all(reads);
		const entries = await journal.read();
		// Each read after the write that caused it, seeing it.
		expect(commandsOf(entries)).toEqual([
			{ command: 'book-sign', names: undefined },
			{ command: 'book-list', names: ['Ada'] },
			{ command: 'book-sign', names: undefined },
			{ command: 'book-list', names: ['Ada', 'Bot'] },
		]);
		expect(await replayed(entries)).toEqual([]);
	});

	it('journals the read an agent’s write under act caused after the write, and replays it the same', async () => {
		const { kernel, journal, reads } = await boot(true);
		await kernel.call('book-sign', { name: 'Ada' });
		expect((await kernel.agent.call('book-sign', { name: 'Bot' })).success).toBe(true);
		await Promise.all(reads);
		const entries = await journal.read();
		expect(commandsOf(entries)).toEqual([
			{ command: 'book-sign', names: undefined },
			{ command: 'book-list', names: ['Ada'] },
			{ command: 'book-sign', names: undefined },
			{ command: 'book-list', names: ['Ada', 'Bot'] },
		]);
		expect(await replayed(entries)).toEqual([]);
	});
});

/** The quota's own reads before a write's batch, during which a read made does not see the write (the re-check). */
class SlowWrite extends MemoryAdapter {
	onGet?: () => Promise<unknown>;
	override async get<T>(table: string, id: string): Promise<T | null> {
		if (table === 'app-book' && this.onGet) {
			const fire = this.onGet;
			this.onGet = undefined;
			// The read is made and ends while the write is still in its quota's reads, before its batch is sent.
			await fire();
		}
		return super.get(table, id) as Promise<T | null>;
	}
}

describe('#1936, the re-check: what a read saw, not when it ran', () => {
	it('never holds a read issued while the write is still in its quota’s reads', async () => {
		const store = new SlowWrite();
		const workspace = await createScopedWorkspace({
			store,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(workspace.kernel);
		const { kernel, journal } = workspace;
		await kernel.call('book-sign', { name: 'Ada' });
		let read: Promise<unknown> | undefined;
		store.onGet = () => {
			read = kernel.appPort('book').call('book-list', {});
			return read;
		};
		expect((await kernel.call('book-sign', { name: 'Bob' })).success).toBe(true);
		expect(((await read) as { data?: { names?: string[] } }).data?.names).toEqual(['Ada']);
		// Journaled before the write it did not see, where it ended.
		expect(commandsOf(await journal.read()).at(-1)).toEqual({
			command: 'book-sign',
			names: undefined,
		});
		expect(await replayed(await journal.read())).toEqual([]);
	});

	it('journals the read a notice’s action caused after the act, whose nested write it saw', async () => {
		const { kernel, journal, reads } = await boot(false);
		await kernel.call('book-sign', { name: 'Ada' });
		const pushed = await kernel
			.appPort('book')
			.call<{ notification: { id: string } }>('notification-push', {
				title: 'Sign Bob',
				action: { command: 'book-sign', label: 'Sign', input: { name: 'Bob' } },
			});
		expect(pushed.success, JSON.stringify(pushed.error)).toBe(true);
		const acted = await kernel.call('notification-act', {
			notification: pushed.data?.notification.id,
		});
		expect(acted.success, JSON.stringify(acted.error)).toBe(true);
		await Promise.all(reads);
		const entries = await journal.read();
		const act = entries.findIndex(({ command }) => command === 'notification-act');
		const last = entries.map(({ command }) => command).lastIndexOf('book-list');
		expect(last).toBeGreaterThan(act);
		expect((entries[last]?.result.data as { names?: unknown })?.names).toEqual(['Ada', 'Bob']);
		// The action, a nested write, runs again in a replay, so its write lands in the replay's store and the read after
		// it reads the same (#2119).
		expect(await replayed(entries)).toEqual([]);
	});
});

describe('#2119: a notice action runs again in a replay, on its own trace and tape', () => {
	it('lands an action that reads through its client before it writes, as hello-greet reads its setting', async () => {
		const { kernel, journal, reads } = await boot(false);
		await kernel.call('book-sign', { name: 'Ada' });
		const pushed = await kernel
			.appPort('book')
			.call<{ notification: { id: string } }>('notification-push', {
				title: 'Greet Bob',
				action: { command: 'book-greet', label: 'Greet', input: { name: 'Bob' } },
			});
		const acted = await kernel.call('notification-act', {
			notification: pushed.data?.notification.id,
		});
		expect(acted.data).toMatchObject({ state: 'done', result: { before: ['Ada'] } });
		await Promise.all(reads);
		expect((await kernel.call('book-list', {})).data).toEqual({ names: ['Ada', 'Bob'] });
		const entries = await journal.read();
		const greet = entries.find(({ command }) => command === 'book-greet');
		// The action's own nested read, under the action's trace ID.
		expect(entries.some(({ context }) => context?.parent === greet?.traceId)).toBe(true);
		expect(await replayed(entries)).toEqual([]);
	});

	const SIGN = {
		name: 'book-sign',
		inputSchema: z.object({ name: z.string() }),
	} as unknown as ZodCommandDefinition;
	const LIST = { name: 'book-list', inputSchema: z.object({}) } as unknown as ZodCommandDefinition;
	const entry = (
		traceId: string,
		command: string,
		context: Record<string, unknown> = {},
		result: unknown = { success: true, data: { name: 'Bob' }, metadata: { executionTimeMs: 1 } }
	) =>
		({
			seq: 1,
			traceId,
			command,
			timestamp: '2026-11-22T00:00:00.000Z',
			input: command.endsWith('-list') ? {} : { name: 'Bob' },
			context,
			result,
			tape: { clock: [7, 8], random: [0.25] },
		}) as unknown as JournalEntry;
	const journal = (context: Record<string, unknown> = {}, ...more: JournalEntry[]) => [
		entry('loam-t-1', 'notification-act'),
		entry('loam-t-2', 'book-sign', { parent: 'loam-t-1', ...context }),
		...more,
	];
	/** What the rerun answers when it answers as recorded: only its time differs. */
	const OK = { success: true, data: { name: 'Bob' }, metadata: { executionTimeMs: 2 } };
	const rerunOf = (answered: unknown) => {
		if (!answered || typeof answered !== 'object' || !('rerun' in answered))
			throw new Error(`not a rerun: ${JSON.stringify(answered)}`);
		return (answered as NestedRerunV1).rerun;
	};

	it('runs the action under its recorded trace ID, with the clock and random values its entry recorded', () => {
		const nested = nestedReplay(journal());
		const rerun = rerunOf(nested.take('loam-t-1', 'book-sign', { name: 'Bob' }, SIGN));
		expect(rerun.traceId).toBe('loam-t-2');
		const { clock, random } = rerun.context;
		expect([clock?.now(), clock?.now(), clock?.now()]).toEqual([7, 8, 8]);
		expect(random?.next()).toBe(0.25);
		rerun.done({ success: true, data: { name: 'Bob' }, metadata: { executionTimeMs: 3 } });
		nested.finish('loam-t-1');
		expect([...nested.problems]).toEqual([]);
	});

	it('keeps against the action what it answered otherwise, a call it added, or one it left out', () => {
		const warned = nestedReplay(journal());
		rerunOf(warned.take('loam-t-1', 'book-sign', { name: 'Bob' }, SIGN)).done({
			success: true,
			data: { name: 'Bob' },
			metadata: { executionTimeMs: 2 },
			warnings: [{ code: 'EXTRA', message: 'An extra warning' }],
		});
		expect([...warned.problems]).toEqual([
			['loam-t-2', "The notice's action 'book-sign' answered other than its entry"],
		]);
		// A call the action made that its entry does not hold: answered by nothing, it runs and is journaled.
		const added = nestedReplay(journal());
		const rerun = rerunOf(added.take('loam-t-1', 'book-sign', { name: 'Bob' }, SIGN));
		expect(added.take(rerun.traceId, 'book-list', {}, LIST)).toBeUndefined();
		added.unrecorded(rerun.traceId, 'book-list');
		rerun.done(OK);
		expect([...added.problems.keys()]).toEqual(['loam-t-2']);
		// The action's own nested read, answered from its entry, and missed when it is not made.
		const read = entry('loam-t-3', 'book-list', { parent: 'loam-t-2' }, { success: true });
		const answered = nestedReplay(journal({}, read));
		const again = rerunOf(answered.take('loam-t-1', 'book-sign', { name: 'Bob' }, SIGN));
		expect(answered.take(again.traceId, 'book-list', {}, LIST)).toEqual({ success: true });
		again.done(OK);
		expect([...answered.problems]).toEqual([]);
		const missed = nestedReplay(journal({}, read));
		rerunOf(missed.take('loam-t-1', 'book-sign', { name: 'Bob' }, SIGN)).done(OK);
		expect([...missed.problems.values()]).toEqual([
			"The handler did not call 'book-list', which the journal records",
		]);
	});

	it('answers from the record an action the replay would at the top level, and any other handler’s call', () => {
		const recorded = (
			context: Record<string, unknown>,
			result?: unknown,
			command = 'book-sign'
		) => {
			const nested = nestedReplay([
				entry('loam-t-1', 'notification-act'),
				entry('loam-t-2', command, { parent: 'loam-t-1', ...context }, result),
			]);
			const answered = nested.take(
				'loam-t-1',
				command,
				command === 'app-list' ? {} : { name: 'Bob' },
				{
					name: command,
					inputSchema: command === 'app-list' ? z.object({}) : z.object({ name: z.string() }),
				} as unknown as ZodCommandDefinition
			);
			return answered !== undefined && !('rerun' in answered);
		};
		// A mounted server's, a recorded query's, and a refusal the page decided.
		expect(recorded({ replay: 'recorded' })).toBe(true);
		expect(recorded({}, { success: true, data: [] }, 'app-list')).toBe(true);
		expect(
			recorded({}, { success: false, error: { code: 'X', details: { [PAGE_DECIDED]: true } } })
		).toBe(true);
		// Another handler's nested call is still answered from its record.
		const app = nestedReplay([
			entry('loam-t-1', 'book-list'),
			entry('loam-t-2', 'book-sign', { parent: 'loam-t-1' }),
		]);
		expect(app.take('loam-t-1', 'book-sign', { name: 'Bob' }, SIGN)).toMatchObject({
			data: { name: 'Bob' },
		});
	});
});

// ─── A recorded command's approval decision (the third half) ───────────────────────

const UMBEL = {
	manifest_version: 1,
	protocol: 1,
	plugin: {
		id: 'umbel',
		title: 'Umbel',
		version: '0.1.0',
		description: 'A mounted host, for these tests.',
		kind: 'mounted',
		domains: ['umbel'],
	},
	mount: { prefix: 'umbel', transport: 'http' },
} as ManifestV1;

const MOUNTED = {
	deployment_version: 2,
	generation: 'parity',
	workspace: { id: 'personal', name: 'Personal' },
	sandbox_origin: null,
	apps: [
		{
			instance: 'work',
			app: 'umbel',
			package: 'apps/work/',
			prefix: 'work',
			audience: 'person',
			transport: 'http',
			route: 'mounts/work/mcp',
		},
	],
} as unknown as ProjectionV3;

/** A server with a read and a write, whose write answers how many times it ran. */
interface Served {
	/** The server's tools, read at each discovery. */
	tools?: () => string[];
	/** Each call to a tool waits for it, when given. */
	hold?: () => Promise<void>;
	/** Counts each call to a tool. */
	calls?: { count: number };
}

function mountedTransport(served: Served = {}): MountTransport {
	const asResult = (body: unknown): McpToolCallResult => ({ structuredContent: body });
	const tools = served.tools ?? (() => ['files-read', 'files-write']);
	let writes = 0;
	return {
		connect: async () => ({ protocolVersion: '2025-11-25' }),
		listTools: () => Promise.reject(new Error('Discovery lists no tools')),
		async callTool(tool, args) {
			if (tool === 'afd-help')
				return asResult({
					success: true,
					data: {
						toolStrategy: 'hybrid',
						firstClassTools: [],
						commands: tools().map((name) => ({ name })),
					},
				});
			if (tool === 'afd-detail')
				return asResult({
					success: true,
					data: (args as { command: string[] }).command.map((name) => ({
						name,
						found: true,
						callable: true,
						mutation: name === 'files-write',
						description: `Runs ${name}`,
						inputSchema: { type: 'object', properties: {} },
					})),
				});
			if (served.calls) served.calls.count++;
			await served.hold?.();
			if (tool === 'afd-call' && (args as { command?: string }).command === 'files-write')
				return asResult({ success: true, data: { writes: ++writes } });
			return asResult({ success: true, data: { files: ['a.txt'] } });
		},
		async close() {},
	};
}

const mountedOptions = (served: Served = {}) => ({
	deployment: MOUNTED,
	ports: {
		...createFixturePorts({ 'apps/work/': { manifest: UMBEL } }),
		mountTransport: async () => mountedTransport(served),
	},
});

/** A replay whose server counts every tool call, which must be none: the record answers each. */
async function replayMounted(entries: readonly JournalEntry[]) {
	const calls = { count: 0 };
	const { report } = await replayKernel(entries, mountedOptions({ calls }));
	expect(calls.count).toBe(0);
	return report.entries.filter(({ status }) => status !== 'same');
}

async function mountedKernel(served: Served = {}) {
	const journal = new MemoryJournalSink();
	const parts = await createKernelParts({
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal,
		auth: new MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		...mountedOptions(served),
	});
	kernels.push(parts.kernel);
	await parts.kernel.startInstances();
	return Object.assign(parts, { journal });
}

describe('#1936: a recorded command’s approval decision replays', () => {
	it('asks again for a mounted tool an agent called, and runs the one the person confirmed', async () => {
		const { kernel, journal } = await mountedKernel();
		const asked = await kernel.agent.call('work-files-read', {});
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const notification = notificationOf(asked);
		const acted = await kernel.call('notification-act', { notification, answer: 'confirm' });
		expect(acted.data).toMatchObject({ state: 'confirmed' });
		// The re-call answers the outcome the person's confirm stored (phase 4's F5).
		expect((await kernel.agent.call('work-files-read', {})).success).toBe(true);
		expect(await replayMounted(await journal.read())).toEqual([]);
	});

	it('counts what the person was asked and approved in the replay, as live (6.3)', async () => {
		const { kernel, journal } = await mountedKernel();
		const asked = await kernel.agent.call('work-files-read', {});
		const notification = notificationOf(asked);
		await kernel.call('notification-act', { notification, answer: 'confirm' });
		const live = await kernel.call('approval-health-get', {});
		expect(live.success, JSON.stringify(live.error)).toBe(true);
		expect((live.data as { totals: Record<string, number> }).totals).toMatchObject({
			asked: 1,
			confirmed: 1,
		});
		const { report, kernel: replayed } = await replayKernel(await journal.read(), {
			...mountedOptions(),
			keep: true,
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		if (!replayed) throw new Error('replayKernel kept no kernel');
		try {
			expect((await replayed.call('approval-health-get', {})).data).toEqual(live.data);
		} finally {
			await replayed.dispose();
		}
	});

	it('asks again for a recorded query an agent called under an ask row, and answers its run from the record', async () => {
		const { kernel, journal } = await mountedKernel();
		expect((await kernel.call('autonomy-set', { level: 'workspace', mode: 'ask' })).success).toBe(
			true
		);
		const asked = await kernel.agent.call('app-list', {});
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const notification = notificationOf(asked);
		expect(
			(await kernel.call('notification-act', { notification, answer: 'confirm' })).data
		).toMatchObject({ state: 'confirmed' });
		expect(await replayMounted(await journal.read())).toEqual([]);
	});

	it('replays a mounted call with the decision it journaled, though the policy changed while it ran (Astra 2)', async () => {
		let release!: () => void;
		let holding = false;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { kernel, journal } = await mountedKernel({
			hold: () => (holding ? held : Promise.resolve()),
		});
		await kernel.call('autonomy-set', { level: 'workspace', instance: 'work', mode: 'act' });
		holding = true;
		const running = kernel.agent.call('work-files-read', {});
		await new Promise((resolve) => setTimeout(resolve, 5));
		// Journaled before the call that was decided under the row it replaces.
		expect(
			(await kernel.call('autonomy-set', { level: 'workspace', instance: 'work', mode: 'ask' }))
				.success
		).toBe(true);
		release();
		expect((await running).success).toBe(true);
		const entries = await journal.read();
		expect(entries.map(({ command }) => command).slice(-2)).toEqual([
			'autonomy-set',
			'work-files-read',
		]);
		expect(await replayMounted(entries)).toEqual([]);
	});

	it('installs the catalog of an agent’s refresh it answers from its record, so a new tool replays (Astra 4)', async () => {
		let tools = ['files-read'];
		const { kernel, journal } = await mountedKernel({ tools: () => tools });
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'act' });
		await kernel.call('autonomy-set', { level: 'workspace', instance: 'work', mode: 'act' });
		tools = ['files-read', 'files-list'];
		const refreshed = await kernel.agent.call('app-instance-refresh', { instance: 'work' });
		expect(refreshed.success, JSON.stringify(refreshed.error)).toBe(true);
		const listed = await kernel.agent.call('work-files-list', {});
		expect(listed.success, JSON.stringify(listed.error)).toBe(true);
		expect(await replayMounted(await journal.read())).toEqual([]);
	});
});

class DelayedJournal extends MemoryJournalSink {
	constructor(private readonly delayCommand: string) {
		super();
	}
	override async append(entry: JournalRecord) {
		if (entry.command === this.delayCommand) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return super.append(entry);
	}
}

describe('#2117: kernel records, WAR ordering, kernel-run reads, and hosted MCP tracking', () => {
	it('orders confirmation-get after the confirmed run whose row write it saw, and replays identically', async () => {
		let onConfirmedWrite: (() => void) | undefined;
		let readPromise: Promise<unknown> | undefined;
		const store = new MemoryAdapter();
		const origBatch = store.batch.bind(store);
		store.batch = (async (ops: Parameters<MemoryAdapter['batch']>[0]) => {
			const res = await origBatch(ops);
			if (
				onConfirmedWrite &&
				ops.some(
					(op) =>
						op.method === 'PUT' &&
						op.path.startsWith(`/${NOTIFICATION_TABLE}/`) &&
						(op.body as { confirmation?: { state?: string } } | undefined)?.confirmation?.state ===
							'confirmed'
				)
			) {
				const fire = onConfirmedWrite;
				onConfirmedWrite = undefined;
				fire();
			}
			return res;
		}) as typeof store.batch;
		const delayedJournal = new DelayedJournal('book-sign');
		const workspace = await createScopedWorkspace({
			store,
			journal: delayedJournal,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(workspace.kernel);
		const { kernel } = workspace;
		expect((await kernel.call('autonomy-set', { level: 'workspace', mode: 'ask' })).success).toBe(
			true
		);
		const asked = await kernel.agent.call('book-sign', { name: 'Ada' });
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const notification = notificationOf(asked);

		onConfirmedWrite = () => {
			readPromise = kernel.agent.call('confirmation-get', { notification });
		};
		const acted = await kernel.call('notification-act', { notification, answer: 'confirm' });
		expect(acted.data).toMatchObject({ state: 'confirmed' });
		const polled = (await readPromise) as { data?: { state?: string } };
		expect(polled?.data?.state).toBe('confirmed');

		const entries = await delayedJournal.read();
		const signIdx = entries.findIndex((e) => e.command === 'book-sign' && e.result.success);
		const getIdx = entries.findIndex((e) => e.command === 'confirmation-get');
		expect(signIdx).toBeGreaterThan(-1);
		expect(getIdx).toBeGreaterThan(signIdx);
		expect(await replayed(entries)).toEqual([]);
	});

	it('orders document-get after document-create whose record write it saw, and replays identically', async () => {
		const delayedJournal = new DelayedJournal('document-create');
		const store = new MemoryAdapter();
		const origBatch = store.batch.bind(store);
		let createdDocId: string | undefined;
		let readPromise: Promise<unknown> | undefined;
		let kernelRef: LoamKernel | undefined;
		store.batch = (async (ops: Parameters<MemoryAdapter['batch']>[0]) => {
			const res = await origBatch(ops);
			if (!createdDocId && kernelRef) {
				const put = ops.find((op) => op.method === 'PUT' && op.path.startsWith('/document/'));
				const id = (put?.body as { id?: string } | undefined)?.id;
				if (id) {
					createdDocId = id;
					readPromise = kernelRef.call('document-get', { document: id });
				}
			}
			return res;
		}) as typeof store.batch;
		const docDeployment = () => ({
			...deployment(),
			apps: [...deployment().apps, { instance: 'probe', app: 'probe', package: 'fixtures/probe/' }],
		});
		const docPorts = () =>
			createFixturePorts({
				...scopedPackages(),
				'fixtures/book/': { manifest: BOOK_MANIFEST, definition: BOOK },
				'fixtures/probe/': {
					manifest: PROBE_DOCUMENTS_MANIFEST,
					definition: PROBE_DOCUMENTS_DEFINITION,
				},
			});
		const workspace = await createScopedWorkspace({
			store,
			journal: delayedJournal,
			deployment: docDeployment(),
			ports: docPorts(),
		});
		kernels.push(workspace.kernel);
		kernelRef = workspace.kernel;

		const created = await workspace.kernel.call<{ id: string }>('document-create', {
			type: 'probe',
			title: 'Chapter 1',
		});
		expect(created.success, JSON.stringify(created.error)).toBe(true);
		const got = (await readPromise) as { success: boolean; data?: { id?: string } };
		expect(got?.success).toBe(true);
		expect(got?.data?.id).toBe(created.data?.id);

		const entries = await delayedJournal.read();
		const createIdx = entries.findIndex((e) => e.command === 'document-create');
		const getIdx = entries.findIndex((e) => e.command === 'document-get');
		expect(getIdx).toBeGreaterThan(createIdx);
		const { report } = await replayKernel(entries, {
			deployment: docDeployment(),
			ports: docPorts(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('holds a write for an earlier read that finishes after the write (WAR), and replays identically', async () => {
		const delayedJournal = new DelayedJournal('book-list');
		const store = new MemoryAdapter();
		const origList = store.list.bind(store);
		let writePromise: Promise<unknown> | undefined;
		let kernelRef: LoamKernel | undefined;
		let triggerWrite = false;
		store.list = (async <T>(table: string, filter?: Parameters<MemoryAdapter['list']>[1]) => {
			const res = await origList<T>(table, filter);
			if (table === 'app-book' && triggerWrite && kernelRef) {
				triggerWrite = false;
				// Trigger write AFTER the read already read the pre-write state, while read's journal append is delayed.
				writePromise = kernelRef.call('book-sign', { name: 'Bob' });
			}
			return res;
		}) as typeof store.list;
		const workspace = await createScopedWorkspace({
			store,
			journal: delayedJournal,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(workspace.kernel);
		kernelRef = workspace.kernel;
		await workspace.kernel.call('book-sign', { name: 'Ada' });

		triggerWrite = true;
		const read = await workspace.kernel.call<{ names: string[] }>('book-list');
		await writePromise;
		expect(read.data?.names).toEqual(['Ada']);

		const entries = await delayedJournal.read();
		expect(commandsOf(entries)).toEqual([
			{ command: 'book-sign', names: undefined },
			{ command: 'book-list', names: ['Ada'] },
			{ command: 'book-sign', names: undefined },
		]);
		expect(await replayed(entries)).toEqual([]);
	});

	it('orders palette-run’s run after a write it saw, and replays identically', async () => {
		const store = new SlowBookkeeping();
		const workspace = await createScopedWorkspace({
			store,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(workspace.kernel);
		const { kernel, journal } = workspace;
		const opened = await kernel.call<{ prompt: { overlayId: string } }>('palette-run', {
			command: 'book-list',
		});
		expect(opened.success, JSON.stringify(opened.error)).toBe(true);
		const prompt = opened.data?.prompt.overlayId as string;
		let paletteRead: Promise<unknown> | undefined;
		listeners.add(() => {
			if (!paletteRead)
				paletteRead = kernel.call('palette-run', { command: 'book-list', prompt, input: {} });
		});
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'act' });
		store.slow = true;
		expect((await kernel.agent.call('book-sign', { name: 'Ada' })).success).toBe(true);
		const ran = (await paletteRead) as { success: boolean; data?: { names?: string[] } };
		expect(ran?.success).toBe(true);
		expect(ran?.data?.names).toEqual(['Ada']);
		const entries = await journal.read();
		const signIdx = entries.findIndex((e) => e.command === 'book-sign');
		const listIdx = entries.findIndex((e) => e.command === 'book-list');
		expect(listIdx).toBeGreaterThan(signIdx);
		expect(await replayed(entries)).toEqual([]);
	});

	it('tracks hosted MCP calls that bypass execute() so reads wait for writes they saw', async () => {
		const delayedJournal = new DelayedJournal('book-sign');
		const parts = await createKernelParts({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: delayedJournal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(parts.kernel);
		const mcpOpts = parts.mcpOptions();
		expect(mcpOpts).toBeDefined();
		const handler = createMcpHandler({
			name: 'loam-test',
			version: '0.1.0',
			commands: [...(mcpOpts as NonNullable<typeof mcpOpts>).commands].map((command) => ({
				...command,
				expose: { ...command.expose, mcp: true },
			})),
			middleware: [...(mcpOpts as NonNullable<typeof mcpOpts>).middleware],
			contextFields: [...(mcpOpts as NonNullable<typeof mcpOpts>).contextFields],
			host: '127.0.0.1',
			toolStrategy: 'individual',
			bootstrap: true,
		});
		const server = createServer(handler);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
		const transport = new StreamableHttpTransport(url, {
			clientName: 'loam-test',
			clientVersion: '0',
			mode: 'auto',
		});
		await transport.connect();
		let id = 0;
		const mcpCall = async (name: string, args: Record<string, unknown>) =>
			transport.send({
				jsonrpc: '2.0',
				id: ++id,
				method: 'tools/call',
				params: { name, arguments: args },
			} as never);
		try {
			let mcpRead: Promise<unknown> | undefined;
			listeners.add(() => {
				if (!mcpRead) mcpRead = mcpCall('book-list', {});
			});
			await mcpCall('book-sign', { name: 'Ada' });
			const listed = (await mcpRead) as {
				result?: { structuredContent?: { data?: { names?: string[] } } };
			};
			expect(listed?.result?.structuredContent?.data?.names).toEqual(['Ada']);

			const entries = await delayedJournal.read();
			expect(commandsOf(entries)).toEqual([
				{ command: 'book-sign', names: undefined },
				{ command: 'book-list', names: ['Ada'] },
			]);
			expect(await replayed(entries)).toEqual([]);
		} finally {
			await transport.disconnect();
			handler.dispose();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it('orders project reads before an in-flight project write until cache publication, and replays identically', async () => {
		const delayedJournal = new DelayedJournal('project-list');
		const store = new MemoryAdapter();
		const origBatch = store.batch.bind(store);
		let kernelRef: LoamKernel | undefined;
		let readWhileWriting: Promise<unknown> | undefined;
		let docListWhileWriting: Promise<unknown> | undefined;
		let trigger = false;
		store.batch = (async (ops: Parameters<MemoryAdapter['batch']>[0]) => {
			if (trigger && kernelRef && ops.some((op) => op.path.startsWith('/project/'))) {
				trigger = false;
				// Reads issued while store.batch is still pending see the pre-write cache, so WAR must journal them first.
				readWhileWriting = kernelRef.call('project-list', {});
				docListWhileWriting = kernelRef.call('document-list', { project: 'alpha' });
				await new Promise<void>((resolve) => setTimeout(resolve, 10));
			}
			return origBatch(ops);
		}) as typeof store.batch;
		const workspace = await createScopedWorkspace({
			store,
			journal: delayedJournal,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(workspace.kernel);
		kernelRef = workspace.kernel;

		trigger = true;
		const created = await workspace.kernel.call<{ id: string }>('project-create', {
			name: 'Alpha',
			slug: 'alpha',
		});
		expect(created.success, JSON.stringify(created.error)).toBe(true);
		const listed = (await readWhileWriting) as {
			success: boolean;
			data?: { projects?: Array<{ slug: string }> };
		};
		const docList = (await docListWhileWriting) as {
			success: boolean;
			error?: { code?: string };
		};
		expect(listed.success).toBe(true);
		expect(listed.data?.projects?.some((p) => p.slug === 'alpha')).toBe(false);
		expect(docList.success).toBe(false);
		expect(docList.error?.code).toBe('PROJECT_NOT_FOUND');

		const entries = await delayedJournal.read();
		const createIdx = entries.findIndex(
			(e) =>
				e.command === 'project-create' &&
				(e.input as { slug?: string } | undefined)?.slug === 'alpha'
		);
		const listIdx = entries.findIndex((e) => e.command === 'project-list');
		const docListIdx = entries.findIndex((e) => e.command === 'document-list');
		expect(createIdx).toBeGreaterThan(-1);
		expect(listIdx).toBeLessThan(createIdx);
		expect(docListIdx).toBeLessThan(createIdx);
		expect(await replayed(entries)).toEqual([]);
	});

	it('orders document-link-list after a concurrent rename of the linked target document, and replays identically', async () => {
		const delayedJournal = new DelayedJournal('document-rename');
		const store = new MemoryAdapter();
		const origGet = store.get.bind(store);
		const docDeployment = () => ({
			...deployment(),
			apps: [...deployment().apps, { instance: 'probe', app: 'probe', package: 'fixtures/probe/' }],
		});
		const docPorts = () =>
			createFixturePorts({
				...scopedPackages(),
				'fixtures/book/': { manifest: BOOK_MANIFEST, definition: BOOK },
				'fixtures/probe/': {
					manifest: PROBE_DOCUMENTS_MANIFEST,
					definition: PROBE_DOCUMENTS_DEFINITION,
				},
			});
		const workspace = await createScopedWorkspace({
			store,
			journal: delayedJournal,
			deployment: docDeployment(),
			ports: docPorts(),
		});
		kernels.push(workspace.kernel);

		const a = (await workspace.kernel.call<{ id: string }>('document-create', {
			type: 'probe',
			title: 'Doc A',
		})) as { data: { id: string } };
		const b = (await workspace.kernel.call<{ id: string }>('document-create', {
			type: 'probe',
			title: 'Doc B',
		})) as { data: { id: string } };
		expect(
			(await workspace.kernel.call('document-link-add', { from: a.data.id, to: b.data.id })).success
		).toBe(true);

		let renamePromise: Promise<unknown> | undefined;
		let intercept = true;
		store.get = (async <T>(table: string, id: string) => {
			const res = await origGet<T>(table, id);
			if (intercept && table === 'document' && id === a.data.id) {
				intercept = false;
				// While document-link-list(A) has read A but not yet B, rename B so link-list reads B's new title.
				renamePromise = workspace.kernel.call('document-rename', {
					document: b.data.id,
					title: 'Doc B Renamed',
				});
				// Give rename time to write B into the store before link-list reads B, while rename's journal append is delayed.
				await new Promise<void>((resolve) => setTimeout(resolve, 10));
			}
			return res;
		}) as typeof store.get;

		const links = await workspace.kernel.call<{
			out: Array<{ document: { id: string; title: string } }>;
		}>('document-link-list', { document: a.data.id });
		await renamePromise;
		expect(links.success, JSON.stringify(links.error)).toBe(true);
		expect(links.data?.out[0]?.document.title).toBe('Doc B Renamed');

		const entries = await delayedJournal.read();
		const renameIdx = entries.findIndex((e) => e.command === 'document-rename');
		const listIdx = entries.findIndex((e) => e.command === 'document-link-list');
		expect(listIdx).toBeGreaterThan(renameIdx);
		const { report } = await replayKernel(entries, {
			deployment: docDeployment(),
			ports: docPorts(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});
});

/** The probe documents app in the scoped workspace, with one note, `Alpha`, and its journal kept apart. */
async function probeNote() {
	const store = new MemoryAdapter();
	const docDeployment = () => ({
		...deployment(),
		apps: [...deployment().apps, { instance: 'probe', app: 'probe', package: 'fixtures/probe/' }],
	});
	const docPorts = () =>
		createFixturePorts({
			...scopedPackages(),
			'fixtures/book/': { manifest: BOOK_MANIFEST, definition: BOOK },
			'fixtures/probe/': {
				manifest: PROBE_DOCUMENTS_MANIFEST,
				definition: PROBE_DOCUMENTS_DEFINITION,
			},
		});
	const journal = new MemoryJournalSink();
	const { kernel } = await createScopedWorkspace({
		store,
		journal,
		deployment: docDeployment(),
		ports: docPorts(),
	});
	kernels.push(kernel);
	const created = await kernel.call<{ id: string }>('document-create', {
		type: 'probe',
		title: 'Alpha',
	});
	const document = created.data?.id as string;
	const get = store.get.bind(store);
	const batch = store.batch.bind(store);
	/** Whether `ops` is a write of the note's content, or of its record (the stamp). */
	const content = (ops: Parameters<MemoryAdapter['batch']>[0]) =>
		ops.some((op) => op.method === 'PUT' && op.path.startsWith('/app-probe/'));
	const stamp = (ops: Parameters<MemoryAdapter['batch']>[0]) =>
		ops.some((op) => op.method === 'PUT' && op.path === `/document/${document}`);
	/** The journal's commands, in order, and what a replay of it changed. */
	const replayed = async () => {
		const entries = await journal.read();
		const { report } = await replayKernel(entries, {
			deployment: docDeployment(),
			ports: docPorts(),
		});
		return {
			commands: entries.map((entry) => entry.command),
			different: report.entries.filter(({ status }) => status !== 'same'),
		};
	};
	return { store, kernel, document, get, batch, content, stamp, replayed };
}

const held = () => {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
};

type Content = CommandResult<{ content: { text: string } | null }>;

/**
 * #2705: a type's instance query reads the record (its check) and then the content, and a concurrent instance mutation
 * of the same document writes the content and then stamps the record. A stamp changes nothing a check reads, so it
 * orders nothing against one: the content alone puts the query before or after the mutation, as the query saw it.
 */
describe('#2705: an instance query beside an instance mutation of the same document', () => {
	it('journals a query that checked after the mutation’s check and read its content after it, after it (P2-D1)', async () => {
		const note = await probeNote();
		let query: Promise<Content> | undefined;
		const found = held();
		const stamped = held();
		let holdFind = false;
		note.store.batch = (async (ops: Parameters<MemoryAdapter['batch']>[0]) => {
			if (note.stamp(ops)) stamped.release();
			const result = await note.batch(ops);
			if (!query && note.content(ops)) {
				holdFind = true;
				query = note.kernel.call('probe-content-get', {
					document: note.document,
				}) as Promise<Content>;
				await found.promise;
			}
			return result;
		}) as typeof note.store.batch;
		note.store.get = (async <T>(table: string, id: string) => {
			const result = await note.get<T>(table, id);
			if (holdFind && table === 'document' && id === note.document) {
				holdFind = false;
				found.release();
				// Its content read comes once the stamp is issued.
				await stamped.promise;
			}
			return result;
		}) as typeof note.store.get;

		const set = await note.kernel.call('probe-content-set', {
			document: note.document,
			text: 'Alpha text',
		});
		expect(set.success, JSON.stringify(set.error)).toBe(true);
		expect((await query)?.data?.content).toEqual({ text: 'Alpha text' });
		const { commands, different } = await note.replayed();
		expect(commands.indexOf('probe-content-get')).toBeGreaterThan(
			commands.indexOf('probe-content-set')
		);
		expect(different).toEqual([]);
	});

	it('journals a query that checked before the mutation began and read its content after it, after it', async () => {
		const note = await probeNote();
		let set: Promise<CommandResult> | undefined;
		const stamped = held();
		let holdFind = true;
		note.store.batch = (async (ops: Parameters<MemoryAdapter['batch']>[0]) => {
			if (note.stamp(ops)) stamped.release();
			return note.batch(ops);
		}) as typeof note.store.batch;
		note.store.get = (async <T>(table: string, id: string) => {
			const result = await note.get<T>(table, id);
			if (holdFind && table === 'document' && id === note.document) {
				holdFind = false;
				set = note.kernel.call('probe-content-set', {
					document: note.document,
					text: 'Alpha text',
				});
				// Its content read comes once the mutation has written the content and issued its stamp.
				await stamped.promise;
			}
			return result;
		}) as typeof note.store.get;

		const query = (await note.kernel.call('probe-content-get', {
			document: note.document,
		})) as Content;
		expect((await set)?.success).toBe(true);
		expect(query.data?.content).toEqual({ text: 'Alpha text' });
		const { commands, different } = await note.replayed();
		expect(commands.indexOf('probe-content-get')).toBeGreaterThan(
			commands.indexOf('probe-content-set')
		);
		expect(different).toEqual([]);
	});

	it('journals a query that ran whole between the mutation’s check and its write, before it', async () => {
		const note = await probeNote();
		let query: Content | undefined;
		let armed = true;
		// The mutation's quota reads its row before the write is issued: the query runs whole there.
		note.store.get = (async <T>(table: string, id: string) => {
			if (armed && table === 'app-probe') {
				armed = false;
				query = (await note.kernel.call('probe-content-get', {
					document: note.document,
				})) as Content;
			}
			return note.get<T>(table, id);
		}) as typeof note.store.get;

		const set = await note.kernel.call('probe-content-set', {
			document: note.document,
			text: 'Alpha text',
		});
		expect(set.success, JSON.stringify(set.error)).toBe(true);
		expect(query?.data?.content).toEqual({ text: '' });
		const { commands, different } = await note.replayed();
		expect(commands.indexOf('probe-content-get')).toBeLessThan(
			commands.indexOf('probe-content-set')
		);
		expect(different).toEqual([]);
	});

	for (const command of ['document-get', 'document-list'] as const) {
		it(`replays a ${command} that read the record between the mutation’s check and its stamp`, async () => {
			const note = await probeNote();
			const before = (
				(await note.kernel.call('document-get', { document: note.document })) as CommandResult<{
					updatedAt: number;
				}>
			).data?.updatedAt;
			let read: Promise<CommandResult> | undefined;
			const seen = held();
			let holdRead = false;
			note.store.batch = (async (ops: Parameters<MemoryAdapter['batch']>[0]) => {
				if (!read && note.content(ops)) {
					holdRead = true;
					read = note.kernel.call(
						command,
						command === 'document-get' ? { document: note.document } : {}
					);
					// The stamp waits until the read has read the record.
					await seen.promise;
				}
				return note.batch(ops);
			}) as typeof note.store.batch;
			const record = (table: string) => {
				if (holdRead && table === 'document') {
					holdRead = false;
					seen.release();
				}
			};
			note.store.get = (async <T>(table: string, id: string) => {
				const result = await note.get<T>(table, id);
				record(table);
				return result;
			}) as typeof note.store.get;
			const list = note.store.list.bind(note.store);
			note.store.list = (async <T>(
				table: string,
				filter?: Parameters<MemoryAdapter['list']>[1]
			) => {
				const result = await list<T>(table, filter);
				record(table);
				return result;
			}) as typeof note.store.list;

			const set = await note.kernel.call('probe-content-set', {
				document: note.document,
				text: 'Alpha text',
			});
			expect(set.success, JSON.stringify(set.error)).toBe(true);
			const got = (await read) as CommandResult<{
				updatedAt?: number;
				documents?: Array<{ updatedAt: number }>;
			}>;
			expect(got.data?.updatedAt ?? got.data?.documents?.[0]?.updatedAt).toBe(before);
			expect((await note.replayed()).different).toEqual([]);
		});
	}
});

type Exported = CommandResult<{ content: { text: string } | null }>;

/**
 * #2727: `document-export` checks the record at the top level, then reads the content through the type's export, a
 * nested call. A nested read counts toward its top-level call's order, as a nested write does, so an export that read
 * the content a concurrent save wrote journals after it.
 */
describe('#2727: a document-export beside an instance mutation of the same document', () => {
	it('journals an export that checked after the mutation’s content write and read its content after the stamp, after it', async () => {
		const note = await probeNote();
		let exported: Promise<Exported> | undefined;
		const found = held();
		const stamped = held();
		let holdFind = false;
		note.store.batch = (async (ops: Parameters<MemoryAdapter['batch']>[0]) => {
			if (note.stamp(ops)) stamped.release();
			const result = await note.batch(ops);
			if (!exported && note.content(ops)) {
				holdFind = true;
				exported = note.kernel.call('document-export', {
					document: note.document,
				}) as Promise<Exported>;
				await found.promise;
			}
			return result;
		}) as typeof note.store.batch;
		note.store.get = (async <T>(table: string, id: string) => {
			const result = await note.get<T>(table, id);
			if (holdFind && table === 'document' && id === note.document) {
				holdFind = false;
				found.release();
				// Its nested content read comes once the stamp is issued.
				await stamped.promise;
			}
			return result;
		}) as typeof note.store.get;

		const set = await note.kernel.call('probe-content-set', {
			document: note.document,
			text: 'Alpha text',
		});
		expect(set.success, JSON.stringify(set.error)).toBe(true);
		const envelope = await exported;
		expect(envelope?.success, JSON.stringify(envelope?.error)).toBe(true);
		expect(envelope?.data?.content).toEqual({ text: 'Alpha text' });
		const { commands, different } = await note.replayed();
		expect(commands.indexOf('document-export')).toBeGreaterThan(
			commands.indexOf('probe-content-set')
		);
		expect(different).toEqual([]);
	});

	it('journals an export that ran whole between the mutation’s check and its write, before it', async () => {
		const note = await probeNote();
		let exported: Exported | undefined;
		let armed = true;
		note.store.get = (async <T>(table: string, id: string) => {
			if (armed && table === 'app-probe') {
				armed = false;
				exported = (await note.kernel.call('document-export', {
					document: note.document,
				})) as Exported;
			}
			return note.get<T>(table, id);
		}) as typeof note.store.get;

		const set = await note.kernel.call('probe-content-set', {
			document: note.document,
			text: 'Alpha text',
		});
		expect(set.success, JSON.stringify(set.error)).toBe(true);
		expect(exported?.data?.content).toEqual({ text: '' });
		const { commands, different } = await note.replayed();
		expect(commands.indexOf('document-export')).toBeLessThan(commands.indexOf('probe-content-set'));
		expect(different).toEqual([]);
	});
});
