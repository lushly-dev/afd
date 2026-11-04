/**
 * P2-E10: the stores and the migration (phase 2 specification, section 4 and 5; D63, D73, D77), over
 * `MemoryAdapter` and `IndexedDbAdapter` on `fake-indexeddb`. Their Chromium part waits for step 7.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { type BootProjectionV2, type ProjectionV2, readBoot } from '@lushly-dev/loam-manifest';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { checked, createAppStore, storeRecordId } from './apps/store.js';
import { BOOT_ONLY, INTERNAL_COMMANDS } from './commands.js';
import { createKernel } from './kernel.js';
import { checkStamped } from './late/stores.js';
import {
	createFixedEnvironment,
	createScopedWorkspace,
	createSteppingClock,
	scopedDeployment,
	scopedPorts,
} from './testing.js';
import type { LoamKernelV2, WorkspaceAppV1 } from './types.js';

const kernels: LoamKernelV2[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

let databases = 0;
const adapters: Array<[string, () => DataAdapter]> = [
	['MemoryAdapter', () => new MemoryAdapter()],
	[
		'IndexedDbAdapter',
		() => new IndexedDbAdapter({ name: `loam-store-${++databases}`, indexedDB: new IDBFactory() }),
	],
];

/** Every key of a projection entry the deployer alone writes, which no reachable input may hold (4.1). */
const DEPLOYER_KEYS = [
	'command',
	'cwd',
	'url',
	'bearer',
	'transport',
	'route',
	'projects',
	'space',
	'expose',
	'audience',
	'prefix',
];

/** Every property name a JSON Schema holds, at any depth. */
function propertyNames(schema: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(schema)) for (const item of schema) propertyNames(item, into);
	else if (typeof schema === 'object' && schema !== null) {
		const { properties } = schema as { properties?: Record<string, unknown> };
		for (const name of Object.keys(properties ?? {})) into.add(name);
		for (const value of Object.values(schema)) propertyNames(value, into);
	}
	return into;
}

describe.each(adapters)('P2-E10: the stores over %s', (_name, adapter) => {
	it('writes each table with its workspace, its scope, its actor and its times', async () => {
		const store = adapter();
		const workspace = await createScopedWorkspace({ store });
		kernels.push(workspace.kernel);
		const { kernel } = workspace;
		await kernel.call('scope-set', { project: 'atlas' });
		await kernel.call('tasks-add', { task: 't-1', title: 'One' });
		const row = await store.get<Record<string, unknown>>(
			'app-tasks',
			storeRecordId(workspace.scopes.atlas, 't-1')
		);
		expect(row).toMatchObject({
			key: 't-1',
			workspace: 'personal',
			scope: workspace.scopes.atlas,
			scopeKey: `p:${workspace.scopes.atlas.project}`,
			actor: null,
		});
		expect(typeof row?.updatedAt).toBe('number');
		expect(await store.get('workspace', 'personal')).toMatchObject({
			id: 'personal',
			name: 'Personal',
			generation: 'scoped',
			trashDays: 30,
			organization: null,
			tenant: null,
			updatedBy: 'local',
		});
		const atlas = await store.get<Record<string, unknown>>('project', workspace.projects.atlas.id);
		expect(atlas).toMatchObject({ workspace: 'personal', createdBy: 'local', updatedBy: 'local' });
		expect(typeof atlas?.createdAt).toBe('number');
		expect(await store.get('workspace-app', 'tasks')).toMatchObject({
			id: 'tasks',
			workspace: 'personal',
			app: 'tasks',
			package: 'fixtures/tasks/',
			overrides: {},
			listed: 'scoped',
			updatedBy: 'local',
		});
	});

	it('refuses a write without its workspace or its actor', () => {
		expect(() =>
			checkStamped('project', { id: 'p', updatedAt: 1, updatedBy: 'local' } as never)
		).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
		expect(() =>
			checkStamped('project', { id: 'p', workspace: 'w', updatedAt: 1, updatedBy: '' })
		).toThrow(expect.objectContaining({ details: { table: 'project', missing: ['updatedBy'] } }));
		expect(() =>
			checkStamped('workspace', { id: 'w', updatedAt: Number.NaN, updatedBy: 'local' })
		).toThrow(expect.objectContaining({ details: { table: 'workspace', missing: ['updatedAt'] } }));
		expect(() =>
			checkStamped('workspace-app', { id: 'a', workspace: 'w', updatedAt: 1, updatedBy: 'local' })
		).not.toThrow();
	});

	it("reads phase 1's rows at workspace level, keeping their ids, and keeps a project's apart", async () => {
		const store = adapter();
		// As phase 1 wrote them: `scope: null`, no `scopeKey`, no workspace.
		await store.batch(
			['a', 'b'].map((key) => ({
				method: 'PUT' as const,
				path: `/app-dual/${key}`,
				body: { id: key, key, value: key, app: 'dual', instance: 'dual', actor: null, scope: null },
			}))
		);
		const at = (scope: { workspace: string; project?: string }) =>
			createAppStore({ adapter: store, app: 'dual', instance: 'dual', scope, now: () => 1 });
		const workspace = at({ workspace: 'personal' });
		const atlas = at({ workspace: 'personal', project: 'prj_atlas' });
		const beacon = at({ workspace: 'personal', project: 'prj_beacon' });
		expect(await workspace.list()).toEqual([
			{ key: 'a', value: 'a' },
			{ key: 'b', value: 'b' },
		]);
		await atlas.put('a', 'atlas');
		expect(await atlas.get('a')).toBe('atlas');
		expect(await workspace.get('a')).toBe('a');
		expect(await beacon.get('a')).toBeUndefined();
		expect(await beacon.list()).toEqual([]);
		expect((await workspace.list()).map((row) => row.key)).toEqual(['a', 'b']);
		expect(await atlas.list()).toEqual([{ key: 'a', value: 'atlas' }]);
		await workspace.put('c', 'w');
		expect((await store.get<{ id: string }>('app-dual', 'c'))?.id).toBe('c');
		await atlas.delete('a');
		expect(await workspace.get('a')).toBe('a');
	});

	it('applies a new generation once: it adds, changes and unlists, keeping overrides, journaled', async () => {
		const store = adapter();
		const journal = new MemoryJournalSink();
		const boot = async (deployment: ProjectionV2) => {
			const kernel = await createKernel({
				store,
				storeKind: 'memory',
				journal,
				auth: new MockAuthAdapter(),
				environment: createFixedEnvironment(),
				host: 'test',
				clock: createSteppingClock(Date.UTC(2026, 0, 1 + kernels.length)),
				deployment,
			});
			kernels.push(kernel);
			return kernel;
		};
		const first = await boot(scopedDeployment());
		await first.call('workspace-app-set', { instance: 'solo', enabled: false, title: 'Alone' });
		const applied = async () =>
			(await journal.read()).filter((entry) => entry.command === 'workspace-deployment-apply');
		expect((await applied()).map((entry) => entry.result.data)).toEqual([
			{ added: 3, changed: 0, unlisted: 0 },
		]);
		// The same generation again: nothing is journaled.
		await boot(scopedDeployment());
		expect(await applied()).toHaveLength(1);
		// A new one drops `tasks` and changes `solo`'s order.
		const next = scopedDeployment();
		next.generation = 'next';
		next.apps = next.apps
			.filter((entry) => entry.instance !== 'tasks')
			.map((entry) => (entry.instance === 'solo' ? { ...entry, order: 5 } : entry));
		await boot(next);
		// `solo`'s order changed; `dual` was listed again as it was, which is no change.
		expect((await applied()).at(-1)?.result.data).toEqual({ added: 0, changed: 1, unlisted: 1 });
		const solo = await store.get<WorkspaceAppV1>('workspace-app', 'solo');
		expect(solo).toMatchObject({
			order: 5,
			listed: 'next',
			overrides: { enabled: false, title: 'Alone' },
		});
		expect(await store.get('workspace-app', 'tasks')).toMatchObject({ listed: null });
		expect(await store.get('workspace', 'personal')).toMatchObject({ generation: 'next' });
	});

	it('journals none of it on an empty shell', async () => {
		const journal = new MemoryJournalSink();
		const kernel = await createKernel({
			store: adapter(),
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
		});
		kernels.push(kernel);
		await kernel.call('scope-get');
		await kernel.call('section-get');
		expect(await journal.read()).toEqual([]);
	});
});

describe('P2-E10: the workspace store across boots', () => {
	/** A boot kernel over `store`, its stage B reading through `loader`. */
	async function bootOver(
		store: DataAdapter,
		journal: MemoryJournalSink,
		loader: () => Promise<{ deployment: ProjectionV2; ports: ReturnType<typeof scopedPorts> }>,
		day: number
	) {
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			clock: createSteppingClock(Date.UTC(2026, 0, day)),
			boot: readBoot(scopedDeployment()) as BootProjectionV2,
			appsLoader: loader,
		});
		kernels.push(kernel);
		await kernel.startApps();
		return kernel;
	}

	it('applies a deployment that a project created while the loader failed has not claimed', async () => {
		const store = new MemoryAdapter();
		const journal = new MemoryJournalSink();
		const failing = await bootOver(store, journal, () => Promise.reject(new Error('Offline')), 1);
		expect((await failing.call('project-create', { name: 'Atlas' })).success).toBe(true);
		// The row exists, and claims no generation a projection can have.
		expect(await store.get('workspace', 'personal')).toMatchObject({ generation: 'unapplied' });
		await failing.dispose();
		await bootOver(
			store,
			journal,
			async () => ({ deployment: scopedDeployment(), ports: scopedPorts() }),
			2
		);
		const applied = (await journal.read()).filter(
			(entry) => entry.command === 'workspace-deployment-apply'
		);
		expect(applied).toHaveLength(1);
		expect(applied[0]?.result.data).toEqual({ added: 3, changed: 0, unlisted: 0 });
		expect(await store.get('workspace', 'personal')).toMatchObject({ generation: 'scoped' });
	});

	it('lets no call made while stage B applies run beside it: a workspace-app-set waits, and keeps its write', async () => {
		const inner = new MemoryAdapter();
		let kernel: LoamKernelV2 | undefined;
		let during: Promise<{ success: boolean; error?: { code: string } }> | undefined;
		// Made while the apply's handler writes its first record, after stage B has read the late commands.
		const store = Object.assign(Object.create(inner), {
			batch: (operations: Array<{ path: string }>) => {
				if (!during && kernel && operations[0]?.path.startsWith('/workspace-app/')) {
					during = kernel.call('workspace-app-set', { instance: 'solo', title: 'Alone' });
				}
				return inner.batch(operations as never);
			},
		}) as MemoryAdapter;
		const journal = new MemoryJournalSink();
		kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: readBoot(scopedDeployment()) as BootProjectionV2,
			appsLoader: async () => ({ deployment: scopedDeployment(), ports: scopedPorts() }),
		});
		kernels.push(kernel);
		await kernel.startApps();
		expect(during).toBeDefined();
		expect(await during).toMatchObject({ success: true });
		expect((await journal.read()).map((entry) => entry.command)).toEqual([
			'workspace-deployment-apply',
			'workspace-app-set',
		]);
		expect(await inner.get('workspace-app', 'solo')).toMatchObject({
			overrides: { title: 'Alone' },
		});
	});

	it("reports stage B's apply as a mutation on its event", async () => {
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: readBoot(scopedDeployment()) as BootProjectionV2,
			appsLoader: async () => ({ deployment: scopedDeployment(), ports: scopedPorts() }),
		});
		kernels.push(kernel);
		const events: Array<{ command: string; mutation: boolean }> = [];
		kernel.subscribe((event) => events.push(event));
		await kernel.startApps();
		expect(events.find((event) => event.command === 'workspace-deployment-apply')).toMatchObject({
			mutation: true,
		});
	});

	it('counts an entry listed again, as it was, as changed', async () => {
		const store = new MemoryAdapter();
		const journal = new MemoryJournalSink();
		const boot = async (deployment: ProjectionV2, day: number) => {
			const kernel = await createKernel({
				store,
				storeKind: 'memory',
				journal,
				auth: new MockAuthAdapter(),
				environment: createFixedEnvironment(),
				host: 'test',
				clock: createSteppingClock(Date.UTC(2026, 0, day)),
				deployment,
			});
			kernels.push(kernel);
		};
		const without = scopedDeployment();
		without.generation = 'without';
		without.apps = without.apps.filter((entry) => entry.instance !== 'tasks');
		await boot(scopedDeployment(), 1);
		await boot(without, 2);
		// `tasks` is listed again, unchanged: it was unlisted, so it changed.
		await boot(scopedDeployment(), 3);
		const applied = (await journal.read())
			.filter((entry) => entry.command === 'workspace-deployment-apply')
			.map((entry) => entry.result.data);
		expect(applied).toEqual([
			{ added: 3, changed: 0, unlisted: 0 },
			{ added: 0, changed: 0, unlisted: 1 },
			{ added: 0, changed: 1, unlisted: 0 },
		]);
	});

	it('fails the apply alone when the store cannot be read: the late commands load', async () => {
		const inner = new MemoryAdapter();
		const store = Object.assign(Object.create(inner), {
			list: (table: string, params?: never) =>
				table === 'workspace' ? Promise.reject(new Error('Unreadable')) : inner.list(table, params),
		}) as MemoryAdapter;
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: readBoot(scopedDeployment()) as BootProjectionV2,
			appsLoader: async () => ({ deployment: scopedDeployment(), ports: scopedPorts() }),
		});
		kernels.push(kernel);
		await kernel.startApps();
		expect(kernel.lateFailure).toBeUndefined();
		expect((await kernel.call('app-close')).success).toBe(true);
		expect((await kernel.call('dual-where')).success).toBe(true);
	});

	it('undoes a workspace-app-set to overrides that were never set, and back', async () => {
		const workspace = await createScopedWorkspace({ empty: true });
		kernels.push(workspace.kernel);
		const { kernel } = workspace;
		const set = await kernel.call<WorkspaceAppV1>('workspace-app-set', {
			instance: 'solo',
			enabled: false,
			title: 'Alone',
		});
		expect(set.data?.overrides).toEqual({ enabled: false, title: 'Alone' });
		expect(set.undoArgs).toEqual({ instance: 'solo', enabled: null, title: null });
		const undone = await kernel.call<WorkspaceAppV1>('workspace-app-set', set.undoArgs);
		expect(undone.data?.overrides).toEqual({});
		expect(undone.undoArgs).toEqual({ instance: 'solo', enabled: false, title: 'Alone' });
		const redone = await kernel.call<WorkspaceAppV1>('workspace-app-set', undone.undoArgs);
		expect(redone.data?.overrides).toEqual({ enabled: false, title: 'Alone' });
	});
});

describe('P2-E10: what no command, app or agent may write (D55, D56, D73)', () => {
	it("holds no deployer's key in any reachable command's input schema", async () => {
		const workspace = await createScopedWorkspace();
		kernels.push(workspace.kernel);
		const { registries } = workspace;
		for (const registry of [registries.palette, registries.agent]) {
			for (const command of registry.listCommands()) {
				// An internal refusal's `command` is the refused name, written nowhere (5.3).
				if (INTERNAL_COMMANDS.includes(command.name)) continue;
				const found = [...propertyNames(command.inputSchema)].filter((name) =>
					DEPLOYER_KEYS.includes(name)
				);
				expect(found, command.name).toEqual([]);
			}
		}
	});

	it('answers each boot-only command as missing, on both interfaces and through a port', async () => {
		const workspace = await createScopedWorkspace();
		kernels.push(workspace.kernel);
		const { kernel } = workspace;
		for (const name of BOOT_ONLY) {
			for (const result of [
				await kernel.call(name, {}),
				await kernel.agent.call(name, {}),
				await kernel.appPort('dual').call(name, {}),
				await kernel
					.appPort('dual')
					.surface({ scope: { workspace: 'personal' } })
					.call(name, {}),
			]) {
				expect(result.error?.code, name).toBe('COMMAND_NOT_FOUND');
			}
		}
	});

	it('refuses a key that would name another scope, as a TypeError', () => {
		expect(() => checked('p~prj_beacon~t-1')).toThrow(TypeError);
		expect(() => checked('.')).toThrow(TypeError);
		expect(checked('t-1')).toBe('t-1');
	});
});
