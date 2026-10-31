/**
 * The golden journal fixture, `spec/wire/journal.jsonl` (see `spec/journal.md`).
 *
 * The test records a short session with a fixed clock and a seeded random source, and
 * compares the JSON Lines text with the file byte for byte. It then parses the file and
 * replays it against a fresh server: every entry must come back `same`.
 *
 * Regenerate after an intentional change:
 * `UPDATE_WIRE_FIXTURES=1 pnpm -F @lushly-dev/afd-server exec vitest run src/journal-wire.test.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
	type Actor,
	failure,
	fixedClock,
	MemoryJournalSink,
	parseJournal,
	seededRandom,
	serializeJournal,
	success,
} from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ContextField } from './context-fields.js';
import { createJournalMiddleware } from './journal.js';
import { replayJournal } from './journal-replay.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';

const FIXTURE = new URL('../../../spec/wire/journal.jsonl', import.meta.url);
const UPDATE = process.env.UPDATE_WIRE_FIXTURES === '1';

function todoCommands() {
	const todos = new Map<string, { id: string; title: string; createdAt: string }>();
	return [
		defineCommand({
			name: 'todo-create',
			description: 'Create a todo',
			version: '1.0.0',
			mutation: true,
			input: z.object({ title: z.string() }),
			handler: async ({ title }, context) => {
				const random = context?.random;
				const id = `todo-${Math.floor((random?.next() ?? 0) * 0x10000).toString(16)}`;
				const todo = { id, title, createdAt: new Date(context?.clock?.now() ?? 0).toISOString() };
				todos.set(id, todo);
				return success(todo, { reasoning: `Created "${title}"`, confidence: 1 });
			},
		}),
		defineCommand({
			name: 'todo-get',
			description: 'Get a todo',
			version: '1.0.0',
			input: z.object({ id: z.string() }),
			handler: async ({ id }) => {
				const todo = todos.get(id);
				return todo
					? success(todo)
					: failure({
							code: 'NOT_FOUND',
							message: `Todo ${id} not found`,
							suggestion: 'Use todo-list to see the todo ids',
						});
			},
		}),
		defineCommand({
			name: 'todo-list',
			description: 'List todos',
			version: '1.0.0',
			input: z.object({}),
			handler: async () => success({ items: [...todos.values()], count: todos.size }),
		}),
		defineCommand({
			name: 'todo-scope',
			description: 'Report the declared scope the call carries',
			version: '1.0.0',
			input: z.object({}),
			handler: async (_input, context) =>
				success({ project: (context?.scope as { project?: string } | undefined)?.project ?? null }),
		}),
	];
}

/** The fixture's declared context fields: `scope` is journaled, `locale` is not. */
const CONTEXT_FIELDS: ContextField[] = [
	{
		name: 'scope',
		meta: 'dev.example/scope',
		schema: z.object({ project: z.string() }),
		journal: true,
	},
	{ name: 'locale', meta: 'dev.example/locale', schema: z.string() },
];

async function recordFixtureSession(): Promise<string> {
	const sink = new MemoryJournalSink();
	const clock = fixedClock('2026-01-01T00:00:00Z');
	const server = createMcpServer({
		name: 'journal-fixture',
		version: '1.0.0',
		commands: todoCommands(),
		clock,
		random: seededRandom('journal-fixture'),
		contextFields: CONTEXT_FIELDS,
		middleware: [createJournalMiddleware(sink, { recordFailures: true })],
	});
	const agent: Actor = { kind: 'agent', label: 'Claude', onBehalfOf: 'user-1' };
	const human: Actor = { kind: 'human', id: 'user-1' };

	const calls: Array<[string, unknown, Actor, string, Record<string, unknown>?]> = [
		['todo-create', { title: 'Buy milk' }, agent, 'trace-1'],
		['todo-create', { title: 'Walk the dog' }, human, 'trace-2'],
		['todo-get', { id: 'todo-missing' }, agent, 'trace-3'],
		['todo-list', {}, agent, 'trace-4'],
		// Declared fields: `scope` is kept in `context`, `locale` stays a key name only.
		['todo-scope', {}, agent, 'trace-5', { scope: { project: 'p-1' }, locale: 'en-GB' }],
		// Over 4096 bytes: `scope` is named in `contextOmitted`, its value left out.
		['todo-list', {}, agent, 'trace-6', { scope: { project: 'x'.repeat(5000) } }],
	];
	for (const [command, input, actor, traceId, fields] of calls) {
		await server.execute(command, input, { traceId, actor, interface: 'mcp', ...fields });
		clock.advance(1000);
	}
	return serializeJournal(await sink.read());
}

describe('golden journal fixture (spec/wire/journal.jsonl)', () => {
	it('matches a recorded session line for line', async () => {
		const text = await recordFixtureSession();
		if (UPDATE) {
			writeFileSync(FIXTURE, text);
			return;
		}
		expect(text).toBe(readFileSync(FIXTURE, 'utf8'));
	});

	it('round-trips through parseJournal and serializeJournal', () => {
		const text = readFileSync(FIXTURE, 'utf8');
		const entries = parseJournal(text);
		expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(serializeJournal(entries)).toBe(text);
	});

	it('replays to the same results on a fresh server', async () => {
		const entries = parseJournal(readFileSync(FIXTURE, 'utf8'));
		const fresh = createMcpServer({
			name: 'journal-fixture',
			version: '1.0.0',
			commands: todoCommands(),
			contextFields: CONTEXT_FIELDS,
		});
		const report = await replayJournal(fresh, entries, { ignore: [] });
		expect(report.entries.map((entry) => [entry.seq, entry.status, entry.notes])).toEqual([
			[1, 'same', undefined],
			[2, 'same', undefined],
			[3, 'same', undefined],
			[4, 'same', undefined],
			[5, 'same', undefined],
			[6, 'same', ["context field 'scope' was too large to journal; replayed without it"]],
		]);
	});
});
