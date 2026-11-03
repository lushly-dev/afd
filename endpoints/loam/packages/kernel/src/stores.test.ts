/**
 * P2-E10: the stores and the migration (phase 2 specification, section 4 and 5; D63, D73, D77), over
 * `MemoryAdapter` and `IndexedDbAdapter` on `fake-indexeddb`. Their Chromium part waits for step 7.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { ProjectionV2 } from '@lushly-dev/loam-manifest';
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
			package: 'apps/tasks/',
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
		expect((await applied()).at(-1)?.result.data).toEqual({ added: 0, changed: 2, unlisted: 1 });
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

	it('keeps no location, credential or command line in the store', async () => {
		const store = new MemoryAdapter();
		const deployment = scopedDeployment();
		deployment.apps.push({
			instance: 'work',
			app: 'umbel',
			package: 'apps/umbel/',
			audience: 'team',
			transport: 'http',
			route: 'mounts/work/',
			projects: ['atlas'],
		});
		const workspace = await createScopedWorkspace({ store, deployment });
		kernels.push(workspace.kernel);
		const rows = JSON.stringify((await store.list('workspace-app')).data);
		for (const key of ['"url"', '"bearer_file"', '"bearer_env"', '"command"', '"cwd"']) {
			expect(rows).not.toContain(key);
		}
		expect(rows).toContain('"route":"mounts/work/"');
	});

	it('refuses a key that would name another scope, as a TypeError', () => {
		expect(() => checked('p~prj_beacon~t-1')).toThrow(TypeError);
		expect(() => checked('.')).toThrow(TypeError);
		expect(checked('t-1')).toBe('t-1');
	});
});
