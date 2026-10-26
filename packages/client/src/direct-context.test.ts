/**
 * @fileoverview DirectClient `actor`, `clock` and `random` (#271, #274).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { fixedClock, seededRandom, success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { createDirectClient, type DirectRegistry } from './direct.js';

/** A registry with one command that records the context it was given. */
function recordingRegistry() {
	const contexts: CommandContext[] = [];
	const registry: DirectRegistry = {
		async execute<T>(_name: string, _input?: unknown, context?: CommandContext) {
			contexts.push(context ?? {});
			return success({ now: context?.clock?.now() }) as CommandResult<T>;
		},
		listCommandNames: () => ['time-read'],
		listCommands: () => [{ name: 'time-read', description: 'Read the clock' }],
		hasCommand: (name) => name === 'time-read',
	};
	return { registry, contexts };
}

describe('DirectClient context defaults', () => {
	it('calls as a human and leaves clock and random to the registry by default', async () => {
		const { registry, contexts } = recordingRegistry();
		await createDirectClient(registry).call('time-read');
		expect(contexts[0]?.actor).toEqual({ kind: 'human' });
		expect(contexts[0]?.clock).toBeUndefined();
		expect(contexts[0]?.random).toBeUndefined();
	});

	it('gives each call its own copy of the default actor', async () => {
		const { registry, contexts } = recordingRegistry();
		let calls = 0;
		const client = createDirectClient(registry, {
			actor: { kind: 'agent' },
			middleware: [
				(_name, _input, context, next) => {
					if (calls++ === 0 && context.actor) context.actor.id = 'first-user';
					return next();
				},
			],
		});
		await client.call('time-read');
		await client.call('time-read');
		expect(contexts[0]?.actor).toEqual({ kind: 'agent', id: 'first-user' });
		expect(contexts[1]?.actor).toEqual({ kind: 'agent' });
	});

	it('uses the configured actor, clock and random source', async () => {
		const { registry, contexts } = recordingRegistry();
		const clock = fixedClock('2026-01-01T00:00:00Z');
		const random = seededRandom('abc');
		const client = createDirectClient(registry, {
			actor: { kind: 'agent', label: 'Assistant', onBehalfOf: 'user-1' },
			clock,
			random,
		});
		const result = await client.call<{ now: number }>('time-read');
		expect(result.data).toEqual({ now: Date.UTC(2026, 0, 1) });
		expect(contexts[0]).toMatchObject({
			actor: { kind: 'agent', label: 'Assistant', onBehalfOf: 'user-1' },
			clock,
			random,
		});
	});

	it('lets a call override the client actor and clock', async () => {
		const { registry, contexts } = recordingRegistry();
		const client = createDirectClient(registry, { actor: { kind: 'agent' } });
		const clock = fixedClock(7);
		await client.call('time-read', {}, { actor: { kind: 'test' }, clock });
		expect(contexts[0]?.actor).toEqual({ kind: 'test' });
		expect(contexts[0]?.clock).toBe(clock);
	});

	it('passes the client defaults to every pipeline step', async () => {
		const { registry, contexts } = recordingRegistry();
		const clock = fixedClock(1);
		const client = createDirectClient(registry, { actor: { kind: 'script' }, clock });
		await client.pipe([{ command: 'time-read' }, { command: 'time-read' }]);
		expect(contexts).toHaveLength(2);
		for (const context of contexts) {
			expect(context.actor).toEqual({ kind: 'script' });
			expect(context.clock).toBe(clock);
		}
	});
});
