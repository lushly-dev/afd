/**
 * What the journal records for a call the engine stopped waiting for (`spec/journal.md`, "Calls
 * that end at a deadline", #2678). Each handler waits on a promise the test settles. The engine's
 * deadlines run on fake timers the test advances, and DirectClient's `AbortSignal.timeout`, which
 * fake timers do not replace, is stubbed with a signal the test aborts, so nothing here races a
 * real timer.
 */

import { DirectClient } from '@lushly-dev/afd-client';
import {
	type CommandMiddleware,
	type CommandResult,
	type JournalEntry,
	type JournalRecord,
	type JournalSink,
	MemoryJournalSink,
	success,
} from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { withCommandDeadlines } from './command-timeout.js';
import { createDirectRegistry } from './direct-registry.js';
import { createExecutionEngine } from './execution.js';
import { createJournalMiddleware } from './journal.js';
import { defineCommand } from './schema.js';

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}

/** A memory sink that also says when an entry arrives. */
function watchedSink() {
	const memory = new MemoryJournalSink();
	let arrived = deferred<JournalEntry>();
	const sink: JournalSink = {
		append: async (record: JournalRecord) => {
			const entry = await memory.append(record);
			arrived.resolve(entry);
			return entry;
		},
		read: (range) => memory.read(range),
	};
	return {
		sink,
		read: () => memory.read(),
		next: () => {
			const waiting = arrived.promise;
			return waiting.finally(() => {
				arrived = deferred<JournalEntry>();
			});
		},
	};
}

function setup(options: { recordFailures?: boolean; before?: CommandMiddleware[] } = {}) {
	const release = deferred<CommandResult>();
	const started = deferred();
	const slow = defineCommand({
		name: 'work-slow',
		description: 'Wait until the test releases it',
		expose: { mcp: true },
		input: z.object({}),
		handler: () => {
			started.resolve();
			return release.promise;
		},
	});
	const quick = defineCommand({
		name: 'work-quick',
		description: 'Return at once',
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => success('quick'),
	});
	const journal = watchedSink();
	const middleware = [
		...(options.before ?? []),
		createJournalMiddleware(journal.sink, { recordFailures: options.recordFailures }),
	];
	const engine = createExecutionEngine({
		commandMap: new Map([
			[slow.name, slow],
			[quick.name, quick],
		]),
		middleware: withCommandDeadlines(middleware),
		devMode: false,
	});
	return { engine, journal, release, started, slow, quick, middleware };
}

afterEach(() => vi.useRealTimers());

describe('the journal at a deadline (TypeScript)', () => {
	it('TIMEOUT: no entry at the deadline; the handler result once it settles', async () => {
		vi.useFakeTimers();
		const { engine, journal, release, started } = setup();
		const running = engine.executeCommand('work-slow', {}, { timeout: 10 });
		await started.promise;
		await vi.advanceTimersByTimeAsync(10);
		expect((await running).error?.code).toBe('TIMEOUT');
		// The handler has not settled: nothing is recorded, however long it stays that way.
		await vi.advanceTimersByTimeAsync(1_000);
		expect(await journal.read()).toEqual([]);

		const arrived = journal.next();
		release.resolve(success('late'));
		const entry = await arrived;
		expect(entry).toMatchObject({ command: 'work-slow', result: { success: true, data: 'late' } });
		expect(await journal.read()).toHaveLength(1);
	});

	it('TIMEOUT: a late failure is recorded only with recordFailures', async () => {
		vi.useFakeTimers();
		const quiet = setup();
		const quietRun = quiet.engine.executeCommand('work-slow', {}, { timeout: 10 });
		await quiet.started.promise;
		await vi.advanceTimersByTimeAsync(10);
		expect((await quietRun).error?.code).toBe('TIMEOUT');
		quiet.release.resolve({
			success: false,
			error: { code: 'ABORTED_BY_HANDLER', message: 'Stopped on abort' },
		});
		await vi.advanceTimersByTimeAsync(0);
		// A marker call that succeeds: its entry is appended after any entry of the late call.
		await quiet.engine.executeCommand('work-quick', {});
		expect((await quiet.journal.read()).map((entry) => entry.command)).toEqual(['work-quick']);

		vi.useFakeTimers();
		const loud = setup({ recordFailures: true });
		const loudRun = loud.engine.executeCommand('work-slow', {}, { timeout: 10 });
		await loud.started.promise;
		await vi.advanceTimersByTimeAsync(10);
		expect((await loudRun).error?.code).toBe('TIMEOUT');
		const arrived = loud.journal.next();
		loud.release.resolve({
			success: false,
			error: { code: 'ABORTED_BY_HANDLER', message: 'Stopped on abort' },
		});
		expect((await arrived).result.error?.code).toBe('ABORTED_BY_HANDLER');
	});

	it('TIMEOUT before the handler starts: the journal holds COMMAND_CANCELLED', async () => {
		vi.useFakeTimers();
		const gate = deferred();
		const held: CommandMiddleware = async (_name, _input, _context, next) => {
			await gate.promise;
			return next();
		};
		// The held middleware sits outside the journal, as an approval step can.
		const { engine, journal, started } = setup({ recordFailures: true, before: [held] });
		const calledAt = Date.now();
		const running = engine.executeCommand('work-slow', {}, { timeout: 10 });
		await vi.advanceTimersByTimeAsync(10);
		expect((await running).error?.code).toBe('TIMEOUT');
		expect(await journal.read()).toEqual([]);

		const arrived = journal.next();
		gate.resolve();
		const entry = await arrived;
		expect(entry.result.error?.code).toBe('COMMAND_CANCELLED');
		// The recorder began when the held middleware let the call through: after the deadline.
		expect(Date.parse(entry.timestamp)).toBeGreaterThanOrEqual(calledAt + 10);
		let handlerRan = false;
		void started.promise.then(() => {
			handlerRan = true;
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(handlerRan).toBe(false);
	});

	it('BATCH_TIMEOUT: the in-flight item is recorded when it settles, the unstarted one never', async () => {
		vi.useFakeTimers();
		const { engine, journal, release, started } = setup();
		const running = engine.executeBatch({
			commands: [
				{ command: 'work-slow', input: {} },
				{ command: 'work-quick', input: {} },
			],
			options: { timeout: 10, parallelism: 1 },
		});
		await started.promise;
		await vi.advanceTimersByTimeAsync(10);
		const batch = await running;
		expect(batch.results.map((item) => item.result.error?.code)).toEqual([
			'BATCH_TIMEOUT',
			'BATCH_TIMEOUT',
		]);
		expect(await journal.read()).toEqual([]);

		const arrived = journal.next();
		release.resolve(success('late'));
		expect(await arrived).toMatchObject({ command: 'work-slow', result: { data: 'late' } });
		await vi.advanceTimersByTimeAsync(0);
		expect((await journal.read()).map((entry) => entry.command)).toEqual(['work-slow']);
	});

	it('PIPELINE_TIMEOUT: the running step is recorded when it settles, the later one never', async () => {
		vi.useFakeTimers();
		const { engine, journal, release, started } = setup();
		const running = engine.executePipeline({
			steps: [{ command: 'work-slow' }, { command: 'work-quick' }],
			options: { timeoutMs: 10 },
		});
		await started.promise;
		await vi.advanceTimersByTimeAsync(10);
		const pipeline = await running;
		expect(pipeline.steps.map((step) => step.error?.code)).toEqual([
			'PIPELINE_TIMEOUT',
			'PIPELINE_TIMEOUT',
		]);
		expect(await journal.read()).toEqual([]);

		const arrived = journal.next();
		release.resolve(success('late'));
		expect(await arrived).toMatchObject({ command: 'work-slow', result: { data: 'late' } });
		await vi.advanceTimersByTimeAsync(0);
		expect((await journal.read()).map((entry) => entry.command)).toEqual(['work-slow']);
	});

	it("DirectClient's TIMEOUT: the same, with the journal in the registry's middleware", async () => {
		const { journal, release, started, slow, middleware } = setup();
		// DirectClient's deadline is `AbortSignal.timeout`: stand in a signal the test aborts.
		const deadline = new AbortController();
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
		try {
			const client = new DirectClient(createDirectRegistry([slow], { middleware }));
			const running = client.call('work-slow', {}, { timeout: 10 });
			await started.promise;
			expect(timeout).toHaveBeenCalledWith(10);
			deadline.abort(new DOMException('The operation timed out.', 'TimeoutError'));
			expect((await running).error?.code).toBe('TIMEOUT');
		} finally {
			timeout.mockRestore();
		}
		expect(await journal.read()).toEqual([]);

		const arrived = journal.next();
		release.resolve(success('late'));
		expect(await arrived).toMatchObject({ command: 'work-slow', result: { data: 'late' } });
	});
});
