/**
 * @fileoverview DirectClient `allow`, per-call `timeout` and the
 * `isUnknownToolError` type guard.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { isSuccess } from '@lushly-dev/afd-core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createDirectClient, type DirectRegistry, isUnknownToolError } from './direct.js';
import { isEnforceableTimeout, runWithTimeout } from './direct-timeout.js';
import type { UnknownToolError } from './unknown-tool.js';

interface Todo {
	id: string;
	title: string;
}

type Handler = (input: unknown, context: CommandContext) => Promise<CommandResult>;

/** A registry over plain handlers that records what reached it. */
function createRegistry(handlers: Record<string, Handler>) {
	const calls: Array<{ name: string; input: unknown; context: CommandContext | undefined }> = [];
	const registry: DirectRegistry = {
		async execute<T>(name: string, input?: unknown, context?: CommandContext) {
			calls.push({ name, input, context });
			const handler = handlers[name];
			if (!handler) throw new Error(`unexpected command ${name}`);
			return (await handler(input, context ?? {})) as CommandResult<T>;
		},
		listCommandNames: () => Object.keys(handlers),
		listCommands: () =>
			Object.keys(handlers).map((name) => ({ name, description: `The ${name} command` })),
		hasCommand: (name) => name in handlers,
	};
	return { registry, calls };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const todoHandlers: Record<string, Handler> = {
	'todo-create': async (input) => ({
		success: true,
		data: { id: 'todo-1', title: (input as { title: string }).title },
	}),
	'todo-list': async () => ({ success: true, data: [] }),
	'admin-reset': async () => ({ success: true, data: { reset: true } }),
};

describe('DirectClient allow option', () => {
	const allowTodo = (name: string) => name.startsWith('todo-');

	it('refuses a disallowed command before it reaches the registry', async () => {
		const { registry, calls } = createRegistry(todoHandlers);
		const client = createDirectClient(registry, { allow: allowTodo });

		const result = await client.call('admin-reset', {});

		expect(result.success).toBe(false);
		expect(result.error).toMatchObject({
			code: 'COMMAND_NOT_ALLOWED',
			message: "Command 'admin-reset' is not allowed for this client",
			retryable: false,
		});
		expect(result.error?.suggestion).toBeTruthy();
		expect(calls).toEqual([]);
	});

	it('still runs allowed commands', async () => {
		const { registry } = createRegistry(todoHandlers);
		const client = createDirectClient(registry, { allow: allowTodo });

		const result = await client.call<Todo>('todo-create', { title: 'Allowed' });

		expect(result).toMatchObject({ success: true, data: { title: 'Allowed' } });
	});

	it('hides disallowed commands from listings and unknown-tool suggestions', async () => {
		const { registry } = createRegistry(todoHandlers);
		const client = createDirectClient(registry, { allow: allowTodo });

		expect(client.listCommandNames()).toEqual(['todo-create', 'todo-list']);
		expect(client.listCommands().map((command) => command.name)).toEqual([
			'todo-create',
			'todo-list',
		]);
		expect(client.hasCommand('admin-reset')).toBe(false);
		expect(client.hasCommand('todo-list')).toBe(true);

		const unknown = await client.call('admin-rest', {});
		expect(unknown.error?.code).toBe('COMMAND_NOT_ALLOWED');

		const typo = await client.call('todo-lst', {});
		expect(isUnknownToolError(typo)).toBe(true);
		expect(typo.data).toMatchObject({ available_tools: ['todo-create', 'todo-list'] });
		expect(JSON.stringify(typo)).not.toContain('admin-reset');
	});

	it('denies when the predicate throws', async () => {
		const { registry, calls } = createRegistry(todoHandlers);
		const client = createDirectClient(registry, {
			allow: () => {
				throw new Error('policy unavailable');
			},
		});

		const result = await client.call('todo-list', {});

		expect(result.error?.code).toBe('COMMAND_NOT_ALLOWED');
		expect(client.listCommandNames()).toEqual([]);
		expect(calls).toEqual([]);
	});

	it('applies to pipeline steps', async () => {
		const { registry, calls } = createRegistry(todoHandlers);
		const client = createDirectClient(registry, { allow: allowTodo });

		const result = await client.pipe([
			{ command: 'todo-list', input: {} },
			{ command: 'admin-reset', input: {} },
		]);

		expect(result.steps.map((step) => step.status)).toEqual(['success', 'failure']);
		expect(result.steps[1]?.error?.code).toBe('COMMAND_NOT_ALLOWED');
		expect(calls.map((call) => call.name)).toEqual(['todo-list']);
	});
});

describe('DirectClient timeout', () => {
	it('returns a TIMEOUT failure when the command outlasts context.timeout', async () => {
		const { registry } = createRegistry({
			'slow-run': async () => {
				await delay(200);
				return { success: true, data: 'late' };
			},
		});
		const client = createDirectClient(registry);

		const started = performance.now();
		const result = await client.call('slow-run', {}, { timeout: 20 });

		expect(performance.now() - started).toBeLessThan(150);
		expect(result.success).toBe(false);
		expect(result.error).toMatchObject({
			code: 'TIMEOUT',
			message: "Command 'slow-run' timed out after 20ms",
			retryable: true,
			details: { command: 'slow-run', timeoutMs: 20 },
		});
		expect(result.error?.suggestion).toContain('larger timeout');
	});

	it('aborts the signal the command receives', async () => {
		let received: AbortSignal | undefined;
		const { registry } = createRegistry({
			'slow-run': async (_input, context) => {
				received = context.signal;
				await delay(100);
				return { success: true };
			},
		});
		const client = createDirectClient(registry);

		await client.call('slow-run', {}, { timeout: 10 });

		expect(received?.aborted).toBe(true);
		expect(received?.reason).toBeInstanceOf(DOMException);
		expect(received?.reason).toMatchObject({ name: 'TimeoutError' });
	});

	it('combines the caller signal with the timeout signal', async () => {
		let received: AbortSignal | undefined;
		const { registry } = createRegistry({
			'wait-run': async (_input, context) => {
				received = context.signal;
				return { success: true };
			},
		});
		const client = createDirectClient(registry);
		const controller = new AbortController();

		await client.call('wait-run', {}, { timeout: 1000, signal: controller.signal });
		expect(received).not.toBe(controller.signal);
		expect(received?.aborted).toBe(false);

		controller.abort(new Error('caller cancelled'));
		expect(received?.aborted).toBe(true);
	});

	it('passes the caller signal through unchanged without a timeout', async () => {
		const { registry, calls } = createRegistry(todoHandlers);
		const client = createDirectClient(registry);
		const controller = new AbortController();

		await client.call('todo-list', {}, { signal: controller.signal });

		expect(calls[0]?.context?.signal).toBe(controller.signal);
	});

	it('resolves fast commands normally under a timeout', async () => {
		const { registry } = createRegistry(todoHandlers);
		const client = createDirectClient(registry);

		const result = await client.call<Todo>('todo-create', { title: 'Quick' }, { timeout: 1000 });

		expect(result).toMatchObject({ success: true, data: { title: 'Quick' } });
	});

	it('covers client middleware as well as the registry', async () => {
		const { registry } = createRegistry(todoHandlers);
		const client = createDirectClient(registry, {
			middleware: [
				async (_name, _input, _context, next) => {
					await delay(100);
					return next();
				},
			],
		});

		const result = await client.call('todo-list', {}, { timeout: 10 });

		expect(result.error?.code).toBe('TIMEOUT');
	});

	it('ignores timeouts that are not positive finite numbers', async () => {
		const { registry, calls } = createRegistry(todoHandlers);
		const client = createDirectClient(registry);

		for (const timeout of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
			const result = await client.call('todo-list', {}, { timeout });
			expect(result.success).toBe(true);
		}
		expect(calls.every((call) => call.context?.signal === undefined)).toBe(true);
		expect(isEnforceableTimeout('100')).toBe(false);
		expect(isEnforceableTimeout(1)).toBe(true);
	});

	it('returns a failure for a rejection that happens before the deadline', async () => {
		const { registry } = createRegistry({
			'broken-run': async () => {
				throw new Error('registry exploded');
			},
		});
		const client = createDirectClient(registry);

		const result = await client.call('broken-run', {}, { timeout: 1000 });

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('COMMAND_EXECUTION_ERROR');
		expect(JSON.stringify(result)).not.toContain('registry exploded');
	});

	it('does not leak a rejection that happens after the deadline', async () => {
		const result = await runWithTimeout('late-failure', 5, undefined, async () => {
			await delay(30);
			throw new Error('too late');
		});

		expect(result.error?.code).toBe('TIMEOUT');
		// Let the late rejection settle; an unhandled rejection would fail the run.
		await delay(50);
	});

	it('applies per step in pipelines', async () => {
		const { registry } = createRegistry({
			'fast-run': async () => ({ success: true, data: 1 }),
			'slow-run': async () => {
				await delay(100);
				return { success: true, data: 2 };
			},
		});
		const client = createDirectClient(registry);

		const result = await client.pipe(
			[
				{ command: 'fast-run', input: {} },
				{ command: 'slow-run', input: {} },
			],
			{ timeout: 20 }
		);

		expect(result.steps.map((step) => step.status)).toEqual(['success', 'failure']);
		expect(result.steps[1]?.error?.code).toBe('TIMEOUT');
	});
});

describe('isUnknownToolError', () => {
	it('identifies the unknown-tool failure and narrows the call result', async () => {
		const { registry } = createRegistry(todoHandlers);
		const client = createDirectClient(registry);

		const result = await client.call<Todo>('todo-craete', { title: 'Typo' });

		expect(isUnknownToolError(result)).toBe(true);
		if (isUnknownToolError(result)) {
			expectTypeOf(result).toEqualTypeOf<CommandResult<UnknownToolError>>();
			expect(result.data?.hint).toBe("Did you mean 'todo-create'?");
			expect(result.error?.suggestion).toBe("Did you mean 'todo-create'?");
		}
	});

	it('narrows the other branch to the command result type', async () => {
		const { registry } = createRegistry(todoHandlers);
		const client = createDirectClient(registry);

		const result = await client.call<Todo>('todo-create', { title: 'Typed' });

		expect(isUnknownToolError(result)).toBe(false);
		if (!isUnknownToolError(result)) {
			expectTypeOf(result).toEqualTypeOf<CommandResult<Todo>>();
			if (isSuccess(result)) {
				expectTypeOf(result.data).toEqualTypeOf<Todo>();
				expect(result.data.id).toBe('todo-1');
			}
		}
	});

	it('rejects other failures and look-alikes', () => {
		expect(isUnknownToolError({ success: false, error: { code: 'NOT_FOUND', message: 'x' } })).toBe(
			false
		);
		expect(
			isUnknownToolError({ success: false, error: { code: 'UNKNOWN_TOOL', message: 'x' } })
		).toBe(false);
		expect(
			isUnknownToolError({
				success: true,
				data: { error: 'UNKNOWN_TOOL' },
			} as CommandResult<unknown>)
		).toBe(false);
	});

	it('gives UNKNOWN_TOOL a generic suggestion when nothing is similar', async () => {
		const { registry } = createRegistry(todoHandlers);
		const client = createDirectClient(registry);

		const result = await client.call('zzzzzzzz', {});

		expect(result.error?.code).toBe('UNKNOWN_TOOL');
		expect(result.error?.suggestion).toBe(
			'Call one of the commands returned by listCommandNames()'
		);
	});
});

describe('DirectClient failures instead of rejections', () => {
	it('returns COMMAND_EXECUTION_ERROR when a hand-written registry throws', async () => {
		const { registry } = createRegistry({
			'todo-explode': async () => {
				throw new Error('database password is hunter2');
			},
		});
		const client = createDirectClient(registry);

		const result = await client.call('todo-explode', {});

		expect(result).toEqual({
			success: false,
			error: {
				code: 'COMMAND_EXECUTION_ERROR',
				message: 'An internal error occurred',
				suggestion: 'Contact support if this persists',
			},
		});
		expect(JSON.stringify(result)).not.toContain('hunter2');
	});

	it('returns a failure when client middleware throws', async () => {
		const { registry, calls } = createRegistry(todoHandlers);
		const client = createDirectClient(registry, {
			middleware: [
				() => {
					throw new Error('middleware broke');
				},
			],
		});

		const result = await client.call('todo-list', {});

		expect(result.error?.code).toBe('COMMAND_EXECUTION_ERROR');
		expect(calls).toEqual([]);
	});

	it('records a throwing pipeline step as a failed step', async () => {
		const { registry } = createRegistry({
			...todoHandlers,
			'todo-explode': async () => {
				throw new Error('boom');
			},
		});
		const client = createDirectClient(registry);

		const result = await client.pipe([
			{ command: 'todo-list', input: {} },
			{ command: 'todo-explode', input: {} },
		]);

		expect(result.steps.map((step) => step.status)).toEqual(['success', 'failure']);
		expect(result.steps[1]?.error?.code).toBe('COMMAND_EXECUTION_ERROR');
	});

	it('marks UNKNOWN_TOOL as not retryable and always suggests something', async () => {
		const { registry } = createRegistry(todoHandlers);
		const client = createDirectClient(registry);

		const result = await client.call('todo-craete', {});

		expect(result.error).toMatchObject({
			code: 'UNKNOWN_TOOL',
			suggestion: "Did you mean 'todo-create'?",
			retryable: false,
		});
	});
});
