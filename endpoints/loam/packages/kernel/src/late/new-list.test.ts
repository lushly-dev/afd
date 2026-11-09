/**
 * New and the palette's document rows (documents specification, 7 and 8.2; step 11): `new-list` by scope,
 * with recents first, kept per person in `loam.new.recent~<actor>`, read-only and persisted, a restricted project's answer the same as
 * a missing one's, the palette's titles filtered for the actor at query time, and the editor owner's
 * commands first. D8's Chromium half is `web/test/browser/documents/new.test.ts`.
 */

import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
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
import { createNewParts, newRecentId } from './new-list.js';

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

/** `probe` with six templates of its own type, for the recents' bound. */
const PROBE_SIX = (() => {
	const manifest = structuredClone(PROBE_DOCUMENTS_MANIFEST) as unknown as {
		ui: { documents: Array<{ templates: Array<{ id: string; title: string; content: unknown }> }> };
	};
	const [probe] = manifest.ui.documents;
	if (probe) {
		for (const n of [3, 4, 5, 6])
			probe.templates.push({ id: `t${n}`, title: `T${n}`, content: { text: '' } });
	}
	return manifest as unknown as ManifestV2;
})();

const ports = (probe: ManifestV2 = PROBE_DOCUMENTS_MANIFEST) =>
	createFixturePorts({
		...scopedPackages(),
		'fixtures/tasks/': { manifest: TASKS_WITH_NEW, definition: TASKS_DEFINITION },
		'fixtures/probe/': { manifest: probe, definition: PROBE_DOCUMENTS_DEFINITION },
	});

async function workspace(
	options: ScopedWorkspaceOptions = {},
	probe?: ManifestV2
): Promise<ScopedWorkspace> {
	const held = await createScopedWorkspace({
		deployment: documentsDeployment(),
		ports: ports(probe),
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
			id: newRecentId('local'),
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
		const before = await kernel.call('view-state-get', { id: newRecentId('local') });
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

	it("refuses view-state-set of a person's recents, naming document-create", async () => {
		const held = await workspace();
		const result = await held.kernel.call('view-state-set', {
			id: newRecentId('local'),
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

describe('P2-D8 (kernel unit): recents per person, bounded at five (7, G-S2, T-N2)', () => {
	it('keeps five: a sixth evicts the oldest, and creating one again moves it first with no copy', async () => {
		const held = await workspace({}, PROBE_SIX);
		const { kernel } = held;
		const recentOf = async () =>
			(
				(await kernel.call('view-state-get', { id: newRecentId('local') })).data as {
					state: { items: Array<{ template: string }> };
				}
			).state.items.map((item) => item.template);
		for (const template of ['blank', 'greeting', 't3', 't4', 't5']) {
			await kernel.call('document-create', { type: 'probe', template, recent: true });
		}
		expect(await recentOf()).toEqual(['t5', 't4', 't3', 'greeting', 'blank']);
		await kernel.call('document-create', { type: 'probe', template: 't6', recent: true });
		expect(await recentOf()).toEqual(['t6', 't5', 't4', 't3', 'greeting']);
		await kernel.call('document-create', { type: 'probe', template: 't3', recent: true });
		expect(await recentOf()).toEqual(['t3', 't6', 't5', 't4', 'greeting']);
		expect(labels(await items(held)).slice(0, 5)).toEqual([
			'probe/t3*',
			'probe/t6*',
			'probe/t5*',
			'probe/t4*',
			'probe/greeting*',
		]);
	});

	it("shows each person their own recents, and no one else's record, signed out among them", async () => {
		const held = await workspace();
		const { kernel } = held;
		await kernel.call('document-create', { type: 'probe', template: 'greeting', recent: true });
		expect(labels(await items(held))).toEqual(['probe/greeting*', 'probe/blank']);
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'someone@example.com',
			password: 'x',
		});
		// Someone else: none of the signed-out person's, and not their record.
		expect(labels(await items(held))).toEqual(['probe/blank', 'probe/greeting']);
		const theirs = await kernel.call('view-state-get', { id: newRecentId('local') });
		expect(theirs.error?.code).toBe('VIEW_STATE_NOT_FOUND');
		const listed = (await kernel.call<{ states: Array<{ id: string }> }>('view-state-list')).data;
		expect(listed?.states.map((state) => state.id)).not.toContain(newRecentId('local'));
		await kernel.call('document-create', { type: 'probe', template: 'blank', recent: true });
		expect(labels(await items(held))).toEqual(['probe/blank*', 'probe/greeting']);
		await kernel.call('auth-sign-out');
		expect(labels(await items(held))).toEqual(['probe/greeting*', 'probe/blank']);
		const someone = await kernel.call('view-state-get', {
			id: newRecentId('mock-user-someone@example.com'),
		});
		expect(someone.error?.code).toBe('VIEW_STATE_NOT_FOUND');
	});
});

describe("P2-D8 (kernel unit): a creator only runs its own app's command (T-B1)", () => {
	it('lists a ui.new entry only when its app owns the command, whatever the manifest says', async () => {
		const summary = {
			instance: 'own',
			app: 'own',
			order: 1,
			state: 'ready',
			scopeLevels: ['workspace'],
		};
		const parts = createNewParts({
			viewState: new ViewStateRegistry(),
			scope: {
				workspaceApps: new Map(),
				opensIn: () => true,
			} as never,
			check: {
				types: () => ({ types: new Map(), conflicts: new Map() }),
				opens: () => undefined,
			} as never,
			apps: () =>
				({
					summaries: () => [summary],
					owners: new Map([
						['own-blank', { instance: 'own' }],
						['auth-sign-out', { instance: 'shell' }],
						['other-make', { instance: 'other' }],
					]),
					port: () => ({
						manifest: {
							ui: {
								new: [
									{ title: 'Mine', icon: 'system/document', command: 'own-blank' },
									{ title: 'Sign out', icon: 'system/document', command: 'auth-sign-out' },
									{ title: 'Theirs', icon: 'system/document', command: 'other-make' },
									{ title: 'Nobody', icon: 'system/document', command: 'nobody-make' },
								],
							},
						},
					}),
				}) as never,
		});
		const result = (await parts.command.handler({}, {
			scope: { workspace: 'personal' },
		} as never)) as {
			data: { items: Array<{ command?: string }> };
		};
		expect(result.data.items.map((item) => item.command)).toEqual(['own-blank']);
	});
});

describe("P2-D8 (kernel unit): the palette's rows after a write during a build", () => {
	it('builds again when a record is written while the index is being read, so an old title never shows', async () => {
		let gate: (() => void) | undefined;
		let holding = false;
		class GatedAdapter extends MemoryAdapter {
			override async list<T>(table: string, params?: Parameters<MemoryAdapter['list']>[1]) {
				const result = await super.list<T>(table, params);
				if (holding && table === 'document') {
					holding = false;
					await new Promise<void>((resolve) => {
						gate = resolve;
					});
				}
				return result;
			}
		}
		const held = await workspace({ store: new GatedAdapter() });
		const { kernel } = held;
		const record = (
			await kernel.call<DocumentRecordV1>('document-create', { type: 'probe', title: 'Before' })
		).data as DocumentRecordV1;
		holding = true;
		const searching = search(held, 'before');
		await expect.poll(() => gate !== undefined).toBe(true);
		await kernel.call('document-rename', { document: record.id, title: 'After' });
		gate?.();
		expect(documentRows(await searching)).toEqual([]);
		expect(documentRows(await search(held, 'after'))).toEqual([
			'After: Probe note in the workspace',
		]);
	});
});

describe('P2-D1 (kernel unit): loam.layout.~documents declares the inspector with a type that has one (5.1)', () => {
	it('declares it while the active tab’s plugin has a type with an inspector, and not with no tab or after a reload’s restore of none', async () => {
		const store = new MemoryAdapter();
		const held = await workspace({ store });
		const { kernel } = held;
		const open = () => kernel.call('layout-set', { inspector: { open: true } });
		await kernel.call('section-open', { section: 'documents' });
		expect((await open()).error?.code).toBe('LAYOUT_PART_UNDECLARED');
		const created = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		await kernel.call('document-open', { document: created.data?.id });
		expect((await open()).success).toBe(true);
		// Closing its tab takes the inspector away again, and an app's main is not the section's.
		await kernel.call('editor-close', { tab: 't1', discard: true });
		expect((await open()).error?.code).toBe('LAYOUT_PART_UNDECLARED');
		await kernel.call('document-open', { document: created.data?.id });
		await kernel.flush();
		await kernel.dispose();
		// A reload restores the tab with no call: stage B declares it as it boots.
		const again = await workspace({ store });
		expect((await again.kernel.call('layout-set', { inspector: { open: false } })).success).toBe(
			true
		);
	});
});

describe('P2-D10 (kernel unit): every layout read agrees while the inspector is undeclared (step 12, S-2)', () => {
	/** `probe` with no inspector: its tab active, `~documents` declares none, as for the browser's sheet. */
	const NO_INSPECTOR = {
		...PROBE_DOCUMENTS_MANIFEST,
		ui: {
			...PROBE_DOCUMENTS_MANIFEST.ui,
			documents: PROBE_DOCUMENTS_MANIFEST.ui?.documents?.map(
				({ inspector: _gone, ...type }) => type
			),
		},
	} as ManifestV2;

	it('answers the inspector closed in layout-get, layout-set’s and layout-reset’s results and view-state-get, storing nothing, and an undo applies as recorded', async () => {
		const store = new MemoryAdapter();
		// The person opened the inspector, in its drawer too, while their note's type had one.
		const first = await workspace({ store });
		await first.kernel.call('section-open', { section: 'documents' });
		const note = await first.kernel.call<{ id: string }>('document-create', { type: 'probe' });
		await first.kernel.call('document-open', { document: note.data?.id });
		const opened = await first.kernel.call('layout-set', {
			inspector: { open: true },
			compact: { drawer: 'inspector' },
		});
		expect(opened.success).toBe(true);
		await first.kernel.flush();
		await first.kernel.dispose();
		// Its type has none now: the inspector is undeclared, and every read says it is closed.
		const second = await workspace({ store }, NO_INSPECTOR);
		const { kernel } = second;
		await kernel.call('section-open', { section: 'documents' });
		type Layout = {
			inspector: { open: boolean };
			compact: { drawer: string | null };
			sidebar: { width: number };
		};
		const shown = (layout?: Layout) => ({
			inspector: layout?.inspector.open,
			drawer: layout?.compact.drawer,
		});
		const closed = { inspector: false, drawer: null };
		expect(shown((await kernel.call<Layout>('layout-get')).data)).toEqual(closed);
		const set = await kernel.call<Layout>('layout-set', { sidebar: { width: 300 } });
		expect(shown(set.data)).toEqual(closed);
		expect(set.data?.sidebar.width).toBe(300);
		for (const id of ['loam.layout', 'loam.layout.~documents']) {
			const read = await kernel.call<{ id: string; state: Layout }>('view-state-get', { id });
			expect(read.data?.id).toBe(id);
			expect(shown(read.data?.state)).toEqual(closed);
		}
		const reset = await kernel.call<Layout>('layout-reset');
		expect(shown(reset.data)).toEqual(closed);
		// Its undo is built from the record, which the reads and the set left as the person had it.
		expect(reset.undoArgs).toMatchObject({
			inspector: { open: true },
			compact: { drawer: 'inspector' },
			sidebar: { width: 300 },
		});
		await kernel.flush();
		await kernel.dispose();
		// Its type has one again: both undos, recorded while it was hidden, apply as recorded, newest first.
		const third = await workspace({ store });
		await third.kernel.call('section-open', { section: 'documents' });
		const layout = async () => (await third.kernel.call<Layout>('layout-get')).data;
		expect((await third.kernel.call('layout-set', reset.undoArgs)).success).toBe(true);
		expect(shown(await layout())).toEqual({ inspector: true, drawer: 'inspector' });
		expect((await layout())?.sidebar.width).toBe(300);
		expect((await third.kernel.call('layout-set', set.undoArgs)).success).toBe(true);
		expect((await layout())?.sidebar.width).toBe(260);
		expect(shown(await layout())).toEqual({ inspector: true, drawer: 'inspector' });
	});
});

describe('P2-D8 (kernel unit): loam.layout.~documents (5.1, G-S3)', () => {
	it('is the documents section’s layout, declaring the sidebar alone, kept apart from the no-app record and across a reload', async () => {
		const store = new MemoryAdapter();
		const held = await workspace({ store });
		const { kernel } = held;
		await kernel.call('section-open', { section: 'documents' });
		const layout = await kernel.call<{ sidebar: { open: boolean; width: number } }>('layout-get');
		expect(layout.data?.sidebar).toEqual({ open: true, width: 260 });
		expect((await kernel.call('layout-set', { inspector: { open: true } })).error?.code).toBe(
			'LAYOUT_PART_UNDECLARED'
		);
		expect((await kernel.call('layout-set', { panel: { open: true } })).error?.code).toBe(
			'LAYOUT_PART_UNDECLARED'
		);
		expect((await kernel.call('layout-set', { sidebar: { width: 320 } })).success).toBe(true);
		const ids = (await kernel.call<{ states: Array<{ id: string }> }>('view-state-list')).data;
		expect(ids?.states.map((state) => state.id)).toContain('loam.layout.~documents');
		// The no-app record keeps its own width, and the projects section its own.
		await kernel.call('app-close');
		const width = async () =>
			(await kernel.call<{ sidebar: { width: number } }>('layout-get')).data?.sidebar.width;
		expect(await width()).toBe(260);
		await kernel.call('section-open', { section: 'documents' });
		expect(await width()).toBe(320);
		await kernel.flush();
		await kernel.dispose();
		const again = await workspace({ store });
		await again.kernel.call('section-open', { section: 'documents' });
		expect(
			(await again.kernel.call<{ sidebar: { width: number } }>('layout-get')).data?.sidebar.width
		).toBe(320);
	});
});

describe("P2-D8 (kernel unit): the palette's needs-input flag agrees with New's (step 11's re-check)", () => {
	it('marks a command needing input in every anyOf branch, or by minProperties, as New refuses it', async () => {
		const branchy = (extra: object) => ({
			type: 'object',
			properties: { a: { type: 'string' }, b: { type: 'string' } },
			...extra,
		});
		// A branch's `required` counts only with the branch's `type`, which the manifest's rule asks for.
		const requires = (name: string) => ({
			type: 'object',
			properties: { [name]: { type: 'string' } },
			required: [name],
		});
		const manifest = structuredClone(TASKS_WITH_NEW) as unknown as {
			commands: Array<Record<string, unknown>>;
		};
		manifest.commands.push(
			{
				name: 'tasks-either',
				title: 'Either',
				description: 'One of two.',
				effects: ['inspect'],
				input_schema: branchy({ anyOf: [requires('a'), requires('b')] }),
			},
			{
				name: 'tasks-some',
				title: 'Some',
				description: 'At least one.',
				effects: ['inspect'],
				input_schema: branchy({ minProperties: 1 }),
			},
			{
				// Only the validator's parse sees it: the `apps` chunk's answer, on the command's owner.
				name: 'tasks-twice',
				title: 'Twice',
				description: 'Two branches that every input meets.',
				effects: ['inspect'],
				input_schema: branchy({ oneOf: [{ type: 'object' }, { type: 'object' }] }),
			}
		);
		const held = await createScopedWorkspace({
			deployment: documentsDeployment(),
			ports: createFixturePorts({
				...scopedPackages(),
				'fixtures/tasks/': {
					manifest: manifest as unknown as ManifestV2,
					definition: TASKS_DEFINITION,
				},
				'fixtures/probe/': {
					manifest: PROBE_DOCUMENTS_MANIFEST,
					definition: PROBE_DOCUMENTS_DEFINITION,
				},
			}),
		});
		kernels.push(held.kernel);
		// Tasks is project-only: its commands are listed in a project.
		await held.kernel.call('scope-set', { project: 'atlas' });
		const flags = new Map(
			held.kernel.listCommands().map((command) => [command.name, command.needsInput])
		);
		expect(flags.get('tasks-either')).toBe(true);
		expect(flags.get('tasks-some')).toBe(true);
		expect(flags.get('tasks-twice')).toBe(true);
		expect(flags.get('tasks-list')).toBe(false);
		expect(flags.get('tasks-add')).toBe(true);
	});
});
