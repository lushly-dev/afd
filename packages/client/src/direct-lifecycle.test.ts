import type { CommandContext, CommandResult, JsonSchema, StreamChunk } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from './client.js';
import type { DirectRegistry } from './direct-types.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function registry(execute: DirectRegistry['execute']): DirectRegistry {
	return {
		execute,
		listCommands: () => [{ name: 'item-get', description: 'Get an item' }],
		listCommandNames: () => ['item-get'],
		hasCommand: (name) => name === 'item-get',
	};
}

async function collect<T>(stream: AsyncIterable<StreamChunk<T>>) {
	const chunks: StreamChunk<T>[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks;
}

afterEach(() => vi.useRealTimers());

describe('McpClient direct execution ownership', () => {
	it('settles a non-cooperative call at its deadline and suppresses late callbacks', async () => {
		vi.useFakeTimers();
		const execution = deferred<CommandResult<never>>();
		let seen: CommandContext | undefined;
		const client = new McpClient({
			transport: 'direct',
			registry: registry(async <T>(_name: string, _input: unknown, context?: CommandContext) => {
				seen = context;
				return execution.promise as Promise<CommandResult<T>>;
			}),
		});
		await client.connect();
		const messages = vi.fn();
		client.on('message', messages);
		let settled = false;
		const call = client.call('item-get', {}, { timeout: 25 }).then((result) => {
			settled = true;
			return result;
		});
		await vi.advanceTimersByTimeAsync(24);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toBe(true);
		expect((await call).error?.code).toBe('TIMEOUT');
		expect(seen?.signal?.aborted).toBe(true);
		execution.resolve({ success: true });
		await vi.advanceTimersByTimeAsync(0);
		expect(messages).not.toHaveBeenCalled();
		await client.disconnect();
	});

	it.each(['caller', 'disconnect'] as const)(
		'settles a pending call on %s cancellation',
		async (action) => {
			const execution = deferred<CommandResult<never>>();
			let signal: AbortSignal | undefined;
			const client = new McpClient({
				transport: 'direct',
				registry: registry(async <T>(_name: string, _input: unknown, context?: CommandContext) => {
					signal = context?.signal;
					return execution.promise as Promise<CommandResult<T>>;
				}),
			});
			await client.connect();
			const controller = new AbortController();
			const call = client.callTool('item-get', {}, { signal: controller.signal });
			const rejected = expect(call).rejects.toThrow(/cancelled|disconnected/);
			if (action === 'caller') controller.abort(new Error('caller cancelled'));
			else await client.disconnect();
			await rejected;
			expect(signal?.aborted).toBe(true);
			// A rejected handler after cancellation is observed by the race.
			execution.reject(new Error('late execution rejection'));
			await client.disconnect();
		}
	);

	it('does not start execution for an already aborted caller', async () => {
		const execute = vi.fn(async () => ({ success: true as const }));
		const client = new McpClient({ transport: 'direct', registry: registry(execute) });
		await client.connect();
		await expect(
			client.callTool(
				'item-get',
				{},
				{
					signal: AbortSignal.abort(new Error('already cancelled')),
				}
			)
		).rejects.toThrow('already cancelled');
		expect(execute).not.toHaveBeenCalled();
		await client.disconnect();
	});

	it('ends a never-resolving stream at its deadline without waiting for execution', async () => {
		vi.useFakeTimers();
		let signal: AbortSignal | undefined;
		const client = new McpClient({
			transport: 'direct',
			registry: registry(async (_name, _input, context) => {
				signal = context?.signal;
				return new Promise(() => undefined);
			}),
		});
		await client.connect();
		let settled = false;
		const stream = collect(client.stream('item-get', {}, { timeout: 25 })).then((chunks) => {
			settled = true;
			return chunks;
		});
		await vi.advanceTimersByTimeAsync(24);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toBe(true);
		expect(await stream).toEqual([
			expect.objectContaining({
				type: 'error',
				error: expect.objectContaining({ code: 'STREAM_TIMEOUT' }),
			}),
		]);
		expect(signal?.aborted).toBe(true);
		await client.disconnect();
	});

	it.each(['caller', 'disconnect'] as const)(
		'ends a stream promptly on %s without a deadline',
		async (action) => {
			let signal: AbortSignal | undefined;
			const client = new McpClient({
				transport: 'direct',
				registry: registry(async (_name, _input, context) => {
					signal = context?.signal;
					return new Promise(() => undefined);
				}),
			});
			await client.connect();
			const controller = new AbortController();
			const stream = collect(client.stream('item-get', {}, { signal: controller.signal }));
			if (action === 'caller') controller.abort();
			else await client.disconnect();
			expect(await stream).toEqual([
				expect.objectContaining({
					type: 'error',
					error: expect.objectContaining({ code: 'STREAM_CANCELLED' }),
				}),
			]);
			expect(signal?.aborted).toBe(true);
			await client.disconnect();
		}
	);

	it('preserves the advertised input schema and planning metadata during discovery', async () => {
		const inputSchema: JsonSchema = {
			type: 'object',
			properties: { id: { type: 'string', minLength: 1 } },
			required: ['id'],
			additionalProperties: false,
		};
		const metadata = {
			category: 'items',
			mutation: true,
			destructive: true,
			undoable: false,
			requires: ['item-list'],
			contexts: ['admin'],
			examples: [{ title: 'Select item', input: { id: '1' } }],
			outputSchema: { type: 'string' },
		};
		const client = new McpClient({
			transport: 'direct',
			registry: {
				...registry(async () => ({ success: true })),
				listCommands: () => [
					{ name: 'item-get', description: 'Get an item', inputSchema, ...metadata },
				],
			},
		});
		await client.connect();
		expect(client.getTools()).toEqual([
			{
				name: 'item-get',
				description: 'Get an item',
				inputSchema,
				_meta: metadata,
			},
		]);
		await client.disconnect();
	});
});
