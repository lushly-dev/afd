/**
 * `createJournalMiddleware()` (#273): what it records, what it never records, and its tape.
 */

import { DirectClient } from '@lushly-dev/afd-client';
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
import {
	createJournalMiddleware,
	JOURNAL_RESULT_UNSERIALIZABLE,
	type JournalMiddlewareOptions,
} from './journal.js';
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

	it('appends concurrent calls in the order they finished, whichever digest settles first', async () => {
		const sink = new MemoryJournalSink();
		// Called directly, outside an engine, where a `secret` declaration cannot be read: only a
		// journal with `redact` records there.
		const journal = createJournalMiddleware(sink, { redact: (record) => record });
		// The first digest taken settles after the second, as the threadpool may order them.
		const subtle = globalThis.crypto.subtle;
		const digest = subtle.digest.bind(subtle);
		let calls = 0;
		const spy = vi.spyOn(subtle, 'digest').mockImplementation(async (algorithm, data) => {
			const slow = calls++ === 0;
			const hash = await digest(algorithm, data);
			if (slow) await new Promise((resolve) => setTimeout(resolve, 20));
			return hash;
		});
		try {
			const call = (name: string) =>
				journal(name, {}, { traceId: name }, async () => ({ success: true, data: name }));
			await Promise.all([call('first-done'), call('second-done')]);
			expect((await sink.read()).map((entry) => entry.command)).toEqual([
				'first-done',
				'second-done',
			]);
		} finally {
			spy.mockRestore();
		}
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

	it('never records a command that declares secret without redact, whatever its name or filter', async () => {
		const login = defineCommand({
			name: 'vault-unlock',
			description: 'Unlock the vault',
			input: z.object({ passphrase: z.string() }),
			secret: true,
			handler: async () => success({ key: 'SECRET-VAULT-KEY' }),
		});
		const run = async (options: Parameters<typeof createJournalMiddleware>[1]) => {
			const sink = new MemoryJournalSink();
			const host = createMcpServer({
				name: 's',
				version: '1',
				commands: [login, roll],
				middleware: [createJournalMiddleware(sink, options)],
			});
			await host.execute('vault-unlock', { passphrase: 'hunter2' });
			await host.execute('dice-roll', { sides: 6 });
			return sink.read();
		};

		for (const options of [
			{},
			{ filter: () => true },
			{ recordFailures: true, filter: () => true },
		]) {
			const entries = await run(options);
			expect(entries.map((entry) => entry.command)).toEqual(['dice-roll']);
			expect(JSON.stringify(entries)).not.toMatch(/hunter2|SECRET/);
		}

		// With redact, the host removes the secret, and the call is recorded.
		const redacted = await run({
			filter: () => true,
			redact: (record) => ({ ...record, input: {}, result: { success: true } }),
		});
		expect(redacted.map((entry) => entry.command)).toEqual(['vault-unlock', 'dice-roll']);
		expect(JSON.stringify(redacted)).not.toMatch(/hunter2|SECRET/);

		// A direct registry runs the same engine, so the same rule holds there.
		const sink = new MemoryJournalSink();
		const registry = createDirectRegistry([login], {
			middleware: [createJournalMiddleware(sink, { filter: () => true })],
		});
		await registry.execute('vault-unlock', { passphrase: 'hunter2' });
		expect(await sink.read()).toEqual([]);
	});

	it('tells redact which calls are secret, and uses the redact it was built with', async () => {
		const login = defineCommand({
			name: 'vault-unlock',
			description: 'Unlock the vault',
			input: z.object({ passphrase: z.string() }),
			secret: true,
			handler: async () => success({ key: 'SECRET-VAULT-KEY' }),
		});
		const seen: Array<[string, boolean | undefined]> = [];
		const sink = new MemoryJournalSink();
		const host = createMcpServer({
			name: 's',
			version: '1',
			commands: [login, roll],
			middleware: [
				createJournalMiddleware(sink, {
					filter: () => true,
					redact: (record, { secret }) => {
						seen.push([record.command, secret]);
						return secret ? undefined : record;
					},
				}),
			],
		});
		await host.execute('vault-unlock', { passphrase: 'hunter2' });
		await host.execute('dice-roll', { sides: 6 });
		expect(seen).toEqual([
			['vault-unlock', true],
			['dice-roll', false],
		]);
		expect((await sink.read()).map((entry) => entry.command)).toEqual(['dice-roll']);

		// A redact added to the options after the middleware was built is not the one it applies,
		// so it admits nothing either.
		const options: Parameters<typeof createJournalMiddleware>[1] = { filter: () => true };
		const later = new MemoryJournalSink();
		const reused = createMcpServer({
			name: 's',
			version: '1',
			commands: [login],
			middleware: [createJournalMiddleware(later, options)],
		});
		options.redact = (record) => record;
		await reused.execute('vault-unlock', { passphrase: 'hunter2' });
		expect(await later.read()).toEqual([]);
	});

	it('records nothing without redact where it cannot read the declaration (a DirectClient)', async () => {
		const login = defineCommand({
			name: 'vault-unlock',
			description: 'Unlock the vault',
			input: z.object({ passphrase: z.string() }),
			secret: true,
			handler: async () => success({ key: 'SECRET-VAULT-KEY' }),
		});
		const sink = new MemoryJournalSink();
		const client = new DirectClient(createDirectRegistry([login, roll]), {
			middleware: [createJournalMiddleware(sink, { filter: () => true })],
		});
		await client.call('vault-unlock', { passphrase: 'hunter2' });
		await client.call('dice-roll', { sides: 6 });
		expect(await sink.read()).toEqual([]);

		const told: Array<boolean | undefined> = [];
		const redacting = new DirectClient(createDirectRegistry([roll]), {
			middleware: [
				createJournalMiddleware(new MemoryJournalSink(), {
					redact: (record, { secret }) => {
						told.push(secret);
						return record;
					},
				}),
			],
		});
		await redacting.call('dice-roll', { sides: 6 });
		expect(told).toEqual([undefined]);
	});

	it('keeps a secret nested call off its recorded parent’s tape, and marks that tape', async () => {
		let draws = 0;
		const random = { next: () => 0.25 + 0.01 * ++draws };
		const sink = new MemoryJournalSink();
		const server: ReturnType<typeof createMcpServer> = createMcpServer({
			name: 's',
			version: '1',
			random,
			middleware: [createJournalMiddleware(sink)],
			commands: [
				defineCommand({
					name: 'token-mint',
					description: 'Mint a token from random values',
					input: z.object({}),
					secret: true,
					handler: async (_input, context) =>
						success({ token: `T-${context?.random?.next()}-${context?.random?.next()}` }),
				}),
				defineCommand({
					name: 'session-open',
					description: 'Open a session, minting its token',
					input: z.object({}),
					handler: async (_input, context) => {
						await server.execute('token-mint', {}, context);
						return success({ opened: true });
					},
				}),
			],
		});
		await server.execute('session-open', {});
		const entries = await sink.read();
		expect(entries.map((entry) => entry.command)).toEqual(['session-open']);
		expect(entries[0]?.tape?.random ?? []).toEqual([]);
		expect(entries[0]?.tape?.truncated).toBe(true);
		expect(draws).toBe(2);
	});

	it('keeps a recorded secret nested call’s reads on its own entry, never its parent’s', async () => {
		let draws = 0;
		const sink = new MemoryJournalSink();
		const server: ReturnType<typeof createMcpServer> = createMcpServer({
			name: 's',
			version: '1',
			random: { next: () => 0.25 + 0.01 * ++draws },
			// A redact that keeps every record: the secret call is recorded, its secret left to redact.
			middleware: [createJournalMiddleware(sink, { redact: (record) => record })],
			commands: [
				defineCommand({
					name: 'token-mint',
					description: 'Mint a token from random values',
					input: z.object({}),
					secret: true,
					handler: async (_input, context) => success({ token: `T-${context?.random?.next()}` }),
				}),
				defineCommand({
					name: 'session-open',
					description: 'Open a session, minting its token',
					input: z.object({}),
					handler: async (_input, context) => {
						await server.execute('token-mint', {}, context);
						return success({ opened: true });
					},
				}),
			],
		});
		await server.execute('session-open', {});
		const [child, parent] = await sink.read();
		expect([child?.command, parent?.command]).toEqual(['token-mint', 'session-open']);
		expect(child?.tape?.random).toEqual([0.26]);
		expect(parent?.tape?.random ?? []).toEqual([]);
		expect(parent?.tape?.truncated).toBe(true);
	});

	it('refuses a secret that is not a boolean', () => {
		expect(() =>
			defineCommand({
				name: 'vault-unlock',
				description: 'Unlock the vault',
				input: z.object({}),
				secret: 'yes' as unknown as boolean,
				handler: async () => success({}),
			})
		).toThrow(TypeError);
	});

	it('records JOURNAL_RESULT_UNSERIALIZABLE when a result cannot be copied as JSON (#865)', async () => {
		const throwingGetter = defineCommand({
			name: 'summary-getter',
			description: 'Return a result with a throwing getter',
			input: z.object({ label: z.string() }),
			handler: async () =>
				success({
					get boom() {
						throw new Error('secret getter boom');
					},
				}),
		});
		const circular = defineCommand({
			name: 'summary-circular',
			description: 'Return a circular result',
			input: z.object({}),
			handler: async () => {
				const node: Record<string, unknown> = {};
				node.self = node;
				return success(node);
			},
		});
		const big = defineCommand({
			name: 'summary-bigint',
			description: 'Return a BigInt result',
			input: z.object({}),
			handler: async () => success({ count: 42n }),
		});
		const badToJson = defineCommand({
			name: 'summary-tojson',
			description: 'Return a result whose toJSON drops CommandResult shape',
			input: z.object({}),
			handler: async () =>
				({
					success: true,
					toJSON: () => 'not-a-result',
				}) as unknown as ReturnType<typeof success>,
		});

		const sink = new MemoryJournalSink();
		const onError = vi.fn((_error: Error) => {
			throw new Error('onError itself failed');
		});
		const host = createDirectRegistry([throwingGetter, circular, big, badToJson, roll], {
			clock: fixedClock('2026-01-01T00:00:00Z'),
			random: seededRandom('unserializable'),
			middleware: [createJournalMiddleware(sink, { onError })],
		});

		const live = await host.execute('summary-getter', { label: 'atlas' }, { traceId: 't-getter' });
		expect(live.success).toBe(true);
		await host.execute('summary-circular', {});
		await host.execute('summary-bigint', {});
		await host.execute('summary-tojson', {});
		await host.execute('dice-roll', { sides: 6 });

		expect(onError).toHaveBeenCalledTimes(4);
		expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: 'secret getter boom' });

		const entries = await sink.read();
		expect(entries.map((entry) => entry.command)).toEqual([
			'summary-getter',
			'summary-circular',
			'summary-bigint',
			'summary-tojson',
			'dice-roll',
		]);
		for (const entry of entries.slice(0, 4)) {
			expect(entry.result).toEqual({
				success: false,
				error: {
					code: JOURNAL_RESULT_UNSERIALIZABLE,
					message: 'The command result could not be serialized for the journal',
					suggestion: 'Return plain JSON-serializable values from the command handler',
					retryable: false,
				},
			});
		}
		expect(entries[0]).toMatchObject({
			seq: 1,
			traceId: 't-getter',
			input: { label: 'atlas' },
		});
		expect(entries[4]?.result.success).toBe(true);
		expect(JSON.stringify(entries)).not.toContain('secret getter boom');
	});

	it('records JOURNAL_RESULT_UNSERIALIZABLE for an unserializable failure when recordFailures is true', async () => {
		const badFailure = defineCommand({
			name: 'fail-unserializable',
			description: 'Return a failure with an unserializable details getter',
			input: z.object({}),
			handler: async () =>
				failure({
					code: 'BROKEN',
					message: 'Failed',
					details: {
						get bad() {
							throw new Error('details getter exploded');
						},
					},
				}),
		});
		const sink = new MemoryJournalSink();
		const onError = vi.fn();
		const host = createDirectRegistry([badFailure], {
			middleware: [createJournalMiddleware(sink, { recordFailures: true, onError })],
		});
		const live = await host.execute('fail-unserializable', {});
		expect(live.success).toBe(false);
		expect(live.error?.code).toBe('BROKEN');
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'details getter exploded' })
		);
		const [entry] = await sink.read();
		expect(entry?.result.error?.code).toBe(JOURNAL_RESULT_UNSERIALIZABLE);
	});

	it('records JOURNAL_RESULT_UNSERIALIZABLE when reading result.success throws (including undefined)', async () => {
		const sink = new MemoryJournalSink();
		const onError = vi.fn();
		// Called directly, outside an engine: only a journal with `redact` records there.
		const middleware = createJournalMiddleware(sink, { onError, redact: (record) => record });
		let reads = 0;
		const badSuccess = {
			get success(): boolean {
				reads += 1;
				throw undefined;
			},
		} as unknown as ReturnType<typeof success>;

		const returned = await middleware('bad-success', {}, {}, async () => badSuccess);
		expect(returned).toBe(badSuccess);
		expect(reads).toBe(1);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'undefined' }));
		const [entry] = await sink.read();
		expect(entry?.result.error?.code).toBe(JOURNAL_RESULT_UNSERIALIZABLE);
	});
});
