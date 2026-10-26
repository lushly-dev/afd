/**
 * `createJournalMiddleware()` (#273): what it records, what it never records, and its tape.
 */
import {
	type CommandMiddleware,
	failure,
	fixedClock,
	type JournalSink,
	MemoryJournalSink,
	seededRandom,
	success,
} from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDirectRegistry } from './direct-registry.js';
import { createJournalMiddleware, type JournalMiddlewareOptions } from './journal.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';

const roll = defineCommand({
	name: 'dice-roll',
	description: 'Roll a die and say when',
	input: z.object({ sides: z.number().int().min(2) }),
	handler: async ({ sides }, context) =>
		success({
			value: 1 + Math.floor((context?.random?.next() ?? 0) * sides),
			at: context?.clock?.now(),
		}),
});

const fail = defineCommand({
	name: 'always-fail',
	description: 'Return a failure',
	input: z.object({}),
	handler: async () => failure({ code: 'NOT_FOUND', message: 'Nothing here', suggestion: 'Stop' }),
});

const boom = defineCommand({
	name: 'always-throw',
	description: 'Throw',
	input: z.object({}),
	handler: async () => {
		throw new Error('database password is hunter2');
	},
});

/** Stands in for auth middleware: puts a session on the context and refines the actor. */
const fakeAuth: CommandMiddleware = async (_name, _input, context, next) => {
	context.auth = { session: { accessToken: 'SECRET-ACCESS-TOKEN' }, user: { email: 'a@b.c' } };
	context.session = { cookie: 'SECRET-COOKIE' };
	context.actor = { kind: 'human', id: 'user-1', label: 'Ada' };
	return next();
};

function server(
	sink: JournalSink,
	options: JournalMiddlewareOptions = {},
	extra: CommandMiddleware[] = []
) {
	return createMcpServer({
		name: 'journal-test',
		version: '1.0.0',
		commands: [roll, fail, boom],
		clock: fixedClock('2026-01-01T00:00:00Z'),
		random: seededRandom('journal'),
		middleware: [...extra, createJournalMiddleware(sink, options)],
	});
}

describe('createJournalMiddleware', () => {
	it('records an accepted call with its input, result, context digest and tape', async () => {
		const sink = new MemoryJournalSink();
		const result = await server(sink).execute('dice-roll', { sides: 6 }, { traceId: 'trace-1' });
		const [entry] = await sink.read();

		expect(entry).toMatchObject({
			seq: 1,
			timestamp: '2026-01-01T00:00:00.000Z',
			traceId: 'trace-1',
			command: 'dice-roll',
			input: { sides: 6 },
			durationMs: 0,
		});
		expect(entry?.contextDigest.hash).toMatch(/^sha256:/);
		expect(entry?.result).toEqual(JSON.parse(JSON.stringify(result)));
		// The handler's random draw and clock read, around the server's two timing reads.
		expect(entry?.tape?.random).toHaveLength(1);
		expect(entry?.tape?.clock).toEqual(Array(3).fill(Date.parse('2026-01-01T00:00:00Z')));
	});

	it('does not record calls rejected by validation or lookup', async () => {
		const sink = new MemoryJournalSink();
		const host = server(sink, { recordFailures: true });
		expect((await host.execute('dice-roll', { sides: 1 })).success).toBe(false);
		expect((await host.execute('no-such-command', {})).success).toBe(false);
		expect(await sink.read()).toEqual([]);
	});

	it('records failures only when asked, without exception messages', async () => {
		const quiet = new MemoryJournalSink();
		await server(quiet).execute('always-fail', {});
		await server(quiet).execute('always-throw', {});
		expect(await quiet.read()).toEqual([]);

		const loud = new MemoryJournalSink();
		const host = server(loud, { recordFailures: true });
		await host.execute('always-fail', {});
		const thrown = await host.execute('always-throw', {});
		const entries = await loud.read();

		expect(thrown.error?.code).toBe('COMMAND_EXECUTION_ERROR');
		// The recorded failure is the one the caller got, suggestion included.
		expect(entries[1]?.result).toEqual(JSON.parse(JSON.stringify(thrown)));
		expect(entries[1]?.result.error?.suggestion).toBeTruthy();
		expect(entries.map((entry) => entry.result.error?.code)).toEqual([
			'NOT_FOUND',
			'COMMAND_EXECUTION_ERROR',
		]);
		expect(JSON.stringify(entries)).not.toContain('hunter2');
	});

	it('never stores auth or session data, and records the actor auth settled on', async () => {
		const sink = new MemoryJournalSink();
		await server(sink, {}, [fakeAuth]).execute(
			'dice-roll',
			{ sides: 6 },
			{ traceId: 't', apiKey: 'SECRET-API-KEY', headers: { authorization: 'Bearer SECRET' } }
		);
		const [entry] = await sink.read();
		const text = JSON.stringify(entry);

		expect(entry?.actor).toEqual({ kind: 'human', id: 'user-1', label: 'Ada' });
		expect(text).not.toMatch(/SECRET|a@b\.c|cookie|accessToken|authorization/i);
		expect(Object.keys(entry ?? {}).sort()).toEqual(
			[
				'actor',
				'command',
				'contextDigest',
				'durationMs',
				'input',
				'result',
				'seq',
				'tape',
				'timestamp',
				'traceId',
			].sort()
		);
		expect(Object.keys(entry?.contextDigest ?? {})).toEqual(['hash']);
	});

	it('filters and redacts', async () => {
		const sink = new MemoryJournalSink();
		const host = server(sink, {
			filter: (name) => name !== 'always-fail',
			recordFailures: true,
			redact: (record) =>
				record.command === 'always-throw'
					? undefined
					: { ...record, input: { sides: '[redacted]' } },
		});
		await host.execute('always-fail', {});
		await host.execute('always-throw', {});
		await host.execute('dice-roll', { sides: 6 });
		const entries = await sink.read();

		expect(entries.map((entry) => entry.command)).toEqual(['dice-roll']);
		expect(entries[0]?.input).toEqual({ sides: '[redacted]' });
	});

	it('truncates long tapes', async () => {
		const sink = new MemoryJournalSink();
		await server(sink, { maxTapeReads: 1 }).execute('dice-roll', { sides: 6 });
		const [entry] = await sink.read();
		expect(entry?.tape).toMatchObject({ clock: [expect.any(Number)], truncated: true });
	});

	it('reports sink errors to onError without changing the result', async () => {
		const onError = vi.fn();
		const broken: JournalSink = {
			append: async () => {
				throw new Error('disk full');
			},
			read: async () => [],
		};
		const result = await server(broken, { onError }).execute('dice-roll', { sides: 6 });
		expect(result.success).toBe(true);
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
	});

	it('records through the DirectClient registry with its interface', async () => {
		const sink = new MemoryJournalSink();
		const agentRoll = defineCommand({
			name: 'dice-roll',
			description: 'Roll a die',
			expose: { agent: true },
			input: z.object({ sides: z.number() }),
			handler: async ({ sides }, context) =>
				success({ value: (context?.random?.next() ?? 0) * sides }),
		});
		const registry = createDirectRegistry([agentRoll], {
			middleware: [createJournalMiddleware(sink)],
			actor: { kind: 'script' },
		});
		await registry.execute('dice-roll', { sides: 6 });
		const [entry] = await sink.read();
		expect(entry).toMatchObject({
			actor: { kind: 'script' },
			contextDigest: { interface: 'agent' },
		});
	});

	it('restores the context clock and random source after the call', async () => {
		const sink = new MemoryJournalSink();
		const clock = fixedClock(0);
		const random = seededRandom('x');
		const seen: unknown[] = [];
		const outer: CommandMiddleware = async (_name, _input, context, next) => {
			const result = await next();
			seen.push(context.clock, context.random);
			return result;
		};
		await createMcpServer({
			name: 's',
			version: '1',
			commands: [roll],
			clock,
			random,
			middleware: [outer, createJournalMiddleware(sink)],
		}).execute('dice-roll', { sides: 6 });
		expect(seen).toEqual([clock, random]);
	});

	it('skips auth-* commands by default, so a password never reaches the journal', async () => {
		const signIn = defineCommand({
			name: 'auth-sign-in',
			description: 'Sign in',
			input: z.object({ email: z.string(), password: z.string() }),
			handler: async () => success({ token: 'SECRET-SESSION-TOKEN' }),
		});
		const sink = new MemoryJournalSink();
		const host = createMcpServer({
			name: 's',
			version: '1',
			commands: [signIn, roll],
			middleware: [createJournalMiddleware(sink, { recordFailures: true })],
		});
		await host.execute('auth-sign-in', { email: 'a@b.c', password: 'hunter2' });
		await host.execute('dice-roll', { sides: 6 });
		const entries = await sink.read();

		expect(entries.map((entry) => entry.command)).toEqual(['dice-roll']);
		expect(JSON.stringify(entries)).not.toMatch(/hunter2|SECRET/);
	});
});
