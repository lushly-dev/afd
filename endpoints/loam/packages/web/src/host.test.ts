import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createHostKernel, type HostKernelOptions } from './host.js';

/** A Web Locks stand-in: one holder per name, `ifAvailable` refuses when held. */
function fakeLocks(): NonNullable<HostKernelOptions['locks']> {
	const held = new Set<string>();
	return {
		async request(name: string, options: unknown, callback?: unknown) {
			const run = (callback ?? options) as (lock: { name: string } | null) => Promise<unknown>;
			const ifAvailable =
				typeof options === 'object' && options !== null && 'ifAvailable' in options;
			if (held.has(name)) {
				if (ifAvailable) return run(null);
				throw new Error('queued locks are not modeled');
			}
			held.add(name);
			try {
				return await run({ name });
			} finally {
				held.delete(name);
			}
		},
		query: async () => ({ held: [], pending: [] }),
	} as unknown as NonNullable<HostKernelOptions['locks']>;
}

const environment = { matches: () => false, onChange: () => () => {} };

describe('the browser host kernel', () => {
	it('persists layout through IndexedDB and journals every call', async () => {
		const indexedDB = new IDBFactory();
		const locks = fakeLocks();
		const first = await createHostKernel({ environment, indexedDB, locks });
		if (first.kind !== 'ready') throw new Error('expected a kernel');
		await first.kernel.call('layout-set', { sidebar: { width: 320 } });
		await first.kernel.flush();
		const entries = await first.journal.read();
		expect(entries.map((entry) => entry.command)).toEqual(['layout-set']);
		const info = await first.kernel.call<{ host: string; store: string }>('shell-info-get');
		expect(info.data).toMatchObject({ host: 'browser', store: 'indexeddb' });
		await first.kernel.dispose();
		await first.journal.close();

		const second = await createHostKernel({ environment, indexedDB, locks });
		if (second.kind !== 'ready') throw new Error('expected a kernel');
		const layout = await second.kernel.call<{ sidebar: { width: number } }>('layout-get');
		expect(layout.data?.sidebar.width).toBe(320);
		await second.kernel.dispose();
		await second.journal.close();
	});

	it('creates no kernel while another context holds the writer lock', async () => {
		const indexedDB = new IDBFactory();
		const locks = fakeLocks();
		const first = await createHostKernel({ environment, indexedDB, locks });
		const second = await createHostKernel({ environment, indexedDB, locks, lockPatienceMs: 250 });
		expect(second.kind).toBe('locked');
		if (second.kind === 'locked') expect(second.error.code).toBe('JOURNAL_LOCKED');
		if (first.kind === 'ready') {
			await first.kernel.dispose();
			await first.journal.close();
		}
	});
});
