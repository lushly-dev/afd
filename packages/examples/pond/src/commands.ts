/**
 * @fileoverview The pond's commands. The three that change the pond are `mutation: true`,
 * and only those are journaled (see `app.ts`). Each returns `stateDigest`, the fingerprint of
 * the pond it left, so replay, which compares results, also notices a pond that came out
 * different.
 *
 * Each handler checks everything that can refuse the call before it changes the pond. A
 * refused call is not journaled, so a handler that changed the pond and then refused would
 * leave a change that replay never makes.
 */

import { type CommandContext, failure, systemClock, systemRandom } from '@lushly-dev/afd-core';
import { defineCommand, success, type ZodCommandDefinition } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { MAX_TICK_DAYS, type Pond, SPECIES, type Species } from './pond.js';

const species = z.enum(Object.keys(SPECIES) as [Species, ...Species[]]);

/** The time and random source of a call. AFD surfaces always set both; the fallbacks are for type safety. */
function sources(context: CommandContext) {
	return { now: (context.clock ?? systemClock).now(), random: context.random ?? systemRandom };
}

export function createPondCommands(pond: Pond): ZodCommandDefinition[] {
	const stock = defineCommand({
		name: 'pond-stock',
		category: 'pond',
		description: 'Adds fish of one species to the pond, each a random length between 3 and 8 cm',
		mutation: true,
		input: z.object({
			species: species.describe('Which species to add'),
			count: z.number().int().min(1).max(50).default(1).describe('How many fish, 1 to 50'),
		}),
		errors: ['POND_FULL'],
		async handler(input, context) {
			if (input.count > pond.room) {
				return failure({
					code: 'POND_FULL',
					message: `The pond has room for ${pond.room} more fish, not ${input.count}`,
					suggestion:
						pond.room > 0
							? `Call pond-stock with count ${pond.room} or less, or pond-net to take fish out first`
							: 'Call pond-net to take fish out first',
					retryable: false,
					details: { room: pond.room, requested: input.count },
				});
			}
			const { now, random } = sources(context);
			const added = pond.stock(input.species, input.count, now, random);
			return success(
				{ added, total: pond.size, stateDigest: pond.digest() },
				{ reasoning: `Added ${added.length} ${input.species}; the pond holds ${pond.size} fish` }
			);
		},
	});

	const tick = defineCommand({
		name: 'pond-tick',
		category: 'pond',
		description:
			'Simulates days in the pond: each fish grows, and may hatch one young while there is room',
		mutation: true,
		input: z.object({
			days: z
				.number()
				.int()
				.min(1)
				.max(MAX_TICK_DAYS)
				.default(1)
				.describe(`How many days, 1 to ${MAX_TICK_DAYS}`),
		}),
		async handler(input, context) {
			const { now, random } = sources(context);
			const days = [];
			for (let i = 0; i < input.days; i++) days.push(pond.tick(now, random));
			const hatched = days.reduce((sum, day) => sum + day.hatched.length, 0);
			return success(
				{ days, total: pond.size, stateDigest: pond.digest() },
				{
					reasoning: `Simulated ${input.days} day(s); ${hatched} hatched; the pond holds ${pond.size} fish`,
				}
			);
		},
	});

	const net = defineCommand({
		name: 'pond-net',
		category: 'pond',
		description: 'Takes one fish out of the pond',
		mutation: true,
		input: z.object({ id: z.string().describe('The fish id, from pond-status') }),
		errors: ['NOT_FOUND'],
		async handler(input) {
			const fish = pond.net(input.id);
			if (!fish) {
				return failure({
					code: 'NOT_FOUND',
					message: `The pond has no fish ${input.id}`,
					suggestion: 'Call pond-status to list the fish in the pond',
					retryable: false,
					details: { id: input.id },
				});
			}
			return success(
				{ removed: fish, total: pond.size, stateDigest: pond.digest() },
				{ reasoning: `Netted ${fish.id}` }
			);
		},
	});

	const status = defineCommand({
		name: 'pond-status',
		category: 'pond',
		description: 'Lists the fish in the pond and the days simulated so far',
		input: z.object({}),
		async handler() {
			const { day, fish } = pond.snapshot();
			return success(
				{ day, fish, total: fish.length },
				{ reasoning: `Day ${day}; ${fish.length} fish` }
			);
		},
	});

	return [stock, tick, net, status];
}
