/**
 * Upgrading databases made before #117 and #118: nodes tables without the
 * sunset_at and replaced_by columns, and no check_snapshots or specimen_maps
 * tables. Existing nodes keep their data and have no plan. The Postgres cases
 * need VIOLET_TEST_POSTGRES_URL (see store-adapters.test-support.ts); the
 * migration case applies the hosted schema's own files from
 * packages/api/migrations.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteDatabase } from '@lushly-dev/violet-core';
import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeUpdateCommand } from '../commands/node/update.js';
import type { Database } from '../commands/registry.js';
import { createPostgresStore, postgresUrl } from './store-adapters.test-support.js';

const LEGACY_NODES_TABLE = `CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  type TEXT NOT NULL DEFAULT 'custom',
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  includes TEXT NOT NULL DEFAULT '[]',
  include_policy TEXT NOT NULL DEFAULT 'merge',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
)`;
const CREATED = '2026-01-05T10:00:00.000Z';

/** The legacy rows read back, then a plan stored on them */
async function expectUpgraded(db: Database): Promise<void> {
	expect(await db.getNode('old')).toMatchObject({
		id: 'old',
		status: 'deprecated',
		owner: 'design@example.com',
	});
	expect((await db.getNode('old'))?.sunsetAt).toBeUndefined();
	const result = await nodeUpdateCommand.handler(
		{ id: 'old', updates: { sunsetAt: '2027-01-31', replacedBy: 'next' } },
		{ db, actor: 'test' },
	);
	expect(result.success).toBe(true);
	expect(await db.getNode('old')).toMatchObject({ sunsetAt: '2027-01-31', replacedBy: 'next' });
	expect(await db.listCheckSnapshots()).toEqual([]);
	expect(await db.getSpecimenMap('next')).toBeNull();
}

describe('deprecation plan upgrade: SQLite', () => {
	let dir: string | undefined;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it('adds the columns and tables to a file made before #117', async () => {
		dir = mkdtempSync(path.join(tmpdir(), 'violet-plan-'));
		const file = path.join(dir, 'legacy.db');
		const Sqlite = createRequire(import.meta.url)('better-sqlite3') as typeof BetterSqlite3;
		const legacy = new Sqlite(file);
		legacy.exec(LEGACY_NODES_TABLE);
		const insert = legacy.prepare(
			'INSERT INTO nodes (id, name, status, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
		);
		insert.run('old', 'old', 'deprecated', 'design@example.com', CREATED, CREATED);
		insert.run('next', 'next', 'active', null, CREATED, CREATED);
		legacy.close();

		const db = new SQLiteDatabase(file);
		await expectUpgraded(db);
		db.close();
		// Opening it again changes nothing
		const reopened = new SQLiteDatabase(file);
		expect(await reopened.getNode('old')).toMatchObject({ sunsetAt: '2027-01-31' });
		reopened.close();
	});
});

describe.skipIf(!postgresUrl)('deprecation plan upgrade: Postgres', () => {
	let store: Awaited<ReturnType<typeof createPostgresStore>> | undefined;

	afterEach(async () => {
		await store?.close();
		store = undefined;
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
			const upgrade = files.find((file) => file.includes('deprecation_plans'));
			expect(upgrade).toBeDefined();
			const before = files.filter((file) => file < (upgrade as string));

			for (const file of before)
				await store.client.query(readFileSync(path.join(dir, file), 'utf8'));
			for (const [id, status, owner] of [
				['old', 'deprecated', 'design@example.com'],
				['next', 'active', null],
			]) {
				await store.client.query(
					`INSERT INTO nodes (id, name, status, owner, created_at, updated_at)
				 VALUES ($1, $1, $2, $3, $4, $4)`,
					[id, status, owner, CREATED],
				);
			}
			for (const file of files.filter((name) => name >= (upgrade as string))) {
				await store.client.query(readFileSync(path.join(dir, file), 'utf8'));
			}
			// Applying it twice, and initSchema on a migrated database, change nothing
			await store.client.query(readFileSync(path.join(dir, upgrade as string), 'utf8'));
			await store.db.initSchema();

			await expectUpgraded(store.db);
		},
	);

	it('adds the columns when initSchema runs on an older schema', async () => {
		store = await createPostgresStore();
		await store.client.query('ALTER TABLE nodes DROP COLUMN sunset_at');
		await store.client.query('ALTER TABLE nodes DROP COLUMN replaced_by');
		await store.client.query('DROP TABLE check_snapshots');
		await store.client.query('DROP TABLE specimen_maps');
		await store.client.query(
			`INSERT INTO nodes (id, name, status, owner, created_at, updated_at)
			 VALUES ('old', 'old', 'deprecated', 'design@example.com', $1, $1),
			        ('next', 'next', 'active', NULL, $1, $1)`,
			[CREATED],
		);

		await store.db.initSchema();
		await expectUpgraded(store.db);
	});
});
