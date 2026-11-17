/**
 * @fileoverview The pond's state and the rules that change it.
 *
 * Nothing here reads the time, a random number or the outside world on its own: every rule
 * takes the time and the random source as arguments. The commands pass in the ones on their
 * `CommandContext`, which the journal records on each call's tape and replay restores, so
 * applying the same calls to an empty pond gives the same pond.
 */

import type { RandomSource } from '@lushly-dev/afd-core';

/** The species the pond can hold, and how each grows. */
export const SPECIES = {
	koi: { maxGrowthCm: 2, spawnChance: 0.1 },
	minnow: { maxGrowthCm: 0.5, spawnChance: 0.3 },
	perch: { maxGrowthCm: 1, spawnChance: 0.15 },
} as const;

export type Species = keyof typeof SPECIES;

/** Most fish the pond holds. With {@link MAX_TICK_DAYS}, it bounds the values one call reads. */
export const POND_CAPACITY = 200;

/** Most days one `pond-tick` simulates. */
export const MAX_TICK_DAYS = 30;

/**
 * Most random values one call can read: `pond-tick` reads two per fish per day. The journal
 * keeps this many per call, so replay can restore every one.
 */
export const MAX_RANDOM_READS = 2 * POND_CAPACITY * MAX_TICK_DAYS;

export interface Fish {
	id: string;
	species: Species;
	lengthCm: number;
	/** ISO 8601 time the fish was stocked or hatched, from the caller's clock. */
	bornAt: string;
}

/** What one day in the pond did. */
export interface TickOutcome {
	day: number;
	grown: number;
	hatched: Fish[];
}

/** Lengths are kept to a millimetre, so they read the same in JSON and in memory. */
function toMillimetre(cm: number): number {
	return Math.round(cm * 10) / 10;
}

export class Pond {
	/** The fish, in the order they arrived. A `Map` iterates in insertion order. */
	readonly fish = new Map<string, Fish>();
	/** Days simulated so far. */
	day = 0;
	/**
	 * The next fish number. It lives in the pond, not in a module variable, so a fresh pond
	 * that replays the journal hands out the same ids as the one that recorded it.
	 */
	private nextNumber = 1;

	get size(): number {
		return this.fish.size;
	}

	/** Room left before {@link POND_CAPACITY}. */
	get room(): number {
		return POND_CAPACITY - this.fish.size;
	}

	/** Add `count` fish of `species`, each a random length between 3 and 8 cm. */
	stock(species: Species, count: number, now: number, random: RandomSource): Fish[] {
		const added: Fish[] = [];
		for (let i = 0; i < count; i++) {
			added.push(this.add(species, 3 + random.next() * 5, now));
		}
		return added;
	}

	/** Remove a fish. Returns it, or `undefined` when the pond has no such fish. */
	net(id: string): Fish | undefined {
		const fish = this.fish.get(id);
		if (fish) this.fish.delete(id);
		return fish;
	}

	/**
	 * Simulate one day: every fish grows a random amount up to its species' limit, then each
	 * may hatch one young of its species while there is room. Two random reads per fish.
	 */
	tick(now: number, random: RandomSource): TickOutcome {
		this.day++;
		// A snapshot, so fish hatched today neither grow nor hatch until tomorrow.
		const today = [...this.fish.values()];
		for (const fish of today) {
			fish.lengthCm = toMillimetre(
				fish.lengthCm + random.next() * SPECIES[fish.species].maxGrowthCm
			);
		}
		const hatched: Fish[] = [];
		for (const fish of today) {
			// Read the random value even when the pond is full, so the number of reads does not
			// depend on the order of an earlier hatch. Either way is deterministic; this is simpler.
			const roll = random.next();
			if (roll < SPECIES[fish.species].spawnChance && this.room > 0) {
				hatched.push(this.add(fish.species, 1, now));
			}
		}
		return { day: this.day, grown: today.length, hatched };
	}

	/** A plain copy of the state, for a result or a comparison. */
	snapshot(): { day: number; fish: Fish[] } {
		return { day: this.day, fish: [...this.fish.values()].map((fish) => ({ ...fish })) };
	}

	/**
	 * A short fingerprint of the whole state (FNV-1a over its JSON). Each change returns it, because
	 * replay compares results, not state: a change whose effect never shows in its result could
	 * replay differently and still compare `same`.
	 */
	digest(): string {
		let hash = 0x811c9dc5;
		for (const char of JSON.stringify(this.snapshot())) {
			hash ^= char.charCodeAt(0);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return hash.toString(16).padStart(8, '0');
	}

	private add(species: Species, lengthCm: number, now: number): Fish {
		const fish: Fish = {
			id: `fish-${this.nextNumber++}`,
			species,
			lengthCm: toMillimetre(lengthCm),
			bornAt: new Date(now).toISOString(),
		};
		this.fish.set(fish.id, fish);
		// A copy, so a result that holds it does not change as the fish grows.
		return { ...fish };
	}
}
