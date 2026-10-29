import {
	type PostgresClient,
	PostgresDatabase,
	type PostgresQueryable,
} from '@lushly-dev/violet-core';
import { SQLiteDatabase } from '@lushly-dev/violet-core';
import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { NeonPostgresClient } from '@lushly-dev/violet-core/neon';
/**
 * Store adapters for the contract tests: every Database must behave the same
 * on memory, SQLite and Postgres.
 *
 * Postgres leg: set VIOLET_TEST_POSTGRES_URL to any Postgres reachable over
 * TCP. CI runs a postgres:17 service container; locally, for example:
 *
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
 *   VIOLET_TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres \
 *     pnpm --filter @lushly-dev/violet-core exec vitest run src/db
 *
 * Each store gets its own schema, dropped when it is closed, so the database
 * can hold other data. Without the variable the leg is skipped, unless
 * VIOLET_TEST_POSTGRES=required (set in CI) makes that an error.
 *
 * Neon leg: VIOLET_NEON_DATABASE_URL, over Neon's WebSocket proxy. It shares
 * one database with other data, so only tests that scope every read by
 * run-unique ids use it.
 */
import { nanoid } from 'nanoid';
import pg from 'pg';
import type { Database } from '../commands/registry.js';

export const postgresUrl = process.env.VIOLET_TEST_POSTGRES_URL;
const neonUrl = process.env.VIOLET_NEON_DATABASE_URL;

if (process.env.VIOLET_TEST_POSTGRES === 'required' && !postgresUrl) {
	throw new Error('VIOLET_TEST_POSTGRES=required, but VIOLET_TEST_POSTGRES_URL is not set');
}

interface OpenStore {
	db: Database;
	close: () => Promise<void>;
}

interface StoreAdapter {
	name: string;
	skip: boolean;
	create: () => Promise<OpenStore>;
}

/** A PostgresClient on node-postgres (TCP), for plain Postgres servers */
class PgPostgresClient implements PostgresClient {
	constructor(private readonly pool: pg.Pool) {}

	async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<readonly TRow[]> {
		return (await this.pool.query(sql, [...params])).rows as TRow[];
	}

	async transaction<T>(fn: (tx: PostgresQueryable) => Promise<T>): Promise<T> {
		const client = await this.pool.connect();
		const tx: PostgresQueryable = {
			query: async <TRow>(sql: string, params: readonly unknown[] = []) =>
				(await client.query(sql, [...params])).rows as TRow[],
		};
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
}

/**
 * A PostgresDatabase in a new schema of the VIOLET_TEST_POSTGRES_URL database.
 * With `initSchema: false` the schema starts empty, for testing migrations.
 */
export async function createPostgresStore({
	initSchema = true,
} = {}): Promise<OpenStore & { db: PostgresDatabase; client: PgPostgresClient }> {
	const schema = `violet_test_${nanoid(10)
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')}`;
	const admin = new pg.Pool({ connectionString: postgresUrl, max: 1 });
	await admin.query(`CREATE SCHEMA ${schema}`);
	const pool = new pg.Pool({ connectionString: postgresUrl, options: `-c search_path=${schema}` });
	const client = new PgPostgresClient(pool);
	const db = new PostgresDatabase(client);
	if (initSchema) await db.initSchema();
	return {
		db,
		client,
		close: async () => {
			await pool.end();
			await admin.query(`DROP SCHEMA ${schema} CASCADE`);
			await admin.end();
		},
	};
}

const memoryAdapter: StoreAdapter = {
	name: 'MemoryDatabase',
	skip: false,
	create: async () => ({ db: createMemoryDatabase(), close: async () => {} }),
};

const sqliteAdapter: StoreAdapter = {
	name: 'SQLiteDatabase(:memory:)',
	skip: false,
	create: async () => {
		const db = new SQLiteDatabase(':memory:');
		return { db, close: async () => db.close() };
	},
};

const postgresAdapter: StoreAdapter = {
	name: 'PostgresDatabase(pg)',
	skip: !postgresUrl,
	create: () => createPostgresStore(),
};

export const neonAdapter: StoreAdapter = {
	name: 'PostgresDatabase(Neon)',
	skip: !neonUrl,
	create: async () => {
		const client = new NeonPostgresClient(neonUrl as string);
		const db = new PostgresDatabase(client);
		await db.initSchema();
		return { db, close: () => client.close() };
	},
};

/** Every store that gives each test an empty database */
export const isolatedStoreAdapters = [memoryAdapter, sqliteAdapter, postgresAdapter];
