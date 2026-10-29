/**
 * The pre-execution approval gate (#272): `createApprovalMiddleware` and its token.
 */

import type { Actor, ApprovalPolicy, CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { fixedClock } from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	type ApprovalMiddlewareOptions,
	type ApprovalRequest,
	canonicalJson,
	createApprovalMiddleware,
} from './approval.js';
import { createDirectRegistry } from './direct-registry.js';
import { createExecutionEngine } from './execution.js';
import { defineCommand } from './schema.js';

const SECRET = 'test-approval-secret-0123456789abcdef';
const OTHER_SECRET = 'another-approval-secret-0123456789abcdef';
const START = Date.parse('2026-10-26T12:00:00.000Z');
const agent: Actor = { kind: 'agent', id: 'advisor', onBehalfOf: 'user-1' };

interface ApprovalDetails {
	approvalToken?: string;
	expiresAt: string;
	summary: string;
	reason?: string;
}

function details(result: CommandResult): ApprovalDetails {
	expect(result.success).toBe(false);
	expect(result.error?.code).toBe('APPROVAL_REQUIRED');
	return result.error?.details as unknown as ApprovalDetails;
}

/** A registry with a gated `todo-delete` and `todo-purge` and an ungated `todo-list`. */
function setup(
	options: Partial<ApprovalMiddlewareOptions> = {},
	policy: ApprovalPolicy<{ id: number }> = 'required'
) {
	const handled = vi.fn();
	const clock = fixedClock(START);
	const remove = defineCommand({
		name: 'todo-delete',
		description: 'Delete a todo permanently',
		mutation: true,
		destructive: true,
		approval: policy,
		input: z.object({ id: z.number(), hard: z.boolean().default(false) }),
		handler: async (input) => {
			handled(input);
			return { success: true as const, data: { deleted: input.id } };
		},
	});
	const purge = defineCommand({
		name: 'todo-purge',
		description: 'Purge todos',
		approval: 'required',
		input: z.object({ id: z.number() }),
		handler: async () => ({ success: true as const, data: null }),
	});
	const list = defineCommand({
		name: 'todo-list',
		description: 'List todos',
		input: z.object({}),
		handler: async () => ({ success: true as const, data: [] }),
	});
	const commands = [remove, purge, list];
	// Token verification uses the trusted host engine; public DirectRegistry uses a private exchange.
	const registry = createExecutionEngine({
		commandMap: new Map(commands.map((command) => [command.name, command])),
		contextDefaults: { clock },
		devMode: false,
		middleware: [createApprovalMiddleware({ secret: SECRET, commands, clock, ...options })],
	});
	const call = (name: string, input: unknown, context: CommandContext = {}) =>
		registry.executeCommand(name, input, { actor: agent, ...context });
	return { call, clock, handled };
}

/** Rewrite one payload field of a token without re-signing it. */
function tamper(token: string, change: Record<string, unknown>): string {
	const [prefix, payload = '', mac] = token.split('.');
	const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	const changed = Buffer.from(JSON.stringify({ ...decoded, ...change })).toString('base64url');
	return [prefix, changed, mac].join('.');
}

describe('createApprovalMiddleware', () => {
	it('runs commands with no policy or a not-required policy', async () => {
		const { call } = setup({}, 'not-required');
		expect((await call('todo-list', {})).success).toBe(true);
		expect((await call('todo-delete', { id: 1 })).success).toBe(true);
	});

	it('holds a required command before the handler with a resumable APPROVAL_REQUIRED', async () => {
		const { call, handled } = setup();
		const result = await call('todo-delete', { id: 42 });
		const held = details(result);
		expect(handled).not.toHaveBeenCalled();
		expect(result.error).toMatchObject({
			message: 'todo-delete needs approval before it runs',
			retryable: false,
		});
		expect(result.error?.suggestion).toContain('Ask the user to approve "Run todo-delete"');
		expect(held.approvalToken).toMatch(/^afdap1\.[\w-]+\.[\w-]+$/);
		expect(held.expiresAt).toBe('2026-10-26T12:05:00.000Z');
		expect(held.summary).toBe('Run todo-delete');
		expect(held).not.toHaveProperty('reason');
	});

	it('runs the command when retried with the token', async () => {
		const { call, handled } = setup();
		const { approvalToken } = details(await call('todo-delete', { id: 42 }));
		const result = await call('todo-delete', { id: 42 }, { approval: approvalToken });
		expect(result).toMatchObject({ success: true, data: { deleted: 42 } });
		expect(handled).toHaveBeenCalledOnce();
	});

	it('binds the validated input, so defaults and key order do not matter', async () => {
		const { call } = setup();
		const { approvalToken } = details(await call('todo-delete', { id: 7 }));
		const retry = await call('todo-delete', { hard: false, id: 7 }, { approval: approvalToken });
		expect(retry.success).toBe(true);
	});

	describe('rejects', () => {
		it('a token whose payload was changed', async () => {
			const { call, handled } = setup();
			const { approvalToken = '' } = details(await call('todo-delete', { id: 1 }));
			const forged = tamper(approvalToken, { exp: START + 3_600_000 });
			const held = details(await call('todo-delete', { id: 1 }, { approval: forged }));
			expect(held.reason).toBe('invalid-signature');
			expect(handled).not.toHaveBeenCalled();
		});

		it('another spelling of a valid signature', async () => {
			const { call } = setup();
			const { approvalToken = '' } = details(await call('todo-delete', { id: 1 }));
			for (const respelled of [`${approvalToken}=`, `${approvalToken}!`]) {
				const held = details(await call('todo-delete', { id: 1 }, { approval: respelled }));
				expect(held.reason).toBe('invalid-signature');
			}
		});

		it('a token whose signature was changed', async () => {
			const { call } = setup();
			const { approvalToken = '' } = details(await call('todo-delete', { id: 1 }));
			// Flip the MAC's first character: the last one may only carry padding bits.
			const [prefix, payload, mac = ''] = approvalToken.split('.');
			const flipped = `${mac.startsWith('A') ? 'B' : 'A'}${mac.slice(1)}`;
			const forged = [prefix, payload, flipped].join('.');
			const held = details(await call('todo-delete', { id: 1 }, { approval: forged }));
			expect(held.reason).toBe('invalid-signature');
		});

		it('a token signed with another secret', async () => {
			const other = setup({ secret: OTHER_SECRET });
			const { approvalToken } = details(await other.call('todo-delete', { id: 1 }));
			const { call } = setup();
			const held = details(await call('todo-delete', { id: 1 }, { approval: approvalToken }));
			expect(held.reason).toBe('invalid-signature');
		});

		it('an expired token', async () => {
			const { call, clock, handled } = setup({ ttlMs: 1000 });
			const { approvalToken } = details(await call('todo-delete', { id: 1 }));
			clock.advance(1000);
			const held = details(await call('todo-delete', { id: 1 }, { approval: approvalToken }));
			expect(held.reason).toBe('expired');
			expect(held.approvalToken).not.toBe(approvalToken);
			expect(handled).not.toHaveBeenCalled();
		});

		it('a token for another command', async () => {
			const { call } = setup();
			const { approvalToken } = details(await call('todo-purge', { id: 1 }));
			const held = details(await call('todo-delete', { id: 1 }, { approval: approvalToken }));
			expect(held.reason).toBe('command-mismatch');
		});

		it('a token for another input', async () => {
			const { call, handled } = setup();
			const { approvalToken } = details(await call('todo-delete', { id: 1 }));
			const held = details(await call('todo-delete', { id: 2 }, { approval: approvalToken }));
			expect(held.reason).toBe('input-mismatch');
			const harder = await call('todo-delete', { id: 1, hard: true }, { approval: approvalToken });
			expect(details(harder).reason).toBe('input-mismatch');
			expect(handled).not.toHaveBeenCalled();
		});

		it('a token for another actor', async () => {
			const { call } = setup();
			const { approvalToken } = details(await call('todo-delete', { id: 1 }));
			const others: Array<Actor | undefined> = [
				{ ...agent, id: 'someone-else' },
				{ ...agent, onBehalfOf: 'user-2' },
				{ ...agent, kind: 'human' },
				undefined,
			];
			for (const actor of others) {
				const held = details(
					await call('todo-delete', { id: 1 }, { actor, approval: approvalToken })
				);
				expect(held.reason).toBe('actor-mismatch');
			}
		});

		it('a token issued with no actor, presented by one', async () => {
			const { call } = setup();
			const { approvalToken } = details(await call('todo-delete', { id: 1 }, { actor: undefined }));
			const held = details(await call('todo-delete', { id: 1 }, { approval: approvalToken }));
			expect(held.reason).toBe('actor-mismatch');
			const same = await call(
				'todo-delete',
				{ id: 1 },
				{ actor: undefined, approval: approvalToken }
			);
			expect(same.success).toBe(true);
		});

		it('the second of two concurrent calls with one single-use token', async () => {
			const { call, handled } = setup();
			const { approvalToken } = details(await call('todo-delete', { id: 1 }));
			const results = await Promise.all([
				call('todo-delete', { id: 1 }, { approval: approvalToken }),
				call('todo-delete', { id: 1 }, { approval: approvalToken }),
			]);
			expect(results.filter((result) => result.success)).toHaveLength(1);
			expect(handled).toHaveBeenCalledOnce();
		});

		it('an input whose validated form cannot be bound, without running the handler', async () => {
			const handled = vi.fn();
			const purge = defineCommand({
				name: 'todo-purge',
				description: 'Purge todos matching a pattern',
				approval: 'required',
				input: z.object({ pattern: z.string().transform((source) => new RegExp(source)) }),
				handler: async () => {
					handled();
					return { success: true as const, data: null };
				},
			});
			const registry = createDirectRegistry([purge], {
				middleware: [createApprovalMiddleware({ secret: SECRET, commands: [purge] })],
			});
			const result = await registry.execute('todo-purge', { pattern: '^tmp-' });
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('COMMAND_EXECUTION_ERROR');
			expect(handled).not.toHaveBeenCalled();
		});

		it('ignores the actor label, which is display text', async () => {
			const { call } = setup();
			const { approvalToken } = details(await call('todo-delete', { id: 1 }));
			const relabelled = { ...agent, label: 'Renamed advisor' };
			const result = await call(
				'todo-delete',
				{ id: 1 },
				{ actor: relabelled, approval: approvalToken }
			);
			expect(result.success).toBe(true);
		});

		it('a reused single-use token', async () => {
			const { call, handled } = setup();
			const { approvalToken } = details(await call('todo-delete', { id: 1 }));
			expect((await call('todo-delete', { id: 1 }, { approval: approvalToken })).success).toBe(
				true
			);
			const replay = details(await call('todo-delete', { id: 1 }, { approval: approvalToken }));
			expect(replay.reason).toBe('already-used');
			expect(handled).toHaveBeenCalledOnce();
		});

		it('malformed evidence', async () => {
			const { call } = setup();
			const { approvalToken = '' } = details(await call('todo-delete', { id: 1 }));
			const [, payload, mac] = approvalToken.split('.');
			const malformed: unknown[] = [
				42,
				{ token: approvalToken },
				'',
				'not-a-token',
				`afdap2.${payload}.${mac}`,
				`${approvalToken}.extra`,
				`afdap1.${'a'.repeat(2000)}.${mac}`,
			];
			for (const approval of malformed) {
				// The type says string; the middleware must still cope with anything.
				const held = details(
					await call('todo-delete', { id: 1 }, { approval: approval as string })
				);
				expect(held.reason).toBe('malformed');
			}
		});

		it('a validly signed payload that is not a token', async () => {
			// Sign a payload with the right key but the wrong shape, through a policy-free route.
			const { createHmac } = await import('node:crypto');
			const payload = Buffer.from(JSON.stringify({ c: 'todo-delete' })).toString('base64url');
			const mac = createHmac('sha256', SECRET).update(`afdap1.${payload}`).digest('base64url');
			const { call } = setup();
			const held = details(
				await call('todo-delete', { id: 1 }, { approval: `afdap1.${payload}.${mac}` })
			);
			expect(held.reason).toBe('malformed');
		});
	});

	describe('replay', () => {
		it('within-ttl lets a token run the same call again until it expires', async () => {
			const { call, clock, handled } = setup({ replay: 'within-ttl', ttlMs: 1000 });
			const { approvalToken } = details(await call('todo-delete', { id: 1 }));
			expect((await call('todo-delete', { id: 1 }, { approval: approvalToken })).success).toBe(
				true
			);
			expect((await call('todo-delete', { id: 1 }, { approval: approvalToken })).success).toBe(
				true
			);
			expect(handled).toHaveBeenCalledTimes(2);
			clock.advance(1000);
			const expired = details(await call('todo-delete', { id: 1 }, { approval: approvalToken }));
			expect(expired.reason).toBe('expired');
		});

		it('says in the suggestion whether a token works once', async () => {
			const once = await setup().call('todo-delete', { id: 1 });
			expect(once.error?.suggestion).toContain('works once');
			const reusable = await setup({ replay: 'within-ttl' }).call('todo-delete', { id: 1 });
			expect(reusable.error?.suggestion).not.toContain('works once');
		});

		it('treats only true from a supplied store as unused', async () => {
			for (const answer of ['OK', 1, { ok: false }, undefined]) {
				const { call, handled } = setup({
					nonceStore: { consume: () => answer as unknown as boolean },
				});
				const { approvalToken } = details(await call('todo-delete', { id: 1 }));
				const held = details(await call('todo-delete', { id: 1 }, { approval: approvalToken }));
				expect(held.reason).toBe('already-used');
				expect(handled).not.toHaveBeenCalled();
			}
		});

		it('records nonces in a supplied store', async () => {
			const spent = new Set<string>();
			const consume = vi.fn(async (nonce: string) => {
				if (spent.has(nonce)) return false;
				spent.add(nonce);
				return true;
			});
			const { call } = setup({ nonceStore: { consume } });
			const { approvalToken } = details(await call('todo-delete', { id: 1 }));
			expect((await call('todo-delete', { id: 1 }, { approval: approvalToken })).success).toBe(
				true
			);
			expect(consume).toHaveBeenCalledWith(expect.any(String), START + 300_000);
			const replay = details(await call('todo-delete', { id: 1 }, { approval: approvalToken }));
			expect(replay.reason).toBe('already-used');
		});
	});

	describe('policies', () => {
		const agentsOnly: ApprovalPolicy<{ id: number }> = (_input, context) =>
			context.actor?.kind === 'agent' ? 'required' : 'not-required';

		it('evaluates a function policy against the input and context', async () => {
			const { call } = setup({}, agentsOnly);
			expect(details(await call('todo-delete', { id: 1 })).summary).toBe('Run todo-delete');
			const human = await call('todo-delete', { id: 1 }, { actor: { kind: 'human', id: 'u' } });
			expect(human.success).toBe(true);
		});

		it('awaits an async policy', async () => {
			const { call } = setup({}, async (input) => (input.id > 10 ? 'required' : 'not-required'));
			expect((await call('todo-delete', { id: 1 })).success).toBe(true);
			details(await call('todo-delete', { id: 11 }));
		});

		it('fails closed when a policy returns anything but not-required', async () => {
			const unexpected = (() => 'maybe') as unknown as ApprovalPolicy<{ id: number }>;
			const { call } = setup({}, unexpected);
			details(await call('todo-delete', { id: 1 }));
		});

		it('fails closed when a policy throws: the handler does not run', async () => {
			const { call, handled } = setup({}, () => {
				throw new Error('policy store offline');
			});
			const result = await call('todo-delete', { id: 1 });
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('COMMAND_EXECUTION_ERROR');
			expect(handled).not.toHaveBeenCalled();
		});
	});

	describe('options', () => {
		it('uses summarize, then the confirmPrompt, for the summary', async () => {
			const summarize = (_command: string, input: unknown) =>
				`Delete todo ${(input as { id: number }).id} (permanent)`;
			expect(details(await setup({ summarize }).call('todo-delete', { id: 42 })).summary).toBe(
				'Delete todo 42 (permanent)'
			);

			const remove = defineCommand({
				name: 'todo-delete',
				description: 'Delete a todo',
				approval: 'required',
				confirmPrompt: 'Delete this todo permanently?',
				input: z.object({}),
				handler: async () => ({ success: true as const, data: null }),
			});
			const registry = createDirectRegistry([remove], {
				middleware: [createApprovalMiddleware({ secret: SECRET, commands: [remove] })],
			});
			expect(details(await registry.execute('todo-delete', {})).summary).toBe(
				'Delete this todo permanently?'
			);
		});

		it('can leave the token out of the result and hand it to onApprovalRequired', async () => {
			const requests: ApprovalRequest[] = [];
			const { call } = setup({
				includeToken: false,
				onApprovalRequired: (request) => {
					requests.push(request);
				},
			});
			const result = await call('todo-delete', { id: 3 });
			expect(details(result)).not.toHaveProperty('approvalToken');
			expect(result.error?.suggestion).toContain('once it has recorded the approval');
			expect(requests).toEqual([
				expect.objectContaining({
					command: 'todo-delete',
					input: { id: 3, hard: false },
					actor: agent,
					summary: 'Run todo-delete',
				}),
			]);
			const retry = await call('todo-delete', { id: 3 }, { approval: requests[0]?.approvalToken });
			expect(retry.success).toBe(true);
		});

		it('passes the rejection to onApprovalRequired', async () => {
			const onApprovalRequired = vi.fn();
			const { call } = setup({ onApprovalRequired });
			await call('todo-delete', { id: 3 }, { approval: 'nope' });
			expect(onApprovalRequired).toHaveBeenCalledWith(
				expect.objectContaining({ rejected: 'malformed' })
			);
		});

		it('verifies tokens signed with any rotated key and signs with the first', async () => {
			const old = setup({ secret: OTHER_SECRET });
			const { approvalToken } = details(await old.call('todo-delete', { id: 1 }));
			const rotated = setup({ secret: [SECRET, OTHER_SECRET] });
			expect(
				(await rotated.call('todo-delete', { id: 1 }, { approval: approvalToken })).success
			).toBe(true);
			const fresh = details(await rotated.call('todo-delete', { id: 1 })).approvalToken;
			const current = setup();
			expect((await current.call('todo-delete', { id: 1 }, { approval: fresh })).success).toBe(
				true
			);
		});

		it('accepts a Uint8Array secret', async () => {
			const { call } = setup({ secret: new Uint8Array(32).fill(7) });
			const { approvalToken } = details(await call('todo-delete', { id: 1 }));
			expect((await call('todo-delete', { id: 1 }, { approval: approvalToken })).success).toBe(
				true
			);
		});

		it('never takes security time from the context clock', async () => {
			const { call, handled } = setup({ ttlMs: 1000 });
			const { approvalToken, expiresAt } = details(await call('todo-delete', { id: 1 }));
			expect(expiresAt).toBe(new Date(START + 1000).toISOString());
			expect((await call('todo-delete', { id: 1 }, { approval: approvalToken })).success).toBe(
				true
			);
			// A caller-set clock far ahead must neither expire the token early nor make the
			// middleware forget that it was spent.
			const ahead = fixedClock(START + 3_600_000);
			const other = details(await call('todo-delete', { id: 2 })).approvalToken;
			expect(
				(await call('todo-delete', { id: 2 }, { approval: other, clock: ahead })).success
			).toBe(true);
			const replay = details(await call('todo-delete', { id: 1 }, { approval: approvalToken }));
			expect(replay.reason).toBe('already-used');
			expect(handled).toHaveBeenCalledTimes(2);
		});

		it('falls back to the default summary for an empty one', async () => {
			const { call } = setup({ summarize: () => '' });
			expect(details(await call('todo-delete', { id: 1 })).summary).toBe('Run todo-delete');
		});

		it('never holds a command that is not in its list', async () => {
			const unlisted = defineCommand({
				name: 'todo-wipe',
				description: 'Wipe todos',
				approval: 'required',
				input: z.object({}),
				handler: async () => ({ success: true as const, data: null }),
			});
			const registry = createDirectRegistry([unlisted], {
				middleware: [createApprovalMiddleware({ secret: SECRET, commands: [] })],
			});
			expect((await registry.execute('todo-wipe', {})).success).toBe(true);
		});
	});

	describe('configuration errors', () => {
		const commands = [{ name: 'todo-delete', approval: 'required' as const }];

		it('requires a secret, with no default', () => {
			const create = (secret: unknown) =>
				createApprovalMiddleware({ secret, commands } as unknown as ApprovalMiddlewareOptions);
			expect(() => create(undefined)).toThrow('Approval secret is required');
			expect(() => create([])).toThrow('Approval secret is required');
			expect(() => create(42)).toThrow('Approval secret is required');
		});

		it('rejects secrets shorter than 32 bytes', () => {
			expect(() => createApprovalMiddleware({ secret: 'short', commands })).toThrow(
				'at least 32 bytes'
			);
			expect(() => createApprovalMiddleware({ secret: [SECRET, 'short'], commands })).toThrow(
				'at least 32 bytes'
			);
		});

		it('rejects a ttlMs that is not positive or exceeds 24 hours', () => {
			for (const ttlMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 86_400_001, 1e300]) {
				expect(() => createApprovalMiddleware({ secret: SECRET, commands, ttlMs })).toThrow(
					'ttlMs'
				);
			}
		});

		it('rejects an invalid approval policy', () => {
			const invalid = [
				{ name: 'todo-delete', approval: 'sometimes' },
			] as unknown as typeof commands;
			expect(() => createApprovalMiddleware({ secret: SECRET, commands: invalid })).toThrow(
				"Command 'todo-delete' has an invalid approval policy"
			);
		});
	});
});

describe('canonicalJson', () => {
	it('sorts object keys at every depth and drops undefined members', () => {
		expect(canonicalJson({ b: 1, a: { d: [1, undefined], c: undefined } })).toBe(
			'{"a":{"d":[1,null]},"b":1}'
		);
	});

	it('honours toJSON, so a date is its ISO string', () => {
		expect(canonicalJson({ at: new Date(0) })).toBe('{"at":"1970-01-01T00:00:00.000Z"}');
		expect(canonicalJson(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
	});

	it('fails closed on values that could collide', () => {
		const ambiguous: unknown[] = [
			10n,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			new Map([['a', 1]]),
			new Set([1]),
			/^tmp-/,
			new Uint8Array([1, 2]),
			new (class Todo {
				id = 1;
			})(),
		];
		for (const value of ambiguous) {
			expect(() => canonicalJson({ value })).toThrow(TypeError);
		}
	});

	it('allows repeated references but refuses cycles', () => {
		const shared = { x: 1 };
		expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => canonicalJson(cyclic)).toThrow('cyclic');
	});
});
