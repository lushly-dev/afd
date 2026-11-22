/**
 * `journal-order.ts`'s rule (#1936), on its own: a top-level read from outside the kernel that read an instance's store
 * after a write to it was issued waits for that write's entry; nothing else waits, so the kernel's own work after a
 * handler is never held by the reads it starts, and a read that read before the write journals where it ends.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { createJournalOrder, RECORDED_ANSWER, RECORDED_AUTONOMY } from './journal-order.js';

const ok: CommandResult = { success: true, data: {} };
const tick = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Options {
	mutation?: boolean;
	top?: boolean;
	external?: boolean;
	name?: string;
	signal?: AbortSignal;
	/** The handler, given its store's order. */
	handler?: (store: { read(): void; wrote(): void }) => Promise<void>;
	/** The chain's work after the handler: the gates, the scope middleware, the write-through. */
	after?: () => Promise<void>;
}

/** Calls through `turn`, then `handler`, around a handler, as the kernel's chain runs them. */
function harness(replaying = false) {
	const order = createJournalOrder(
		(name) => name !== 'unjournaled',
		() => replaying
	);
	const log: string[] = [];
	async function call(traceId: string, options: Options = {}): Promise<CommandResult> {
		const { mutation = false, top = true, external = true, name = 'book-list' } = options;
		order.begin(traceId, mutation, top ? {} : { parent: 'outer' }, !external);
		const context = {
			traceId,
			...(options.signal ? { signal: options.signal } : {}),
		} as CommandContext;
		const store = order.store(traceId, 'book');
		try {
			const result = await order.turn(name, {}, context, async () => {
				const inner = await order.handler(name, {}, context, async () => {
					await options.handler?.(store);
					return ok;
				});
				await options.after?.();
				return inner;
			});
			log.push(traceId);
			order.appended(traceId);
			return result;
		} finally {
			order.end(traceId);
		}
	}
	return { order, log, call };
}

describe('journal-order (#1936)', () => {
	it('holds a read that read after a write was issued until the write is journaled', async () => {
		const { log, call } = harness();
		let read: Promise<unknown> | undefined;
		await call('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => {
				store.wrote();
				read = call('r', { handler: async (own) => own.read() });
			},
			after: tick,
		});
		await read;
		expect(log).toEqual(['w', 'r']);
	});

	it('holds one that read on a later tick too, after the handler returned (Astra 1)', async () => {
		const { log, call } = harness();
		let read: Promise<unknown> | undefined;
		await call('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => {
				store.wrote();
				setTimeout(() => {
					read = call('r', { handler: async (own) => own.read() });
				}, 0);
			},
			after: () => tick(10),
		});
		await tick(15);
		await read;
		expect(log).toEqual(['w', 'r']);
	});

	it('never holds a read that read before the write was issued (Opus 1)', async () => {
		const { log, call } = harness();
		let read: Promise<unknown> | undefined;
		await call('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => {
				// Told before it writes: the read lists first, then takes a while.
				read = call('r', {
					handler: async (own) => {
						own.read();
						await tick(15);
					},
				});
				await tick(1);
				store.wrote();
			},
			after: tick,
		});
		await read;
		expect(log).toEqual(['w', 'r']);
		const { log: second, call: again } = harness();
		const slowWrite = again('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => {
				await tick(1);
				store.wrote();
			},
			after: () => tick(20),
		});
		const early = again('r', { handler: async (own) => own.read() });
		await Promise.all([slowWrite, early]);
		expect(second).toEqual(['r', 'w']);
	});

	it('never holds a write, a nested call, the kernel’s own call or an unjournaled read', async () => {
		const { log, call } = harness();
		const started: Promise<unknown>[] = [];
		const write = call('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => {
				store.wrote();
				const reads = async (own: { read(): void }) => own.read();
				started.push(call('w2', { mutation: true, name: 'book-sign', handler: reads }));
				started.push(call('n', { top: false, handler: reads }));
				started.push(call('k', { external: false, handler: reads }));
				started.push(call('u', { name: 'unjournaled', handler: reads }));
			},
			after: () => tick(10),
		});
		await Promise.all([write, ...started]);
		expect(log.at(-1)).toBe('w');
	});

	it('never holds the kernel’s own read that the write’s work after its handler starts and waits for', async () => {
		const { log, call } = harness();
		await call('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => store.wrote(),
			after: async () => {
				await call('settle-read', { external: false, handler: async (own) => own.read() });
			},
		});
		expect(log).toEqual(['settle-read', 'w']);
	});

	it('releases a read when the write ends with no entry, and when the read is aborted', async () => {
		const { order, call } = harness();
		order.begin('w', true, {}, false);
		order.store('w', 'book').wrote();
		const waiting = call('r', { handler: async (own) => own.read() });
		await tick();
		order.end('w');
		await expect(waiting).resolves.toBe(ok);
		const { order: held, call: again } = harness();
		held.begin('w', true, {}, false);
		held.store('w', 'book').wrote();
		const controller = new AbortController();
		const read = again('r', { signal: controller.signal, handler: async (own) => own.read() });
		controller.abort();
		await expect(read).resolves.toBe(ok);
	});

	it('clears a forged autonomy, and hands a replay’s to the gate by symbol alone', async () => {
		for (const replaying of [false, true]) {
			const { order } = harness(replaying);
			order.begin('x', false, {}, false);
			const context = { traceId: 'x', autonomy: 'act' } as unknown as CommandContext;
			let seen: unknown;
			await order.turn('book-list', {}, context, async () => {
				seen = {
					field: (context as { autonomy?: unknown }).autonomy,
					symbol: (context as Record<symbol, unknown>)[RECORDED_AUTONOMY],
				};
				return ok;
			});
			expect(seen).toEqual({ field: undefined, symbol: replaying ? 'act' : undefined });
		}
	});

	it('answers the handler from the record for a call the replay marks, running nothing', async () => {
		const { order } = harness(true);
		const result: CommandResult = { success: true, data: { files: ['a.txt'] } };
		const answer = { result, answered: false };
		const context = { traceId: 'x', [RECORDED_ANSWER]: answer } as unknown as CommandContext;
		let ran = false;
		const answered = await order.handler('work-files-read', {}, context, async () => {
			ran = true;
			return ok;
		});
		expect(ran).toBe(false);
		expect(answer.answered).toBe(true);
		expect(answered).toEqual(result);
		expect(answered).not.toBe(result);
	});
});
