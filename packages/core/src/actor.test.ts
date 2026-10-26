import { describe, expect, it } from 'vitest';
import { ACTOR_KINDS, isActor, isActorKind, withContextDefaults } from './actor.js';
import { fixedClock, seededRandom, systemClock, systemRandom } from './clock.js';
import { createCommandRegistry } from './commands.js';
import { success } from './result.js';

describe('actor kinds', () => {
	it('lists the five kinds', () => {
		expect(ACTOR_KINDS).toEqual(['human', 'agent', 'service', 'script', 'test']);
	});

	it('recognizes actors and kinds', () => {
		expect(isActorKind('agent')).toBe(true);
		expect(isActorKind('robot')).toBe(false);
		expect(isActor({ kind: 'agent', id: 'a1', label: 'Claude', onBehalfOf: 'u1' })).toBe(true);
		expect(isActor({ kind: 'human' })).toBe(true);
		expect(isActor({ kind: 'robot' })).toBe(false);
		expect(isActor({ kind: 'human', id: 7 })).toBe(false);
		expect(isActor(['human'])).toBe(false);
		expect(isActor(null)).toBe(false);
	});
});

describe('withContextDefaults', () => {
	it('fills the real clock and random source, and no actor', () => {
		const context = withContextDefaults({ traceId: 't' });
		expect(context).toEqual({ traceId: 't', clock: systemClock, random: systemRandom });
		expect('actor' in context).toBe(false);
	});

	it('uses the given defaults where the context has none', () => {
		const clock = fixedClock(1);
		const random = seededRandom('s');
		const context = withContextDefaults({}, { clock, random, actor: { kind: 'agent' } });
		expect(context.clock).toBe(clock);
		expect(context.random).toBe(random);
		expect(context.actor).toEqual({ kind: 'agent' });
	});

	it('keeps values the context already has, and does not modify it', () => {
		const clock = fixedClock(1);
		const random = seededRandom('caller');
		const original = { clock, random, actor: { kind: 'test' as const } };
		const context = withContextDefaults(original, {
			clock: fixedClock(2),
			random: seededRandom('default'),
			actor: { kind: 'agent' },
		});
		expect(context).toEqual(original);
		expect(context).not.toBe(original);
	});
});

describe('core registry', () => {
	it('gives handlers a clock and random source, keeping the caller’s', async () => {
		const registry = createCommandRegistry();
		registry.register({
			name: 'time-read',
			description: 'Read the context clock',
			parameters: [],
			handler: async (_input, context) =>
				success({ now: context?.clock?.now(), roll: context?.random?.next() }),
		});

		const real = await registry.execute<{ now: number; roll: number }>('time-read', {});
		expect(typeof real.data?.now).toBe('number');

		const fixed = await registry.execute<{ now: number }>(
			'time-read',
			{},
			{
				clock: fixedClock(99),
				random: { next: () => 0.5 },
			}
		);
		expect(fixed.data).toEqual({ now: 99, roll: 0.5 });
	});
});
