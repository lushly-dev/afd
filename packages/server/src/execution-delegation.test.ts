/**
 * The server engine delegates batch and stream execution to the core executors
 * (Theme 2: one executor), with its own `executeCommand` as the callback. These
 * tests pin the delegation and the core behaviors the server now shares.
 */

import type { CommandContext, CommandResult, StreamChunk } from '@lushly-dev/afd-core';
import * as core from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createExecutionEngine } from './execution.js';
import { defineCommand } from './schema.js';

vi.mock('@lushly-dev/afd-core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@lushly-dev/afd-core')>();
	return {
		...actual,
		executeBatch: vi.fn(actual.executeBatch),
		executeStream: vi.fn(actual.executeStream),
	};
});

afterEach(() => {
	vi.clearAllMocks();
});

function engineFor(
	handler: (input: { value?: string }, context: CommandContext) => Promise<CommandResult>,
	devMode = false
) {
	const command = defineCommand({
		name: 'item-run',
		description: 'Run a test item',
		input: z.object({ value: z.string().optional() }),
		handler,
	});
	return createExecutionEngine({
		commandMap: new Map([[command.name, command]]),
		middleware: [],
		devMode,
	});
}

async function collect(stream: AsyncGenerator<StreamChunk, void, unknown>): Promise<StreamChunk[]> {
	const chunks: StreamChunk[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	return chunks;
}

describe('batch delegation', () => {
	it('runs batches through the core executeBatch with executeCommand as the callback', async () => {
		const engine = engineFor(async ({ value }) => success({ value }));
		const context = { traceId: 'trace-1', interface: 'mcp' as const };

		const result = await engine.executeBatch(
			{ commands: [{ command: 'item-run', input: { value: 'a' } }] },
			context
		);

		expect(core.executeBatch).toHaveBeenCalledTimes(1);
		const [, execute, passedContext, options] = vi.mocked(core.executeBatch).mock.calls[0] ?? [];
		expect(execute).toBe(engine.executeCommand);
		expect(passedContext).toBe(context);
		expect(options).toEqual({ devMode: false });
		expect(result.results[0]?.result).toMatchObject({ success: true, data: { value: 'a' } });
		expect(result.results[0]?.result.metadata?.traceId).toBe('trace-1-0');
	});

	it('reports an invalid envelope with the core wording', async () => {
		const engine = engineFor(async () => success(null));
		const direct = await core.executeBatch({ commands: [] }, async () => success(null));
		const viaEngine = await engine.executeBatch({ commands: [] });

		expect(viaEngine.success).toBe(false);
		expect(viaEngine.error).toEqual(direct.error);
		expect(viaEngine.error?.suggestion).toContain('nonnegative timeout');
	});

	it('keeps unknown commands and validation failures as per-entry results', async () => {
		const engine = engineFor(async () => success(null));
		const result = await engine.executeBatch({
			commands: [
				{ command: 'item-missing', input: {} },
				{ command: 'item-run', input: { value: 42 } },
			],
		});

		expect(result.results.map((entry) => entry.result.error?.code)).toEqual([
			'COMMAND_NOT_FOUND',
			'VALIDATION_ERROR',
		]);
	});
});

describe('stream delegation', () => {
	it('runs streams through the core executeStream with executeCommand as the callback', async () => {
		const engine = engineFor(async () => success(['a', 'b']), true);

		const chunks = await collect(engine.executeStream('item-run', {}, { traceId: 'trace-2' }));

		expect(core.executeStream).toHaveBeenCalledTimes(1);
		const [name, input, execute, context, options] =
			vi.mocked(core.executeStream).mock.calls[0] ?? [];
		expect([name, input]).toEqual(['item-run', {}]);
		expect(execute).toBe(engine.executeCommand);
		expect(context).toEqual({ traceId: 'trace-2' });
		expect(options).toEqual({ devMode: true });
		expect(chunks.map((chunk) => chunk.type)).toEqual(['data', 'data', 'complete']);
	});

	it('does not run the command when the signal is already aborted', async () => {
		const handler = vi.fn(async () => success(['a']));
		const engine = engineFor(handler);
		const controller = new AbortController();
		controller.abort();

		const chunks = await collect(
			engine.executeStream('item-run', {}, { signal: controller.signal })
		);

		expect(handler).not.toHaveBeenCalled();
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toMatchObject({ type: 'error', error: { code: 'STREAM_ABORTED' } });
	});

	it('ends with STREAM_ABORTED when the signal aborts while the command runs', async () => {
		const controller = new AbortController();
		const engine = engineFor(async () => {
			controller.abort();
			return success(['a', 'b']);
		});

		const chunks = await collect(
			engine.executeStream('item-run', {}, { signal: controller.signal })
		);

		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toMatchObject({ type: 'error', error: { code: 'STREAM_ABORTED' } });
	});

	it('gives a failure without an error a COMMAND_FAILED chunk with a suggestion', async () => {
		const engine = engineFor(async () => ({ success: false }));

		const [chunk] = await collect(engine.executeStream('item-run', {}));

		expect(chunk).toMatchObject({
			type: 'error',
			error: { code: 'COMMAND_FAILED', suggestion: expect.any(String) },
		});
	});

	it('streams command failures as error chunks', async () => {
		const engine = engineFor(async () =>
			failure({ code: 'ITEM_LOCKED', message: 'Locked', retryable: true })
		);

		const [chunk] = await collect(engine.executeStream('item-run', {}));

		expect(chunk).toMatchObject({
			type: 'error',
			error: { code: 'ITEM_LOCKED' },
			recoverable: true,
		});
	});
});

describe('thrown handler errors use the core executionFailure', () => {
	it('hides the message and stack outside devMode', async () => {
		const engine = engineFor(async () => {
			throw new Error('secret path /srv/app');
		});

		const result = await engine.executeCommand('item-run', {});

		expect(result).toEqual(core.executionFailure(new Error('secret path /srv/app'), false));
		expect(JSON.stringify(result)).not.toContain('/srv/app');
	});

	it('includes the message and stack in devMode', async () => {
		const thrown = new Error('boom');
		const engine = engineFor(async () => {
			throw thrown;
		}, true);

		const result = await engine.executeCommand('item-run', {});

		expect(result.error).toMatchObject({
			code: 'COMMAND_EXECUTION_ERROR',
			message: 'boom',
			details: { stack: thrown.stack },
		});
	});

	it('carries no synthetic stack for a thrown non-Error in devMode', async () => {
		const engine = engineFor(async () => {
			throw 'plain string';
		}, true);

		const result = await engine.executeCommand('item-run', {});

		expect(result.error).toEqual({
			code: 'COMMAND_EXECUTION_ERROR',
			message: 'plain string',
			suggestion: 'Check the command implementation',
		});
	});
});
