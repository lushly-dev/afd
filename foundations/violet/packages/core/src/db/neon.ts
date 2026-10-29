import { type PoolClient as NeonPoolConnection, Pool, neonConfig } from '@neondatabase/serverless';
import NodeWebSocket from 'ws';
import type { PostgresClient, PostgresQueryable } from './postgres.js';

if (typeof globalThis.WebSocket === 'undefined') {
	neonConfig.webSocketConstructor = NodeWebSocket as unknown as typeof WebSocket;
}

class NeonTransactionClient implements PostgresQueryable {
	private readonly client: NeonPoolConnection;

	constructor(client: NeonPoolConnection) {
		this.client = client;
	}

	async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<readonly TRow[]> {
		const result = await this.client.query(sql, [...params]);
		return result.rows as readonly TRow[];
	}
}

/**
 * Neon Pool-backed Postgres client for the prototype Vercel/Node path.
 */
export class NeonPostgresClient implements PostgresClient {
	private readonly pool: Pool;

	constructor(connectionString: string) {
		this.pool = new Pool({ connectionString });
	}

	async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<readonly TRow[]> {
		const result = await this.pool.query(sql, [...params]);
		return result.rows as readonly TRow[];
	}

	async transaction<T>(fn: (tx: PostgresQueryable) => Promise<T>): Promise<T> {
		const client = await this.pool.connect();
		const tx = new NeonTransactionClient(client);

		try {
			await client.query('BEGIN');
			const result = await fn(tx);
			await client.query('COMMIT');
			return result;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	async close(): Promise<void> {
		await this.pool.end();
	}
}

export function createNeonPostgresClient(connectionString: string): NeonPostgresClient {
	return new NeonPostgresClient(connectionString);
}
