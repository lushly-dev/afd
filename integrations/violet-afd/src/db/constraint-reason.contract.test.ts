/**
 * A disabled rule's reason (#1327) on every store, and on SQLite and Postgres
 * databases made before the column existed. The Postgres cases need
 * VIOLET_TEST_POSTGRES_URL (see store-adapters.test-support.ts).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SQLiteDatabase } from '@lushly-dev/violet-core';
import type { Constraint, Node } from '@lushly-dev/violet-core/types';
import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from '../commands/registry.js';
import {
	createPostgresStore,
	isolatedStoreAdapters,
	postgresUrl,
} from './store-adapters.test-support.js';

const CREATED = '2026-01-05T10:00:00.000Z';
const REASON = 'Fixed by the logo guidelines';

const ROOT: Node = {
	id: 'root',
	name: 'root',
	parentId: null,
	type: 'root',
	status: 'active',
	includes: [],
	includePolicy: 'merge',
	tags: [],
	createdAt: CREATED,
	updatedAt: CREATED,
};

const disabled: Constraint = {
	id: 'off',
	name: 'Switched off',
	config: { type: 'contrast', against: 'color.page', min: 4.5 },
	severity: 'error',
	applyTo: 'color.text.*',
	enabled: false,
	disabledReason: REASON,
};
const running: Constraint = {
	id: 'on',
	name: 'Running',
	config: { type: 'contrast', against: 'color.page', min: 4.5 },
	severity: 'error',
	applyTo: 'color.text.*',
	enabled: true,
};

async function expectRoundTrip(db: Database, nodeId: string): Promise<void> {
	await db.setConstraints(nodeId, [disabled, running]);
	const stored = await db.getConstraints(nodeId);
	expect(stored.find((c) => c.id === 'off')).toEqual(disabled);
	// A rule with no reason reads back with no key at all, as it went in
	expect(stored.find((c) => c.id === 'on')).toEqual(running);

	await db.addConstraint(nodeId, {
		...running,
		id: 'later',
		enabled: false,
		disabledReason: 'Later',
	});
	const later = (await db.getConstraints(nodeId)).find((c) => c.id === 'later');
	expect(later?.disabledReason).toBe('Later');
}

for (const { name, create, skip } of isolatedStoreAdapters) {
	describe.skipIf(skip)(`constraint reason: ${name}`, () => {
		let close: () => Promise<void> = async () => {};

		afterEach(async () => {
			await close();
		});

		it('stores and reads back a disabled rule with its reason', async () => {
			const store = await create();
			close = store.close;
			await store.db.createNode(ROOT);
			await expectRoundTrip(store.db, 'root');
		});
	});
}

const LEGACY_TABLES = `
CREATE TABLE nodes (
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
);
CREATE TABLE constraints (
  id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  constraint_type TEXT NOT NULL,
  config TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error',
  apply_to TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (node_id, id)
);`;

describe('constraint reason upgrade: SQLite', () => {
	let dir: string | undefined;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it('adds the column to a file made before #1327, keeping its rules', async () => {
		dir = mkdtempSync(path.join(tmpdir(), 'rule-reason-'));
		const file = path.join(dir, 'legacy.db');
		const Sqlite = createRequire(import.meta.url)('better-sqlite3') as typeof BetterSqlite3;
		const legacy = new Sqlite(file);
		legacy.exec(LEGACY_TABLES);
		legacy
			.prepare('INSERT INTO nodes (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
			.run('root', 'root', CREATED, CREATED);
		legacy
			.prepare(
				`INSERT INTO constraints (id, node_id, name, constraint_type, config, apply_to, enabled)
				 VALUES ('old', 'root', 'Old', 'contrast', ?, 'color.*', 0)`,
			)
			.run(JSON.stringify({ type: 'contrast', against: 'color.page', min: 3 }));
		legacy.close();

		const db = new SQLiteDatabase(file);
		const [old] = await db.getConstraints('root');
		expect(old).toMatchObject({ id: 'old', enabled: false });
		expect(old).not.toHaveProperty('disabledReason');
		await expectRoundTrip(db, 'root');
		db.close();

		// Opening it again changes nothing
		const reopened = new SQLiteDatabase(file);
		const off = (await reopened.getConstraints('root')).find((c) => c.id === 'off');
		expect(off?.disabledReason).toBe(REASON);
		reopened.close();
	});
});

describe.skipIf(!postgresUrl)('constraint reason upgrade: Postgres', () => {
	let store: Awaited<ReturnType<typeof createPostgresStore>> | undefined;

	afterEach(async () => {
		await store?.close();
		store = undefined;
	});

	it('adds the column when initSchema runs on an older schema', async () => {
		store = await createPostgresStore();
		await store.client.query('ALTER TABLE constraints DROP COLUMN disabled_reason');
		await store.db.initSchema();
		await store.db.initSchema();
		await store.db.createNode(ROOT);
		await expectRoundTrip(store.db, 'root');
	});
});
