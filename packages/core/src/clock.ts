/**
 * @fileoverview Injectable time and randomness for command handlers.
 *
 * Handlers that call `Date.now()` or `Math.random()` directly cannot be tested
 * deterministically or replayed. AFD surfaces put a `clock` and a `random` source on
 * every `CommandContext` (real ones by default), and tests, replays and simulations
 * swap in {@link fixedClock} and {@link seededRandom}.
 */

/**
 * A source of the current time.
 */
export interface Clock {
	/** Milliseconds since the Unix epoch, like `Date.now()`. */
	now(): number;
}

/**
 * A clock that only moves when told to, from {@link fixedClock}.
 */
export interface ManualClock extends Clock {
	/** Move the clock to `at` (milliseconds since the epoch, an ISO string or a `Date`). */
	set(at: ClockInstant): void;
	/** Move the clock forward by `ms` milliseconds (backward when negative). */
	advance(ms: number): void;
}

/**
 * A source of random numbers.
 */
export interface RandomSource {
	/** A number in [0, 1), like `Math.random()`. */
	next(): number;
	/** The seed this source was created from, when it is seeded (for journals and replay). */
	readonly seed?: string;
}

/** An instant accepted by {@link fixedClock}: epoch milliseconds, an ISO 8601 string or a `Date`. */
export type ClockInstant = number | string | Date;

/** The real clock: `Date.now()`. */
export const systemClock: Clock = Object.freeze({ now: () => Date.now() });

/** The real random source: `Math.random()`. Not seeded, so not reproducible. */
export const systemRandom: RandomSource = Object.freeze({ next: () => Math.random() });

function toEpochMs(at: ClockInstant): number {
	const ms = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : at;
	if (!Number.isFinite(ms)) {
		throw new RangeError(`Invalid clock instant: ${String(at)}`);
	}
	return ms;
}

/**
 * A clock stopped at `at`. It moves only through `set()` and `advance()`.
 *
 * @throws RangeError when `at` is not a valid instant
 *
 * @example
 * ```typescript
 * const clock = fixedClock('2026-01-01T00:00:00Z');
 * clock.now(); // 1767225600000
 * clock.advance(1000);
 * ```
 */
export function fixedClock(at: ClockInstant = 0): ManualClock {
	let current = toEpochMs(at);
	return {
		now: () => current,
		set(next) {
			current = toEpochMs(next);
		},
		advance(ms) {
			if (!Number.isFinite(ms)) throw new RangeError(`Invalid clock advance: ${String(ms)}`);
			current += ms;
		},
	};
}

/** FNV-1a (32-bit) over the UTF-8 bytes of `text`. */
function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(text)) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

/**
 * A reproducible random source: the same seed always gives the same sequence.
 *
 * The generator is mulberry32, seeded with the FNV-1a (32-bit) hash of the seed's UTF-8
 * bytes. It is fast and well distributed, and not suitable for secrets: use
 * `crypto.getRandomValues()` for tokens and keys.
 *
 * @example
 * ```typescript
 * const random = seededRandom('abc');
 * random.next(); // the same value on every run
 * ```
 */
export function seededRandom(seed: string): RandomSource {
	let state = fnv1a(seed);
	return {
		seed,
		next() {
			state = (state + 0x6d2b79f5) >>> 0;
			let t = state;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		},
	};
}
