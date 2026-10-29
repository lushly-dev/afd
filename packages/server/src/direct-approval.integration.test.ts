import { createDirectClient, type DirectApprovalHook } from '@lushly-dev/afd-client';
import {
	type CommandMiddleware,
	type CommandResult,
	fixedClock,
	MemoryJournalSink,
	success,
} from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApprovalMiddleware } from './approval.js';
import { createDirectRegistry } from './direct-registry.js';
import { createJournalMiddleware } from './journal.js';
import { defineCommand } from './schema.js';

function setup(hook?: DirectApprovalHook, before?: CommandMiddleware) {
	const clock = fixedClock('2026-10-28T12:00:00Z');
	const run = vi.fn(async () => success({ count: 1 }));
	const command = defineCommand({
		name: 'counter-increment',
		description: 'Increment a harmless test counter',
		approval: 'required',
		input: z.object({ id: z.number() }),
		handler: run,
	});
	const issued: string[] = [];
	const observed = vi.fn();
	const journal = new MemoryJournalSink();
	const approval = createApprovalMiddleware({
		commands: [command],
		secret: 'test-only-approval-secret-32-bytes-long',
		clock,
		onApprovalRequired: ({ approvalToken }) => {
			issued.push(approvalToken);
		},
	});
	const registry = createDirectRegistry([command], {
		onCommand: observed,
		middleware: [
			...(before ? [before] : []),
			createJournalMiddleware(journal, { recordFailures: true }),
			approval,
		],
	});
	const client = createDirectClient(registry, { onApprovalNeeded: hook });
	return { client, registry, run, issued, observed, journal, clock, approval };
}

describe('DirectClient private approval exchange', () => {
	it.each([
		undefined,
		async () => false,
		() => {
			throw new Error('prompt failed');
		},
		async () => {
			throw new Error('prompt rejected');
		},
	])('does not disclose evidence after a hold (%s)', async (hook) => {
		const { client, run, issued, observed, journal } = setup(hook);
		const result = await client.call('counter-increment', { id: 1 });
		expect(result.error?.code).toBe('APPROVAL_REQUIRED');
		expect(issued).toHaveLength(1);
		expect(result.error?.details).not.toHaveProperty('approvalToken');
		expect(JSON.stringify([result, observed.mock.calls, await journal.read()])).not.toContain(
			issued[0]
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('rejects caller-supplied evidence on call, pipe and registry entry points', async () => {
		const { client, registry, run, issued } = setup();
		await client.call('counter-increment', { id: 1 });
		const context = { approval: issued[0] };
		expect((await client.call('counter-increment', { id: 1 }, context)).success).toBe(false);
		expect(
			(await client.pipe([{ command: 'counter-increment', input: { id: 1 } }], context)).steps[0]
				?.status
		).toBe('failure');
		expect((await registry.execute('counter-increment', { id: 1 }, context)).success).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});

	it('executes exactly once after an affirmative hook', async () => {
		const hook = vi.fn(async () => true);
		const { client, run } = setup(hook);
		expect((await client.call('counter-increment', { id: 1 })).success).toBe(true);
		expect(run).toHaveBeenCalledOnce();
		expect(hook).toHaveBeenCalledOnce();
		expect(JSON.stringify(hook.mock.calls)).not.toContain('approvalToken');
	});
	it('returns a safe hold when approval expires during the decision', async () => {
		const env = setup(async () => {
			env.clock.advance(5 * 60_000);
			return true;
		});
		const result = await env.client.call('counter-increment', { id: 1 });
		expect(result.error?.details).toMatchObject({ reason: 'expired' });
		expect(result.error?.details).not.toHaveProperty('approvalToken');
		expect(env.run).not.toHaveBeenCalled();
		expect(env.issued).toHaveLength(2);
	});

	it('cancels a decision without executing or leaking evidence', async () => {
		const controller = new AbortController();
		const env = setup(async () => {
			controller.abort();
			return true;
		});
		const result = await env.client.call(
			'counter-increment',
			{ id: 1 },
			{ signal: controller.signal }
		);
		expect(result.error?.code).toBe('APPROVAL_REQUIRED');
		expect(result.error?.details).not.toHaveProperty('approvalToken');
		expect(env.run).not.toHaveBeenCalled();
	});

	it('retains input binding when arguments change during the prompt', async () => {
		const input = { id: 1 };
		const env = setup(async () => {
			input.id = 2;
			return true;
		});
		const result = await env.client.call('counter-increment', input);
		expect(result.error?.details).toMatchObject({ reason: 'input-mismatch' });
		expect(result.error?.details).not.toHaveProperty('approvalToken');
		expect(env.run).not.toHaveBeenCalled();
	});

	it('spends the genuine HMAC nonce, so even a trusted host cannot replay it', async () => {
		const env = setup(async () => true);
		await env.client.call('counter-increment', { id: 1 });
		const result = await env.approval(
			'counter-increment',
			{ id: 1 },
			{
				actor: { kind: 'human' },
				approval: env.issued[0],
			},
			env.run
		);
		expect(result.error?.details).toMatchObject({ reason: 'already-used' });
		expect(env.run).toHaveBeenCalledOnce();
	});

	it('approves each gated pipeline step with private evidence', async () => {
		const hook = vi.fn(async () => true);
		const env = setup(hook);
		const result = await env.client.pipe([
			{ command: 'counter-increment', input: { id: 1 } },
			{ command: 'counter-increment', input: { id: '$prev.count' } },
		]);
		expect(result.steps.map((step) => step.status)).toEqual(['success', 'success']);
		expect(hook).toHaveBeenCalledTimes(2);
		expect(env.run).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(result)).not.toContain('afdap1.');
	});

	it('isolates simultaneous approval decisions', async () => {
		const env = setup(async ({ input }) => input.id === 1);
		const results = await Promise.all(
			[1, 2].map((id) => env.client.call('counter-increment', { id }))
		);
		expect(results.map((result) => result.success)).toEqual([true, false]);
		expect(env.run).toHaveBeenCalledOnce();
		expect(JSON.stringify(results)).not.toContain('afdap1.');
	});
});

describe('approval exchange timeout cleanup', () => {
	it('keeps a late middleware hold private after the client has timed out', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			let release = () => {};
			const paused = new Promise<void>((resolve) => {
				release = resolve;
			});
			let finish = () => {};
			const finished = new Promise<void>((resolve) => {
				finish = resolve;
			});
			let late: CommandResult | undefined;
			const env = setup(
				async () => true,
				async (_name, _input, _context, next) => {
					await paused;
					late = await next();
					finish();
					return late;
				}
			);
			const pending = env.client.call('counter-increment', { id: 1 }, { timeout: 50 });
			await vi.advanceTimersByTimeAsync(51);
			expect((await pending).error?.code).toBe('TIMEOUT');
			release();
			await finished;
			expect(late?.error?.code).toBe('APPROVAL_REQUIRED');
			expect(JSON.stringify([late, await env.journal.read()])).not.toContain('afdap1.');
			expect(env.run).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
