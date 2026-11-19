/**
 * The `store` grant's quota (phase 4 specification, section 11): writes of one instance in turn, so two overlapping
 * writes never both take the last place; the count kept with each write and delete; and a value with no JSON form
 * refused, since its size cannot be counted.
 */

import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it } from 'vitest';
import { countRefusals } from '../late/limit-commands.js';
import { createKernelLimits, LIMIT_DEFAULTS } from '../limits.js';
import { createAppStore, createStoreQuota, STORE_USAGE_TABLE, storeUsageId } from './store.js';

const SCOPE = { workspace: 'personal' };

function setup(storeBytes = 1_048_576) {
	const adapter = new MemoryAdapter();
	const limits = createKernelLimits();
	limits.set({ ...LIMIT_DEFAULTS, storeBytes });
	const quota = createStoreQuota(adapter, limits);
	const store = (instance = 'probe') =>
		createAppStore({ adapter, app: instance, instance, scope: SCOPE, now: () => 7, quota });
	return { adapter, limits, quota, store };
}

const used = async (adapter: MemoryAdapter, instance = 'probe') =>
	(await adapter.get<{ used: number }>(STORE_USAGE_TABLE, storeUsageId('personal', instance)))
		?.used;

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
		expect(countRefusals(limits.recent('probe', 7)).storeBytes).toBe(1);
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
		const { store } = setup();
		await store().put('when', { at: new Date(0), gone: undefined });
		expect(await store().get('when')).toEqual({ at: '1970-01-01T00:00:00.000Z' });
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		await expect(store().put('cycle', cycle)).rejects.toThrow(/JSON form/);
		await expect(store().put('big', 1n)).rejects.toThrow(/JSON form/);
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
		expect(await quota.stored('probe', 'personal')).toBe(99);
		// Another workspace's row is never read as this one's.
		expect(await quota.stored('probe', 'other')).toBeUndefined();
	});
});
