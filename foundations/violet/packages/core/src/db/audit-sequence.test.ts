/**
 * Upgrading audit_events tables made before #89, which had no write-order
 * column: rows already there keep a sensible order, and new rows sort after
 * them. The Postgres cases need VIOLET_TEST_POSTGRES_URL (see
 * store-adapters.test-support.ts); the migration case applies the hosted
 * schema's own files from packages/api/migrations.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from '../storage.js';
import type { AuditEvent } from '../types/operation.js';
import { SQLiteDatabase } from './sqlite.js';
import { createPostgresStore, postgresUrl } from './store-adapters.test-support.js';

const TIMESTAMP = '2026-10-06T10:00:00.000Z';
const LEGACY_AUDIT_TABLE = `CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  target_node TEXT NOT NULL,
  target_token TEXT,
  old_value TEXT,
  new_value TEXT,
  metadata TEXT
)`;

const event = (id: string): AuditEvent => ({
	id,
	timestamp: TIMESTAMP,
	eventType: 'token_updated',
	actor: 'test',
	targetNode: 'node',
	targetToken: null,
	oldValue: null,
	newValue: null,
	metadata: null,
});

const order = async (db: Database) =>
	(await db.queryAuditEvents({ limit: 10, offset: 0 })).events.map((entry) => entry.id);

describe('audit sequence upgrade: SQLite', () => {
	let dir: string | undefined;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it('numbers existing rows in the order they were inserted', async () => {
		dir = mkdtempSync(path.join(tmpdir(), 'violet-audit-'));
		const file = path.join(dir, 'legacy.db');
		const Sqlite = createRequire(import.meta.url)('better-sqlite3') as typeof BetterSqlite3;
		const legacy = new Sqlite(file);
		legacy.exec(LEGACY_AUDIT_TABLE);
		const insert = legacy.prepare(
			`INSERT INTO audit_events (id, timestamp, event_type, actor, target_node)
			 VALUES (?, ?, 'token_updated', 'test', 'node')`,
		);
		for (const id of ['b', 'c', 'a']) insert.run(id, TIMESTAMP);
		legacy.close();

		const db = new SQLiteDatabase(file);
		expect(await order(db)).toEqual(['a', 'c', 'b']);
		await db.addAuditEvent(event('0'));
		expect(await order(db)).toEqual(['0', 'a', 'c', 'b']);
		db.close();
	});
});

describe.skipIf(!postgresUrl)('audit sequence upgrade: Postgres', () => {
	let store: Awaited<ReturnType<typeof createPostgresStore>> | undefined;

	afterEach(async () => {
		await store?.close();
		store = undefined;
	});

	const insertLegacyRows = async (ids: string[]) => {
		for (const id of ids) {
			await store?.client.query(
				`INSERT INTO audit_events (id, timestamp, event_type, actor, target_node)
				 VALUES ($1, $2, 'token_updated', 'test', 'node')`,
				[id, TIMESTAMP],
			);
		}
	};

	it('keeps the old (timestamp, id) order when initSchema adds the column', async () => {
		store = await createPostgresStore();
		await store.client.query('ALTER TABLE audit_events DROP COLUMN seq');
		await insertLegacyRows(['b', 'c', 'a']);

		await store.db.initSchema();
		expect(await order(store.db)).toEqual(['c', 'b', 'a']);
		await store.db.addAuditEvent(event('0'));
		expect(await order(store.db)).toEqual(['0', 'c', 'b', 'a']);
	});

	// The hosted migrations ship with the Violet API app, which this import leaves out;
	// the case skips until they are imported beside it.
	const hostedMigrations = fileURLToPath(new URL('../../../api/migrations/', import.meta.url));
	it.skipIf(!existsSync(hostedMigrations))(
		'upgrades a database made by the hosted migrations, rows and all',
		async () => {
			store = await createPostgresStore({ initSchema: false });
			const dir = hostedMigrations;
			const files = readdirSync(dir)
				.filter((file) => file.endsWith('.sql'))
				.sort();
			const before = files.filter((file) => file < '0003');
			expect(before).toEqual(['0001_core_schema.sql', '0002_api_auth_and_rate_limits.sql']);

			for (const file of before)
				await store.client.query(readFileSync(path.join(dir, file), 'utf8'));
			await insertLegacyRows(['b', 'c', 'a']);
			for (const file of files.filter((name) => name >= '0003')) {
				await store.client.query(readFileSync(path.join(dir, file), 'utf8'));
			}

			expect(await order(store.db)).toEqual(['c', 'b', 'a']);
			// initSchema on a migrated database changes nothing
			await store.db.initSchema();
			await store.db.addAuditEvent(event('0'));
			await store.db.addAuditEvent(event('1'));
			expect(await order(store.db)).toEqual(['1', '0', 'c', 'b', 'a']);
		},
	);
});
