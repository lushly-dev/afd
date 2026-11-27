/**
 * P5-B2 (phase 5 specification, 9.2 and 18): `event-list` and the push. The bus's own units run on synthetic journal
 * entries (retention, cursors, the per-app index, the push and the catch-up after a failed write); the kernel's run on
 * `p5-base` (exposure, the grant's order, the kinds a call projects, an app's view of a person and replay parity).
 */

import type { JournalEntry } from '@lushly-dev/afd-core';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { P4_PERSON, P5_CALLER, p5Base, type SeededKernel } from '../../scenarios/seeds.js';
import type { AppsRuntime } from '../apps-runtime.js';
import type { MembershipV1 } from '../scope/access.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { replayKernel } from '../testing.js';
import { APP_CALLABLE_SHELL_COMMANDS_V3, type EventHintV1, type EventV1 } from '../types.js';
import {
	type BusDeps,
	canSeeEvent,
	createBus,
	EVENT_RETENTION,
	PROJECTION_BATCH,
	projectEntry,
} from './events.js';

type Listed = { events: EventV1[]; cursor: string; hasMore: boolean };

let seq = 0;
/** A journal entry as the kernel writes one, by command, input, result and the caller and scope it ran with. */
const entry = (
	command: string,
	options: { input?: unknown; data?: unknown; caller?: string; failure?: true; actor?: string } = {}
): JournalEntry =>
	({
		seq: ++seq,
		timestamp: new Date(1_767_225_600_000 + seq).toISOString(),
		command,
		input: options.input ?? {},
		...(options.actor ? { actor: { kind: 'human', id: options.actor } } : {}),
		contextDigest: { hash: 'sha256:0', interface: 'palette' },
		context: {
			scope: { workspace: 'personal' },
			...(options.caller ? { caller: options.caller } : {}),
		},
		result: options.failure
			? { success: false, error: { code: 'CALL_NOT_GRANTED', message: 'm', suggestion: 's' } }
			: { success: true, data: options.data ?? {} },
		durationMs: 0,
	}) as unknown as JournalEntry;

/** One app, `watch`, with the `events` grant, workspace-only, and the bus's deps over a memory store. */
function busOver(
	store: DataAdapter = new MemoryAdapter(),
	journal = new MemoryJournalSink(),
	options: { provider?: boolean; person?: string; project?: boolean; allows?: () => boolean } = {}
) {
	const apps = {
		owners: new Map(),
		summaries: () => [{ instance: 'watch', state: 'ready' }],
		detail: () => ({ success: true, data: { grants: [{ name: 'events', served: true }] } }),
		port: () => ({
			manifest: {
				plugin: { id: 'watch' },
				app: { scope_levels: options.project ? ['workspace', 'project'] : ['workspace'] },
			},
		}),
	} as unknown as AppsRuntime;
	const scope = {
		workspace: { id: 'personal', name: 'Personal' },
		allows: () => options.allows?.() ?? true,
		workspaceApps: new Map(),
		projects: new Map(),
		opensIn: () => true,
	} as unknown as ScopeRuntime;
	const deps: BusDeps = {
		store,
		journal,
		scope,
		apps: () => apps,
		isMutation: () => false,
		...(options.provider
			? { identity: { mode: 'provider' }, deployment: { host: { kind: 'desktop' } } }
			: {}),
	};
	return { bus: createBus(deps, () => options.person ?? 'local'), store, journal };
}

/** Decide and write entries as a replay does: each with the state as it is now. */
const project = async (bus: ReturnType<typeof createBus>, entries: JournalEntry[]) => {
	bus.replayed(entries, Number.POSITIVE_INFINITY);
	await bus.flush();
};

const list = async (
	bus: ReturnType<typeof createBus>,
	input: Record<string, unknown>,
	caller?: string,
	person?: string
) =>
	(await bus.command.handler(
		input as never,
		{
			scope: { workspace: 'personal' },
			...(caller ? { caller } : {}),
			...(person ? { actor: { kind: 'human', id: person } } : {}),
		} as never
	)) as { success: boolean; data?: Listed; error?: { code: string } };

describe('P5-B2: the bus’s projection, cursors and retention', () => {
	it('P5-B2: projects each kind from its entry alone, holding no input value', () => {
		const apps = { owners: new Map() } as unknown as AppsRuntime;
		const kinds = (made: JournalEntry) =>
			projectEntry(made, 'personal', apps, () => false).map((each) => each.kind);
		expect(kinds(entry('project-create', { data: { id: 'prj_a' } }))).toEqual(['project-created']);
		expect(
			kinds(entry('document-rename', { input: { document: 'doc_a', title: 'Secret' } }))
		).toEqual(['document-updated']);
		const person = projectEntry(
			entry('setting-set', {
				input: { section: 'hello.prefs', key: 'k', value: 'Secret', level: 'person' },
				actor: 'ada',
			}),
			'personal',
			apps,
			() => false
		);
		expect(person).toMatchObject([{ kind: 'setting-changed', person: 'ada', owner: 'hello' }]);
		expect(JSON.stringify(person)).not.toContain('Secret');
		expect(
			kinds(entry('toast-show', { data: { notification: 'ntf_1' }, caller: 'watch' }))
		).toEqual(['notification-pushed']);
		// A toast that was not sticky writes no notice, and a failure projects nothing but a refusal.
		expect(kinds(entry('toast-show', { data: {} }))).toEqual([]);
		expect(kinds(entry('project-create', { failure: true }))).toEqual([]);
		expect(kinds(entry('app-call-refuse', { caller: 'watch', failure: true }))).toEqual([
			'call-refused',
		]);
		expect(kinds(entry('layout-set'))).toEqual([]);
	});

	it('P5-B2: reads tail, catch-up and its cursors, refusing a malformed or future cursor uniformly', async () => {
		const { bus } = busOver();
		// A kind named twice is refused before anything is read.
		const twice = await list(bus, { kinds: ['app-changed', 'app-changed'] });
		// As the input validator words a refusal: message, suggestion and details.
		expect(twice.error).toEqual({
			code: 'VALIDATION_ERROR',
			message: 'Input validation failed',
			suggestion: 'kinds: Name each kind once. Expected fields: since, kinds, instance, limit',
			details: {
				errors: [{ path: 'kinds', message: 'Name each kind once', code: 'custom' }],
				expectedFields: ['since', 'kinds', 'instance', 'limit'],
			},
		});
		await project(
			bus,
			[1, 2, 3].map((n) => entry('project-create', { data: { id: `prj_${n}` } }))
		);
		const tail = await list(bus, { limit: 2 });
		expect(tail.data?.events.map((each) => each.seq)).toEqual([2, 3]);
		expect(tail.data).toMatchObject({ cursor: 'v1.3', hasMore: false });
		const forward = await list(bus, { since: 'v1.0', limit: 2 });
		expect(forward.data).toMatchObject({ cursor: 'v1.2', hasMore: true });
		const rest = await list(bus, { since: forward.data?.cursor });
		expect(rest.data?.events.map((each) => each.seq)).toEqual([3]);
		expect(rest.data).toMatchObject({ cursor: 'v1.3', hasMore: false });
		for (const since of ['v1.4', 'v2.1', 'v1.01', 'x'])
			expect((await list(bus, { since })).error?.code, since).toBe('EVENT_CURSOR_INVALID');
		expect((await list(bus, { kinds: ['nothing-yet'] })).data?.events).toEqual([]);
	});

	it('P5-B2: keeps an app’s own contiguous positions, so hidden traffic leaves no gap', async () => {
		const { bus } = busOver();
		await project(bus, [
			entry('workspace-app-set', { input: { instance: 'watch' } }),
			entry('app-call-refuse', { caller: 'other', failure: true }),
			entry('autonomy-set', { input: {} }),
			entry('workspace-app-set', { input: { instance: 'watch' } }),
		]);
		const seen = await list(bus, { since: 'v1.0' }, 'watch');
		expect(seen.data?.events.map((each) => [each.seq, each.kind])).toEqual([
			[1, 'app-changed'],
			[2, 'app-changed'],
		]);
		expect(seen.data?.cursor).toBe('v1.2');
		// The workspace stream holds all four.
		expect((await list(bus, {})).data?.cursor).toBe('v1.4');
	});

	it(`P5-B2: expires a cursor past retention (${EVENT_RETENTION} events), while a tail reset after hidden-only eviction never loops`, async () => {
		const { bus } = busOver();
		await project(bus, [
			entry('workspace-app-set', { input: { instance: 'watch' } }),
			entry('workspace-app-set', { input: { instance: 'watch' } }),
			...Array.from({ length: EVENT_RETENTION + 1 }, () =>
				entry('app-call-refuse', { caller: 'other', failure: true })
			),
		]);
		expect((await list(bus, { since: 'v1.0' })).error?.code).toBe('EVENT_CURSOR_EXPIRED');
		expect((await list(bus, { since: 'v1.2' })).error?.code).toBe('EVENT_CURSOR_EXPIRED');
		// Both of `watch`'s events were evicted by traffic it cannot see: its tail is its head, and reading on from it works.
		const reset = await list(bus, {}, 'watch');
		expect(reset.data).toMatchObject({ events: [], cursor: 'v1.2', hasMore: false });
		expect((await list(bus, { since: reset.data?.cursor }, 'watch')).success).toBe(true);
		expect((await list(bus, { since: 'v1.0' }, 'watch')).error?.code).toBe('EVENT_CURSOR_EXPIRED');
	}, 60_000);

	it('P5-B2: pushes one coalesced hint of what the app may read, and none of what it may not', async () => {
		const { bus } = busOver();
		const hints: EventHintV1[] = [];
		const stop = bus.subscribe('watch', (hint) => hints.push(hint));
		await project(bus, [
			entry('workspace-app-set', { input: { instance: 'watch' } }),
			entry('workspace-app-set', { input: { instance: 'watch' } }),
			entry('autonomy-set', { input: {} }),
		]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(hints).toEqual([{ kinds: ['app-changed'], instances: ['watch'], cursor: 'v1.2' }]);
		stop();
		await project(bus, [entry('workspace-app-set', { input: { instance: 'watch' } })]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(hints).toHaveLength(1);
	});

	it('P5-B2: heals a failed projection write from the durable journal, with no hole and no duplicate', async () => {
		const memory = new MemoryAdapter();
		let fail = true;
		const store = new Proxy(memory, {
			get(target, key) {
				if (key === 'batch')
					return async (operations: Parameters<DataAdapter['batch']>[0]) => {
						if (fail) {
							fail = false;
							throw new Error('disk full');
						}
						return target.batch(operations);
					};
				const value = Reflect.get(target, key);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}) as DataAdapter;
		const journal = new MemoryJournalSink();
		const { bus } = busOver(store, journal);
		for (const n of [1, 2, 3]) {
			const { seq: _seq, ...record } = entry('project-create', { data: { id: `prj_${n}` } });
			await journal.append(record as never);
		}
		await expect(bus.catchUp()).rejects.toThrow();
		await bus.catchUp();
		await bus.catchUp();
		const all = await list(bus, { since: 'v1.0' });
		expect(all.data?.events.map((each) => (each.subject as { project?: string }).project)).toEqual([
			'prj_1',
			'prj_2',
			'prj_3',
		]);
	});

	it('P5-B2: names the owning instance of an app’s setting section', () => {
		const apps = {
			owners: new Map(),
			summaries: () => [{ instance: 'greeter', app: 'hello' }],
		} as unknown as AppsRuntime;
		const [event] = projectEntry(
			entry('setting-set', {
				input: { section: 'hello.prefs', key: 'k', value: 1, level: 'workspace' },
			}),
			'personal',
			apps,
			() => false
		);
		expect(event).toMatchObject({ kind: 'setting-changed', instance: 'greeter', owner: 'hello' });
	});

	it('P5-B2: keys an app’s stream by the signed-in reader in provider mode, whoever acted', async () => {
		const { bus } = busOver(undefined, undefined, { provider: true, person: 'ada' });
		await project(bus, [
			// The kernel's own entry, with no actor, and another person's: both workspace events.
			entry('workspace-app-set', { input: { instance: 'watch' } }),
			entry('workspace-app-set', { input: { instance: 'watch' }, actor: 'bo' }),
		]);
		const read = await list(bus, { since: 'v1.0' }, 'watch', 'ada');
		expect(read.data?.events.map((each) => each.seq)).toEqual([1, 2]);
		// Nothing landed under `local`, the key the reader's stream is not.
		const local = await list(bus, { since: 'v1.0' }, 'watch');
		expect(local.data).toMatchObject({ events: [], cursor: 'v1.0' });
	});

	it('P5-B2: pushes to a bound surface only its own project’s events', async () => {
		const { bus } = busOver(undefined, undefined, { project: true });
		const hints: EventHintV1[] = [];
		bus.subscribe('watch', (hint) => hints.push(hint), { workspace: 'personal', project: 'prj_a' });
		await project(bus, [entry('project-create', { data: { id: 'prj_b' } })]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(hints).toEqual([]);
		await project(bus, [entry('project-create', { data: { id: 'prj_a' } })]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(hints.map((hint) => hint.kinds)).toEqual([['project-created']]);
	});

	it('P5-B2: catches up a long journal in bounded batches, each atomic', async () => {
		const memory = new MemoryAdapter();
		let batches = 0;
		const store = new Proxy(memory, {
			get(target, key) {
				if (key === 'batch')
					return async (operations: Parameters<DataAdapter['batch']>[0]) => {
						if (operations.some((op) => op.method !== 'GET')) batches++;
						return target.batch(operations);
					};
				const value = Reflect.get(target, key);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}) as DataAdapter;
		const journal = new MemoryJournalSink();
		const { bus } = busOver(store, journal);
		for (let n = 0; n < 450; n++) {
			const { seq: _seq, ...record } = entry('project-create', { data: { id: `prj_${n}` } });
			await journal.append(record as never);
		}
		await bus.catchUp();
		expect(batches).toBe(Math.ceil(450 / PROJECTION_BATCH));
		const all = await list(bus, { since: 'v1.0', limit: 200 });
		expect(all.data?.events.map((each) => each.seq)).toEqual(
			Array.from({ length: 200 }, (_, index) => index + 1)
		);
		expect(all.data?.hasMore).toBe(true);
		expect((await list(bus, {})).data?.cursor).toBe('v1.450');
	});

	it('P5-B2: an append while a catch-up runs waits for the backlog before it, leaving no hole', async () => {
		const journal = new MemoryJournalSink();
		const { bus } = busOver(new MemoryAdapter(), journal);
		for (let n = 1; n <= 5; n++) {
			const { seq: _seq, ...record } = entry('project-create', { data: { id: `prj_${n}` } });
			await journal.append(record as never);
		}
		const running = bus.catchUp();
		const { seq: _seq, ...record } = entry('project-create', { data: { id: 'prj_6' } });
		bus.appended(await journal.append(record as never));
		await running;
		await bus.flush();
		expect((await list(bus, {})).data?.cursor).toBe('v1.6');
		const all = await list(bus, { since: 'v1.0' });
		expect(all.data?.events.map((each) => (each.subject as { project?: string }).project)).toEqual([
			'prj_1',
			'prj_2',
			'prj_3',
			'prj_4',
			'prj_5',
			'prj_6',
		]);
	});

	it('P5-B2: an append between a long catch-up’s batches is projected after the whole backlog', async () => {
		const memory = new MemoryAdapter();
		const journal = new MemoryJournalSink();
		let batches = 0;
		let appendAfterFirst: (() => Promise<void>) | undefined;
		const store = new Proxy(memory, {
			get(target, key) {
				if (key === 'batch')
					return async (operations: Parameters<DataAdapter['batch']>[0]) => {
						const done = await target.batch(operations);
						if (operations.some((op) => op.method !== 'GET') && ++batches === 1)
							await appendAfterFirst?.();
						return done;
					};
				const value = Reflect.get(target, key);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}) as DataAdapter;
		const { bus } = busOver(store, journal);
		for (let n = 1; n <= 450; n++) {
			const { seq: _seq, ...record } = entry('project-create', { data: { id: `prj_${n}` } });
			await journal.append(record as never);
		}
		appendAfterFirst = async () => {
			const { seq: _seq, ...record } = entry('project-create', { data: { id: 'prj_451' } });
			bus.appended(await journal.append(record as never));
		};
		await bus.catchUp();
		await bus.flush();
		expect((await list(bus, {})).data?.cursor).toBe('v1.451');
		const seen: number[] = [];
		let cursor = 'v1.0';
		for (;;) {
			const page = await list(bus, { since: cursor, limit: 200 });
			seen.push(...(page.data?.events ?? []).map((each) => each.seq));
			cursor = page.data?.cursor as string;
			if (!page.data?.hasMore) break;
		}
		expect(seen).toEqual(Array.from({ length: 451 }, (_, index) => index + 1));
	});

	it('P5-B2: an append while a failed catch-up reads the store waits for the backlog, written once and in order', async () => {
		const memory = new MemoryAdapter();
		const journal = new MemoryJournalSink();
		let batches = 0;
		let failed = false;
		let appendDuringRead: (() => Promise<void>) | undefined;
		const store = new Proxy(memory, {
			get(target, key) {
				if (key === 'batch')
					return async (operations: Parameters<DataAdapter['batch']>[0]) => {
						// The last of three batches is not written.
						if (operations.some((op) => op.method !== 'GET') && ++batches === 3) {
							failed = true;
							throw new Error('disk full');
						}
						return target.batch(operations);
					};
				if (key === 'get')
					return async (table: string, id: string) => {
						// The failure handler's read of the store's last write: an append lands meanwhile.
						if (failed && table === 'event_meta' && appendDuringRead) {
							const append = appendDuringRead;
							appendDuringRead = undefined;
							await append();
						}
						return target.get(table, id);
					};
				const value = Reflect.get(target, key);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}) as DataAdapter;
		const { bus } = busOver(store, journal);
		for (let n = 1; n <= 450; n++) {
			const { seq: _seq, ...record } = entry('project-create', { data: { id: `prj_${n}` } });
			await journal.append(record as never);
		}
		appendDuringRead = async () => {
			const { seq: _seq, ...record } = entry('project-create', { data: { id: 'prj_451' } });
			bus.appended(await journal.append(record as never));
		};
		await expect(bus.catchUp()).rejects.toThrow();
		await bus.catchUp();
		await bus.flush();
		const stored = (
			await memory.list<{ seq: number; journalSeq: number }>('event', { sort: 'seq', limit: 1000 })
		).data;
		expect(stored.map((event) => event.journalSeq)).toEqual(
			Array.from({ length: 451 }, (_, index) => index + 1)
		);
		expect((await list(bus, {})).data?.cursor).toBe('v1.451');
	});

	it('P5-B2: keeps a queued entry’s decision through a failed write, never deciding it again later', async () => {
		const memory = new MemoryAdapter();
		let fail = true;
		const store = new Proxy(memory, {
			get(target, key) {
				if (key === 'batch')
					return async (operations: Parameters<DataAdapter['batch']>[0]) => {
						if (fail && operations.some((op) => op.method !== 'GET')) {
							fail = false;
							throw new Error('disk full');
						}
						return target.batch(operations);
					};
				const value = Reflect.get(target, key);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		}) as DataAdapter;
		const journal = new MemoryJournalSink();
		let allowed = true;
		const { bus } = busOver(store, journal, { project: true, allows: () => allowed });
		const { seq: _seq, ...record } = {
			...entry('project-create', { data: { id: 'prj_kept' } }),
			context: { scope: { workspace: 'personal', project: 'prj_kept' } },
		} as JournalEntry;
		// Appended while the reader may enter the project, so `watch`'s stream takes it; the append's own catch-up, which
		// the flush waits behind, fails to write it.
		bus.appended(await journal.append(record as never));
		await bus.flush();
		expect(fail).toBe(false);
		expect((await memory.list('event', {})).data).toEqual([]);
		// Then the project is closed to the reader: the next write keeps the decision made at the append.
		allowed = false;
		await bus.catchUp();
		await bus.flush();
		const rows = (await memory.list<{ eventSeq: number }>('event_app', { sort: 'id' })).data;
		expect(rows.map((row) => row.eventSeq)).toEqual([1]);
	});

	it('P5-B2: decides each entry’s streams with the state it left, alike live and in a replay', async () => {
		// One reader, `watch`, project-capable, whose access, enablement and reach the journal changes between entries.
		const state = { allowed: true, enabled: true, granted: true };
		const make = () => {
			const store = new MemoryAdapter();
			const apps = {
				owners: new Map([
					['mail-thread-archive', { app: 'mail', instance: 'mail', recorded: true, apps: true }],
				]),
				summaries: () => [
					{ instance: 'watch', state: 'ready', scopeLevels: ['workspace', 'project'] },
				],
				detail: () => ({
					success: true,
					data: {
						grants: [
							{ name: 'events', served: true },
							{ name: 'calls', served: state.granted },
						],
					},
				}),
				port: () => ({
					manifest: {
						plugin: { id: 'watch' },
						app: { scope_levels: ['workspace', 'project'] },
						calls: [{ app: 'mail', commands: ['mail-thread-archive'] }],
					},
				}),
			} as unknown as AppsRuntime;
			const scope = {
				workspace: { id: 'personal', name: 'Personal' },
				allows: () => state.allowed,
				// The runtime's own disable: `workspace-app-set { enabled: false }`'s override, which `canOpen` reads.
				get workspaceApps() {
					return new Map(state.enabled ? [] : [['watch', { overrides: { enabled: false } }]]);
				},
				projects: new Map(),
				opensIn: () => true,
			} as unknown as ScopeRuntime;
			const journal = new MemoryJournalSink();
			const deps: BusDeps = {
				store,
				journal,
				scope,
				apps: () => apps,
				isMutation: () => true,
			};
			return { bus: createBus(deps, () => 'local'), store, journal };
		};
		const scoped = (n: number) =>
			({
				...entry('project-create', { data: { id: `prj_${n}` } }),
				context: { scope: { workspace: 'personal', project: `prj_${n}` } },
			}) as JournalEntry;
		const steps: Array<[JournalEntry, Partial<typeof state>]> = [
			[scoped(1), {}],
			[entry('mail-thread-archive'), { granted: false }],
			[scoped(2), { granted: true, allowed: false }],
			// Disabled in the workspace: its project events join no stream of `watch` (a workspace event still would).
			[scoped(3), { allowed: true, enabled: false }],
			[entry('mail-thread-archive'), { enabled: true }],
			[scoped(4), {}],
		];
		const tables = async (store: DataAdapter) => {
			const out: Record<string, unknown[]> = {};
			for (const table of ['event', 'event_meta', 'event_app', 'event_app_meta'])
				out[table] = (await store.list<{ id: string }>(table, { sort: 'id' })).data;
			return out;
		};
		// Live: each entry journaled, then appended with the state it left; a replay: each decided as the replay reaches
		// the next.
		const live = make();
		Object.assign(state, { allowed: true, enabled: true, granted: true });
		const journal: JournalEntry[] = [];
		for (const [made, change] of steps) {
			Object.assign(state, change);
			const { seq: _seq, ...record } = made;
			const recorded = await live.journal.append(record as never);
			journal.push(recorded);
			live.bus.appended(recorded);
		}
		await live.bus.catchUp();
		const replay = make();
		Object.assign(state, { allowed: true, enabled: true, granted: true });
		for (const [index, [, change]] of steps.entries()) {
			Object.assign(state, change);
			replay.bus.replayed(journal, (journal[index] as JournalEntry).seq);
		}
		await replay.bus.flush();
		const rebuilt = await tables(replay.store);
		expect(rebuilt).toEqual(await tables(live.store));
		// And the changes mattered: `watch` sees projects 1 and 4 and one of the two archives.
		expect((rebuilt.event_app as Array<{ eventSeq: number }>).map((row) => row.eventSeq)).toEqual([
			1, 5, 6,
		]);
	});

	it('P5-B2: tells two mounts of one plugin apart, by the concrete instances a grant reaches', () => {
		const event = {
			kind: 'mount-mutated' as const,
			scope: { workspace: 'personal' },
			actor: 'agent:copilot',
		};
		const viewer = (granted: string[]) => ({
			person: 'local',
			app: { instance: 'reader', plugin: 'reader', project: true, granted: new Set(granted) },
		});
		const access = { allows: () => true, enabled: () => true };
		expect(canSeeEvent({ ...event, instance: 'mail' }, viewer(['mail']), access)).toBe(true);
		expect(canSeeEvent({ ...event, instance: 'mailwork' }, viewer(['mail']), access)).toBe(false);
		// A person-private event is its person's alone; the autonomy rows are never an app's.
		expect(
			canSeeEvent({ ...event, kind: 'autonomy-changed', person: 'ada' }, { person: 'bo' }, access)
		).toBe(false);
		expect(canSeeEvent({ ...event, kind: 'autonomy-changed' }, viewer([]), access)).toBe(false);
	});
});

let seeded: SeededKernel | undefined;
afterEach(async () => {
	await seeded?.dispose();
	seeded = undefined;
});

describe('P5-B2: event-list in the kernel', () => {
	it('P5-B2: runs for a person and an agent, unjournaled, hidden from palette-search, callable by every app', async () => {
		seeded = await p5Base({ provider: false });
		const { kernel, journal } = seeded;
		expect(APP_CALLABLE_SHELL_COMMANDS_V3).toContain('event-list');
		const before = (await journal.read()).length;
		expect((await kernel.call('event-list', {})).success).toBe(true);
		expect((await kernel.agent.call('event-list', {})).success).toBe(true);
		expect((await journal.read()).length).toBe(before);
		const found = await kernel.call<{ items: Array<{ name: string }> }>('palette-search', {
			query: 'event',
		});
		expect(found.data?.items.map((item) => item.name)).not.toContain('event-list');
	});

	it('P5-B2: answers an app without the events grant GRANT_REQUIRED before it reads its cursor', async () => {
		seeded = await p5Base({ provider: false });
		const port = seeded.kernel.appPort('hello');
		for (const input of [{}, { since: 'nonsense' }, { since: 'v1.999999' }]) {
			const refused = await port.call('event-list', input);
			expect(refused.error?.code).toBe('GRANT_REQUIRED');
			expect(refused.error?.suggestion).toContain("'events'");
		}
	});

	it('P5-B2: projects a person’s and an agent’s writes, and names no person to an app', async () => {
		seeded = await p5Base({ provider: false });
		const { kernel } = seeded;
		const head = await kernel.call<Listed>('event-list', { limit: 1 });
		await kernel.call('project-create', { name: 'Orchard' });
		await kernel.call('notification-push', { title: 'A notice' });
		await kernel.agent.call('mailfix-thread-archive', { thread: 'thr_1' });
		const after = await kernel.call<Listed>('event-list', { since: head.data?.cursor });
		expect(after.data?.events.map((each) => each.kind)).toEqual([
			'project-created',
			'notification-pushed',
			'mount-mutated',
		]);
		expect(after.data?.events[2]).toMatchObject({
			instance: 'mailfix',
			actor: 'agent:shell-agent',
		});
		expect(after.data?.events[2]?.onBehalfOf).toMatch(/^human:/);
		const app = await kernel
			.appPort('mailfixapp')
			.call<Listed>('event-list', { kinds: ['mount-mutated'], instance: 'mailfix' });
		expect(app.data?.events.at(-1)).toMatchObject({ kind: 'mount-mutated', instance: 'mailfix' });
		expect(JSON.stringify(app.data)).not.toMatch(/mock-user|onBehalfOf/);
	});

	it('P5-B2: notes a new confirmation once, never its repeat, and its answer', async () => {
		seeded = await p5Base({ provider: false });
		const { kernel } = seeded;
		const head = await kernel.call<Listed>('event-list', { limit: 1 });
		// The app's own command through its port, while it is not the active app: an inbox confirmation, not a slot's.
		// The overlay's callee (`p5-base.overlay.json`), named by its app: the shell's sources name no app.
		const callee = kernel.appPort(P5_CALLER.app);
		const asked = await callee.call(`${P5_CALLER.app}-reset`, {});
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		await callee.call(`${P5_CALLER.app}-reset`, {});
		const notification = (asked.error?.details as { notification: string } | undefined)
			?.notification as string;
		await kernel.call('notification-act', { notification, answer: 'decline' });
		const after = await kernel.call<Listed>('event-list', {
			since: head.data?.cursor,
			kinds: ['confirmation-raised', 'confirmation-answered'],
		});
		expect(after.data?.events.map((each) => [each.kind, each.subject])).toEqual([
			[
				'confirmation-raised',
				{ kind: 'confirmation', notification, scope: { workspace: 'personal' } },
			],
			[
				'confirmation-answered',
				{ kind: 'confirmation', notification, scope: { workspace: 'personal' } },
			],
		]);
	});

	it('P5-B2: notes a confirmation an internal withdrawal ends, and never a slot’s prompt', async () => {
		seeded = await p5Base({
			provider: true,
			scripts: {
				held: [
					{ tools: [{ name: 'project-update', input: { project: 'atlas', name: 'Renamed' } }] },
					{ text: 'It waits for you.' },
					{ answered: true },
					{ text: 'Done.' },
				],
			},
		});
		const { kernel } = seeded;
		const head = await kernel.call<Listed>('event-list', { limit: 1 });
		const session = (await kernel.call<{ session: { id: string } }>('copilot-session-start', {}))
			.data?.session.id as string;
		const sent = await kernel.call<{ turn: { state: string } }>('copilot-message-send', {
			session,
			text: 'script:held',
		});
		expect(sent.data?.turn.state, JSON.stringify(sent.error)).toBe('waiting');
		// Stopping the turn withdraws its confirmation: the kernel's own withdrawal, in `copilot-turn-settle`.
		await kernel.call('copilot-turn-stop', { session, turn: 1 });
		// The active app's own confirm_prompt command asks in its slot: a prompt, never an inbox row.
		await kernel.call('app-open', { instance: P5_CALLER.app });
		const slot = kernel.appPort(P5_CALLER.app).call(`${P5_CALLER.app}-reset`, {});
		// The person declines it in the slot: the call ends, and the slot's decline row is no inbox confirmation.
		let overlays: Array<{ overlayId: string }> = [];
		for (let tries = 0; tries < 200 && overlays.length === 0; tries++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			overlays =
				(await kernel.call<{ overlays: Array<{ overlayId: string }> }>('overlay-list', {})).data
					?.overlays ?? [];
		}
		for (const { overlayId } of overlays) await kernel.call('overlay-dismiss', { overlayId });
		expect((await slot).success).toBe(false);
		const after = await kernel.call<Listed>('event-list', {
			since: head.data?.cursor,
			kinds: ['confirmation-raised', 'confirmation-answered'],
		});
		expect(after.data?.events.map((each) => [each.kind, each.command])).toEqual([
			['confirmation-raised', 'project-update'],
			// The stop's internal withdrawal, journaled under the turn's settle (9.2's table).
			['confirmation-answered', 'copilot-turn-settle'],
		]);
	}, 30_000);

	it('P5-B2: rebuilds all four tables row for row in a replay, though enablement and reach change midway', async () => {
		seeded = await p5Base({ provider: false });
		const { kernel } = seeded;
		const archive = () => kernel.agent.call('mailfix-thread-archive', { thread: 'thr_1' });
		const unarchive = () => kernel.agent.call('mailfix-thread-unarchive', { thread: 'thr_1' });
		await kernel.call('project-create', { name: 'Orchard', slug: 'orchard' });
		await archive();
		// In Orchard, which the journal creates (the seed's own projects are not in it), mailfixapp, the bus's reader, is disabled and enabled again: each is an event in Orchard, which an app
		// disabled there may not read, so the first joins no stream of its and the second does (a workspace event, by
		// contrast, would join both times).
		expect((await kernel.call('scope-set', { project: 'orchard' })).success).toBe(true);
		await kernel.call('workspace-app-set', { instance: 'mailfixapp', enabled: false });
		await unarchive();
		await kernel.call('workspace-app-set', { instance: 'mailfixapp', enabled: true });
		await kernel.call('scope-set', { project: null });
		// Its reach: the callee disabled, then a project restricted to someone else.
		await kernel.call('workspace-app-set', { instance: 'mailfix', enabled: false });
		await kernel.call('workspace-app-set', { instance: 'mailfix', enabled: true });
		await archive();
		await kernel.appPort('mailfixapp').call('event-list', {});
		await kernel.call('event-list', {});
		const rows = async (store: DataAdapter) => {
			const out: Record<string, unknown[]> = {};
			for (const table of ['event', 'event_meta', 'event_app', 'event_app_meta'])
				out[table] = (await store.list<{ id: string }>(table, { sort: 'id' })).data;
			return out;
		};
		const live = await rows(seeded.store as DataAdapter);
		// The change mattered: of the two changes in Orchard, the reader's stream holds the second alone.
		const orchard = (
			live.event as Array<{
				seq: number;
				kind: string;
				instance?: string;
				scope: { project?: string };
			}>
		).filter((event) => event.scope.project !== undefined && event.instance === 'mailfixapp');
		const indexed = new Set(
			(live.event_app as Array<{ eventSeq: number }>).map((row) => row.eventSeq)
		);
		expect(orchard.map((event) => [event.kind, indexed.has(event.seq)])).toEqual([
			['app-changed', false],
			['app-changed', true],
		]);
		const store = new MemoryAdapter();
		const replayed = await replayKernel(await seeded.journal.read(), {
			...(seeded.deployment ? { deployment: seeded.deployment } : {}),
			...(seeded.ports ? { ports: seeded.ports } : {}),
			store,
		});
		expect(replayed.report.diverged).toBe(false);
		expect(await rows(store)).toEqual(live);
	});

	it('P5-B2: replays a signed-in person’s streams row for row in provider mode, though a project is restricted midway', async () => {
		const OTHER = 'mock-user-bo@example.com';
		const identity = {
			identity: {
				mode: 'provider',
				organization: 'acme',
				path: 'api/auth',
				methods: ['passkey', 'password'],
			} as IdentityV1,
			membership: {
				mode: 'provider',
				members: new Map([
					[P4_PERSON, 'owner'],
					[OTHER, 'member'],
				]),
				digest: 'd1',
			} as MembershipV1,
		};
		seeded = await p5Base({ provider: false, identity });
		const { kernel } = seeded;
		const archive = () => kernel.agent.call('mailfix-thread-archive', { thread: 'thr_1' });
		const made = await kernel.call<{ slug: string }>('project-create', {
			name: 'Orchard',
			slug: 'orchard',
		});
		expect(made.success, JSON.stringify(made.error)).toBe(true);
		expect((await kernel.call('scope-set', { project: 'orchard' })).success).toBe(true);
		await archive();
		// Orchard restricted to someone else: the reader's stream keeps the archive projected while they could enter it,
		// which a replay deciding every entry at the end, with the restriction in place, would drop.
		await kernel.call('scope-set', { project: null });
		const update = await kernel.call('project-update', {
			project: 'orchard',
			access: { mode: 'restricted', members: [OTHER] },
		});
		expect(update.success, JSON.stringify(update.error)).toBe(true);
		await archive();
		await kernel.appPort('mailfixapp').call('event-list', {});
		const rows = async (store: DataAdapter) => {
			const out: Record<string, unknown[]> = {};
			for (const table of ['event', 'event_meta', 'event_app', 'event_app_meta'])
				out[table] = (await store.list<{ id: string }>(table, { sort: 'id' })).data;
			return out;
		};
		const live = await rows(seeded.store as DataAdapter);
		// Keyed by the signed-in reader, and holding the restricted project's event from before the restriction.
		const streams = (live.event_app as Array<{ stream: string; eventSeq: number }>).map(
			(row) => row.stream
		);
		expect(new Set(streams)).toEqual(new Set([`personal:${P4_PERSON}:mailfixapp`]));
		const orchard = (live.event as Array<{ seq: number; scope: { project?: string } }>).filter(
			(event) => event.scope.project !== undefined
		);
		expect(orchard.length).toBeGreaterThan(0);
		const indexed = new Set(
			(live.event_app as Array<{ eventSeq: number }>).map((row) => row.eventSeq)
		);
		expect(orchard.some((event) => indexed.has(event.seq))).toBe(true);
		const store = new MemoryAdapter();
		const replayed = await replayKernel(await seeded.journal.read(), {
			...(seeded.deployment ? { deployment: seeded.deployment } : {}),
			...(seeded.ports ? { ports: seeded.ports } : {}),
			...identity,
			store,
		});
		expect(replayed.report.diverged).toBe(false);
		expect(await rows(store)).toEqual(live);
	});

	it('P5-B2: replays the journal into the same events the live kernel projected', async () => {
		seeded = await p5Base({ provider: false });
		const { kernel } = seeded;
		await kernel.call('project-create', { name: 'Orchard' });
		await kernel.appPort('hello').call(`${P5_CALLER.app}-add`, {});
		await kernel.agent.call('mailfix-thread-archive', { thread: 'thr_1' });
		const live = await kernel.call<Listed>('event-list', { since: 'v1.0', limit: 200 });
		const replayed = await replayKernel(await seeded.journal.read(), {
			...(seeded.deployment ? { deployment: seeded.deployment } : {}),
			...(seeded.ports ? { ports: seeded.ports } : {}),
			keep: true,
		});
		try {
			const again = await replayed.kernel?.call<Listed>('event-list', {
				since: 'v1.0',
				limit: 200,
			});
			expect(again?.data?.events).toEqual(live.data?.events);
			expect(again?.data?.cursor).toBe(live.data?.cursor);
		} finally {
			await replayed.kernel?.dispose();
		}
	});
});
