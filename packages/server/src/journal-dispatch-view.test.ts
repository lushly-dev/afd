/**
 * Each call's clock and random source are its own (`spec/journal.md`, #2890): recording a call,
 * or keeping one off tape, never changes what a concurrent call on the same context object reads.
 * Mirrors `python/tests/test_journal_secret.py`'s "Concurrent calls on one context".
 *
 * Every engine in this package gives each dispatch its own context, so these run a chain composed
 * by hand on one context object, where the declaration of `secret` cannot be read: a journal
 * without `redact` keeps every call off tape, and one with `redact` records each call on its own.
 */

import {
	type CommandContext,
	type CommandMiddleware,
	type CommandResult,
	createContextDigest,
	fixedClock,
	MemoryJournalSink,
	type RandomSource,
	success,
} from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJournalMiddleware } from './journal.js';
import { hasDispatchViews } from './journal-view.js';
import { composeMiddleware } from './middleware.js';

/** 0.26, 0.27, ...: each read's value names its turn. */
function countingRandom(): RandomSource & { draws: () => number } {
	let draws = 0;
	return {
		next: () => Number((0.25 + 0.01 * ++draws).toFixed(2)),
		draws: () => draws,
	};
}

/** A gate one call opens and another waits on. */
function gate() {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { open, opened };
}

/** Run `handler` as `name` through `chain` on `context`, as a hand-composed engine does. */
function run(
	chain: CommandMiddleware,
	name: string,
	context: CommandContext,
	handler: () => Promise<CommandResult>
) {
	return chain(name, {}, context, handler);
}

/** Records every call: the declaration cannot be read here, so `redact` keeps it. */
const keepAll = { redact: (record: unknown) => record } as never;

describe('concurrent calls on one context (#2890)', () => {
	it('runs where each dispatch can have its own view', () => {
		expect(hasDispatchViews).toBe(true);
	});

	it('puts an off-tape call’s values on no sibling’s tape when the sibling starts recording after it', async () => {
		const random = countingRandom();
		const context: CommandContext = { random };
		const recorded = new MemoryJournalSink();
		const offTape = composeMiddleware(createJournalMiddleware(new MemoryJournalSink()));
		const recording = composeMiddleware(createJournalMiddleware(recorded, keepAll));
		const started = gate();
		const minted = gate();

		await Promise.all([
			run(offTape, 'token-mint', context, async () => {
				await started.opened;
				const token = `T-${context.random?.next()}`;
				minted.open();
				return success({ token });
			}),
			run(recording, 'dice-roll', context, async () => {
				started.open();
				await minted.opened;
				return success({ value: context.random?.next() });
			}),
		]);

		const [entry] = await recorded.read();
		expect(entry?.command).toBe('dice-roll');
		// Only the sibling's own read: the off-tape call's 0.26 reached no tape.
		expect(entry?.tape?.random).toEqual([0.27]);
		expect(entry?.tape?.truncated).toBeUndefined();
		expect(context.random).toBe(random);
	});

	it('leaves a recording sibling’s tape whole when an off-tape call starts beside it', async () => {
		const random = countingRandom();
		const context: CommandContext = { random };
		const recorded = new MemoryJournalSink();
		const offTape = composeMiddleware(createJournalMiddleware(new MemoryJournalSink()));
		const recording = composeMiddleware(createJournalMiddleware(recorded, keepAll));
		const started = gate();
		const minting = gate();
		const rolled = gate();

		await Promise.all([
			run(recording, 'dice-roll', context, async () => {
				const first = context.random?.next();
				started.open();
				await minting.opened;
				const second = context.random?.next();
				rolled.open();
				return success({ values: [first, second] });
			}),
			run(offTape, 'token-mint', context, async () => {
				await started.opened;
				minting.open();
				await rolled.opened;
				return success({ token: `T-${context.random?.next()}` });
			}),
		]);

		const [entry] = await recorded.read();
		expect(entry?.tape?.random).toEqual([0.26, 0.27]);
		expect(entry?.tape?.truncated).toBeUndefined();
		// Neither call leaves the other's source on the shared context.
		expect(context.random).toBe(random);
	});

	it('records each of two concurrent calls’ reads on its own entry only', async () => {
		const random = countingRandom();
		const context: CommandContext = { random };
		const sink = new MemoryJournalSink();
		const chain = composeMiddleware(createJournalMiddleware(sink, keepAll));
		const first = gate();
		const second = gate();

		await Promise.all([
			run(chain, 'dice-a', context, async () => {
				const a = context.random?.next();
				first.open();
				await second.opened;
				return success({ values: [a, context.random?.next()] });
			}),
			run(chain, 'dice-b', context, async () => {
				await first.opened;
				const b = context.random?.next();
				second.open();
				return success({ value: b });
			}),
		]);

		const tapes = Object.fromEntries(
			(await sink.read()).map((entry) => [entry.command, entry.tape?.random])
		);
		expect(tapes).toEqual({ 'dice-a': [0.26, 0.28], 'dice-b': [0.27] });
		expect(context.random).toBe(random);
	});

	it('gives concurrent nested calls in a recorded parent their own sources', async () => {
		const random = countingRandom();
		const context: CommandContext = { random };
		const parent = new MemoryJournalSink();
		const children = new MemoryJournalSink();
		const outer = composeMiddleware(createJournalMiddleware(parent, keepAll));
		const offTape = composeMiddleware(createJournalMiddleware(new MemoryJournalSink()));
		const recording = composeMiddleware(createJournalMiddleware(children, keepAll));
		const started = gate();
		const minted = gate();

		await run(outer, 'session-open', context, async () => {
			await Promise.all([
				run(offTape, 'token-mint', context, async () => {
					await started.opened;
					const token = `T-${context.random?.next()}`;
					minted.open();
					return success({ token });
				}),
				run(recording, 'dice-roll', context, async () => {
					started.open();
					await minted.opened;
					return success({ value: context.random?.next() });
				}),
			]);
			return success({ opened: true });
		});

		const [roll] = await children.read();
		const [session] = await parent.read();
		expect(roll?.command).toBe('dice-roll');
		// Each recorder runs its own call off its parent's tape first, then records it.
		expect(roll?.tape?.random).toEqual([0.27]);
		// The parent's tape holds no child's read and says it is missing them.
		expect(session?.tape?.random).toEqual([]);
		expect(session?.tape?.truncated).toBe(true);
		expect(random.draws()).toBe(2);
		expect(context.random).toBe(random);
	});

	it('lets a sibling with no source take its own default while a call records', async () => {
		const context: CommandContext = {};
		const chain = composeMiddleware(createJournalMiddleware(new MemoryJournalSink(), keepAll));
		const recording = gate();
		const looked = gate();
		let seen: unknown = 'unread';
		await Promise.all([
			run(chain, 'dice-roll', context, async () => {
				recording.open();
				await looked.opened;
				return success({ value: context.random?.next() });
			}),
			(async () => {
				await recording.opened;
				seen = context.clock;
				looked.open();
			})(),
		]);
		expect(seen).toBeUndefined();
		// And the context is left as it was.
		expect(Object.hasOwn(context, 'clock')).toBe(false);
		expect(Object.hasOwn(context, 'random')).toBe(false);
	});

	it('gives a sibling its own source, with everything it has, while a call records', async () => {
		const clock = fixedClock(7);
		const context: CommandContext = { clock };
		const chain = composeMiddleware(createJournalMiddleware(new MemoryJournalSink(), keepAll));
		const recording = gate();
		const looked = gate();
		let seen: unknown;
		await Promise.all([
			run(chain, 'clock-read', context, async () => {
				recording.open();
				await looked.opened;
				return success({ at: context.clock?.now() });
			}),
			(async () => {
				await recording.opened;
				seen = context.clock;
				looked.open();
			})(),
		]);
		expect(seen).toBe(clock);
		expect(context.clock).toBe(clock);
		expect(Object.getOwnPropertyDescriptor(context, 'clock')).toMatchObject({
			value: clock,
			writable: true,
		});
	});

	it('marks a recording’s tape when its source is replaced on the context while it runs', async () => {
		const context: CommandContext = { clock: fixedClock(1) };
		const sink = new MemoryJournalSink();
		const chain = composeMiddleware(createJournalMiddleware(sink, keepAll));
		const replacement = fixedClock(2);
		await run(chain, 'clock-read', context, async () => {
			const first = context.clock?.now();
			context.clock = replacement;
			return success({ at: [first, context.clock?.now()] });
		});
		const [entry] = await sink.read();
		expect(entry?.tape?.clock).toEqual([1]);
		expect(entry?.tape?.truncated).toBe(true);
		// The replacement stays: whoever assigned it meant every later call.
		expect(context.clock).toBe(replacement);
	});

	it('carries plain sources, never the view, into a spread of the context', async () => {
		const random = countingRandom();
		const context: CommandContext = { random };
		const sink = new MemoryJournalSink();
		const chain = composeMiddleware(createJournalMiddleware(sink, keepAll));
		let copied: CommandContext | undefined;
		await run(chain, 'dice-roll', context, async () => {
			copied = { ...context };
			return success({ value: copied.random?.next() });
		});
		expect(Object.getOwnPropertyDescriptor(copied, 'random')?.get).toBeUndefined();
		const [entry] = await sink.read();
		// The copy's reads are the recorded call's own, as the engine's nested calls are.
		expect(entry?.tape?.random).toEqual([0.26]);
	});

	it('keeps an off-tape call’s read through work its recorded parent started off the parent’s tape', async () => {
		const random = countingRandom();
		const context: CommandContext = { random };
		const parent = new MemoryJournalSink();
		const outer = composeMiddleware(createJournalMiddleware(parent, keepAll));
		const offTape = composeMiddleware(createJournalMiddleware(new MemoryJournalSink()));
		await run(outer, 'session-open', context, async () => {
			// A worker the parent starts, in the parent's dispatch, that reads for whoever asks.
			const requests: Array<(value: number | undefined) => void> = [];
			let stop = false;
			const worker = (async () => {
				while (!stop) {
					const reply = requests.shift();
					if (reply) reply(context.random?.next());
					await new Promise((resolve) => setImmediate(resolve));
				}
			})();
			await run(offTape, 'token-mint', context, async () => {
				const value = await new Promise<number | undefined>((resolve) => requests.push(resolve));
				return success({ token: `T-${value}` });
			});
			stop = true;
			await worker;
			return success({ opened: true });
		});
		const [session] = await parent.read();
		expect(session?.tape?.random).toEqual([]);
		expect(session?.tape?.truncated).toBe(true);
		expect(random.draws()).toBe(1);
	});

	it('keeps a second secret call on one context off its recorded parent’s tape too', async () => {
		const random = countingRandom();
		const context: CommandContext = { random };
		const parent = new MemoryJournalSink();
		const outer = composeMiddleware(createJournalMiddleware(parent, keepAll));
		const offTape = composeMiddleware(createJournalMiddleware(new MemoryJournalSink()));
		await run(outer, 'session-open', context, async () => {
			for (let at = 0; at < 2; at++) {
				await run(offTape, 'token-mint', context, async () =>
					success({ token: `T-${context.random?.next()}` })
				);
			}
			return success({ opened: true });
		});
		const [session] = await parent.read();
		expect(session?.tape?.random).toEqual([]);
		expect(session?.tape?.truncated).toBe(true);
	});

	it('leaves no recorder on the context when a journal inside it assigns its sources instead', async () => {
		const random = countingRandom();
		const context: CommandContext = { random };
		const sink = new MemoryJournalSink();
		const outer = composeMiddleware(createJournalMiddleware(sink, keepAll));
		// As a copy of afd-server from before #2890 does: swap, then write back what it read.
		const assigning: CommandMiddleware = async (_name, _input, ctx, next) => {
			const saved = ctx.random;
			ctx.random = { next: () => saved?.next() ?? 0 };
			try {
				return await next();
			} finally {
				ctx.random = saved;
			}
		};
		await run(outer, 'dice-roll', context, () =>
			assigning('dice-roll', {}, context, async () => success({ value: context.random?.next() }))
		);
		expect(context.random).toBe(random);
		const [entry] = await sink.read();
		expect(entry?.tape?.truncated).toBe(true);
	});

	it('keeps overlapping off-tape children off their recorded parent’s tape for their whole length', async () => {
		const random = countingRandom();
		const context: CommandContext = { random };
		const parent = new MemoryJournalSink();
		const outer = composeMiddleware(createJournalMiddleware(parent, keepAll));
		const offTape = composeMiddleware(createJournalMiddleware(new MemoryJournalSink()));
		const firstStarted = gate();
		const firstDone = gate();
		await run(outer, 'session-open', context, async () => {
			await Promise.all([
				run(offTape, 'token-mint', context, async () => {
					firstStarted.open();
					return success({ token: `T-${context.random?.next()}` });
				}).then(firstDone.open),
				run(offTape, 'key-mint', context, async () => {
					await firstStarted.opened;
					await firstDone.opened;
					// The first child has ended; this one still reads off tape.
					return success({ key: `K-${context.random?.next()}` });
				}),
			]);
			return success({ opened: true });
		});
		const [session] = await parent.read();
		expect(session?.tape?.random).toEqual([]);
		expect(session?.tape?.truncated).toBe(true);
		expect(random.draws()).toBe(2);
	});

	it('keeps a getter-backed source live for other readers while a call records', async () => {
		let backing = fixedClock(1);
		const context = {} as CommandContext;
		Object.defineProperty(context, 'clock', {
			configurable: true,
			enumerable: true,
			get: () => backing,
		});
		const chain = composeMiddleware(createJournalMiddleware(new MemoryJournalSink(), keepAll));
		const recording = gate();
		const looked = gate();
		let seen: number | undefined;
		await Promise.all([
			run(chain, 'clock-read', context, async () => {
				recording.open();
				await looked.opened;
				return success({ at: context.clock?.now() });
			}),
			(async () => {
				await recording.opened;
				backing = fixedClock(3);
				seen = context.clock?.now();
				looked.open();
			})(),
		]);
		expect(seen).toBe(3);
		expect(Object.getOwnPropertyDescriptor(context, 'clock')?.get).toBeTypeOf('function');
		expect(context.clock?.now()).toBe(3);
	});

	it('swaps both sources on a context that refuses a view on one', async () => {
		const clock = fixedClock(1);
		const random = countingRandom();
		const context = { clock } as CommandContext;
		Object.defineProperty(context, 'random', { value: random, writable: true, enumerable: true });
		const sink = new MemoryJournalSink();
		const chain = composeMiddleware(createJournalMiddleware(sink, keepAll));
		await run(chain, 'dice-roll', context, async () =>
			success({ value: context.random?.next(), at: context.clock?.now() })
		);
		const [entry] = await sink.read();
		expect(entry?.tape).toMatchObject({ clock: [1], random: [0.26] });
		expect(Object.getOwnPropertyDescriptor(context, 'clock')).toMatchObject({ value: clock });
		expect(context.random).toBe(random);
	});

	it('leaves no view behind on a context that refuses both a view and an assignment', async () => {
		const clock = fixedClock(1);
		const context = { clock } as CommandContext;
		Object.defineProperty(context, 'random', { value: countingRandom(), enumerable: true });
		const chain = composeMiddleware(createJournalMiddleware(new MemoryJournalSink(), keepAll));
		await expect(
			run(chain, 'dice-roll', context, async () => success({ value: context.random?.next() }))
		).rejects.toThrow(TypeError);
		expect(Object.getOwnPropertyDescriptor(context, 'clock')).toMatchObject({
			value: clock,
			writable: true,
		});
	});

	it('records on a sealed context as before', async () => {
		const random = countingRandom();
		const context: CommandContext = Object.seal({ random, clock: fixedClock(1) });
		const sink = new MemoryJournalSink();
		const chain = composeMiddleware(createJournalMiddleware(sink, keepAll));
		await run(chain, 'dice-roll', context, async () => success({ value: context.random?.next() }));
		const [entry] = await sink.read();
		expect(entry?.tape?.random).toEqual([0.26]);
		expect(context.random).toBe(random);
	});

	it('hashes the context it was given, inherited fields included', async () => {
		const context: CommandContext = Object.assign(
			Object.create({ interface: 'cli', traceId: 't1' }),
			{ clock: fixedClock(1), random: countingRandom() }
		);
		const sink = new MemoryJournalSink();
		const chain = composeMiddleware(createJournalMiddleware(sink, keepAll));
		await run(chain, 'clock-read', context, async () => success({ at: context.clock?.now() }));
		const [entry] = await sink.read();
		expect(entry?.contextDigest).toEqual(await createContextDigest(context));
		expect(entry?.contextDigest.interface).toBe('cli');
	});

	it('leaves a concurrent recording whole, and records, when the context’s sources are accessors', async () => {
		const random = countingRandom();
		const context = {} as CommandContext;
		Object.defineProperty(context, 'random', {
			configurable: true,
			enumerable: true,
			get: () => random,
		});
		const sink = new MemoryJournalSink();
		const chain = composeMiddleware(createJournalMiddleware(sink, keepAll));
		const shortDone = gate();
		await Promise.all([
			run(chain, 'dice-long', context, async () => {
				await shortDone.opened;
				return success({ value: context.random?.next() });
			}),
			run(chain, 'dice-short', context, async () => success({})).then(shortDone.open),
		]);
		const tapes = Object.fromEntries(
			(await sink.read()).map((entry) => [entry.command, entry.tape])
		);
		expect(tapes['dice-long']).toEqual({ clock: expect.any(Array), random: [0.26] });
		expect(Object.keys(tapes).sort()).toEqual(['dice-long', 'dice-short']);
	});

	it('runs an off-tape call with no tape around it on a frozen context', async () => {
		const context: CommandContext = Object.freeze({ clock: fixedClock(1) });
		const offTape = composeMiddleware(createJournalMiddleware(new MemoryJournalSink()));
		const result = await run(offTape, 'token-mint', context, async () =>
			success({ at: context.clock?.now() })
		);
		expect(result).toMatchObject({ success: true, data: { at: 1 } });
	});

	it('takes back a source it added when the swap fails part way', async () => {
		const context = Object.create({ clock: fixedClock(9) }) as CommandContext;
		Object.defineProperty(context, 'random', { value: countingRandom(), enumerable: true });
		const chain = composeMiddleware(createJournalMiddleware(new MemoryJournalSink(), keepAll));
		await expect(
			run(chain, 'dice-roll', context, async () => success({ value: context.random?.next() }))
		).rejects.toThrow(TypeError);
		expect(Object.hasOwn(context, 'clock')).toBe(false);
		expect(context.clock?.now()).toBe(9);
	});

	it('assigns through an inherited setter when a handler replaces a source', async () => {
		const assigned: unknown[] = [];
		let held = fixedClock(1);
		const proto = {
			get clock() {
				return held;
			},
			set clock(value) {
				assigned.push(value);
				held = value;
			},
		};
		const context = Object.create(proto) as CommandContext;
		const chain = composeMiddleware(createJournalMiddleware(new MemoryJournalSink(), keepAll));
		const replacement = fixedClock(2);
		await run(chain, 'clock-set', context, async () => {
			context.clock = replacement;
			return success({});
		});
		expect(assigned).toEqual([replacement]);
		expect(Object.hasOwn(context, 'clock')).toBe(false);
		expect(context.clock).toBe(replacement);
	});

	it('puts back an inherited setter’s source when the swap fails part way', async () => {
		let held = fixedClock(9);
		const context = Object.create({
			get clock() {
				return held;
			},
			set clock(value) {
				held = value;
			},
		}) as CommandContext;
		const original = held;
		Object.defineProperty(context, 'random', { value: countingRandom(), enumerable: true });
		Object.preventExtensions(context);
		const chain = composeMiddleware(createJournalMiddleware(new MemoryJournalSink(), keepAll));
		await expect(
			run(chain, 'dice-roll', context, async () => success({ value: context.random?.next() }))
		).rejects.toThrow(TypeError);
		expect(held).toBe(original);
	});

	it('leaves no recorder behind an inherited setter when a journal inside assigns its sources', async () => {
		const random = countingRandom();
		let held: RandomSource | undefined = random;
		const context = Object.create({
			get random() {
				return held;
			},
			set random(value) {
				held = value;
			},
		}) as CommandContext;
		const outer = composeMiddleware(createJournalMiddleware(new MemoryJournalSink(), keepAll));
		const assigning: CommandMiddleware = async (_name, _input, ctx, next) => {
			const saved = ctx.random;
			ctx.random = { next: () => saved?.next() ?? 0 };
			try {
				return await next();
			} finally {
				ctx.random = saved;
			}
		};
		await run(outer, 'dice-roll', context, () =>
			assigning('dice-roll', {}, context, async () => success({ value: context.random?.next() }))
		);
		expect(held).toBe(random);
	});

	describe('across two separately loaded copies of afd-server', () => {
		afterEach(() => {
			vi.resetModules();
		});

		async function secondCopy() {
			vi.resetModules();
			const journal = await import('./journal.js');
			const middleware = await import('./middleware.js');
			return { journal, middleware };
		}

		it('keeps one copy’s off-tape nested call off the other’s recording parent', async () => {
			const other = await secondCopy();
			const random = countingRandom();
			const context: CommandContext = { random };
			const parent = new MemoryJournalSink();
			const outer = composeMiddleware(createJournalMiddleware(parent, keepAll));
			const offTape = other.middleware.composeMiddleware(
				other.journal.createJournalMiddleware(new MemoryJournalSink())
			);
			await run(outer, 'session-open', context, async () => {
				const child = { ...context };
				await run(offTape, 'token-mint', child, async () =>
					success({ token: `T-${child.random?.next()}` })
				);
				return success({ opened: true });
			});
			const [session] = await parent.read();
			expect(session?.tape?.random).toEqual([]);
			expect(session?.tape?.truncated).toBe(true);
		});

		it('leaves one copy’s recording whole beside the other’s off-tape call on one context', async () => {
			const other = await secondCopy();
			const random = countingRandom();
			const context: CommandContext = { random };
			const recorded = new MemoryJournalSink();
			const recording = composeMiddleware(createJournalMiddleware(recorded, keepAll));
			const offTape = other.middleware.composeMiddleware(
				other.journal.createJournalMiddleware(new MemoryJournalSink())
			);
			const started = gate();
			const minting = gate();
			const rolled = gate();
			await Promise.all([
				run(recording, 'dice-roll', context, async () => {
					const first = context.random?.next();
					started.open();
					await minting.opened;
					const second = context.random?.next();
					rolled.open();
					return success({ values: [first, second] });
				}),
				run(offTape, 'token-mint', context, async () => {
					await started.opened;
					minting.open();
					await rolled.opened;
					return success({ token: `T-${context.random?.next()}` });
				}),
			]);
			const [entry] = await recorded.read();
			expect(entry?.tape?.random).toEqual([0.26, 0.27]);
			expect(entry?.tape?.truncated).toBeUndefined();
			expect(context.random).toBe(random);
		});
	});
});

describe('without AsyncLocalStorage (a browser)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('records a call by setting its sources for the length of the call, as before', async () => {
		vi.stubGlobal('process', { ...process, getBuiltinModule: undefined });
		vi.resetModules();
		const view = await import('./journal-view.js');
		const journal = await import('./journal.js');
		const middleware = await import('./middleware.js');
		expect(view.hasDispatchViews).toBe(false);

		const random = countingRandom();
		const context: CommandContext = { random };
		const sink = new MemoryJournalSink();
		const chain = middleware.composeMiddleware(journal.createJournalMiddleware(sink, keepAll));
		await run(chain, 'dice-roll', context, async () => success({ value: context.random?.next() }));
		const [entry] = await sink.read();
		expect(entry?.tape?.random).toEqual([0.26]);
		expect(context.random).toBe(random);
	});
});
