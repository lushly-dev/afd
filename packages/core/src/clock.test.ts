import { describe, expect, it, vi } from 'vitest';
import { fixedClock, seededRandom, systemClock, systemRandom } from './clock.js';

describe('systemClock and systemRandom', () => {
	it('read Date.now() and Math.random()', () => {
		const now = vi.spyOn(Date, 'now').mockReturnValue(42);
		const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
		try {
			expect(systemClock.now()).toBe(42);
			expect(systemRandom.next()).toBe(0.25);
			expect(systemRandom.seed).toBeUndefined();
		} finally {
			now.mockRestore();
			random.mockRestore();
		}
	});
});

describe('fixedClock', () => {
	it('stays at the given instant until moved', () => {
		const clock = fixedClock('2026-01-01T00:00:00Z');
		expect(clock.now()).toBe(Date.UTC(2026, 0, 1));
		expect(clock.now()).toBe(Date.UTC(2026, 0, 1));
	});

	it('accepts epoch milliseconds, ISO strings and Dates, and defaults to the epoch', () => {
		expect(fixedClock().now()).toBe(0);
		expect(fixedClock(1234).now()).toBe(1234);
		expect(fixedClock(new Date(5678)).now()).toBe(5678);
	});

	it('moves with advance() and set()', () => {
		const clock = fixedClock(1000);
		clock.advance(500);
		expect(clock.now()).toBe(1500);
		clock.advance(-1500);
		expect(clock.now()).toBe(0);
		clock.set('1970-01-01T00:00:01.000Z');
		expect(clock.now()).toBe(1000);
	});

	it('rejects invalid instants and advances', () => {
		expect(() => fixedClock('not a date')).toThrow(RangeError);
		expect(() => fixedClock(Number.NaN)).toThrow(RangeError);
		const clock = fixedClock();
		expect(() => clock.set(new Date(Number.NaN))).toThrow(RangeError);
		expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
		expect(clock.now()).toBe(0);
	});
});

describe('seededRandom', () => {
	it('produces a fixed sequence for a seed (mulberry32 over FNV-1a of the UTF-8 seed)', () => {
		// Golden values: other language implementations must produce the same sequence.
		const random = seededRandom('abc');
		expect(random.seed).toBe('abc');
		expect([random.next(), random.next(), random.next()]).toEqual([
			0.5166419988963753, 0.6596221292857081, 0.0018796597141772509,
		]);
		expect(seededRandom('').next()).toBe(0.6112444521859288);
	});

	it('repeats for the same seed and differs between seeds', () => {
		const sequence = (seed: string) => {
			const random = seededRandom(seed);
			return Array.from({ length: 20 }, () => random.next());
		};
		expect(sequence('replay-1')).toEqual(sequence('replay-1'));
		expect(sequence('replay-1')).not.toEqual(sequence('replay-2'));
		expect(sequence('é')).not.toEqual(sequence('e'));
	});

	it('stays in [0, 1)', () => {
		const random = seededRandom('range');
		for (let i = 0; i < 10_000; i++) {
			const value = random.next();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});
});
