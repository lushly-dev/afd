/**
 * @fileoverview End-to-end integration tests of `McpClient` MCP Tasks against `createMcpHandler`.
 */

import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpClient, type TaskInfo } from '@lushly-dev/afd-client';
import { ErrorCodes, failure, success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	while (cleanups.length > 0) {
		await cleanups.pop()?.();
	}
});

interface Deferred {
	promise: Promise<void>;
	resolve(): void;
}

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

async function startTaskServer(
	opts: { waitStarted?: Deferred; waitRelease?: Deferred; onAborted?: () => void } = {}
): Promise<{ url: string; server: HttpServer }> {
	const jobOptional = defineCommand({
		name: 'job-optional',
		description: 'Optional task command',
		expose: { mcp: true },
		task: 'optional',
		input: z.object({ label: z.string() }),
		async handler(input, context) {
			context.reportProgress?.(`working:${input.label}`);
			return success({
				label: input.label,
				viaTask: typeof context.reportProgress === 'function',
			});
		},
	});

	const jobRequired = defineCommand({
		name: 'job-required',
		description: 'Required task command',
		expose: { mcp: true },
		task: 'required',
		input: z.object({ value: z.number() }),
		async handler(input) {
			return success({ doubled: input.value * 2 });
		},
	});

	const jobFail = defineCommand({
		name: 'job-fail',
		description: 'Failing task command',
		expose: { mcp: true },
		task: 'required',
		input: z.object({}),
		async handler() {
			return failure({
				code: ErrorCodes.NOT_FOUND,
				message: 'Missing item',
				suggestion: 'Check id',
			});
		},
	});

	const jobWait = defineCommand({
		name: 'job-wait',
		description: 'Long running wait task',
		expose: { mcp: true },
		task: 'required',
		input: z.object({}),
		async handler(_input, context) {
			context.reportProgress?.('step-1');
			opts.waitStarted?.resolve();
			await new Promise<void>((resolve) => {
				const onAbort = () => {
					opts.onAborted?.();
					resolve();
				};
				if (context.signal?.aborted) {
					onAbort();
					return;
				}
				context.signal?.addEventListener('abort', onAbort, { once: true });
				void opts.waitRelease?.promise.then(() => {
					context.signal?.removeEventListener('abort', onAbort);
					resolve();
				});
			});
			return success({ done: true });
		},
	});

	const jobPlain = defineCommand({
		name: 'job-plain',
		description: 'Non-task command',
		expose: { mcp: true },
		input: z.object({}),
		async handler() {
			return success({ plain: true });
		},
	});

	const handler = createMcpHandler({
		name: 'client-tasks-test',
		version: '1.0.0',
		commands: [jobOptional, jobRequired, jobFail, jobWait, jobPlain],
		toolStrategy: 'individual',
		createContext: () => ({ actor: { kind: 'human', id: 'alice' } }),
		taskOptions: {
			ttlMs: 60_000,
			pollIntervalMs: 15,
			checkIntervalMs: 5,
			callersIdentifiedByHook: true,
		},
	});

	const server = createServer((req, res) => {
		void handler(req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const { port } = server.address() as AddressInfo;
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return { url: `http://127.0.0.1:${port}/mcp`, server };
}

describe('McpClient MCP Tasks integration', () => {
	it('runs optional and required commands as tasks, reports progress and unwraps CommandResult', async () => {
		const { url } = await startTaskServer();
		const client = new McpClient({ url, protocolMode: 'modern', tasks: true });
		await client.connect();
		cleanups.push(() => client.disconnect());

		const progress: TaskInfo[] = [];
		const opt = await client.call<{ label: string; viaTask: boolean }>(
			'job-optional',
			{ label: 'alpha' },
			{ onTaskProgress: (task) => progress.push(task) }
		);
		expect(opt.success).toBe(true);
		expect(opt.data).toEqual({ label: 'alpha', viaTask: true });
		expect(progress.length).toBeGreaterThanOrEqual(2);
		expect(progress[0]?.status).toBe('working');
		expect(progress.at(-1)?.status).toBe('completed');

		const req = await client.call<{ doubled: number }>('job-required', { value: 21 });
		expect(req.success).toBe(true);
		expect(req.data).toEqual({ doubled: 42 });

		const failed = await client.call('job-fail', {});
		expect(failed.success).toBe(false);
		expect(failed.error?.code).toBe(ErrorCodes.NOT_FOUND);

		const plain = await client.call<{ plain: boolean }>('job-plain', {});
		expect(plain.success).toBe(true);
		expect(plain.data).toEqual({ plain: true });
	});

	it('cancels a running task on AbortSignal and on timeout, and supports direct getTask/cancelTask', async () => {
		const waitStarted = deferred();
		const waitRelease = deferred();
		let abortedCount = 0;
		const { url } = await startTaskServer({
			waitStarted,
			waitRelease,
			onAborted: () => {
				abortedCount += 1;
			},
		});
		const client = new McpClient({ url, protocolMode: 'modern', tasks: true });
		await client.connect();
		cleanups.push(() => client.disconnect());

		const ac = new AbortController();
		const progressMessages: string[] = [];
		const sawStep1 = deferred();
		const pending = client.call(
			'job-wait',
			{},
			{
				signal: ac.signal,
				onTaskProgress: (t) => {
					if (t.statusMessage) {
						progressMessages.push(t.statusMessage);
						if (t.statusMessage === 'step-1') sawStep1.resolve();
					}
				},
			}
		);
		await waitStarted.promise;
		await sawStep1.promise;
		ac.abort();

		const cancelled = await pending;
		expect(cancelled.success).toBe(false);
		expect(cancelled.error?.code).toBe('COMMAND_CANCELLED');
		expect(progressMessages).toContain('step-1');

		await vi.waitFor(() => expect(abortedCount).toBe(1), { timeout: 2000 });

		const timedOut = await client.call('job-wait', {}, { timeout: 50 });
		expect(timedOut.success).toBe(false);
		expect(timedOut.error?.code).toBe(ErrorCodes.TIMEOUT);

		await expect(client.getTask('a'.repeat(26))).rejects.toMatchObject({
			code: -32602,
			message: 'Task not found',
		});
	});

	it('runs optional inline and returns MISSING_CLIENT_CAPABILITY for required when tasks is false', async () => {
		const { url } = await startTaskServer();
		const client = new McpClient({ url, protocolMode: 'modern', tasks: false });
		await client.connect();
		cleanups.push(() => client.disconnect());

		const opt = await client.call<{ label: string; viaTask: boolean }>('job-optional', {
			label: 'inline',
		});
		expect(opt.success).toBe(true);
		expect(opt.data).toEqual({ label: 'inline', viaTask: false });

		const req = await client.call('job-required', { value: 5 });
		expect(req.success).toBe(false);
		expect(req.error?.code).toBe('MISSING_CLIENT_CAPABILITY');
		expect(req.error?.retryable).toBe(false);
	});
});
