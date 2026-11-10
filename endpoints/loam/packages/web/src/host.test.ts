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

describe('the two stages (phase 2 specification, 2.2)', () => {
	it('resolves after stage A with the boot commands, and stage B adds the rest', async () => {
		const host = await createHostKernel({
			environment,
			indexedDB: new IDBFactory(),
			locks: fakeLocks(),
			// What `readBoot` reads of `vite build`'s own `deployment.json`.
			boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
		});
		if (host.kind !== 'ready') throw new Error('expected a kernel');
		// Kernel interface version 3 (phase 3 specification, 12).
		expect(host.kernel.version).toBe(3);
		expect(host.kernel.listCommands().map((row) => row.name)).toEqual([
			'layout-get',
			'appearance-get',
			'auth-session-get',
			'app-list',
			'scope-get',
			'section-get',
		]);
		await host.kernel.startApps();
		expect(host.kernel.listCommands().length).toBeGreaterThan(6);
		await host.kernel.dispose();
		await host.journal.close();
	});

	it('lists the boot records before stage B, and asks the loader only in stage B', async () => {
		let asked = 0;
		const host = await createHostKernel({
			environment,
			indexedDB: new IDBFactory(),
			locks: fakeLocks(),
			boot: {
				generation: 'test',
				workspace: { id: 'acme', name: 'Acme' },
				apps: [
					{
						instance: 'hello',
						app: 'hello',
						title: 'Hello',
						kind: 'native',
						icon: 'system/document',
						order: 10,
						scopeLevels: ['workspace'],
						rail: true,
						parts: [],
						layout: {},
						refusal: null,
					},
				],
			},
			appsLoader: async () => {
				asked += 1;
				return { refused: 'Its deployment.json is refused: no.' };
			},
		});
		if (host.kind !== 'ready') throw new Error('expected a kernel');
		const before = await host.kernel.call<{ apps: Array<{ state: string }> }>('app-list');
		expect(before.data?.apps.map((app) => app.state)).toEqual(['loading']);
		expect(asked).toBe(0);
		await host.kernel.startApps();
		expect(asked).toBe(1);
		const after = await host.kernel.call<{
			apps: Array<{ state: string; error?: { code: string } }>;
		}>('app-list');
		expect(after.data?.apps[0]).toMatchObject({
			state: 'failed',
			error: { code: 'DEPLOYMENT_INVALID' },
		});
		await host.kernel.dispose();
		await host.journal.close();
	});
});
