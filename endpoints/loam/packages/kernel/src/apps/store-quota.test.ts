/**
 * The `store` grant's quota (phase 4 specification, section 11): writes of one instance in turn, so two overlapping
 * writes never both take the last place; the count kept with each write and delete; and a value with no JSON form
 * refused, since its size cannot be counted.
 */

import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createKernelLimits, LIMIT_DEFAULTS } from '../limits.js';
import { USAGE_RECOUNT_MS } from '../settings/limit-commands.js';
import {
	type AppStoreRecord,
	createAppStore,
	createStoreQuota,
	USAGE_RECOUNT_MS as STORE_RECOUNT_MS,
	STORE_USAGE_TABLE,
	storeUsageId,
} from './store.js';

const SCOPE = { workspace: 'personal' };

let databases = 0;
function setup(storeBytes = 1_048_576, adapter: DataAdapter = new MemoryAdapter()) {
	const limits = createKernelLimits();
	limits.set({ ...LIMIT_DEFAULTS, storeBytes });
	const quota = createStoreQuota(adapter, limits);
	const store = (instance = 'probe', scope: { workspace: string } = SCOPE) =>
		createAppStore({ adapter, app: instance, instance, scope, now: () => 7, quota });
	return { adapter, limits, quota, store };
}

const used = async (adapter: DataAdapter, instance = 'probe', workspace = 'personal') =>
	(await adapter.get<{ used: number }>(STORE_USAGE_TABLE, storeUsageId(workspace, instance)))?.used;

describe('the store quota (section 11)', () => {
	it('lets one of two overlapping writes take the last place, never both', async () => {
		const { adapter, limits, store } = setup();
		const big = 'x'.repeat(600_000);
		const results = await Promise.allSettled([store().put('a', big), store().put('b', big)]);
		expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
		const refused = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
		expect(refused.reason).toMatchObject({
			code: 'QUOTA_EXCEEDED',
			details: { kind: 'store', limit: 1_048_576 },
		});
		expect(await used(adapter)).toBeLessThanOrEqual(1_048_576);
		expect(limits.counts('probe', 7).storeBytes).toBe(1);
	});

	it('keeps the count with each write, overwrite and delete, per instance', async () => {
		const { adapter, store } = setup();
		const bytes = (key: string, value: unknown) => JSON.stringify({ key, value }).length;
		await store().put('a', 'one');
		expect(await used(adapter)).toBe(bytes('a', 'one'));
		await store().put('a', 'three');
		expect(await used(adapter)).toBe(bytes('a', 'three'));
		await store().put('b', { n: 1 });
		expect(await used(adapter)).toBe(bytes('a', 'three') + bytes('b', { n: 1 }));
		await store().delete('a');
		await store().delete('missing');
		expect(await used(adapter)).toBe(bytes('b', { n: 1 }));
		await store('other').put('a', 'one');
		expect(await used(adapter, 'other')).toBe(bytes('a', 'one'));
		expect(await used(adapter)).toBe(bytes('b', { n: 1 }));
	});

	it('always lets a smaller write or a delete land, even over the limit', async () => {
		const { store } = setup();
		await store().put('a', 'x'.repeat(1_000_000));
		await expect(store().put('b', 'x'.repeat(100_000))).rejects.toMatchObject({
			code: 'QUOTA_EXCEEDED',
		});
		await expect(store().put('a', 'x'.repeat(10))).resolves.toBeUndefined();
		await expect(store().delete('a')).resolves.toBeUndefined();
	});

	it('stores the JSON form it counted, and refuses a value with none', async () => {
		const { adapter, store } = setup();
		await store().put('when', { at: new Date(0), gone: undefined });
		expect(await store().get('when')).toEqual({ at: '1970-01-01T00:00:00.000Z' });
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		const before = await used(adapter);
		for (const value of [cycle, 1n, () => 1, undefined])
			await expect(store().put('bad', value)).rejects.toMatchObject({
				code: 'VALIDATION_ERROR',
				suggestion: expect.stringContaining('JSON'),
			});
		// Refused before any charge: nothing written, nothing counted (R2).
		expect(await used(adapter)).toBe(before);
		expect(await store().get('bad')).toBeUndefined();
	});

	it.each([
		['MemoryAdapter', () => new MemoryAdapter()],
		[
			'IndexedDbAdapter',
			() =>
				new IndexedDbAdapter({ name: `loam-quota-${++databases}`, indexedDB: new IDBFactory() }),
		],
	])(
		'refunds what was charged on an overwrite and a delete, over %s (blocker 4)',
		async (_name, make) => {
			const { adapter, store } = setup(1_048_576, make());
			const bytes = (key: string, value: unknown) => JSON.stringify({ key, value }).length;
			await store().put('a', { big: 'x'.repeat(500) });
			await store().put('a', 'small');
			expect(await used(adapter)).toBe(bytes('a', 'small'));
			// A store that merges a PUT into the row keeps no field of the old value's charge.
			const row = await adapter.get<AppStoreRecord>('app-probe', 'a');
			expect(row).toMatchObject({ value: 'small', bytes: bytes('a', 'small') });
			await store().delete('a');
			expect(await used(adapter)).toBe(0);
		}
	);

	it('counts and refunds a row from before step 10 by its size', async () => {
		const { adapter, store } = setup();
		await adapter.create('app-probe', { id: 'old', key: 'old', value: 'v'.repeat(100) });
		const held = JSON.stringify({ key: 'old', value: 'v'.repeat(100) }).length;
		expect(await createStoreQuota(adapter).count('probe', 'personal')).toBe(held);
		await store().put('new', 1);
		expect(await used(adapter)).toBe(held + JSON.stringify({ key: 'new', value: 1 }).length);
		await store().delete('old');
		expect(await used(adapter)).toBe(JSON.stringify({ key: 'new', value: 1 }).length);
	});

	it("never counts or refunds another workspace's rows (R1)", async () => {
		const { adapter, quota, store } = setup();
		await store('probe', { workspace: 'alpha' }).put('a', 'x'.repeat(1_000));
		await store('probe', { workspace: 'beta' }).put('b', 'y');
		expect(await used(adapter, 'probe', 'alpha')).toBe(
			JSON.stringify({ key: 'a', value: 'x'.repeat(1_000) }).length
		);
		expect(await used(adapter, 'probe', 'beta')).toBe(
			JSON.stringify({ key: 'b', value: 'y' }).length
		);
		expect(await quota.count('probe', 'beta')).toBe(
			JSON.stringify({ key: 'b', value: 'y' }).length
		);
		// Beta deleting alpha's row by its key refunds beta nothing.
		await store('probe', { workspace: 'beta' }).delete('a');
		expect(await used(adapter, 'probe', 'beta')).toBe(
			JSON.stringify({ key: 'b', value: 'y' }).length
		);
	});

	it('charges what the shell writes in turn with the writes, and refunds after a delete', async () => {
		const { adapter, quota, limits } = setup();
		let written = 0;
		await quota.charge('probe', 'personal', 1_000_000, 7, async (usage) => {
			written += 1;
			await adapter.batch([usage]);
		});
		expect(await used(adapter)).toBe(1_000_000);
		await expect(
			quota.charge('probe', 'personal', 100_000, 7, async () => {
				written += 1;
			})
		).rejects.toMatchObject({
			code: 'QUOTA_EXCEEDED',
			details: { kind: 'store', used: 1_000_000 },
		});
		expect(written).toBe(1);
		expect(limits.counts('probe', 7).storeBytes).toBe(1);
		await quota.refund('probe', 'personal', 400_000, 8);
		expect(await used(adapter)).toBe(600_000);
	});

	it('counts a table with no row afresh, and settle writes the rows given', async () => {
		const { adapter, quota, store } = setup();
		await store().put('a', 'one');
		await adapter.remove(STORE_USAGE_TABLE, storeUsageId('personal', 'probe'));
		expect(await quota.stored('probe', 'personal')).toBeUndefined();
		expect(await quota.used('probe', 'personal')).toBe(
			JSON.stringify({ key: 'a', value: 'one' }).length
		);
		await quota.settle('personal', [{ instance: 'probe', used: 99 }], 8);
		expect(await quota.stored('probe', 'personal')).toEqual({ used: 99, countedAt: 8 });
		expect(STORE_RECOUNT_MS).toBe(USAGE_RECOUNT_MS);
		// Another workspace's row is never read as this one's.
		expect(await quota.stored('probe', 'other')).toBeUndefined();
	});
});
