/** Optional destructive-to-test-records harness; never targets a service by default. */
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { HttpAdapter } from './http-adapter.js';

const baseURL = process.env.AFD_TEST_HTTP_BASE_URL;
it.skipIf(!baseURL)(
	'persists isolated records across clients and rolls back a hosted batch',
	async () => {
		const table = process.env.AFD_TEST_HTTP_TABLE;
		if (!baseURL || !table)
			throw new Error(
				'Set AFD_TEST_HTTP_BASE_URL and AFD_TEST_HTTP_TABLE for a disposable test service'
			);
		const token = process.env.AFD_TEST_HTTP_TOKEN;
		const options = token
			? {
					fetch: ((input, init) => {
						const headers = new Headers(init?.headers);
						headers.set('authorization', `Bearer ${token}`);
						return fetch(input, { ...init, headers });
					}) satisfies typeof fetch,
				}
			: undefined;
		const writer = new HttpAdapter(baseURL, options);
		const reader = new HttpAdapter(baseURL, options);
		const id = `afd-integration-${randomUUID()}`;
		const batchId = `${id}-batch`;
		const missingId = `${id}-missing`;
		const path = `/${encodeURIComponent(table)}`;
		try {
			expect(await reader.get(table, id)).toBeNull();
			await writer.create(table, { id, value: 'before' });
			expect(await reader.get(table, id)).toMatchObject({ id, value: 'before' });
			await writer.update(table, id, { value: 'after' });
			expect(await reader.get(table, id)).toMatchObject({ id, value: 'after' });
			const result = await writer.batch([
				{ method: 'PATCH', path: `${path}/${id}`, body: { value: 'rolled-back' } },
				{ method: 'POST', path, body: { id: batchId } },
				{ method: 'PATCH', path: `${path}/${missingId}`, body: {} },
			]);
			expect(result.results.map((entry) => entry.status)).toEqual([424, 424, 404]);
			expect(await reader.get(table, id)).toMatchObject({ value: 'after' });
			expect(await reader.get(table, batchId)).toBeNull();
		} finally {
			// Fixed IDs from this invocation only, even if the server violated rollback.
			const cleanup = await Promise.allSettled(
				[id, batchId, missingId].map((key) => writer.remove(table, key))
			);
			expect(cleanup.filter((result) => result.status === 'rejected')).toEqual([]);
			for (const key of [id, batchId, missingId]) expect(await reader.get(table, key)).toBeNull();
		}
	},
	30_000
);
