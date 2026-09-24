/**
 * `StreamOptions.timeout` (registry) and `timeout` (core `executeStream`) are a
 * deadline for the whole stream. The registry used to ignore it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeStream } from './command-execution.js';
import { type CommandDefinition, createCommandRegistry } from './commands.js';
import type { CommandResult } from './result.js';
import { success } from './result.js';
import type { StreamChunk } from './streaming.js';

afterEach(() => {
	vi.useRealTimers();
});

async function collect<T>(stream: AsyncGenerator<StreamChunk<T>, void, unknown>) {
	const chunks: StreamChunk<T>[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks;
}

function command(handler: CommandDefinition['handler']): CommandDefinition {
	return { name: 'item-list', description: 'List items', parameters: [], handler };
}

describe('registry executeStream honors StreamOptions.timeout', () => {
	it('ends with STREAM_TIMEOUT and aborts the command signal when the deadline passes', async () => {
		vi.useFakeTimers();
		let signal: AbortSignal | undefined;
		const registry = createCommandRegistry();
		registry.register(
			command(async (_input, context) => {
				signal = context?.signal;
				// Ignores the signal: the deadline must still end the stream.
				await new Promise((resolve) => setTimeout(resolve, 60_000));
				return success(['late']);
			})
		);

		const chunks = collect(registry.executeStream('item-list', {}, { timeout: 50 }));
		await vi.advanceTimersByTimeAsync(50);
		const result = await chunks;

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: 'error',
			error: { code: 'STREAM_TIMEOUT', message: 'Stream timed out after 50ms', retryable: true },
			recoverable: true,
		});
		expect(signal?.aborted).toBe(true);
	});

	it('streams normally when the command finishes before the deadline', async () => {
		vi.useFakeTimers();
		const registry = createCommandRegistry();
		registry.register(command(async () => success(['a', 'b'])));

		const chunks = await collect(registry.executeStream('item-list', {}, { timeout: 5_000 }));

		expect(chunks.map((chunk) => chunk.type)).toEqual(['data', 'data', 'complete']);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('still reports a caller abort as STREAM_ABORTED when a timeout is set', async () => {
		const controller = new AbortController();
		const registry = createCommandRegistry();
		registry.register(
			command(async () => {
				controller.abort();
				return success(['a']);
			})
		);

		const chunks = await collect(
			registry.executeStream('item-list', {}, { timeout: 5_000, signal: controller.signal })
		);

		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toMatchObject({ type: 'error', error: { code: 'STREAM_ABORTED' } });
	});

	it('rejects an invalid timeout without running the command', async () => {
		const handler = vi.fn(async () => success('x'));
		const registry = createCommandRegistry();
		registry.register(command(handler));

		for (const timeout of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			const chunks = await collect(registry.executeStream('item-list', {}, { timeout }));
			expect(chunks).toHaveLength(1);
			expect(chunks[0]).toMatchObject({
				type: 'error',
				error: { code: 'VALIDATION_ERROR' },
				recoverable: false,
			});
		}
		expect(handler).not.toHaveBeenCalled();
	});
});

describe('core executeStream timeout', () => {
	it('stops between data chunks once the deadline passes and says where to resume', async () => {
		vi.useFakeTimers();
		const stream = executeStream(
			'item-list',
			{},
			async (): Promise<CommandResult> => success([1, 2, 3]),
			{},
			{ timeout: 100 }
		);

		expect((await stream.next()).value).toMatchObject({ type: 'data', data: 1 });
		// A slow consumer: the deadline passes while the stream is paused.
		await vi.advanceTimersByTimeAsync(100);
		const stopped = (await stream.next()).value;

		expect(stopped).toMatchObject({
			type: 'error',
			error: { code: 'STREAM_TIMEOUT' },
			chunksBeforeError: 1,
			resumeFrom: 1,
		});
		expect((await stream.next()).done).toBe(true);
	});

	it('passes the deadline signal to the command, combined with the caller signal', async () => {
		const caller = new AbortController();
		let seen: AbortSignal | undefined;
		const stream = executeStream(
			'item-list',
			{},
			async (_name, _input, context) => {
				seen = context.signal as AbortSignal;
				caller.abort();
				return success('x');
			},
			{ signal: caller.signal, traceId: 'trace-1' },
			{ timeout: 5_000 }
		);

		const chunks = await collect(stream);

		expect(seen).not.toBe(caller.signal);
		expect(seen?.aborted).toBe(true);
		expect(chunks[0]).toMatchObject({ error: { code: 'STREAM_ABORTED' } });
	});

	it('clears the deadline timer when the consumer stops early', async () => {
		vi.useFakeTimers();
		const stream = executeStream(
			'item-list',
			{},
			async () => success([1, 2]),
			{},
			{ timeout: 1_000 }
		);

		await stream.next();
		await stream.return(undefined);

		expect(vi.getTimerCount()).toBe(0);
	});
});
