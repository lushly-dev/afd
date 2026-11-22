import { describe, expect, it } from 'vitest';
import type { NewOperationRecord } from '../types/operation.js';
import { type PostgresClient, PostgresDatabase, type PostgresQueryable } from './postgres.js';

function makeNewOp(id: string, nodeId: string, tokenId: string): NewOperationRecord {
	return {
		id,
		nodeId,
		type: 'add',
		tokenId,
		value: JSON.stringify('#000000'),
		metadata: null,
		fromNode: null,
		asTokenId: null,
		toAncestor: null,
		reason: null,
		author: 'test',
		createdAt: '2026-01-01T00:00:00.000Z',
	};
}

interface TxLog {
	id: number;
	committed: boolean;
	rolledBack: boolean;
	queries: Array<{ sql: string; params: readonly unknown[] }>;
}

function createRecordingClient() {
	let txCounter = 0;
	let seqCounter = 0;
	const transactions: TxLog[] = [];

	const client: PostgresClient = {
		async query<TRow>(): Promise<readonly TRow[]> {
			return [];
		},
		async transaction<T>(fn: (tx: PostgresQueryable) => Promise<T>): Promise<T> {
			const log: TxLog = {
				id: ++txCounter,
				committed: false,
				rolledBack: false,
				queries: [],
			};
			transactions.push(log);

			const tx: PostgresQueryable = {
				async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<readonly TRow[]> {
					log.queries.push({ sql, params });
					if (sql.includes('INSERT INTO operations')) {
						return [{ sequence: ++seqCounter } as TRow];
					}
					return [];
				},
			};

			try {
				const result = await fn(tx);
				log.committed = true;
				return result;
			} catch (error) {
				log.rolledBack = true;
				throw error;
			}
		},
	};

	return { client, transactions };
}

describe('PostgresDatabase transaction scoping and appendOperation (#1958)', () => {
	it('keeps an independent appendOperation isolated from another caller open transaction', async () => {
		const { client, transactions } = createRecordingClient();
		const db = new PostgresDatabase(client);

		let tx1Ready!: () => void;
		const tx1Open = new Promise<void>((resolve) => {
			tx1Ready = resolve;
		});
		let releaseTx1!: () => void;
		const tx1Hold = new Promise<void>((resolve) => {
			releaseTx1 = resolve;
		});

		const failingTx = db.transaction(async () => {
			await db.appendOperation(makeNewOp('in-tx1', 'root', 'color.a'));
			tx1Ready();
			await tx1Hold;
			throw new Error('tx1-rollback');
		});

		await tx1Open;
		// Independent caller appends while failingTx is open
		const independent = await db.appendOperation(makeNewOp('independent', 'root', 'color.b'));
		releaseTx1();

		await expect(failingTx).rejects.toThrow('tx1-rollback');

		expect(transactions).toHaveLength(2);
		const [tx1, tx2] = transactions;
		expect(tx1?.rolledBack).toBe(true);
		expect(tx2?.committed).toBe(true);
		expect(tx1?.queries.some((q) => q.params.includes('in-tx1'))).toBe(true);
		expect(tx1?.queries.some((q) => q.params.includes('independent'))).toBe(false);
		expect(tx2?.queries.some((q) => q.sql.includes('FOR UPDATE'))).toBe(true);
		expect(tx2?.queries.some((q) => q.params.includes('independent'))).toBe(true);
		expect(independent.sequence).toBe(2);
	});

	it('reuses the active transaction when appendOperation is called inside db.transaction()', async () => {
		const { client, transactions } = createRecordingClient();
		const db = new PostgresDatabase(client);

		await db.transaction(async () => {
			await db.appendOperation(makeNewOp('op-1', 'root', 'color.a'));
			await db.appendOperation(makeNewOp('op-2', 'root', 'color.b'));
		});

		expect(transactions).toHaveLength(1);
		expect(transactions[0]?.committed).toBe(true);
		expect(
			transactions[0]?.queries.filter((q) =>
				q.sql.includes('SELECT id FROM nodes WHERE id = $1 FOR UPDATE'),
			),
		).toHaveLength(2);
	});
});
