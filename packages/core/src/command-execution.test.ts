import { describe, expect, it } from 'vitest';
import type { BatchRequest } from './batch.js';
import { executeBatch, executeStream, executionFailure } from './command-execution.js';
import { type CommandContext, type CommandDefinition, createCommandRegistry } from './commands.js';
import type { CommandExecutor } from './pipeline-executor.js';
import { failure, success } from './result.js';
import type { StreamChunk } from './streaming.js';

async function collect<T>(stream: AsyncGenerator<StreamChunk<T>, void, unknown>) {
	const chunks: StreamChunk<T>[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks;
}

/** A command that waits `ms` or until its signal aborts, recording what it saw. */
function slowCommand(name: string, ms: number, seen: { started: number; aborted: number }) {
	const command: CommandDefinition = {
		name,
		description: 'slow',
		parameters: [],
		handler: async (_input, context) => {
			seen.started++;
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, ms);
				context?.signal?.addEventListener('abort', () => {
					seen.aborted++;
					clearTimeout(timer);
					resolve();
				});
			});
			return success('done');
		},
	};
	return command;
}

const internalOnly: CommandDefinition = {
	name: 'secret-rotate',
	description: 'Internal only',
	parameters: [],
	expose: { palette: false, agent: false, mcp: false, cli: false },
	handler: async () => success({ rotated: true }),
};

const remote: CommandDefinition = {
	name: 'item-list',
	description: 'Exposed to MCP',
	parameters: [],
	expose: { mcp: true },
	handler: async () => success([1, 2]),
};

describe('executionFailure', () => {
	it('hides the message and stack outside devMode', () => {
		expect(executionFailure(new Error('/srv/app/db.ts exploded'))).toEqual(
			failure({
				code: 'COMMAND_EXECUTION_ERROR',
				message: 'An internal error occurred',
				suggestion: 'Contact support if this persists',
			})
		);
	});

	it('includes the message and stack in devMode', () => {
		const result = executionFailure(new Error('exploded'), true);
		expect(result.error?.message).toBe('exploded');
		expect(result.error?.details?.stack).toContain('exploded');
		expect(executionFailure(42, true).error?.message).toBe('42');
	});
});

describe('executeBatch (shared executor)', () => {
	const ok: CommandExecutor = async (command, input) => success({ command, input });

	it('rejects malformed envelopes before running anything', async () => {
		let calls = 0;
		const counting: CommandExecutor = async () => {
			calls++;
			return success(null);
		};
		const malformed: unknown[] = [
			null,
			{},
			{ commands: [] },
			{ commands: [{ command: 'a-b', input: {} }, null] },
			{ commands: [{ command: '', input: {} }] },
			{ commands: [{ command: 'a-b', id: 7 }] },
			{ commands: [{ command: 'a-b' }], options: { parallelism: 0 } },
			{ commands: [{ command: 'a-b' }], options: { parallelism: 1.5 } },
			{ commands: [{ command: 'a-b' }], options: { timeout: -1 } },
			{ commands: [{ command: 'a-b' }], options: { stopOnError: 'yes' } },
		];

		for (const request of malformed) {
			const result = await executeBatch(request as BatchRequest, counting);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('INVALID_BATCH_REQUEST');
			expect(result.error?.suggestion).toBeDefined();
			expect(result.summary.total).toBe(0);
		}
		expect(calls).toBe(0);
	});

	it('passes the caller context, a per-command traceId and a signal to every entry', async () => {
		const contexts: Array<Record<string, unknown>> = [];
		const recording: CommandExecutor = async (_command, _input, context) => {
			contexts.push(context);
			return success(null);
		};

		const result = await executeBatch(
			{ commands: [{ command: 'a-b' }, { command: 'c-d', input: 1 }] } as BatchRequest,
			recording,
			{ interface: 'mcp', traceId: 'trace-1', userId: 'u1' }
		);

		expect(result.metadata?.traceId).toBe('trace-1');
		expect(contexts.map((c) => [c.interface, c.traceId, c.userId])).toEqual([
			['mcp', 'trace-1-0', 'u1'],
			['mcp', 'trace-1-1', 'u1'],
		]);
		expect(contexts.every((c) => c.signal instanceof AbortSignal)).toBe(true);
	});

	it('forwards the caller signal to each entry', async () => {
		const caller = new AbortController();
		let entrySignal: unknown;
		await executeBatch(
			{ commands: [{ command: 'a-b', input: {} }] },
			async (_c, _i, context) => {
				entrySignal = context.signal;
				caller.abort();
				return success(null);
			},
			{ signal: caller.signal }
		);

		expect(entrySignal).toBeInstanceOf(AbortSignal);
		expect((entrySignal as AbortSignal).aborted).toBe(true);
	});

	it('returns results in request order at any parallelism', async () => {
		const delayed: CommandExecutor = async (command, input) => {
			await new Promise((resolve) => setTimeout(resolve, Number(input)));
			return success(command);
		};
		const result = await executeBatch(
			{
				commands: [
					{ command: 'first-cmd', input: 30 },
					{ command: 'second-cmd', input: 1 },
					{ command: 'third-cmd', input: 10 },
				],
				options: { parallelism: 3 },
			},
			delayed
		);

		expect(result.results.map((r) => [r.index, r.id, r.result.data])).toEqual([
			[0, 'cmd-0', 'first-cmd'],
			[1, 'cmd-1', 'second-cmd'],
			[2, 'cmd-2', 'third-cmd'],
		]);
		expect(result.summary).toEqual({ total: 3, successCount: 3, failureCount: 0, skippedCount: 0 });
	});

	it('turns a throwing or rejecting callback into a redacted per-entry failure', async () => {
		const throwing: CommandExecutor = (command) => {
			if (command === 'sync-throw') throw new Error('sync /srv/app');
			return Promise.reject(new Error('async /srv/app'));
		};
		const request: BatchRequest = {
			commands: [
				{ command: 'sync-throw', input: {} },
				{ command: 'async-reject', input: {} },
			],
		};

		const hidden = await executeBatch(request, throwing);
		expect(hidden.success).toBe(true);
		expect(hidden.results.map((r) => r.result.error?.message)).toEqual([
			'An internal error occurred',
			'An internal error occurred',
		]);
		expect(JSON.stringify(hidden)).not.toContain('/srv/app');

		const shown = await executeBatch(request, throwing, {}, { devMode: true });
		expect(shown.results.map((r) => r.result.error?.message)).toEqual([
			'sync /srv/app',
			'async /srv/app',
		]);
	});

	it('reports unstarted entries as BATCH_TIMEOUT once the deadline has passed', async () => {
		const result = await executeBatch(
			{
				commands: [{ command: 'a-b' }, { command: 'c-d' }],
				options: { timeout: 0 },
			} as BatchRequest,
			ok
		);

		expect(result.results.map((r) => r.result.error?.code)).toEqual([
			'BATCH_TIMEOUT',
			'BATCH_TIMEOUT',
		]);
		expect(result.results[0]?.result.error?.suggestion).toBeDefined();
	});

	it('reports entries after a failure as COMMAND_SKIPPED with stopOnError', async () => {
		const failing: CommandExecutor = async (command) =>
			command === 'bad-cmd' ? failure({ code: 'BAD', message: 'bad' }) : success(null);
		const result = await executeBatch(
			{
				commands: [
					{ command: 'good-cmd', input: {} },
					{ command: 'bad-cmd', input: {} },
					{ command: 'good-cmd', input: {} },
				],
				options: { stopOnError: true },
			},
			failing
		);

		expect(result.results.map((r) => r.result.error?.code)).toEqual([
			undefined,
			'BAD',
			'COMMAND_SKIPPED',
		]);
		expect(result.results[2]?.result.error?.suggestion).toBe(
			'Disable stopOnError to execute every command'
		);
		expect(result.summary.skippedCount).toBe(1);
	});
});

describe('executeStream (shared executor)', () => {
	it('emits an error chunk without running when the signal is already aborted', async () => {
		let calls = 0;
		const controller = new AbortController();
		controller.abort();
		const chunks = await collect(
			executeStream(
				'item-list',
				{},
				async () => {
					calls++;
					return success([]);
				},
				{ signal: controller.signal }
			)
		);

		expect(calls).toBe(0);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toMatchObject({ type: 'error', error: { code: 'STREAM_ABORTED' } });
	});

	it('reports an abort that happens during execution', async () => {
		const controller = new AbortController();
		const chunks = await collect(
			executeStream(
				'item-list',
				{},
				async () => {
					controller.abort();
					return success([1, 2]);
				},
				{ signal: controller.signal }
			)
		);

		expect(chunks).toEqual([
			expect.objectContaining({
				type: 'error',
				error: expect.objectContaining({
					code: 'STREAM_ABORTED',
					message: 'Stream was aborted during execution',
				}),
			}),
		]);
	});

	it('stops between data chunks when aborted and reports where to resume', async () => {
		const controller = new AbortController();
		const stream = executeStream<number>('item-list', {}, async () => success([1, 2, 3]), {
			signal: controller.signal,
		});

		const first = await stream.next();
		expect(first.value).toMatchObject({ type: 'data', data: 1, index: 0, isLast: false });
		controller.abort();
		const rest = [];
		for await (const chunk of stream) rest.push(chunk);

		expect(rest).toEqual([
			expect.objectContaining({
				type: 'error',
				chunksBeforeError: 1,
				resumeFrom: 1,
				error: expect.objectContaining({ code: 'STREAM_ABORTED' }),
			}),
		]);
	});

	it('redacts a throwing callback outside devMode', async () => {
		const throwing: CommandExecutor = async () => {
			throw new Error('/srv/app/secret');
		};

		const hidden = await collect(executeStream('item-list', {}, throwing));
		expect(hidden).toEqual([
			expect.objectContaining({
				type: 'error',
				error: expect.objectContaining({
					code: 'STREAM_ERROR',
					message: 'Stream execution failed',
				}),
			}),
		]);

		const shown = await collect(executeStream('item-list', {}, throwing, {}, { devMode: true }));
		expect(shown[0]).toMatchObject({ error: { message: '/srv/app/secret' } });
	});

	it('uses a fallback error when a failed result has no error', async () => {
		const chunks = await collect(executeStream('item-list', {}, async () => ({ success: false })));
		expect(chunks[0]).toMatchObject({
			type: 'error',
			recoverable: false,
			error: { code: 'COMMAND_FAILED' },
		});
	});

	it('emits one data chunk for a non-array result and forwards UX fields', async () => {
		const chunks = await collect(
			executeStream('item-get', {}, async () =>
				success({ id: 1 }, { confidence: 0.9, reasoning: 'found' })
			)
		);
		expect(chunks[0]).toEqual({ type: 'data', data: { id: 1 }, index: 0, isLast: true });
		expect(chunks[1]).toMatchObject({
			type: 'complete',
			totalChunks: 1,
			confidence: 0.9,
			reasoning: 'found',
		});
	});
});

describe('createCommandRegistry uses the shared executor semantics', () => {
	it('enforces the batch timeout with parallelism > 1 and aborts in-flight commands', async () => {
		const seen = { started: 0, aborted: 0 };
		const registry = createCommandRegistry();
		registry.register(slowCommand('slow-run', 400, seen));

		const started = performance.now();
		const result = await registry.executeBatch({
			commands: Array.from({ length: 6 }, () => ({ command: 'slow-run', input: {} })),
			options: { timeout: 50, parallelism: 2 },
		});
		const elapsed = performance.now() - started;

		expect(elapsed).toBeLessThan(300);
		expect(seen.started).toBe(2);
		expect(seen.aborted).toBe(2);
		expect(result.results).toHaveLength(6);
		expect(result.results.every((r) => r.result.error?.code === 'BATCH_TIMEOUT')).toBe(true);
	});

	it('enforces the same deadline in the sequential path', async () => {
		const seen = { started: 0, aborted: 0 };
		const registry = createCommandRegistry();
		registry.register(slowCommand('slow-run', 400, seen));

		const started = performance.now();
		const result = await registry.executeBatch({
			commands: Array.from({ length: 3 }, () => ({ command: 'slow-run', input: {} })),
			options: { timeout: 50 },
		});

		expect(performance.now() - started).toBeLessThan(300);
		expect(seen).toEqual({ started: 1, aborted: 1 });
		expect(result.results.map((r) => r.result.error?.code)).toEqual([
			'BATCH_TIMEOUT',
			'BATCH_TIMEOUT',
			'BATCH_TIMEOUT',
		]);
	});

	it('applies the exposure check to every batch entry', async () => {
		const registry = createCommandRegistry();
		let ran = false;
		registry.register({
			...internalOnly,
			handler: async () => {
				ran = true;
				return success({ rotated: true });
			},
		});
		registry.register(remote);
		const request: BatchRequest = {
			commands: [
				{ command: 'secret-rotate', input: {} },
				{ command: 'item-list', input: {} },
			],
		};

		const single = await registry.execute('secret-rotate', {}, { interface: 'mcp' });
		const batch = await registry.executeBatch(request, { interface: 'mcp' });

		expect(single.error?.code).toBe('COMMAND_NOT_EXPOSED');
		expect(batch.results[0]?.result.error).toEqual(single.error);
		expect(batch.results[1]?.result.success).toBe(true);
		expect(ran).toBe(false);

		// In-process calls without an interface are not exposure-checked.
		const local = await registry.executeBatch(request);
		expect(local.summary.successCount).toBe(2);
		expect(ran).toBe(true);
	});

	it('applies the exposure check to streams', async () => {
		const registry = createCommandRegistry();
		registry.register(internalOnly);
		registry.register(remote);

		const blocked = await collect(
			registry.executeStream('secret-rotate', {}, undefined, { interface: 'mcp' })
		);
		const allowed = await collect(
			registry.executeStream('item-list', {}, undefined, { interface: 'mcp' })
		);

		expect(blocked).toEqual([
			expect.objectContaining({
				type: 'error',
				error: expect.objectContaining({ code: 'COMMAND_NOT_EXPOSED' }),
			}),
		]);
		expect(allowed.map((chunk) => chunk.type)).toEqual(['data', 'data', 'complete']);
	});

	it('rejects a batch with a null entry instead of silently skipping it', async () => {
		const registry = createCommandRegistry();
		let calls = 0;
		registry.register({
			...remote,
			handler: async () => {
				calls++;
				return success([]);
			},
		});

		const result = await registry.executeBatch({
			commands: [{ command: 'item-list', input: {} }, null],
		} as unknown as BatchRequest);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('INVALID_BATCH_REQUEST');
		expect(calls).toBe(0);
	});

	it('passes options.signal and context to the stream command', async () => {
		const registry = createCommandRegistry();
		let received: CommandContext | undefined;
		registry.register({
			...remote,
			handler: async (_input, context) => {
				received = context;
				return success([]);
			},
		});
		const controller = new AbortController();

		await collect(
			registry.executeStream(
				'item-list',
				{},
				{ signal: controller.signal },
				{ interface: 'mcp', traceId: 't-1' }
			)
		);

		expect(received?.signal).toBe(controller.signal);
		expect(received?.interface).toBe('mcp');
		expect(received?.traceId).toBe('t-1');
	});

	it('redacts batch and stream handler exceptions unless devMode is set', async () => {
		const throwing: CommandDefinition = {
			name: 'boom-run',
			description: 'throws',
			parameters: [],
			handler: async () => {
				throw new Error('/srv/app/boom');
			},
		};
		const registry = createCommandRegistry();
		registry.register(throwing);
		const devRegistry = createCommandRegistry({ devMode: true });
		devRegistry.register(throwing);
		const request: BatchRequest = { commands: [{ command: 'boom-run', input: {} }] };

		const batch = await registry.executeBatch(request);
		const stream = await collect(registry.executeStream('boom-run', {}));
		expect(JSON.stringify(batch)).not.toContain('/srv/app');
		expect(JSON.stringify(stream)).not.toContain('/srv/app');

		const devBatch = await devRegistry.executeBatch(request);
		expect(devBatch.results[0]?.result.error?.message).toBe('/srv/app/boom');
	});
});
