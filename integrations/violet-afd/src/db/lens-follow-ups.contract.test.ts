import type { CheckSnapshot } from '@lushly-dev/violet-core/types';
/**
 * Storage for the lens follow-ups, run on MemoryDatabase, SQLiteDatabase and,
 * when VIOLET_TEST_POSTGRES_URL is set, Postgres (see
 * store-adapters.test-support.ts): a node's deprecation plan (#117), rule
 * check snapshots (#117) and specimen role maps (#118).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../commands/node/create.js';
import { nodeUpdateCommand } from '../commands/node/update.js';
import type { Database } from '../commands/registry.js';
import { isolatedStoreAdapters } from './store-adapters.test-support.js';

const snapshot = (id: string, takenAt: string, rootId: string | null = null): CheckSnapshot => ({
	id,
	rootId,
	takenAt,
	nodes: 3,
	counts: { total: 1, error: 1, warning: 0, info: 0 },
	issues: [{ nodeId: 'a', tokenId: 'color.text', constraintId: 'contrast', severity: 'error' }],
	actor: 'test',
});

for (const { name, create, skip } of isolatedStoreAdapters) {
	describe.skipIf(skip)(`lens follow-up store contract: ${name}`, () => {
		let db: Database;
		let close: () => Promise<void> = async () => {};

		beforeEach(async () => {
			({ db, close } = await create());
		});

		afterEach(async () => {
			await close();
		});

		it('stores, reads back and clears a deprecation plan', async () => {
			const context = { db, actor: 'test' };
			await nodeCreateCommand.handler({ name: 'root', parentId: null }, context);
			await nodeCreateCommand.handler({ name: 'next', parentId: 'root' }, context);
			await nodeCreateCommand.handler(
				{
					name: 'old',
					parentId: 'root',
					status: 'deprecated',
					sunsetAt: '2027-03-31',
					replacedBy: 'next',
				},
				context,
			);
			expect(await db.getNode('old')).toMatchObject({
				sunsetAt: '2027-03-31',
				replacedBy: 'next',
			});
			// A node without a plan has neither field
			const plain = await db.getNode('next');
			expect(plain && 'sunsetAt' in plain).toBe(false);
			expect(plain && 'replacedBy' in plain).toBe(false);

			await nodeUpdateCommand.handler(
				{ id: 'old', updates: { sunsetAt: null, replacedBy: null } },
				context,
			);
			const cleared = await db.getNode('old');
			expect(cleared?.sunsetAt).toBeUndefined();
			expect(cleared?.replacedBy).toBeUndefined();
			expect((await db.listNodes()).find((node) => node.id === 'old')?.status).toBe('deprecated');
		});

		it('lists check snapshots oldest first, by range, subtree and limit', async () => {
			await db.addCheckSnapshot(snapshot('s2', '2026-10-02T09:00:00.000Z'));
			await db.addCheckSnapshot(snapshot('s1', '2026-10-01T09:00:00.000Z'));
			await db.addCheckSnapshot(snapshot('s3', '2026-10-03T09:00:00.000Z', 'xbox'));
			await db.addCheckSnapshot(snapshot('s4', '2026-10-04T09:00:00.000Z', 'office'));

			const ids = async (query: Parameters<Database['listCheckSnapshots']>[0]) =>
				(await db.listCheckSnapshots(query)).map((entry) => entry.id);
			expect(await ids({})).toEqual(['s1', 's2', 's3', 's4']);
			expect(
				await ids({ since: '2026-10-02T00:00:00.000Z', until: '2026-10-04T00:00:00.000Z' }),
			).toEqual(['s2', 's3']);
			expect(await ids({ rootIds: [null] })).toEqual(['s1', 's2']);
			expect(await ids({ rootIds: [null, 'xbox'] })).toEqual(['s1', 's2', 's3']);
			expect(await ids({ rootIds: [] })).toEqual([]);
			// The limit keeps the newest
			expect(await ids({ limit: 2 })).toEqual(['s3', 's4']);

			const [first] = await db.listCheckSnapshots({ limit: 1, rootIds: ['xbox'] });
			expect(first).toEqual(snapshot('s3', '2026-10-03T09:00:00.000Z', 'xbox'));
		});

		it('stores, replaces and removes a specimen map per root', async () => {
			expect(await db.getSpecimenMap('root')).toBeNull();
			const record = {
				rootId: 'root',
				map: { button: { background: 'btn.bg', 'padding.x': 'btn.pad' } },
				updatedAt: '2026-10-01T09:00:00.000Z',
				updatedBy: 'test',
			};
			await db.setSpecimenMap('root', record);
			expect(await db.getSpecimenMap('root')).toEqual(record);

			const replaced = { ...record, map: { card: { background: 'card.bg' } }, updatedBy: null };
			await db.setSpecimenMap('root', replaced);
			expect(await db.getSpecimenMap('root')).toEqual(replaced);
			expect(await db.getSpecimenMap('other')).toBeNull();

			await db.setSpecimenMap('root', null);
			expect(await db.getSpecimenMap('root')).toBeNull();
		});
	});
}
