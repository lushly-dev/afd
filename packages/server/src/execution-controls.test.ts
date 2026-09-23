import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpClient } from '@lushly-dev/afd-client';
import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { failure, success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createExecutionEngine } from './execution.js';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

const workInput = z.object({ index: z.number() });

function engineFor(
	handler: (input: z.infer<typeof workInput>, context: CommandContext) => Promise<CommandResult>
) {
	const command = defineCommand({
		name: 'work-run',
		description: 'Run controlled test work',
		input: workInput,
		handler,
	});
	return createExecutionEngine({
		commandMap: new Map([[command.name, command]]),
		middleware: [],
		devMode: true,
	});
}

describe('batch execution controls', () => {
	it('preserves completed batch semantics through the real HTTP client and handler', async () => {
		const failing = defineCommand({
			name: 'work-fail',
			description: 'Return a controlled failure',
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => failure({ code: 'EXPECTED', message: 'controlled failure' }),
		});
		const handler = createMcpHandler({
			name: 'execution-controls',
			version: '1.0.0',
			host: '127.0.0.1',
			port: 0,
			commands: [failing],
		});
		const server = createServer(handler);
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const port = (server.address() as AddressInfo).port;
		const client = new McpClient({
			url: `http://127.0.0.1:${port}/message`,
			transport: 'http',
			autoReconnect: false,
		});

		try {
			await client.connect();
			const result = await client.batch([{ command: 'work-fail', input: {} }]);
			expect(result.success).toBe(true);
			expect(result.summary.failureCount).toBe(1);
		} finally {
			client.disconnect();
			handler.dispose();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it('bounds overlap and retains request order and IDs', async () => {
		let active = 0;
		let peak = 0;
		const engine = engineFor(async ({ index }) => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, index === 0 ? 20 : 5));
			active--;
			return success({ index });
		});

		const result = await engine.executeBatch({
			commands: [0, 1, 2, 3].map((index) => ({
				id: `request-${index}`,
				command: 'work-run',
				input: { index },
			})),
			options: { parallelism: 2 },
		});

		expect(peak).toBe(2);
		expect(result.results.map(({ id }) => id)).toEqual([
			'request-0',
			'request-1',
			'request-2',
			'request-3',
		]);
		expect(result.results.map(({ result: commandResult }) => commandResult.data)).toEqual([
			{ index: 0 },
			{ index: 1 },
			{ index: 2 },
			{ index: 3 },
		]);
	});

	it('stops scheduling after failure and counts skipped commands separately', async () => {
		const started: number[] = [];
		const engine = engineFor(async ({ index }) => {
			started.push(index);
			return index === 0 ? failure({ code: 'EXPECTED', message: 'stop' }) : success({ index });
		});
		const result = await engine.executeBatch({
			commands: [0, 1, 2].map((index) => ({ command: 'work-run', input: { index } })),
			options: { stopOnError: true },
		});

		expect(started).toEqual([0]);
		expect(result.success).toBe(true);
		expect(result.summary).toEqual({
			total: 3,
			successCount: 0,
			failureCount: 1,
			skippedCount: 2,
		});
	});

	it('enforces the remaining deadline while a command is awaited', async () => {
		const engine = engineFor(async (_input, context) => {
			await new Promise<void>((resolve) => {
				context.signal?.addEventListener('abort', () => resolve(), { once: true });
			});
			return success({ late: true });
		});
		const result = await engine.executeBatch({
			commands: [{ command: 'work-run', input: { index: 0 } }],
			options: { timeout: 10 },
		});

		expect(result.results[0]?.result.error?.code).toBe('BATCH_TIMEOUT');
		expect(result.timing.totalMs).toBeLessThan(100);
	});
});
