import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { withCommandDeadlines } from './command-timeout.js';
import { createDirectRegistry } from './direct-registry.js';
import { createExecutionEngine } from './execution.js';
import { defineCommand } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function setup(
	handler: (context: CommandContext) => Promise<CommandResult>,
	middleware: CommandMiddleware[] = []
) {
	const command = defineCommand({
		name: 'work-run',
		description: 'Run controlled work',
		expose: { mcp: true },
		input: z.object({}),
		handler: (_input, context) => handler(context),
	});
	const onCommand = vi.fn();
	const engine = createExecutionEngine({
		commandMap: new Map([[command.name, command]]),
		middleware: withCommandDeadlines(middleware),
		devMode: false,
		onCommand,
	});
	return { command, engine, onCommand };
}

afterEach(() => vi.useRealTimers());

describe('per-command deadlines', () => {
	it('aborts the command signal and returns TIMEOUT even when the handler ignores it', async () => {
		vi.useFakeTimers();
		const late = deferred<CommandResult>();
		let signal: AbortSignal | undefined;
		const { engine, onCommand } = setup(async (context) => {
			signal = context.signal;
			return late.promise;
		});
		const caller = new AbortController();
		const running = engine.executeCommand('work-run', {}, { timeout: 10, signal: caller.signal });
		await vi.advanceTimersByTimeAsync(9);
		expect(signal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(signal?.aborted).toBe(true);
		expect(caller.signal.aborted).toBe(false);
		expect(await running).toMatchObject({
			success: false,
			error: {
				code: 'TIMEOUT',
				suggestion: expect.stringContaining('check its effect'),
				retryable: true,
				details: { command: 'work-run', timeoutMs: 10 },
			},
		});
		// Late rejections are consumed and cannot notify the observer a second time.
		late.reject(new Error('late failure'));
		await vi.advanceTimersByTimeAsync(0);
		expect(onCommand).toHaveBeenCalledTimes(1);
		expect(onCommand.mock.calls[0]?.[2].error.code).toBe('TIMEOUT');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('returns TIMEOUT when the abort listener immediately completes the handler', async () => {
		vi.useFakeTimers();
		const { engine } = setup(async ({ signal }) => {
			await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
			return success('late');
		});
		const running = engine.executeCommand('work-run', {}, { timeout: 10 });
		await vi.advanceTimersByTimeAsync(10);
		expect((await running).error?.code).toBe('TIMEOUT');
	});

	it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		'ignores a nonpositive or nonfinite timeout (%s), as DirectClient does',
		async (timeout) => {
			vi.useFakeTimers();
			const caller = new AbortController();
			const { engine } = setup(async (context) => {
				expect(context.signal).toBe(caller.signal);
				return success('done');
			});
			expect(
				(await engine.executeCommand('work-run', {}, { timeout, signal: caller.signal })).success
			).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		}
	);

	it('clears completed deadlines and preserves caller cancellation', async () => {
		vi.useFakeTimers();
		const caller = new AbortController();
		let signal: AbortSignal | undefined;
		const { engine } = setup(async (context) => {
			signal = context.signal;
			return success('done');
		});
		expect(
			(await engine.executeCommand('work-run', {}, { timeout: 10, signal: caller.signal })).success
		).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(10);
		expect(signal?.aborted).toBe(false);
		caller.abort('caller cancelled');
		expect(signal?.reason).toBe('caller cancelled');
	});

	it.each(['timeout', 'cancel'] as const)(
		'never starts a handler after delayed middleware resumes following %s',
		async (mode) => {
			vi.useFakeTimers();
			const entered = deferred<void>();
			const gate = deferred<void>();
			const settled = deferred<void>();
			const handler = vi.fn(async () => success('must not run'));
			const { engine } = setup(handler, [
				async (_name, _input, _context, next) => {
					entered.resolve();
					await gate.promise;
					try {
						return await next();
					} finally {
						settled.resolve();
					}
				},
			]);
			const caller = new AbortController();
			const running = engine.executeCommand(
				'work-run',
				{},
				{
					timeout: mode === 'timeout' ? 10 : undefined,
					signal: caller.signal,
				}
			);
			await entered.promise;
			if (mode === 'timeout') {
				await vi.advanceTimersByTimeAsync(10);
				expect((await running).error?.code).toBe('TIMEOUT');
			} else caller.abort();
			gate.resolve();
			await settled.promise;
			if (mode === 'cancel') expect((await running).error?.code).toBe('COMMAND_CANCELLED');
			expect(handler).not.toHaveBeenCalled();
		}
	);

	it('never starts a pre-cancelled command or its middleware', async () => {
		const middlewareCalled = vi.fn();
		const handler = vi.fn(async () => success('must not run'));
		const { engine } = setup(handler, [
			async (_name, _input, _context, next) => {
				middlewareCalled();
				return next();
			},
		]);
		const caller = new AbortController();
		caller.abort();
		const result = await engine.executeCommand(
			'work-run',
			{},
			{ timeout: 10, signal: caller.signal }
		);
		expect(result.error).toMatchObject({
			code: 'COMMAND_CANCELLED',
			retryable: false,
			suggestion: expect.any(String),
		});
		expect(middlewareCalled).not.toHaveBeenCalled();
		expect(handler).not.toHaveBeenCalled();
	});

	it('enforces the server defaultTimeoutMs (30_000ms) and allows disabling with 0 or null', async () => {
		vi.useFakeTimers();
		const late = deferred<CommandResult>();
		const { command } = setup(async () => late.promise);

		const defaultServer = createMcpServer({
			name: 'default-deadline',
			version: '1',
			commands: [command],
		});
		const timed = defaultServer.execute('work-run', {});
		await vi.advanceTimersByTimeAsync(29_999);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(await timed).toMatchObject({
			success: false,
			error: {
				code: 'TIMEOUT',
				retryable: true,
				details: { command: 'work-run', timeoutMs: 30_000 },
			},
		});

		const disabledZero = createMcpServer({
			name: 'no-deadline-zero',
			version: '1',
			commands: [command],
			defaultTimeoutMs: 0,
		});
		const disabledNull = createMcpServer({
			name: 'no-deadline-null',
			version: '1',
			commands: [command],
			defaultTimeoutMs: null,
		});
		const p1 = disabledZero.execute('work-run', {});
		const p2 = disabledNull.execute('work-run', {});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(vi.getTimerCount()).toBe(0);
		late.resolve(success('ok'));
		expect((await p1).success).toBe(true);
		expect((await p2).success).toBe(true);
	});

	it('rejects invalid defaultTimeoutMs, maxBatchSize, maxBatchParallelism, and maxValidationIssues', () => {
		const { command } = setup(async () => success('ok'));
		expect(() =>
			createMcpServer({ name: 'bad', version: '1', commands: [command], defaultTimeoutMs: -5 })
		).toThrow(RangeError);
		expect(() =>
			createMcpServer({ name: 'bad', version: '1', commands: [command], maxBatchSize: 0 })
		).toThrow(RangeError);
		expect(() =>
			createMcpServer({ name: 'bad', version: '1', commands: [command], maxBatchParallelism: 1.5 })
		).toThrow(RangeError);
		expect(() =>
			createMcpServer({ name: 'bad', version: '1', commands: [command], maxValidationIssues: -1 })
		).toThrow(RangeError);
		expect(() => createDirectRegistry([command], { maxBatchSize: 0 })).toThrow(RangeError);
		expect(() => createDirectRegistry([command], { maxBatchParallelism: 0 })).toThrow(RangeError);
		expect(() => createDirectRegistry([command], { maxValidationIssues: 0 })).toThrow(RangeError);
	});

	it.each(['batch', 'pipeline'] as const)('gives each %s step its own deadline', async (mode) => {
		vi.useFakeTimers();
		const { engine } = setup(async () => {
			await new Promise((resolve) => setTimeout(resolve, 6));
			return success('done');
		});
		const steps = [
			{ command: 'work-run', input: {} },
			{ command: 'work-run', input: {} },
		];
		const running =
			mode === 'batch'
				? engine.executeBatch({ commands: steps }, { timeout: 10 })
				: engine.executePipeline({ steps }, { timeout: 10 });
		await vi.advanceTimersByTimeAsync(12);
		expect(await running).toMatchObject(
			mode === 'batch'
				? { summary: { successCount: 2, failureCount: 0 } }
				: { steps: [{ status: 'success' }, { status: 'success' }] }
		);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('remote command deadlines', () => {
	it('also enforces deadlines on server.execute without starting a transport', async () => {
		vi.useFakeTimers();
		const { command } = setup(async ({ signal }) => {
			await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
			return success('late');
		});
		const server = createMcpServer({ name: 'deadline-test', version: '1', commands: [command] });
		const running = server.execute('work-run', {}, { timeout: 10 });
		await vi.advanceTimersByTimeAsync(10);
		expect((await running).error?.code).toBe('TIMEOUT');
	});

	it.each(['/message', '/mcp', '/rpc'] as const)(
		'enforces createContext.timeout on %s',
		async (path) => {
			const late = deferred<CommandResult>();
			let signal: AbortSignal | undefined;
			const { command } = setup(async (context) => {
				signal = context.signal;
				return late.promise;
			});
			const handler = createMcpHandler({
				name: 'deadline-test',
				version: '1',
				host: '127.0.0.1',
				commands: [command],
				createContext: () => ({ timeout: 20 }),
			});
			const server = createServer(handler);
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
			try {
				const response = await fetch(
					`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Accept: 'application/json, text/event-stream',
							...(path === '/mcp'
								? {
										'MCP-Protocol-Version': '2026-07-28',
										'Mcp-Method': 'tools/call',
										'Mcp-Name': 'work-run',
									}
								: {}),
						},
						body: JSON.stringify(
							path !== '/rpc'
								? {
										jsonrpc: '2.0',
										id: 1,
										method: 'tools/call',
										params: {
											name: 'work-run',
											arguments: {},
											...(path === '/mcp'
												? {
														_meta: {
															'io.modelcontextprotocol/protocolVersion': '2026-07-28',
															'io.modelcontextprotocol/clientCapabilities': {},
															'io.modelcontextprotocol/clientInfo': {
																name: 'deadline-test',
																version: '1',
															},
														},
													}
												: {}),
										},
									}
								: { id: 1, method: 'work-run', params: {} }
						),
					}
				);
				expect(response.status).toBe(200);
				const text = await response.text();
				const body = JSON.parse(/^data: (.*)$/m.exec(text)?.[1] ?? text) as {
					result: CommandResult & { content: Array<{ text: string }> };
				};
				const result =
					path !== '/rpc' ? JSON.parse(body.result.content[0]?.text ?? '') : body.result;
				expect(result).toMatchObject({
					success: false,
					error: { code: 'TIMEOUT', suggestion: expect.any(String) },
				});
				expect(signal?.aborted).toBe(true);
			} finally {
				late.resolve(success('late'));
				handler.dispose();
				server.closeAllConnections();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		}
	);
});
