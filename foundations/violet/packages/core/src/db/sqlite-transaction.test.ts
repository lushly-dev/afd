import { afterEach, describe, expect, it } from 'vitest';
import type { Node } from '../types/node.js';
import { SQLiteDatabase } from './sqlite.js';

function makeNode(id: string): Node {
	return {
		id,
		name: id,
		type: 'theme',
		parentId: null,
		status: 'active',
		includes: [],
		includePolicy: 'merge',
		tags: [],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		deletedAt: null,
	};
}

describe('SQLiteDatabase.transaction', () => {
	let db: SQLiteDatabase | undefined;

	afterEach(() => {
		db?.close();
		db = undefined;
	});

	it('commits async callbacks and returns their resolved value (#1879)', async () => {
		db = new SQLiteDatabase(':memory:');
		const result = await db.transaction(async () => {
			await db?.createNode(makeNode('n1'));
			await Promise.resolve();
			await db?.createNode(makeNode('n2'));
			return 'committed';
		});

		expect(result).toBe('committed');
		expect(await db.getNode('n1')).not.toBeNull();
		expect(await db.getNode('n2')).not.toBeNull();
	});

	it('rolls back all writes when an async callback rejects (#1879)', async () => {
		db = new SQLiteDatabase(':memory:');
		await expect(
			db.transaction(async () => {
				await db?.createNode(makeNode('will-rollback'));
				await Promise.resolve();
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');

		expect(await db.getNode('will-rollback')).toBeNull();
	});

	it('serializes concurrent top-level transactions without interleaving (#1879)', async () => {
		db = new SQLiteDatabase(':memory:');
		const order: string[] = [];

		const tx1 = db.transaction(async () => {
			order.push('tx1:start');
			await db?.createNode(makeNode('from-tx1'));
			await new Promise((r) => setTimeout(r, 15));
			order.push('tx1:end');
			throw new Error('tx1-fail');
		});

		const tx2 = db.transaction(async () => {
			order.push('tx2:start');
			await db?.createNode(makeNode('from-tx2'));
			order.push('tx2:end');
			return 'ok';
		});

		const [r1, r2] = await Promise.allSettled([tx1, tx2]);
		expect(r1.status).toBe('rejected');
		expect(r2).toEqual({ status: 'fulfilled', value: 'ok' });
		expect(order).toEqual(['tx1:start', 'tx1:end', 'tx2:start', 'tx2:end']);
		expect(await db.getNode('from-tx1')).toBeNull();
		expect(await db.getNode('from-tx2')).not.toBeNull();
	});

	it('supports nested transactions via savepoints without deadlocking (#1879)', async () => {
		db = new SQLiteDatabase(':memory:');
		await db.transaction(async () => {
			await db?.createNode(makeNode('outer'));
			await expect(
				db?.transaction(async () => {
					await db?.createNode(makeNode('inner-failed'));
					throw new Error('inner-boom');
				}),
			).rejects.toThrow('inner-boom');
			await db?.createNode(makeNode('outer-after'));
		});

		expect(await db.getNode('outer')).not.toBeNull();
		expect(await db.getNode('inner-failed')).toBeNull();
		expect(await db.getNode('outer-after')).not.toBeNull();
	});

	it('serializes concurrent nested savepoints without invalidating siblings (#1879)', async () => {
		db = new SQLiteDatabase(':memory:');
		const results = await db.transaction(async () => {
			return Promise.all([
				db?.transaction(async () => {
					await new Promise((r) => setTimeout(r, 5));
					await db?.createNode(makeNode('sibling-a'));
					return 'a';
				}),
				db?.transaction(async () => {
					await new Promise((r) => setTimeout(r, 15));
					await db?.createNode(makeNode('sibling-b'));
					return 'b';
				}),
			]);
		});

		expect(results).toEqual(['a', 'b']);
		expect(await db.getNode('sibling-a')).not.toBeNull();
		expect(await db.getNode('sibling-b')).not.toBeNull();
	});

	it('prevents queued siblings from persisting writes after parent rolls back (#1879)', async () => {
		db = new SQLiteDatabase(':memory:');
		let siblingB!: Promise<void>;
		let siblingC!: Promise<void>;

		await expect(
			db.transaction(async () => {
				const siblingA = db?.transaction(async () => {
					await db?.createNode(makeNode('sib-a'));
					await new Promise((r) => setTimeout(r, 10));
					throw new Error('sib-a-fail');
				});
				siblingB = db
					? db.transaction(async () => {
							await new Promise((r) => setTimeout(r, 10));
							await db?.createNode(makeNode('sib-b'));
						})
					: Promise.resolve();
				siblingC = db
					? db.transaction(async () => {
							await db?.createNode(makeNode('sib-c'));
						})
					: Promise.resolve();
				await Promise.all([siblingA, siblingB, siblingC]);
			}),
		).rejects.toThrow('sib-a-fail');

		await Promise.allSettled([siblingB, siblingC]);
		expect(await db.getNode('sib-a')).toBeNull();
		expect(await db.getNode('sib-b')).toBeNull();
		expect(await db.getNode('sib-c')).toBeNull();
	});

	it('does not deadlock when an ordinary write is queued behind an active nested transaction (#1879)', async () => {
		db = new SQLiteDatabase(':memory:');
		let queuedOp!: Promise<void>;
		let childStarted!: () => void;
		const childActive = new Promise<void>((resolve) => {
			childStarted = resolve;
		});

		await expect(
			db.transaction(async () => {
				const child = db?.transaction(async () => {
					childStarted();
					await new Promise((r) => setTimeout(r, 15));
				});
				await childActive;
				// Child is now active (activeFrame === childFrame), so this parent-context op queues on childQueue.
				queuedOp = db ? db.createNode(makeNode('mixed-op')) : Promise.resolve();
				void child;
				throw new Error('parent-fail');
			}),
		).rejects.toThrow('parent-fail');

		await expect(queuedOp).rejects.toThrow('Transaction has already ended');
		expect(await db.getNode('mixed-op')).toBeNull();
	});

	it('isolates outside writes and expired async contexts from an active transaction rollback (#1879)', async () => {
		db = new SQLiteDatabase(':memory:');

		let releaseTx1!: () => void;
		const tx1Ready = new Promise<void>((resolve) => {
			releaseTx1 = resolve;
		});

		const tx1 = db.transaction(async () => {
			await db?.createNode(makeNode('tx1-row'));
			releaseTx1();
			await new Promise((r) => setTimeout(r, 20));
			throw new Error('tx1-rollback');
		});

		await tx1Ready;
		const outsiderWrite = db.createNode(makeNode('outsider-row'));

		await expect(tx1).rejects.toThrow('tx1-rollback');
		await outsiderWrite;
		expect(await db.getNode('tx1-row')).toBeNull();
		expect(await db.getNode('outsider-row')).not.toBeNull();

		// A fire-and-forget callback launched inside txA must not join a later txB after txA finishes.
		let escapedWork!: Promise<void>;
		await db.transaction(async () => {
			escapedWork = (async () => {
				await new Promise((r) => setTimeout(r, 15));
				await db?.transaction(async () => {
					await db?.createNode(makeNode('escaped-committed'));
				});
			})();
		});

		const txB = db.transaction(async () => {
			await db?.createNode(makeNode('txB-row'));
			await new Promise((r) => setTimeout(r, 30));
			throw new Error('txB-rollback');
		});

		await expect(txB).rejects.toThrow('txB-rollback');
		await escapedWork;
		expect(await db.getNode('txB-row')).toBeNull();
		expect(await db.getNode('escaped-committed')).not.toBeNull();
	});
});
