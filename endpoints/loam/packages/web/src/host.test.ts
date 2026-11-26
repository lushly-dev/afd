import 'fake-indexeddb/auto';
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createHostKernel, type HostKernelOptions, STORE_NAME } from './host.js';

/** A Web Locks stand-in: one holder per name, `ifAvailable` refuses when held, blocking requests queue (#1634). */
function fakeLocks(): NonNullable<HostKernelOptions['locks']> {
	const held = new Set<string>();
	const queues = new Map<string, Array<() => void>>();
	const wake = (name: string) => {
		const next = queues.get(name)?.shift();
		if (next) next();
	};
	return {
		async request(name: string, options: unknown, callback?: unknown) {
			const hasOpts = typeof options === 'object' && options !== null;
			const run = (callback ?? options) as (lock: { name: string } | null) => Promise<unknown>;
			const ifAvailable =
				hasOpts &&
				'ifAvailable' in options &&
				Boolean((options as { ifAvailable?: boolean }).ifAvailable);
			const signal =
				hasOpts && 'signal' in options ? (options as { signal?: AbortSignal }).signal : undefined;
			if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
			if (held.has(name)) {
				if (ifAvailable) return run(null);
				await new Promise<void>((resolve, reject) => {
					const list = queues.get(name) ?? [];
					queues.set(name, list);
					const onGrant = () => {
						signal?.removeEventListener('abort', onAbort);
						resolve();
					};
					const onAbort = () => {
						const idx = list.indexOf(onGrant);
						if (idx >= 0) list.splice(idx, 1);
						reject(new DOMException('The request was aborted.', 'AbortError'));
					};
					signal?.addEventListener('abort', onAbort, { once: true });
					list.push(onGrant);
				});
			}
			held.add(name);
			try {
				return await run({ name });
			} finally {
				held.delete(name);
				wake(name);
			}
		},
		query: async () => ({ held: [...held].map((name) => ({ name })), pending: [] }),
	} as unknown as NonNullable<HostKernelOptions['locks']>;
}

const environment = { matches: () => false, onChange: () => () => {} };

describe('the browser host kernel', () => {
	it('requests persistence and round-trips all workspace tables through one export file', async () => {
		const indexedDB = new IDBFactory();
		const source = new IndexedDbAdapter({ name: STORE_NAME, indexedDB });
		const restored = new IndexedDbAdapter({ name: 'restored', indexedDB });
		const rows = [
			{ table: 'documents', row: { id: 'draft', title: 'A draft' } },
			{ table: 'loam-settings', row: { id: 'local', appearance: { theme: 'dark' } } },
			{ table: 'app-notes', row: { id: 'draft', body: 'The draft text' } },
		];
		for (const { table, row } of rows) await source.create<Record<string, unknown>>(table, row);
		let file: { name: string; contents: string } | undefined;
		const host = await createHostKernel({
			environment,
			indexedDB,
			locks: fakeLocks(),
			localWorkspace: {
				storage: { persist: async () => true },
				saveFile(name, contents) {
					file = { name, contents };
				},
			},
		});
		if (host.kind !== 'ready') throw new Error('expected a kernel');
		try {
			expect((await host.kernel.call('storage-persistence-get')).data).toEqual({
				status: 'persistent',
			});
			expect((await host.kernel.agent.call('workspace-export')).error?.code).toBe(
				'COMMAND_NOT_EXPOSED'
			);
			const result = await host.kernel.call('workspace-export');
			expect(result.data).toMatchObject({ filename: 'loam-workspace.json' });
			expect(file?.name).toBe('loam-workspace.json');
			const backup = JSON.parse(file?.contents ?? '{}');
			expect(backup).toMatchObject({ format: 'loam-workspace', version: 1 });
			expect(backup.records.length).toBeGreaterThanOrEqual(rows.length);
			for (const { table, row } of backup.records) await restored.create(table, row);
			expect(await restored.snapshot()).toEqual(await source.snapshot());
		} finally {
			await host.kernel.dispose();
			await host.journal.close();
			await source.close();
			await restored.close();
		}
	});

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

	it('creates no kernel while another context holds the writer lock, and boots via waitForLock once released (#1634)', async () => {
		const indexedDB = new IDBFactory();
		const locks = fakeLocks();
		const first = await createHostKernel({ environment, indexedDB, locks });
		if (first.kind !== 'ready') throw new Error('expected first kernel');
		const second = await createHostKernel({ environment, indexedDB, locks, lockPatienceMs: 50 });
		expect(second.kind).toBe('locked');
		if (second.kind !== 'locked') throw new Error('expected locked');
		expect(second.error.code).toBe('JOURNAL_LOCKED');

		// While the first tab holds the lock, waitForLock stays pending and creates no kernel.
		let settled = false;
		const waiting = second.waitForLock().then((result) => {
			settled = true;
			return result;
		});
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(settled).toBe(false);

		// Once the first tab releases the lock, waitForLock boots the second kernel automatically.
		await first.kernel.dispose();
		await first.journal.close();
		const booted = await waiting;
		expect(booted.kind).toBe('ready');
		if (booted.kind !== 'ready') throw new Error('expected booted kernel');
		const info = await booted.kernel.call<{ host: string }>('shell-info-get');
		expect(info.data?.host).toBe('browser');
		await booted.kernel.dispose();
		await booted.journal.close();
	});

	it('aborts waitForLock cleanly when its signal aborts (#1634)', async () => {
		const indexedDB = new IDBFactory();
		const locks = fakeLocks();
		const first = await createHostKernel({ environment, indexedDB, locks });
		if (first.kind !== 'ready') throw new Error('expected first kernel');
		const second = await createHostKernel({ environment, indexedDB, locks, lockPatienceMs: 10 });
		if (second.kind !== 'locked') throw new Error('expected locked');
		const controller = new AbortController();
		const waiting = second.waitForLock(controller.signal);
		controller.abort();
		await expect(waiting).rejects.toThrow(/abort/i);
		await first.kernel.dispose();
		await first.journal.close();
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
		// Kernel interface version 5 (phase 5 specification, 3.2).
		expect(host.kernel.version).toBe(5);
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
