/**
 * @fileoverview DirectClient `onApprovalNeeded` (#419).
 *
 * The registry here stands in for `createApprovalMiddleware`: `todo-delete` runs only with a
 * token it issued for the same input that is unused and unexpired on its own clock.
 */

import type { CommandContext, CommandResult, ManualClock } from '@lushly-dev/afd-core';
import { failure, fixedClock, isFailure, success } from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { createDirectClient, type DirectApprovalHook, type DirectRegistry } from './direct.js';

const TTL_MS = 60_000;

function gatedRegistry(clock: ManualClock, options: { includeToken?: boolean } = {}) {
	const issued = new Map<string, { input: string; exp: number; used: boolean }>();
	const calls: Array<{ name: string; input: unknown; context: CommandContext }> = [];
	const ran: string[] = [];
	const held: CommandResult<never>[] = [];
	let count = 0;

	function hold(name: string, input: unknown, reason?: string): CommandResult<never> {
		const token = `tok-${++count}`;
		const exp = clock.now() + TTL_MS;
		issued.set(token, { input: JSON.stringify(input), exp, used: false });
		const result = failure({
			code: 'APPROVAL_REQUIRED',
			message: `${name} needs approval before it runs`,
			suggestion: 'Ask the user to approve',
			retryable: false,
			details: {
				...(options.includeToken !== false && { approvalToken: token }),
				expiresAt: new Date(exp).toISOString(),
				summary: `Delete todo ${(input as { id?: unknown }).id}`,
				...(reason && { reason }),
			},
		});
		held.push(result);
		return result;
	}

	const registry: DirectRegistry = {
		async execute<T>(name: string, input?: unknown, context: CommandContext = {}) {
			calls.push({ name, input, context: { ...context } });
			if (name === 'todo-get') return success({ id: 42 }) as CommandResult<T>;
			if (context.approval === undefined) return hold(name, input);
			const token = issued.get(context.approval);
			if (!token) return hold(name, input, 'invalid-signature');
			if (clock.now() >= token.exp) return hold(name, input, 'expired');
			if (token.input !== JSON.stringify(input)) return hold(name, input, 'input-mismatch');
			if (token.used) return hold(name, input, 'already-used');
			token.used = true;
			ran.push(name);
			return success({ deleted: (input as { id?: unknown }).id }) as CommandResult<T>;
		},
		listCommandNames: () => ['todo-get', 'todo-delete'],
		listCommands: () => [
			{ name: 'todo-get', description: 'Get a todo' },
			{ name: 'todo-delete', description: 'Delete a todo' },
		],
		hasCommand: (name) => name === 'todo-get' || name === 'todo-delete',
	};
	return { registry, calls, ran, held };
}

function setup(hook?: DirectApprovalHook, options?: { includeToken?: boolean }) {
	const clock = fixedClock('2026-10-26T12:00:00Z');
	const gated = gatedRegistry(clock, options);
	const client = createDirectClient(gated.registry, { onApprovalNeeded: hook });
	return { clock, client, ...gated };
}

describe('DirectClient onApprovalNeeded', () => {
	it('retries once with the token when the hook approves', async () => {
		const hook = vi.fn<DirectApprovalHook>(async () => true);
		const { client, calls, ran } = setup(hook);

		const result = await client.call('todo-delete', { id: 42 });

		expect(result).toEqual(expect.objectContaining({ success: true, data: { deleted: 42 } }));
		expect(ran).toEqual(['todo-delete']);
		expect(hook).toHaveBeenCalledOnce();
		const request = hook.mock.calls[0]?.[0];
		expect(request).toEqual({
			command: 'todo-delete',
			input: { id: 42 },
			summary: 'Delete todo 42',
			expiresAt: '2026-10-26T12:01:00.000Z',
			actor: { kind: 'human' },
		});
		expect(JSON.stringify(request)).not.toContain('tok-');
		// The retry carries the token in the context only, with the same input and actor.
		expect(calls).toHaveLength(2);
		expect(calls[0]?.context.approval).toBeUndefined();
		expect(calls[1]?.context.approval).toBe('tok-1');
		expect(calls[1]?.input).toEqual({ id: 42 });
		expect(calls[1]?.context.actor).toEqual({ kind: 'human' });
		expect(calls[1]?.context.traceId).toBe(calls[0]?.context.traceId);
	});

	it('returns the original result unchanged when the hook denies', async () => {
		const hook = vi.fn<DirectApprovalHook>(async () => false);
		const { client, calls, ran, held } = setup(hook);

		const result = await client.call('todo-delete', { id: 42 });

		expect(isFailure(result) && result.error.code).toBe('APPROVAL_REQUIRED');
		expect(result).toBe(held[0]);
		expect(hook).toHaveBeenCalledOnce();
		expect(calls).toHaveLength(1);
		expect(ran).toEqual([]);
	});

	it.each([
		[
			'throws',
			() => {
				throw new Error('prompt crashed');
			},
		],
		[
			'rejects',
			async () => {
				throw new Error('prompt crashed');
			},
		],
		['returns a truthy non-boolean', async () => 'yes' as unknown as boolean],
	])('treats a hook that %s as a denial', async (_label, impl) => {
		const { client, calls, ran } = setup(impl as DirectApprovalHook);

		const result = await client.call('todo-delete', { id: 42 });

		expect(isFailure(result) && result.error.details?.approvalToken).toBe('tok-1');
		expect(calls).toHaveLength(1);
		expect(ran).toEqual([]);
	});

	it('returns APPROVAL_REQUIRED unchanged without a hook', async () => {
		const { client, calls } = setup();

		const result = await client.call('todo-delete', { id: 42 });

		expect(isFailure(result) && result.error.code).toBe('APPROVAL_REQUIRED');
		expect(calls).toHaveLength(1);
	});

	it('does not ask when the result carries no approval token', async () => {
		const hook = vi.fn<DirectApprovalHook>(async () => true);
		const { client, calls } = setup(hook, { includeToken: false });

		const result = await client.call('todo-delete', { id: 42 });

		expect(isFailure(result) && result.error.code).toBe('APPROVAL_REQUIRED');
		expect(hook).not.toHaveBeenCalled();
		expect(calls).toHaveLength(1);
	});

	it('does not ask for calls that are not held', async () => {
		const hook = vi.fn<DirectApprovalHook>(async () => true);
		const { client } = setup(hook);

		await client.call('todo-get', { id: 42 });

		expect(hook).not.toHaveBeenCalled();
	});

	it('returns the held retry, without retrying again, when the token expires during the wait', async () => {
		let clock: ManualClock | undefined;
		const hook = vi.fn<DirectApprovalHook>(async () => {
			clock?.advance(TTL_MS);
			return true;
		});
		const env = setup(hook);
		clock = env.clock;

		const result = await env.client.call('todo-delete', { id: 42 });

		expect(isFailure(result) && result.error.code).toBe('APPROVAL_REQUIRED');
		expect(isFailure(result) && result.error.details).toEqual(
			expect.objectContaining({ reason: 'expired', approvalToken: 'tok-2' })
		);
		expect(hook).toHaveBeenCalledOnce();
		expect(env.calls).toHaveLength(2);
		expect(env.ran).toEqual([]);
	});

	it('stops waiting, without retrying, when the call is cancelled during the wait', async () => {
		const controller = new AbortController();
		const hook = vi.fn<DirectApprovalHook>(({ signal }) => {
			expect(signal).toBe(controller.signal);
			controller.abort();
			return new Promise<boolean>(() => {});
		});
		const { client, calls } = setup(hook);

		const result = await client.call('todo-delete', { id: 42 }, { signal: controller.signal });

		expect(isFailure(result) && result.error.code).toBe('APPROVAL_REQUIRED');
		expect(calls).toHaveLength(1);
	});

	it('gives each attempt its own timeout signal and an unchanged starting context', async () => {
		const hook = vi.fn<DirectApprovalHook>(async () => true);
		const clock = fixedClock('2026-10-26T12:00:00Z');
		const { registry, calls } = gatedRegistry(clock);
		const client = createDirectClient(registry, {
			onApprovalNeeded: hook,
			actor: { kind: 'agent', label: 'Assistant' },
			// Like auth middleware, refines the actor on every attempt.
			middleware: [
				(_name, _input, context, next) => {
					if (context.actor) context.actor.id = `${context.actor.id ?? ''}user-1`;
					return next();
				},
			],
		});

		const result = await client.call('todo-delete', { id: 42 }, { timeout: 60_000 });

		expect(result.success).toBe(true);
		expect(calls.map((call) => call.context.actor)).toEqual([
			{ kind: 'agent', label: 'Assistant', id: 'user-1' },
			{ kind: 'agent', label: 'Assistant', id: 'user-1' },
		]);
		const [first, second] = calls.map((call) => call.context.signal);
		expect(second).toBeInstanceOf(AbortSignal);
		expect(second).not.toBe(first);
		expect(second?.aborted).toBe(false);
		expect(hook.mock.calls[0]?.[0].actor).toEqual({ kind: 'agent', label: 'Assistant' });
	});

	it('does not ask when the call was already cancelled', async () => {
		const hook = vi.fn<DirectApprovalHook>(async () => true);
		const { client, calls } = setup(hook);

		const result = await client.call('todo-delete', { id: 42 }, { signal: AbortSignal.abort() });

		expect(isFailure(result) && result.error.code).toBe('APPROVAL_REQUIRED');
		expect(hook).not.toHaveBeenCalled();
		expect(calls).toHaveLength(1);
	});

	it('does not let the timeout cut the wait short', async () => {
		const { registry, calls, ran } = gatedRegistry(fixedClock('2026-10-26T12:00:00Z'));
		// Answer only once the first attempt's timeout signal has fired.
		const hook: DirectApprovalHook = () =>
			new Promise<boolean>((resolve) => {
				const first = calls[0]?.context.signal;
				if (first?.aborted) resolve(true);
				else first?.addEventListener('abort', () => resolve(true), { once: true });
			});
		const client = createDirectClient(registry, { onApprovalNeeded: hook });

		const result = await client.call('todo-delete', { id: 42 }, { timeout: 1 });

		expect(calls[0]?.context.signal?.aborted).toBe(true);
		expect(result.success).toBe(true);
		expect(ran).toEqual(['todo-delete']);
	});

	it('passes the rejection reason of a token the call already carried', async () => {
		const hook = vi.fn<DirectApprovalHook>(async () => false);
		const { client } = setup(hook);

		await client.call('todo-delete', { id: 42 }, { approval: 'forged' });

		expect(hook.mock.calls[0]?.[0].reason).toBe('invalid-signature');
	});

	describe('pipe()', () => {
		it('asks when a gated step is reached, with its resolved input', async () => {
			const hook = vi.fn<DirectApprovalHook>(async () => true);
			const { client, calls, ran } = setup(hook);

			const result = await client.pipe([
				{ command: 'todo-get', input: { id: 42 } },
				{ command: 'todo-delete', input: { id: '$prev.id' } },
			]);

			expect(result.data).toEqual({ deleted: 42 });
			expect(hook).toHaveBeenCalledOnce();
			expect(hook.mock.calls[0]?.[0]).toEqual(
				expect.objectContaining({ command: 'todo-delete', input: { id: 42 } })
			);
			// The hook ran after the first step, between the gated step's two attempts.
			expect(calls.map((call) => call.name)).toEqual(['todo-get', 'todo-delete', 'todo-delete']);
			expect(calls[2]?.context.approval).toBe('tok-1');
			expect(ran).toEqual(['todo-delete']);
		});

		it('counts the wait against the pipeline timeoutMs', async () => {
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			try {
				let waitSignal: AbortSignal | undefined;
				const hook = vi.fn<DirectApprovalHook>(({ signal }) => {
					waitSignal = signal;
					return new Promise<boolean>(() => {});
				});
				const { client, calls } = setup(hook);

				const pending = client.pipe({
					steps: [{ command: 'todo-delete', input: { id: 42 } }],
					options: { timeoutMs: 50 },
				});
				await vi.advanceTimersByTimeAsync(100);
				const result = await pending;

				expect(result.steps[0]?.error?.code).toBe('PIPELINE_TIMEOUT');
				expect(waitSignal?.aborted).toBe(true);
				expect(calls).toHaveLength(1);
			} finally {
				vi.useRealTimers();
			}
		});

		it('fails a denied step like any other and skips the rest', async () => {
			const hook = vi.fn<DirectApprovalHook>(async () => false);
			const { client, calls } = setup(hook);

			const result = await client.pipe([
				{ command: 'todo-delete', input: { id: 42 } },
				{ command: 'todo-get', input: { id: 42 } },
			]);

			expect(result.steps.map((step) => step.status)).toEqual(['failure', 'skipped']);
			expect(result.steps[0]?.error?.code).toBe('APPROVAL_REQUIRED');
			expect(calls.map((call) => call.name)).toEqual(['todo-delete']);
		});
	});
});
