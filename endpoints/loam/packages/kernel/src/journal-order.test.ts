/**
 * `journal-order.ts`'s rules (#1936, #2117), on their own: RAW waits for pending writes, WAR waits for earlier pending
 * reads, cycle freedom breaks back-edges across `waitsOn` and `origin`/`parent` execution waits, `suspend()` drops
 * pre-wait reads and stale WAR edges during human slot waits, and `track` begins/ends hosted MCP calls.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { createJournalOrder, RECORDED_ANSWER, RECORDED_AUTONOMY } from './journal-order.js';

const ok: CommandResult = { success: true, data: {} };
const tick = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

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
		order.begin(traceId, mutation, top ? {} : { parent: 'outer' }, !external, name);
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
		const readIssued = deferred();
		let read: Promise<unknown> | undefined;
		await call('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => {
				store.wrote();
				setTimeout(() => {
					read = call('r', {
						handler: async (own) => {
							own.read();
							readIssued.resolve();
						},
					});
				}, 0);
			},
			after: async () => {
				await readIssued.promise;
				await tick();
			},
		});
		await read;
		expect(log).toEqual(['w', 'r']);
	});

	it('holds a write for an earlier read of the same resource so the read journals first (#2117 WAR, #1045)', async () => {
		const { log, call } = harness();
		const readIssued = deferred();
		const releaseRead = deferred();
		const writeDoneAfter = deferred();
		let read: Promise<unknown> | undefined;
		const write = call('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => {
				// The read lists first, then stays open past the write's handler and after-work.
				read = call('r', {
					handler: async (own) => {
						own.read();
						readIssued.resolve();
						await releaseRead.promise;
					},
				});
				await readIssued.promise;
				store.wrote();
			},
			after: async () => {
				writeDoneAfter.resolve();
			},
		});
		await writeDoneAfter.promise;
		await tick();
		// WAR holds w until r journals, even though w's handler and after-work finished first.
		expect(log).toEqual([]);
		releaseRead.resolve();
		await Promise.all([write, read]);
		expect(log).toEqual(['r', 'w']);
		// And an early read that finishes quickly is never held by a slow later write.
		const { log: second, call: again } = harness();
		const earlyRead = deferred();
		const writeIssued = deferred();
		const releaseWrite = deferred();
		const slowWrite = again('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => {
				await earlyRead.promise;
				store.wrote();
				writeIssued.resolve();
			},
			after: () => releaseWrite.promise,
		});
		const early = again('r', {
			handler: async (own) => {
				own.read();
				earlyRead.resolve();
				await writeIssued.promise;
			},
		});
		await early;
		releaseWrite.resolve();
		await slowWrite;
		expect(second).toEqual(['r', 'w']);
	});

	it('orders two concurrent writes to the same instance and breaks cycles safely (#1045)', async () => {
		const { log, call } = harness();
		let secondWrite: Promise<unknown> | undefined;
		await call('w1', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => {
				store.wrote();
				secondWrite = call('w2', {
					mutation: true,
					name: 'book-sign',
					handler: async (own) => own.wrote(),
				});
			},
			after: () => tick(10),
		});
		await secondWrite;
		expect(log).toEqual(['w1', 'w2']);

		// A read that reads both before and after a write cannot deadlock (acyclic wait graph).
		const { log: cyclic, call: run } = harness();
		let read: Promise<unknown> | undefined;
		await run('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => {
				read = run('r', {
					handler: async (own) => {
						own.read();
						await tick(10);
						own.read();
					},
				});
				await tick(1);
				store.wrote();
			},
			after: tick,
		});
		await read;
		expect(cyclic).toEqual(['r', 'w']);
	});

	it('never holds a non-writing mutation, a nested call, the kernel’s own call or an unjournaled read', async () => {
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

describe('journal-order: a nested read (#2727)', () => {
	/** A top-level call `outer` whose handler runs a nested call `inner` that reads `book`. */
	async function nested(
		order: ReturnType<typeof harness>['order'],
		log: string[],
		mutation: boolean,
		during: () => Promise<void>
	): Promise<void> {
		const name = mutation ? 'book-sign' : 'document-export';
		order.begin('outer', mutation, {}, false, name);
		try {
			await order.turn(name, {}, { traceId: 'outer' } as CommandContext, async () => {
				if (mutation) order.store('outer', 'book').wrote();
				order.begin('inner', false, { parent: 'outer' }, false, 'book-list');
				try {
					await during();
					order.store('inner', 'book').read();
				} finally {
					order.end('inner');
				}
				return ok;
			});
			log.push('outer');
			order.appended('outer');
		} finally {
			order.end('outer');
		}
	}

	it('holds a top-level read whose nested call read after a write was issued until the write is journaled', async () => {
		const { order, log, call } = harness();
		let write: Promise<unknown> | undefined;
		await nested(order, log, false, async () => {
			write = call('w', {
				mutation: true,
				name: 'book-sign',
				handler: async (store) => store.wrote(),
				after: () => tick(10),
			});
			await tick();
		});
		await write;
		expect(log).toEqual(['w', 'outer']);
	});

	it('holds a later write behind a top-level read whose nested call read first (WAR)', async () => {
		const { order, log, call } = harness();
		let write: Promise<unknown> | undefined;
		order.begin('outer', false, {}, false, 'document-export');
		const outer = (async () => {
			try {
				await order.turn(
					'document-export',
					{},
					{ traceId: 'outer' } as CommandContext,
					async () => {
						order.begin('inner', false, { parent: 'outer' }, false, 'book-list');
						order.store('inner', 'book').read();
						order.end('inner');
						write = call('w', {
							mutation: true,
							name: 'book-sign',
							handler: async (store) => store.wrote(),
						});
						await tick(10);
						return ok;
					}
				);
				log.push('outer');
				order.appended('outer');
			} finally {
				order.end('outer');
			}
		})();
		await outer;
		await write;
		expect(log).toEqual(['outer', 'w']);
	});

	it('releases the top-level call’s reads when its nested call suspends, so a write during the wait is not held', async () => {
		const { order, log, call } = harness();
		let answer!: () => void;
		const answered = new Promise<void>((resolve) => {
			answer = resolve;
		});
		let suspendedNow!: () => void;
		const waiting = new Promise<void>((resolve) => {
			suspendedNow = resolve;
		});
		order.begin('outer', false, {}, false, 'document-export');
		const outer = (async () => {
			try {
				await order.turn(
					'document-export',
					{},
					{ traceId: 'outer' } as CommandContext,
					async () => {
						order.store('outer', 'book').read();
						order.begin('inner', false, { parent: 'outer' }, false, 'probe-export');
						try {
							order.store('inner', 'book').read();
							// A confirmation: it waits for a person.
							order.suspend('inner');
							suspendedNow();
							await answered;
						} finally {
							order.end('inner');
						}
						return ok;
					}
				);
				log.push('outer');
				order.appended('outer');
			} finally {
				order.end('outer');
			}
		})();
		await waiting;
		await call('w', {
			mutation: true,
			name: 'book-sign',
			handler: async (store) => store.wrote(),
		});
		expect(log).toEqual(['w']);
		answer();
		await outer;
		expect(log).toEqual(['w', 'outer']);
	});

	it('never holds a write on a nested read under a call a replay answers from its record (project-summary-get)', async () => {
		const order = createJournalOrder(
			() => true,
			() => false,
			() => false,
			(name) => name === 'project-summary-get'
		);
		const log: string[] = [];
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let read!: () => void;
		const nestedRead = new Promise<void>((resolve) => {
			read = resolve;
		});
		order.begin('outer', false, {}, false, 'project-summary-get');
		const outer = (async () => {
			try {
				await order.turn(
					'project-summary-get',
					{},
					{ traceId: 'outer' } as CommandContext,
					async () => {
						order.begin('inner', false, { parent: 'outer' }, false, 'tasks-summary');
						order.store('inner', 'book').read();
						order.end('inner');
						read();
						await held;
						return ok;
					}
				);
				log.push('outer');
				order.appended('outer');
			} finally {
				order.end('outer');
			}
		})();
		await nestedRead;
		order.begin('w', true, {}, false, 'book-sign');
		try {
			await order.turn('book-sign', {}, { traceId: 'w' } as CommandContext, async () => {
				order.store('w', 'book').wrote();
				return ok;
			});
			log.push('w');
			order.appended('w');
		} finally {
			order.end('w');
		}
		expect(log).toEqual(['w']);
		release();
		await outer;
		expect(log).toEqual(['w', 'outer']);
	});

	it('adds nothing for a nested read under a mutation, which never waits on its own write', async () => {
		const { order, log } = harness();
		await nested(order, log, true, async () => {});
		expect(log).toEqual(['outer']);
	});
});

describe('journal-order (#2117)', () => {
	it('breaks WAR/RAW cycles cleanly on single- and two-resource interleavings without deadlocking', async () => {
		// Single resource: r reads before w writes, then reads again after w writes -> w waits on r, r skips back-edge.
		const { order, log } = harness();
		const run = async (
			id: string,
			mutation: boolean,
			work: () => Promise<void>,
			afterWork?: () => Promise<void>
		) => {
			order.begin(id, mutation, {}, false, mutation ? 'book-sign' : 'book-list');
			try {
				await order.turn(
					mutation ? 'book-sign' : 'book-list',
					{},
					{ traceId: id } as CommandContext,
					async () => {
						await work();
						await afterWork?.();
						return ok;
					}
				);
				log.push(id);
				order.appended(id);
			} finally {
				order.end(id);
			}
		};
		let releaseRead!: () => void;
		const readHold = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		const readPromise = run('r', false, async () => {
			order.store('r', 'book').read();
			await readHold;
			// Second read after w has written would create r -> w while w -> r already exists.
			order.store('r', 'book').read();
		});
		const writePromise = run('w', true, async () => {
			order.store('w', 'book').wrote();
			releaseRead();
		});
		await Promise.all([readPromise, writePromise]);
		expect(log).toEqual(['r', 'w']);

		// Two resources: r reads A, w writes A (w -> r), w writes B, r reads B (cycle r -> w skipped).
		const two = harness();
		let releaseR2!: () => void;
		const holdR2 = new Promise<void>((resolve) => {
			releaseR2 = resolve;
		});
		const run2 = async (id: string, mutation: boolean, work: () => Promise<void>) => {
			two.order.begin(id, mutation, {}, false, mutation ? 'book-sign' : 'book-list');
			try {
				await two.order.turn(
					mutation ? 'book-sign' : 'book-list',
					{},
					{ traceId: id } as CommandContext,
					async () => {
						await work();
						return ok;
					}
				);
				two.log.push(id);
				two.order.appended(id);
			} finally {
				two.order.end(id);
			}
		};
		const r2 = run2('r2', false, async () => {
			two.order.store('r2', 'resA').read();
			await holdR2;
			two.order.store('r2', 'resB').read();
		});
		const w2 = run2('w2', true, async () => {
			two.order.store('w2', 'resA').wrote();
			two.order.store('w2', 'resB').wrote();
			releaseR2();
		});
		await Promise.all([r2, w2]);
		expect(two.log).toEqual(['r2', 'w2']);
	});

	it('orders origin runs behind unrelated writes, but never waits on the awaiting origin write itself', async () => {
		const { order, log } = harness();
		const run = async (
			id: string,
			mutation: boolean,
			fields: { origin?: string },
			work: () => Promise<void>,
			afterWork?: () => Promise<void>
		) => {
			order.begin(id, mutation, fields, false, mutation ? 'book-sign' : 'book-list');
			try {
				await order.turn(
					mutation ? 'book-sign' : 'book-list',
					{},
					{ traceId: id } as CommandContext,
					async () => {
						await work();
						await afterWork?.();
						return ok;
					}
				);
				log.push(id);
				order.appended(id);
			} finally {
				order.end(id);
			}
		};
		// Unrelated write finishes after an origin-run read that saw it -> origin-run waits on unrelated write.
		let originRun!: Promise<void>;
		await run(
			'unrelated-w',
			true,
			{},
			async () => {
				order.store('unrelated-w', 'book').wrote();
				originRun = run('outer', true, {}, async () => {
					order.store('outer', 'record:confirmation').wrote();
					await run('inner', false, { origin: 'outer' }, async () => {
						// Reads both unrelated-w's resource AND its own awaiting origin's resource.
						order.store('inner', 'book').read();
						order.store('inner', 'record:confirmation').read();
					});
				});
			},
			() => tick(10)
		);
		await originRun;
		// inner waits for unrelated-w, does NOT deadlock on outer, and outer finishes after inner.
		expect(log).toEqual(['unrelated-w', 'inner', 'outer']);
	});

	it('tracks calls entering through `track` middleware without `execute()` (hosted MCP)', async () => {
		const order = createJournalOrder(
			() => true,
			() => false,
			(name) => name === 'book-sign'
		);
		const log: string[] = [];
		const invoke = async (
			traceId: string,
			name: string,
			work: () => Promise<void>,
			afterWork?: () => Promise<void>
		) => {
			const context = { traceId } as CommandContext;
			await order.track(name, {}, context, async () => {
				const result = await order.turn(name, {}, context, async () => {
					await work();
					await afterWork?.();
					return ok;
				});
				log.push(traceId);
				order.appended(traceId);
				return result;
			});
		};
		let mcpRead!: Promise<void>;
		await invoke(
			'mcp-w',
			'book-sign',
			async () => {
				order.store('mcp-w', 'book').wrote();
				mcpRead = invoke('mcp-r', 'book-list', async () => {
					order.store('mcp-r', 'book').read();
				});
			},
			() => tick(10)
		);
		await mcpRead;
		expect(log).toEqual(['mcp-w', 'mcp-r']);
	});

	it('releases pre-wait reads on suspend() so writes during a slot confirmation never deadlock on WAR', async () => {
		const { order, log } = harness();
		let releaseSuspended!: () => void;
		const waiting = new Promise<void>((resolve) => {
			releaseSuspended = resolve;
		});
		order.begin('slot-r', false, {}, false, 'probe-export');
		const suspendedRead = (async () => {
			try {
				await order.turn('probe-export', {}, { traceId: 'slot-r' } as CommandContext, async () => {
					order.store('slot-r', 'record:document').read();
					order.suspend('slot-r');
					await waiting;
					return ok;
				});
				log.push('slot-r');
				order.appended('slot-r');
			} finally {
				order.end('slot-r');
			}
		})();

		order.begin('move-w', true, {}, false, 'document-move');
		try {
			await order.turn('document-move', {}, { traceId: 'move-w' } as CommandContext, async () => {
				order.store('move-w', 'record:document').wrote();
				return ok;
			});
			log.push('move-w');
			order.appended('move-w');
		} finally {
			order.end('move-w');
		}
		releaseSuspended();
		await suspendedRead;
		expect(log).toEqual(['move-w', 'slot-r']);
	});

	it('purges stale WAR edges on suspend() so a post-resume re-read still waits on an in-flight writer (#2117)', async () => {
		const { order, log } = harness();
		let releaseRead!: () => void;
		const readHold = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		let releaseWriteAppend!: () => void;
		const writeAppendHold = new Promise<void>((resolve) => {
			releaseWriteAppend = resolve;
		});
		let writeRegistered!: () => void;
		const writeReady = new Promise<void>((resolve) => {
			writeRegistered = resolve;
		});
		let readResumed!: () => void;
		const readReReadDone = new Promise<void>((resolve) => {
			readResumed = resolve;
		});

		order.begin('r', false, {}, false, 'probe-export');
		const readPromise = (async () => {
			try {
				await order.turn('probe-export', {}, { traceId: 'r' } as CommandContext, async () => {
					order.store('r', 'doc:1').read();
					// Wait until w has called wrote() and attached a WAR edge w -> r, then suspend r.
					await writeReady;
					order.suspend('r');
					await readHold;
					// After resuming, r re-reads doc:1 while w's append is still pending -> r MUST wait on w!
					order.store('r', 'doc:1').read();
					readResumed();
					return ok;
				});
				log.push('r');
				order.appended('r');
			} finally {
				order.end('r');
			}
		})();

		order.begin('w', true, {}, false, 'document-rename');
		const writePromise = (async () => {
			try {
				await order.turn('document-rename', {}, { traceId: 'w' } as CommandContext, async () => {
					order.store('w', 'doc:1').wrote();
					writeRegistered();
					await writeAppendHold;
					return ok;
				});
				log.push('w');
				order.appended('w');
			} finally {
				order.end('w');
			}
		})();

		// Let r suspend, then resume r while w has not yet appended.
		await tick(5);
		releaseRead();
		await readReReadDone;
		await tick(5);
		// r must still be waiting on w, not yet appended.
		expect(log).toEqual([]);
		releaseWriteAppend();
		await Promise.all([readPromise, writePromise]);
		expect(log).toEqual(['w', 'r']);
	});
});
