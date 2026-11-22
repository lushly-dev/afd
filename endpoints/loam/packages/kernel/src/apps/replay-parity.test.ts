/**
 * #1936's units: a replay of an agent's write to an app matches the live session. An app's surface reads again when a
 * command changes its store, through its own port, while the write is still on its way out of the kernel's chain: the
 * confirmations' gate stores a confirmed run's outcome on its row (phase 4's 7.2), and the enforcement gate counts an
 * `act` write (phase 5's 6.3), each after the handler. That read is journaled after the write, or a replay reads before
 * it (phase 4's R5: a replay of an honest journal matches live).
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { ManifestV1, ProjectionV3 } from '@lushly-dev/loam-manifest';
import { type AppCallContextV1, defineApp, type ManifestV2, success } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { APPROVAL_HEALTH_TABLE } from '../copilot/health.js';
import { createKernelParts } from '../kernel.js';
import { NOTIFICATION_TABLE } from '../late/notifications.js';
import { createScopedWorkspace, type ScopedWorkspace, scopedPackages } from '../scope/fixtures.js';
import { createFixedEnvironment, createFixturePorts, replayKernel } from '../testing.js';
import type { LoamKernelV5, McpToolCallResult, MountTransportV2 } from '../types.js';

const kernels: LoamKernelV5[] = [];
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
			name: 'book-list',
			title: 'List the names',
			description: 'List the names in the book.',
			effects: ['inspect'],
			input_schema: EMPTY,
		},
	],
	ui: { surfaces: { main: { element: 'book-main' } } },
} as unknown as ManifestV2;

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
		// Not replayed here: a replay answers the action, a nested call, from its record, so its write never lands in the
		// replay's store, whatever the order (a follow-up in phase 4's specification).
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

function mountedTransport(served: Served = {}): MountTransportV2 {
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
