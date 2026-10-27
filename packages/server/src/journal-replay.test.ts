/**
 * `replayJournal()` (#273): record a session, replay it against a fresh server, and report
 * divergence per entry.
 */
import {
	type CommandMiddleware,
	type CommandResult,
	fixedClock,
	type JournalEntry,
	MemoryJournalSink,
	parseJournal,
	seededRandom,
	serializeJournal,
	success,
} from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createJournalMiddleware } from './journal.js';
import { replayJournal } from './journal-replay.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';

interface Todo {
	id: string;
	title: string;
	createdAt: string;
}

/** A todo app whose ids come from `context.random` and timestamps from `context.clock`. */
function todoCommands(options: { titleCase?: boolean } = {}) {
	const todos: Todo[] = [];
	return [
		defineCommand({
			name: 'todo-create',
			description: 'Create a todo',
			mutation: true,
			input: z.object({ title: z.string() }),
			handler: async ({ title }, context) => {
				const todo: Todo = {
					id: `todo-${Math.floor((context?.random?.next() ?? 0) * 1e9)}`,
					title: options.titleCase ? title.toUpperCase() : title,
					createdAt: new Date(context?.clock?.now() ?? 0).toISOString(),
				};
				todos.push(todo);
				return success(todo);
			},
		}),
		defineCommand({
			name: 'todo-list',
			description: 'List todos',
			input: z.object({}),
			handler: async () => success({ items: [...todos], count: todos.length }),
		}),
	];
}

function host(commands = todoCommands(), sink?: MemoryJournalSink) {
	return createMcpServer({
		name: 'todo',
		version: '1.0.0',
		commands,
		clock: fixedClock('2026-01-01T09:00:00Z'),
		random: seededRandom('session-42'),
		...(sink ? { middleware: [createJournalMiddleware(sink)] } : {}),
	});
}

async function recordSession(): Promise<{ entries: JournalEntry[]; results: CommandResult[] }> {
	const sink = new MemoryJournalSink();
	const server = host(todoCommands(), sink);
	const results = [
		await server.execute('todo-create', { title: 'Buy milk' }, { traceId: 't-1' }),
		await server.execute('todo-create', { title: 'Walk dog' }, { traceId: 't-2' }),
		await server.execute('todo-list', {}, { traceId: 't-3' }),
	];
	return { entries: await sink.read(), results };
}

describe('replayJournal', () => {
	it('replays a recorded session to the same results, through JSON Lines', async () => {
		const { entries } = await recordSession();
		const fromFile = parseJournal(serializeJournal(entries));

		// The replay server has the real clock and random source: the tape restores both.
		const fresh = createMcpServer({ name: 'todo', version: '1.0.0', commands: todoCommands() });
		const report = await replayJournal(fresh, fromFile);

		expect(report).toMatchObject({ same: 3, different: 0, errors: 0, diverged: false, skipped: 0 });
		expect(report.entries.map((entry) => entry.status)).toEqual(['same', 'same', 'same']);
		expect(report.entries.every((entry) => entry.notes === undefined)).toBe(true);
		const list = report.entries[2]?.replayed?.data as { items: Todo[] };
		expect(list.items.map((todo) => todo.createdAt)).toEqual([
			'2026-01-01T09:00:00.000Z',
			'2026-01-01T09:00:00.000Z',
		]);
	});

	it('restores the trace ID and actor of each entry', async () => {
		const { entries } = await recordSession();
		const seen: unknown[] = [];
		await replayJournal(
			{
				execute: async (_name, _input, context) => {
					seen.push([context?.traceId, context?.actor]);
					return success(null);
				},
			},
			entries.map((entry) => ({ ...entry, actor: { kind: 'agent', id: 'claude' } }))
		);
		expect(seen).toEqual([
			['t-1', { kind: 'agent', id: 'claude' }],
			['t-2', { kind: 'agent', id: 'claude' }],
			['t-3', { kind: 'agent', id: 'claude' }],
		]);
	});

	it('reports a changed handler as divergence with a structural diff', async () => {
		const { entries } = await recordSession();
		const changed = host(todoCommands({ titleCase: true }));
		const report = await replayJournal(changed, entries);

		expect(report).toMatchObject({ same: 0, different: 3, diverged: true });
		expect(report.entries[0]?.differences).toEqual([
			{ path: 'data.title', kind: 'changed', recorded: 'Buy milk', replayed: 'BUY MILK' },
		]);
		expect(report.entries[2]?.differences?.map((difference) => difference.path)).toEqual([
			'data.items[0].title',
			'data.items[1].title',
		]);
	});

	it('reports added and removed values, and honours ignore', async () => {
		const [entry] = (await recordSession()).entries;
		if (!entry) throw new Error('no entry');
		const target = {
			execute: async () => ({ ...entry.result, data: { extra: true }, confidence: 1 }),
		};
		const report = await replayJournal(target, [entry], { ignore: ['metadata', 'confidence'] });
		expect(report.entries[0]?.differences).toEqual([
			{ path: 'data.createdAt', kind: 'removed', recorded: expect.any(String) },
			{ path: 'data.extra', kind: 'added', replayed: true },
			{ path: 'data.id', kind: 'removed', recorded: expect.any(String) },
			{ path: 'data.title', kind: 'removed', recorded: 'Buy milk' },
		]);
	});

	it('reports a target that throws as an error and can stop there', async () => {
		const { entries } = await recordSession();
		const report = await replayJournal(
			{
				execute: async () => {
					throw new Error('connection refused');
				},
			},
			entries,
			{ stopOnDivergence: true }
		);
		expect(report).toMatchObject({ errors: 1, diverged: true, skipped: 2 });
		expect(report.entries).toEqual([
			expect.objectContaining({ seq: 1, status: 'error', error: 'connection refused' }),
		]);
	});

	it('replays in seq order', async () => {
		const { entries } = await recordSession();
		const order: number[] = [];
		await replayJournal(
			{
				execute: async (_name, _input, context) => {
					order.push(Number(String(context?.traceId).slice(2)));
					return success(null);
				},
			},
			[...entries].reverse()
		);
		expect(order).toEqual([1, 2, 3]);
	});

	it('uses the entry timestamp and a per-entry seed when there is no tape', async () => {
		const { entries } = await recordSession();
		const [first] = entries;
		if (!first) throw new Error('no entry');
		const { tape: _tape, ...untaped } = first;
		const report = await replayJournal(host(), [untaped], { seed: 's' });
		const replayed = report.entries[0]?.replayed?.data as Todo;

		expect(replayed.createdAt).toBe(first.timestamp);
		expect(replayed.id).toBe(`todo-${Math.floor(seededRandom('s:1').next() * 1e9)}`);
	});

	it('notes a tape that runs short or is not used up', async () => {
		const { entries } = await recordSession();
		const [first, , list] = entries;
		if (!first || !list) throw new Error('no entries');
		const short = { ...first, tape: { clock: [], random: [] } };
		const unused = { ...list, tape: { clock: [1, 2, 3, 4], random: [0.5], truncated: true } };
		const report = await replayJournal(host(), [short, unused]);

		expect(report.entries[0]?.notes).toEqual([
			expect.stringMatching(/^clock: the tape holds 0 readings/),
			expect.stringMatching(/^random: the tape holds 0 values/),
		]);
		expect(report.entries[1]?.notes).toEqual([
			'the recorded tape was truncated; values past it are not restored',
			'clock: the replay read 2 of 4 recorded readings',
			'random: the replay read 0 of 1 recorded values',
		]);
	});

	it('passes extra context, which wins over restored values', async () => {
		const { entries } = await recordSession();
		const seen: unknown[] = [];
		await replayJournal(
			{
				execute: async (_name, _input, context) => {
					seen.push([context?.traceId, context?.db]);
					return success(null);
				},
			},
			entries.slice(0, 1),
			{ context: (entry) => ({ db: `db-${entry.seq}`, traceId: 'replay' }) }
		);
		expect(seen).toEqual([['replay', 'db-1']]);
	});

	it('lines the tape up when the replayed server has the same middleware', async () => {
		// A clock that moves on every reading, and an outer middleware that reads it too.
		let now = Date.parse('2026-01-01T00:00:00Z');
		const ticking = { now: () => (now += 1000) };
		const outer: CommandMiddleware = async (_name, _input, context, next) => {
			context.clock?.now();
			const result = await next();
			context.clock?.now();
			return result;
		};
		const build = (sink: MemoryJournalSink) =>
			createMcpServer({
				name: 'todo',
				version: '1.0.0',
				commands: todoCommands(),
				clock: ticking,
				middleware: [outer, createJournalMiddleware(sink)],
			});

		const recording = new MemoryJournalSink();
		const recorder = build(recording);
		await recorder.execute('todo-create', { title: 'Buy milk' });
		await recorder.execute('todo-list', {});
		const entries = await recording.read();

		const replaySink = new MemoryJournalSink();
		const report = await replayJournal(build(replaySink), entries, { ignore: [] });

		expect(report.entries.map((entry) => [entry.status, entry.notes])).toEqual([
			['same', undefined],
			['same', undefined],
		]);
		// Replay does not record again.
		expect(await replaySink.read()).toEqual([]);
	});

	it('reports a bad timestamp or a throwing context factory as an entry error', async () => {
		const [first, second] = (await recordSession()).entries;
		if (!first || !second) throw new Error('no entries');
		const { tape: _tape, ...untaped } = first;
		const report = await replayJournal(host(), [{ ...untaped, timestamp: 'not a date' }, second]);
		expect(report.entries.map((entry) => entry.status)).toEqual(['error', 'same']);

		const throwing = await replayJournal(host(), [first], {
			context: () => {
				throw new Error('no database');
			},
		});
		expect(throwing.entries[0]).toMatchObject({ status: 'error', error: 'no database' });
	});

	it('compares own keys only', async () => {
		const [entry] = (await recordSession()).entries;
		if (!entry) throw new Error('no entry');
		const recorded = { ...entry, result: { success: true, data: { constructor: 1 } } };
		const report = await replayJournal({ execute: async () => success({}) }, [recorded], {
			ignore: ['metadata'],
		});
		expect(report.entries[0]?.differences).toEqual([
			{ path: 'data.constructor', kind: 'removed', recorded: 1 },
		]);
	});

	it('keeps nested calls on the outer tape, recording and replaying', async () => {
		let now = 0;
		const ticking = { now: () => (now += 7) };
		const build = (sink: MemoryJournalSink) => {
			const server: ReturnType<typeof createMcpServer> = createMcpServer({
				name: 'nested',
				version: '1.0.0',
				clock: ticking,
				middleware: [createJournalMiddleware(sink)],
				commands: [
					defineCommand({
						name: 'inner-tick',
						description: 'Read the clock',
						input: z.object({}),
						handler: async (_input, context) => success({ at: context?.clock?.now() }),
					}),
					defineCommand({
						name: 'outer-tick',
						description: 'Read the clock around a nested call',
						input: z.object({}),
						handler: async (_input, context) => {
							const before = context?.clock?.now();
							const inner = await server.execute('inner-tick', {}, context);
							return success({ before, inner: inner.data, after: context?.clock?.now() });
						},
					}),
				],
			});
			return server;
		};

		const recording = new MemoryJournalSink();
		await build(recording).execute('outer-tick', {});
		const entries = await recording.read();
		expect(entries.map((entry) => entry.command)).toEqual(['inner-tick', 'outer-tick']);

		const replaySink = new MemoryJournalSink();
		const report = await replayJournal(build(replaySink), entries, { ignore: [] });
		expect(report.entries.map((entry) => [entry.status, entry.notes])).toEqual([
			['same', undefined],
			['same', undefined],
		]);
		expect(await replaySink.read()).toEqual([]);
	});
});

describe('JOURNAL_REPLAY across module copies (#441)', () => {
	it('is the same registered symbol in separately loaded copies of the module', async () => {
		const first = await import('./journal.js');
		vi.resetModules();
		const second = await import('./journal.js');

		expect(second).not.toBe(first);
		expect(second.JOURNAL_REPLAY).toBe(first.JOURNAL_REPLAY);
		expect(Symbol.keyFor(first.JOURNAL_REPLAY)).toBe('@lushly-dev/afd-server/journal-replay');
	});

	it("is recognized by another copy's journal middleware, which does not re-record", async () => {
		const { entries } = await recordSession();
		vi.resetModules();
		const other = await import('./journal-replay.js');

		// The registry records with this file's copy; replay marks calls with the other copy.
		const sink = new MemoryJournalSink();
		const report = await other.replayJournal(host(todoCommands(), sink), entries);

		expect(report.diverged).toBe(false);
		expect(await sink.read()).toEqual([]);
	});
});
