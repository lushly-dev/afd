/**
 * New and the palette's document rows (documents specification, 7 and 8.2; step 11): `new-list` by scope,
 * with recents first, `loam.new.recent` read-only and persisted, a restricted project's answer the same as
 * a missing one's, the palette's titles filtered for the actor at query time, and the editor owner's
 * commands first. D8's Chromium half is `web/test/browser/documents/new.test.ts`.
 */

import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import type { DocumentRecordV1, NewItemV1 } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import type { PaletteItem } from '../palette-index.js';
import { scopedPackages, TASKS_DEFINITION, TASKS_MANIFEST } from '../scope/fixtures.js';
import {
	createScopedWorkspace,
	documentsDeployment,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
} from '../testing.js';
import { PROBE_DOCUMENTS_DEFINITION, PROBE_DOCUMENTS_MANIFEST } from '../testing-documents.js';
import { createFixturePorts } from '../testing-probe.js';
import type { LoamKernelV2 } from '../types.js';

const kernels: LoamKernelV2[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

/** `tasks` with a creator, project-only as the app is: `tasks-list` needs no input. */
const TASKS_WITH_NEW = {
	...TASKS_MANIFEST,
	ui: {
		...TASKS_MANIFEST.ui,
		new: [{ title: 'Task', icon: 'system/checkmark', command: 'tasks-list' }],
	},
} as unknown as ManifestV2;

const ports = () =>
	createFixturePorts({
		...scopedPackages(),
		'fixtures/tasks/': { manifest: TASKS_WITH_NEW, definition: TASKS_DEFINITION },
		'fixtures/probe/': {
			manifest: PROBE_DOCUMENTS_MANIFEST,
			definition: PROBE_DOCUMENTS_DEFINITION,
		},
	});

async function workspace(options: ScopedWorkspaceOptions = {}): Promise<ScopedWorkspace> {
	const held = await createScopedWorkspace({
		deployment: documentsDeployment(),
		ports: ports(),
		...options,
	});
	kernels.push(held.kernel);
	return held;
}

const WORKSPACE = { workspace: 'personal' };

const items = async (held: ScopedWorkspace, scope: object = WORKSPACE): Promise<NewItemV1[]> => {
	const result = await held.kernel.call<{ items: NewItemV1[] }>(
		'new-list',
		{},
		{
			scope: scope as never,
		}
	);
	expect(result.error).toBeFalsy();
	return result.data?.items ?? [];
};

const labels = (rows: NewItemV1[]) =>
	rows.map((row) =>
		row.kind === 'document'
			? `${row.type}/${row.template}${row.recent ? '*' : ''}`
			: `${row.instance}:${row.command}`
	);

describe('P2-D8 (kernel unit): new-list by scope, recents first', () => {
	it("lists each template of the call level's types and each creator, by the rail's order", async () => {
		const held = await workspace();
		// At workspace level: `probe` at either level; the project-only memo and tasks' creator are not here.
		expect(labels(await items(held))).toEqual(['probe/blank', 'probe/greeting']);
		// In Atlas: by the rail's order, `order` then the instance, each app's in its manifest's order.
		expect(labels(await items(held, held.scopes.atlas))).toEqual([
			'probe/blank',
			'probe/greeting',
			'probe-memo/blank',
			'tasks:tasks-list',
		]);
		const creator = (await items(held, held.scopes.atlas)).at(-1);
		expect(creator).toEqual({
			kind: 'creator',
			instance: 'tasks',
			command: 'tasks-list',
			title: 'Task',
			icon: 'system/checkmark',
		});
		const blank = (await items(held)).find((row) => row.kind === 'document');
		expect(blank).toEqual({
			kind: 'document',
			type: 'probe',
			template: 'blank',
			title: 'Blank probe',
			icon: 'system/document',
			recent: false,
		});
	});

	it("puts the last five distinct types and templates first, written only by the New menu's create", async () => {
		const held = await workspace();
		const { kernel, scopes } = held;
		const create = (input: object, scope: object) =>
			kernel.call<DocumentRecordV1>('document-create', input, { scope: scope as never });
		// No `recent`: an agent's create changes nothing New shows.
		await create({ type: 'probe', template: 'greeting' }, WORKSPACE);
		expect(labels(await items(held))).toEqual(['probe/blank', 'probe/greeting']);
		await create({ type: 'probe-memo', recent: true }, scopes.atlas);
		await create({ type: 'probe', template: 'greeting', recent: true }, WORKSPACE);
		expect(labels(await items(held, scopes.atlas))).toEqual([
			'probe/greeting*',
			'probe-memo/blank*',
			'probe/blank',
			'tasks:tasks-list',
		]);
		// A recent of a level the scope does not allow is not listed there.
		expect(labels(await items(held))).toEqual(['probe/greeting*', 'probe/blank']);
		// A refused create keeps nothing: an unknown template.
		expect(
			(await create({ type: 'probe', template: 'nope', recent: true }, WORKSPACE)).error?.code
		).toBe('DOCUMENT_TEMPLATE_UNKNOWN');
		await create({ type: 'probe', recent: true }, WORKSPACE);
		expect(labels(await items(held))).toEqual(['probe/blank*', 'probe/greeting*']);
		const record = await kernel.call<{ state: { items: unknown[] } }>('view-state-get', {
			id: 'loam.new.recent',
		});
		expect(record.data?.state.items).toEqual([
			{ type: 'probe', template: 'blank' },
			{ type: 'probe', template: 'greeting' },
			{ type: 'probe-memo', template: 'blank' },
		]);
	});

	it('keeps at most five, and reads them again after a reload', async () => {
		const store = new MemoryAdapter();
		const held = await workspace({ store });
		const { kernel, scopes } = held;
		for (const [type, template, scope] of [
			['probe', 'blank', WORKSPACE],
			['probe', 'greeting', WORKSPACE],
			['probe-memo', 'blank', scopes.atlas],
			['probe', 'blank', scopes.beacon],
			['probe', 'greeting', scopes.atlas],
		] as const) {
			await kernel.call('document-create', { type, template, recent: true }, { scope });
		}
		const before = await kernel.call('view-state-get', { id: 'loam.new.recent' });
		expect((before.data as { state: { items: unknown[] } }).state.items).toHaveLength(3);
		await kernel.dispose();
		const again = await workspace({ store });
		expect(labels(await items(again, again.scopes.atlas))).toEqual([
			'probe/greeting*',
			'probe/blank*',
			'probe-memo/blank*',
			'tasks:tasks-list',
		]);
	});

	it('refuses view-state-set of loam.new.recent, naming document-create', async () => {
		const held = await workspace();
		const result = await held.kernel.call('view-state-set', {
			id: 'loam.new.recent',
			state: { items: [] },
		});
		expect(result.error?.code).toBe('VIEW_STATE_READ_ONLY');
		expect(result.error?.suggestion).toContain('document-create');
	});

	it('answers a restricted project as a missing one, and lists nothing there', async () => {
		const held = await workspace();
		const refused = await held.kernel.call('new-list', {}, { scope: held.scopes.citadel });
		const missing = await held.kernel.call(
			'new-list',
			{},
			{ scope: { workspace: 'personal', project: 'prj_nowhere' } }
		);
		expect(refused.success).toBe(false);
		expect(JSON.stringify(refused.error)).toBe(JSON.stringify(missing.error));
		expect(refused.error?.code).toBe('PROJECT_NOT_FOUND');
	});

	it("leaves out a disabled instance's types and creators", async () => {
		const held = await workspace();
		await held.kernel.call('workspace-app-set', { instance: 'tasks', enabled: false });
		expect(labels(await items(held, held.scopes.atlas))).toEqual([
			'probe/blank',
			'probe/greeting',
			'probe-memo/blank',
		]);
		await held.kernel.call('workspace-app-set', { instance: 'probe', enabled: false });
		expect(await items(held, held.scopes.atlas)).toEqual([]);
	});
});

const search = async (held: ScopedWorkspace, query: string): Promise<PaletteItem[]> =>
	(await held.kernel.call<{ items: PaletteItem[] }>('palette-search', { query })).data?.items ?? [];

const documentRows = (rows: PaletteItem[]) =>
	rows.filter((row) => row.kind === 'document').map((row) => `${row.title}: ${row.description}`);

describe("P2-D8 (kernel unit): the palette's document rows (8.2)", () => {
	it('finds active titles, each filtered through decideAccess at query time', async () => {
		const held = await workspace();
		const { kernel, scopes } = held;
		const roadmap = (
			await kernel.call<DocumentRecordV1>(
				'document-create',
				{ type: 'probe', title: 'Roadmap' },
				{ scope: scopes.atlas }
			)
		).data as DocumentRecordV1;
		await kernel.call(
			'document-create',
			{ type: 'probe', title: 'Road trip' },
			{ scope: WORKSPACE }
		);
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'someone@example.com',
			password: 'x',
		});
		await kernel.call(
			'document-create',
			{ type: 'probe', title: 'Roadmap of the vault' },
			{ scope: scopes.citadel }
		);
		expect(documentRows(await search(held, 'roadmap')).sort()).toEqual([
			'Roadmap of the vault: Probe note in Citadel',
			'Roadmap: Probe note in Atlas',
		]);
		// Signed out, the same index answers without Citadel's title.
		await kernel.call('auth-sign-out');
		expect(documentRows(await search(held, 'road')).sort()).toEqual([
			'Road trip: Probe note in the workspace',
			'Roadmap: Probe note in Atlas',
		]);
		const [row] = (await search(held, 'roadmap')).filter((item) => item.kind === 'document');
		expect(row).toMatchObject({ name: roadmap.id, kind: 'document', field: 'title' });
		// A rename, a trash and a restore each reach the next query; an empty query lists commands alone.
		const renamed = await kernel.call(
			'document-rename',
			{ document: roadmap.id, title: 'Plan' },
			{ scope: scopes.atlas }
		);
		expect(renamed.error).toBeFalsy();
		expect(documentRows(await search(held, 'roadmap'))).toEqual([]);
		expect(documentRows(await search(held, 'plan'))).toEqual(['Plan: Probe note in Atlas']);
		await kernel.call('document-trash', { document: roadmap.id });
		expect(documentRows(await search(held, 'plan'))).toEqual([]);
		await kernel.call('document-restore', { document: roadmap.id });
		expect(documentRows(await search(held, 'plan'))).toEqual(['Plan: Probe note in Atlas']);
		expect(documentRows(await search(held, ''))).toEqual([]);
	});

	it("lists the editor owner's commands with no app active, its instance commands first (5.4)", async () => {
		const held = await workspace();
		const { kernel } = held;
		const names = async (query: string) => (await search(held, query)).map((item) => item.name);
		expect((await names('probe')).some((name) => name.startsWith('probe-'))).toBe(false);
		const record = (
			await kernel.call<DocumentRecordV1>('document-create', { type: 'probe', title: 'Owner' })
		).data as DocumentRecordV1;
		await kernel.call('document-open', { document: record.id });
		const shown = (await names('probe')).filter((name) => name.startsWith('probe-'));
		expect(shown).toContain('probe-reach');
		expect(shown.indexOf('probe-reach')).toBeGreaterThan(shown.indexOf('probe-content-get'));
		expect(
			shown.slice(0, -2).every((name) => name !== 'probe-reach' && name !== 'probe-memo-get')
		).toBe(true);
		// An app opened takes the palette back.
		await kernel.call('app-open', { instance: 'dual' });
		expect((await names('probe')).some((name) => name.startsWith('probe-'))).toBe(false);
	});
});
