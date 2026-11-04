/**
 * The document records (documents specification, sections 2 to 4 and 11; step 9): D3's registry units,
 * D4's record and store over both adapters, and D6's cross-project rows on every path a call takes: a
 * person's, an agent's, an app's port, a surface's port and a handler's nested client. MCP's are in
 * `mcp-scope.test.ts`. The fixture is the `probe` type (`testing-documents.ts`).
 */

import { type CommandResult, MemoryJournalSink } from '@lushly-dev/afd-core';
import {
	type DocumentRecordV1,
	type DocumentTypeV1,
	documentContentKey,
} from '@lushly-dev/loam-sdk';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppStoreRecord } from '../apps/store.js';
import { storeRecordId } from '../scope/store-id.js';
import {
	createScopedWorkspace,
	documentsDeployment,
	documentsPorts,
	replayKernel,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
} from '../testing.js';
import { createFixturePorts } from '../testing-probe.js';
import type { KernelEventV2, LoamKernelV2 } from '../types.js';
import {
	buildDocumentTypes,
	DOCUMENT_INPUT_MAX_BYTES,
	documentContentKey as kernelContentKey,
} from './document-types.js';

const kernels: LoamKernelV2[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

let databases = 0;
const adapters: Array<[string, () => DataAdapter]> = [
	['MemoryAdapter', () => new MemoryAdapter()],
	[
		'IndexedDbAdapter',
		() =>
			new IndexedDbAdapter({ name: `loam-documents-${++databases}`, indexedDB: new IDBFactory() }),
	],
];

async function documents(options: ScopedWorkspaceOptions = {}): Promise<ScopedWorkspace> {
	const workspace = await createScopedWorkspace({
		deployment: documentsDeployment(),
		ports: documentsPorts(),
		...options,
	});
	kernels.push(workspace.kernel);
	return workspace;
}

const WORKSPACE = { workspace: 'personal' };

/** A document, created by the person in `scope`, or failing the test. */
async function created(
	workspace: ScopedWorkspace,
	input: Record<string, unknown> = { type: 'probe' },
	scope?: { workspace: string; project?: string }
): Promise<DocumentRecordV1> {
	const result = await workspace.kernel.call<DocumentRecordV1>(
		'document-create',
		input,
		scope ? { scope } : {}
	);
	expect(result.error).toBeFalsy();
	return result.data as DocumentRecordV1;
}

/** A Citadel document, which only `SOMEONE_ELSE` may enter: created while signed in as them. */
async function citadelDocument(workspace: ScopedWorkspace): Promise<DocumentRecordV1> {
	await workspace.kernel.call('auth-sign-in', {
		method: 'credentials',
		email: 'someone@example.com',
		password: 'x',
	});
	const record = await created(
		workspace,
		{ type: 'probe', title: 'Vault' },
		workspace.scopes.citadel
	);
	await workspace.kernel.call('auth-sign-out');
	return record;
}

const errorOf = (result: CommandResult<unknown>) => JSON.stringify(result.error);

describe('P2-D3: types and the registry', () => {
	it("keys a document's content as the SDK does, `doc/<id>`", () => {
		for (const id of ['doc_abc123def456', 'doc_x']) {
			expect(kernelContentKey(id)).toBe(documentContentKey(id));
			expect(kernelContentKey(id)).toBe(`doc/${id}`);
		}
	});

	it('lists the types the call scope allows, every type with all, and no content', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const ids = async (input: object, scope?: object) =>
			(
				await kernel.call<{ types: DocumentTypeV1[] }>(
					'document-type-list',
					input,
					scope ? { scope: scope as never } : {}
				)
			).data?.types.map((type) => type.id);
		expect(await ids({}, WORKSPACE)).toEqual(['probe']);
		expect(await ids({}, scopes.atlas)).toEqual(['probe', 'probe-memo']);
		expect(await ids({ all: true }, WORKSPACE)).toEqual(['probe', 'probe-memo']);
		const [probe] =
			(await kernel.call<{ types: DocumentTypeV1[] }>('document-type-list', {})).data?.types ?? [];
		expect(probe).toEqual({
			id: 'probe',
			title: 'Probe note',
			icon: 'system/document',
			instance: 'probe',
			app: 'probe',
			scopeLevels: ['workspace', 'project'],
			contentVersion: 2,
			templates: [
				{ id: 'blank', title: 'Blank probe' },
				{ id: 'greeting', title: 'Greeting' },
			],
			surfaces: ['editor'],
			binding: {
				model: 'command',
				selection: 'text-range',
				locator: 'text-range',
				conflict: 'last-writer-wins',
			},
			instanceCommands: ['probe-content-get', 'probe-content-set', 'probe-export'],
			editorKind: 'native',
		});
		expect(JSON.stringify(probe)).not.toContain('Hello');
	});

	it('keeps the earlier app on a type conflict, and gives the later one a notice', () => {
		const manifest = (instance: string) =>
			({
				plugin: { id: 'probe' },
				ui: { documents: [{ ...PROBE_TYPE, title: instance }] },
			}) as never;
		const registry = buildDocumentTypes([
			{ instance: 'first', app: 'probe', kind: 'native', manifest: manifest('first') },
			{ instance: 'second', app: 'probe', kind: 'native', manifest: manifest('second') },
			{ instance: 'remote', app: 'probe', kind: 'mounted', manifest: manifest('remote') },
		]);
		expect([...registry.types.values()].map((type) => [type.id, type.instance])).toEqual([
			['probe', 'first'],
		]);
		expect(registry.conflicts.get('second')?.map((notice) => notice.code)).toEqual([
			'DOCUMENT_TYPE_CONFLICT',
		]);
		expect(registry.conflicts.has('first')).toBe(false);
		expect(registry.conflicts.has('remote')).toBe(false);
	});

	it("leaves a refused plugin's documents in place, and its type unavailable", async () => {
		const store = new MemoryAdapter();
		const first = await documents({ store });
		const record = await created(first, { type: 'probe', title: 'Kept' });
		await first.kernel.dispose();
		// The same store, with the packages unreadable: each app is refused, and its types with it (2.2).
		const broken = createFixturePorts({});
		const failed = await documents({
			store,
			ports: { ...documentsPorts(), fetchJson: broken.fetchJson },
		});
		const { kernel } = failed;
		const probe = (
			await kernel.call<{ apps: Array<{ instance: string; state: string }> }>('app-list')
		).data?.apps.find((app) => app.instance === 'probe');
		expect(probe?.state).toBe('refused');
		expect((await kernel.call('document-get', { document: record.id })).data).toEqual(record);
		expect(
			(await kernel.call<{ types: unknown[] }>('document-type-list', { all: true })).data?.types
		).toEqual([]);
		expect((await kernel.call('document-export', { document: record.id })).error?.code).toBe(
			'DOCUMENT_TYPE_UNAVAILABLE'
		);
		expect((await kernel.call('document-create', { type: 'probe' })).error?.code).toBe(
			'DOCUMENT_TYPE_UNAVAILABLE'
		);
	});

	it('leaves a disabled instance out of the registry until it is enabled again', async () => {
		const { kernel } = await documents();
		const listed = async () =>
			(await kernel.call<{ types: DocumentTypeV1[] }>('document-type-list', { all: true })).data
				?.types.length;
		expect(await listed()).toBe(2);
		await kernel.call('workspace-app-set', { instance: 'probe', enabled: false });
		expect(await listed()).toBe(0);
		await kernel.call('workspace-app-set', { instance: 'probe', enabled: null });
		expect(await listed()).toBe(2);
	});
});

/** The `probe` type as its manifest declares it, for the registry's unit. */
const PROBE_TYPE = {
	id: 'probe',
	title: 'Probe note',
	icon: 'system/document',
	content_schema: { type: 'object' },
	content_version: 1,
	instance_commands: [],
	editor: { element: 'probe-editor' },
	binding: { model: 'command', selection: 'none', locator: 'none', conflict: 'last-writer-wins' },
	templates: [{ id: 'blank', title: 'Blank', content: {} }],
};

/** A store that refuses any batch writing an app's table after its first write, so a batch fails midway. */
class FailingContent extends MemoryAdapter {
	override async batch(operations: Parameters<MemoryAdapter['batch']>[0]) {
		if (operations.some((operation) => operation.path.startsWith('/app-probe/'))) {
			// A PATCH of a row that does not exist fails, and the adapter rolls the batch back.
			return super.batch([
				...operations,
				{ method: 'PATCH', path: '/app-probe/missing', body: {} },
			]);
		}
		return super.batch(operations);
	}
}

/** A store that remembers every read of a document's content, which the shell never makes (D4). */
class WatchedContent extends MemoryAdapter {
	readonly reads: string[] = [];
	override async get<T>(table: string, id: string): Promise<T | null> {
		if (table.startsWith('app-') && id.includes('doc/')) this.reads.push(`${table}/${id}`);
		return super.get<T>(table, id);
	}
	override async list<T>(table: string, params?: Parameters<MemoryAdapter['list']>[1]) {
		if (table.startsWith('app-')) this.reads.push(`${table}/*`);
		return super.list<T>(table, params);
	}
}

describe.each(adapters)('P2-D4: the record and the store (%s)', (_name, adapterOf) => {
	it('creates a record and its template content in one batch, with every field set', async () => {
		const store = adapterOf();
		const workspace = await documents({ store });
		const { kernel, scopes } = workspace;
		const result = await kernel.call<DocumentRecordV1>(
			'document-create',
			{ type: 'probe', template: 'greeting' },
			{ scope: scopes.atlas }
		);
		const record = result.data as DocumentRecordV1;
		expect(record).toEqual({
			id: expect.stringMatching(/^doc_[a-z0-9]{12}$/),
			workspace: 'personal',
			type: 'probe',
			instance: 'probe',
			title: 'Greeting',
			scope: scopes.atlas,
			scopeKey: `p:${scopes.atlas.project}`,
			owner: 'local',
			tags: [],
			status: 'active',
			trashedAt: null,
			contentVersion: 2,
			binding: {
				model: 'command',
				selection: 'text-range',
				locator: 'text-range',
				conflict: 'last-writer-wins',
			},
			epoch: 0,
			createdAt: expect.any(Number),
			updatedAt: record.createdAt,
			createdBy: 'local',
			updatedBy: 'local',
		});
		expect(result.undoCommand).toBe('document-trash');
		expect(result.undoArgs).toEqual({ document: record.id });
		expect(await store.get('document', record.id)).toEqual(record);
		const content = await store.get<AppStoreRecord>(
			'app-probe',
			storeRecordId(scopes.atlas, documentContentKey(record.id))
		);
		expect(content).toMatchObject({
			key: `doc/${record.id}`,
			value: { text: 'Hello' },
			scope: scopes.atlas,
		});
		// The type's own command reads it, under the document's scope.
		const read = await kernel.call<{ content: unknown }>(
			'probe-content-get',
			{ document: record.id },
			{ scope: scopes.atlas }
		);
		expect(read.data?.content).toEqual({ text: 'Hello' });
	});

	it('defaults the title and template, and refuses what a type or project does not allow', async () => {
		const workspace = await documents({ store: adapterOf() });
		const { kernel, scopes } = workspace;
		const blank = await created(workspace);
		expect([blank.title, blank.scope]).toEqual(['Blank probe', WORKSPACE]);
		const code = async (input: object, scope: object = WORKSPACE) =>
			(await kernel.call('document-create', input, { scope: scope as never })).error?.code;
		expect(await code({ type: 'probe', template: 'nope' })).toBe('DOCUMENT_TEMPLATE_UNKNOWN');
		expect(await code({ type: 'probe-memo' })).toBe('DOCUMENT_SCOPE_UNSUPPORTED');
		expect(await code({ type: 'nope' })).toBe('DOCUMENT_TYPE_UNAVAILABLE');
		expect(await code({ type: 'probe', title: ' ' })).toBe('VALIDATION_ERROR');
		expect(await code({ type: 'probe', project: 'citadel' })).toBe('PROJECT_NOT_FOUND');
		expect(await code({ type: 'probe', project: 'nowhere' })).toBe('PROJECT_NOT_FOUND');
		const named = await created(workspace, { type: 'probe-memo', project: 'beacon' }, scopes.atlas);
		expect(named.scope).toEqual(scopes.beacon);
		await kernel.call('project-archive', { project: 'beacon' });
		expect(await code({ type: 'probe', project: 'beacon' })).toBe('PROJECT_ARCHIVED');
		expect(await code({ type: 'probe' }, scopes.beacon)).toBe('PROJECT_ARCHIVED');
		// Every refusal is journaled, as a handler's failure is.
		const journaled = (await workspace.journal.read()).filter(
			(entry) => entry.command === 'document-create' && !entry.result.success
		);
		expect(journaled.length).toBe(8);
	});

	it('stamps updatedAt by an instance command that changes the document, and says which on the event', async () => {
		const workspace = await documents({ store: adapterOf() });
		const { kernel } = workspace;
		const record = await created(workspace);
		const events: KernelEventV2[] = [];
		kernel.subscribe((event) => events.push(event));
		await kernel.call('probe-content-get', { document: record.id });
		expect(
			(await kernel.call<DocumentRecordV1>('document-get', { document: record.id })).data?.updatedAt
		).toBe(record.updatedAt);
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		});
		const set = await kernel.call('probe-content-set', { document: record.id, text: 'Changed' });
		expect(set.success).toBe(true);
		const after = (await kernel.call<DocumentRecordV1>('document-get', { document: record.id }))
			.data;
		expect(after?.updatedAt).toBeGreaterThan(record.updatedAt);
		expect(after?.updatedBy).toBe('mock-user-person@example.com');
		expect(
			events.filter((event) => event.document).map((event) => [event.command, event.document])
		).toEqual([['probe-content-set', record.id]]);
	});

	it('moves the content with the record, raises the epoch, and moves back through undo', async () => {
		const store = adapterOf();
		const workspace = await documents({ store });
		const { kernel, scopes } = workspace;
		const record = await created(workspace, { type: 'probe', template: 'greeting' }, scopes.atlas);
		const key = documentContentKey(record.id);
		const moved = await kernel.call<DocumentRecordV1>(
			'document-move',
			{ document: record.id, project: 'beacon' },
			{ scope: scopes.atlas }
		);
		expect(moved.data).toMatchObject({
			scope: scopes.beacon,
			scopeKey: `p:${scopes.beacon.project}`,
			epoch: 1,
		});
		expect(await store.get('app-probe', storeRecordId(scopes.atlas, key))).toBeFalsy();
		expect(
			(await store.get<AppStoreRecord>('app-probe', storeRecordId(scopes.beacon, key)))?.value
		).toEqual({ text: 'Hello' });
		expect(moved.undoCommand).toBe('document-move');
		const back = await kernel.call<DocumentRecordV1>('document-move', moved.undoArgs, {
			scope: scopes.atlas,
		});
		expect(back.data).toMatchObject({ scope: scopes.atlas, epoch: 2 });
		expect(
			(await store.get<AppStoreRecord>('app-probe', storeRecordId(scopes.atlas, key)))?.value
		).toEqual({ text: 'Hello' });
		expect(await store.get('app-probe', storeRecordId(scopes.beacon, key))).toBeFalsy();
		// A project-only type cannot move to the workspace, and nothing moves to a refused project.
		const memo = await created(workspace, { type: 'probe-memo' }, scopes.atlas);
		const code = async (project: string | null) =>
			(await kernel.call('document-move', { document: memo.id, project }, { scope: scopes.atlas }))
				.error?.code;
		expect(await code(null)).toBe('DOCUMENT_SCOPE_UNSUPPORTED');
		expect(await code('citadel')).toBe('PROJECT_NOT_FOUND');
	});

	it('renames and updates, each undone by its own undo', async () => {
		const workspace = await documents({ store: adapterOf() });
		const { kernel } = workspace;
		const record = await created(workspace);
		const renamed = await kernel.call<DocumentRecordV1>('document-rename', {
			document: record.id,
			title: 'Roadmap',
		});
		expect(renamed.data?.title).toBe('Roadmap');
		await kernel.call(renamed.undoCommand as string, renamed.undoArgs);
		const updated = await kernel.call<DocumentRecordV1>('document-update', {
			document: record.id,
			tags: ['plan'],
			status: 'archived',
		});
		expect(updated.data).toMatchObject({
			title: 'Blank probe',
			tags: ['plan'],
			status: 'archived',
		});
		await kernel.call(updated.undoCommand as string, updated.undoArgs);
		expect((await kernel.call('document-get', { document: record.id })).data).toMatchObject({
			title: 'Blank probe',
			tags: [],
			status: 'active',
		});
		expect(
			(await kernel.call('document-update', { document: record.id, tags: ['x'.repeat(41)] })).error
				?.code
		).toBe('VALIDATION_ERROR');
	});

	it('trashes and restores, each the undo of the other, and a trashed document refuses changes', async () => {
		const workspace = await documents({ store: adapterOf() });
		const { kernel } = workspace;
		const record = await created(workspace);
		const trashed = await kernel.call<DocumentRecordV1>('document-trash', { document: record.id });
		expect(trashed.data).toMatchObject({ status: 'trashed', trashedAt: expect.any(Number) });
		expect([trashed.undoCommand, trashed.undoArgs]).toEqual([
			'document-restore',
			{ document: record.id },
		]);
		// Read, restored, never changed.
		expect((await kernel.call('document-get', { document: record.id })).success).toBe(true);
		for (const [name, input] of [
			['document-rename', { document: record.id, title: 'No' }],
			['probe-content-set', { document: record.id, text: 'No' }],
		] as const) {
			const refused = await kernel.call(name, input);
			expect(refused.error?.code, name).toBe('DOCUMENT_TRASHED');
			expect(refused.error?.suggestion, name).toContain('document-restore');
		}
		const restored = await kernel.call<DocumentRecordV1>('document-restore', {
			document: record.id,
		});
		expect(restored.data).toMatchObject({ status: 'active', trashedAt: null });
		expect(restored.undoCommand).toBe('document-trash');
		await kernel.call(restored.undoCommand as string, restored.undoArgs);
		expect(
			(await kernel.call<DocumentRecordV1>('document-get', { document: record.id })).data?.status
		).toBe('trashed');
	});

	it('exports through the type, and imports into a new record whose next call is the type’s import', async () => {
		const workspace = await documents({ store: adapterOf() });
		const { kernel } = workspace;
		const record = await created(workspace, { type: 'probe', template: 'greeting' });
		await kernel.call('document-update', { document: record.id, tags: ['kept'] });
		const exported = await kernel.call('document-export', { document: record.id });
		expect(exported.data).toEqual({
			loam_document: 1,
			type: 'probe',
			content_version: 2,
			title: 'Greeting',
			tags: ['kept'],
			content: { text: 'Hello' },
		});
		const imported = await kernel.call<
			DocumentRecordV1 & { next: { command: string; input: unknown } }
		>('document-import', { type: 'probe', envelope: exported.data, title: 'Copy' });
		const copy = imported.data as DocumentRecordV1 & { next: { command: string; input: unknown } };
		expect(copy).toMatchObject({ title: 'Copy', tags: ['kept'], type: 'probe' });
		expect(copy.next).toEqual({
			command: 'probe-import',
			input: { document: copy.id, content: { text: 'Hello' } },
		});
		expect(imported.undoCommand).toBe('document-trash');
		const { next } = copy;
		expect((await kernel.call(next.command, next.input)).success).toBe(true);
		expect((await kernel.call('probe-content-get', { document: copy.id })).data).toEqual({
			content: { text: 'Hello' },
		});
		const newer = await kernel.call('document-import', {
			type: 'probe',
			envelope: { ...(exported.data as object), content_version: 3 },
		});
		expect(newer.error?.code).toBe('DOCUMENT_IMPORT_VERSION_NEWER');
		expect(
			(
				await kernel.call(
					'document-import',
					{ type: 'probe-memo', envelope: exported.data },
					{ scope: workspace.scopes.atlas }
				)
			).error?.code
		).toBe('DOCUMENT_TYPE_MISMATCH');
		const memo = await created(workspace, { type: 'probe-memo' }, workspace.scopes.atlas);
		expect(
			(
				await kernel.call(
					'document-export',
					{ document: memo.id },
					{ scope: workspace.scopes.atlas }
				)
			).error?.code
		).toBe('DOCUMENT_EXPORT_UNAVAILABLE');
		expect(
			(
				await kernel.call(
					'document-import',
					{
						type: 'probe-memo',
						envelope: { ...(exported.data as object), type: 'probe-memo', content_version: 1 },
					},
					{ scope: workspace.scopes.atlas }
				)
			).error?.code
		).toBe('DOCUMENT_IMPORT_UNAVAILABLE');
	});

	it('lists by scope, status, type, tag and title, recent or by title, never what the actor may not enter', async () => {
		const workspace = await documents({ store: adapterOf() });
		const { kernel, scopes } = workspace;
		const vault = await citadelDocument(workspace);
		const a = await created(workspace, { type: 'probe', title: 'Beta plan' }, scopes.atlas);
		const b = await created(workspace, { type: 'probe', title: 'alpha draft' }, scopes.atlas);
		const w = await created(workspace, { type: 'probe', title: 'Workspace one' });
		await kernel.call(
			'document-update',
			{ document: a.id, tags: ['plan'] },
			{ scope: scopes.atlas }
		);
		const titles = async (input: object, scope: object = scopes.atlas) =>
			(
				await kernel.call<{ documents: DocumentRecordV1[]; total: number }>(
					'document-list',
					input,
					{
						scope: scope as never,
					}
				)
			).data?.documents.map((record) => record.title);
		expect(await titles({})).toEqual(['Beta plan', 'alpha draft']);
		expect(await titles({ sort: 'title' })).toEqual(['alpha draft', 'Beta plan']);
		expect(await titles({ query: 'PLAN' })).toEqual(['Beta plan']);
		expect(await titles({ tag: 'plan' })).toEqual(['Beta plan']);
		expect(await titles({ type: 'probe-memo' })).toEqual([]);
		expect(await titles({ project: null })).toEqual(['Workspace one']);
		expect(await titles({ limit: 1, offset: 1 })).toEqual(['alpha draft']);
		const everywhere = await titles({ project: 'all' });
		expect(everywhere?.sort()).toEqual(['Beta plan', 'Workspace one', 'alpha draft']);
		expect(everywhere).not.toContain(vault.title);
		expect((await kernel.call('document-list', { project: 'citadel' })).error?.code).toBe(
			'PROJECT_NOT_FOUND'
		);
		await kernel.call('document-trash', { document: b.id }, { scope: scopes.atlas });
		expect(await titles({ status: 'trashed' })).toEqual(['alpha draft']);
		expect(w.scope).toEqual(WORKSPACE);
	});

	it('writes neither the record nor the content when the batch fails', async () => {
		const store = new FailingContent();
		const workspace = await documents({ store });
		const result = await workspace.kernel.call('document-create', { type: 'probe' });
		expect(result.success).toBe(false);
		expect((await store.list('document')).data).toEqual([]);
		expect((await store.list('app-probe')).data).toEqual([]);
	});

	it("never reads a document's content but to move it", async () => {
		const store = new WatchedContent();
		const workspace = await documents({ store });
		const { kernel, scopes } = workspace;
		store.reads.length = 0;
		const record = await created(workspace, { type: 'probe' }, scopes.atlas);
		const at = { scope: scopes.atlas };
		for (const [name, input] of [
			['document-type-list', {}],
			['document-get', { document: record.id }],
			['document-list', { project: 'all' }],
			['document-rename', { document: record.id, title: 'Renamed' }],
			['document-update', { document: record.id, tags: ['t'] }],
			['document-trash', { document: record.id }],
			['document-restore', { document: record.id }],
			[
				'document-import',
				{ type: 'probe', envelope: { loam_document: 1, content_version: 1, content: {} } },
			],
		] as const) {
			expect((await kernel.call(name, input, at)).success, name).toBe(true);
		}
		expect(store.reads).toEqual([]);
		await kernel.call('document-move', { document: record.id, project: 'beacon' }, at);
		expect(store.reads).toEqual([
			`app-probe/${storeRecordId(scopes.atlas, documentContentKey(record.id))}`,
		]);
	});
});

describe.each(adapters)('P2-D4: the trash expires (%s)', (_name, adapterOf) => {
	const DAY = 86_400_000;

	it("deletes each record trashed longer than the workspace's trashDays, and its content, journaled", async () => {
		const store = adapterOf();
		let now = Date.UTC(2026, 0, 1);
		const clock = () => (now += 1);
		const first = await documents({ store, clock });
		const old = await created(first, { type: 'probe', template: 'greeting' }, first.scopes.atlas);
		const kept = await created(first);
		const recent = await created(first);
		await first.kernel.call('document-trash', { document: old.id }, { scope: first.scopes.atlas });
		const contentId = storeRecordId(first.scopes.atlas, documentContentKey(old.id));
		expect(await store.get('app-probe', contentId)).toBeDefined();
		now += 31 * DAY;
		await first.kernel.call('document-trash', { document: recent.id });
		await first.kernel.dispose();
		const journal = new MemoryJournalSink();
		const second = await documents({ store, clock, journal });
		const expired = (await journal.read()).filter(
			(entry) => entry.command === 'document-trash-expire'
		);
		expect(expired.length).toBe(1);
		expect(expired[0]?.result.data).toEqual({ deleted: [old.id] });
		expect(await store.get('document', old.id)).toBeFalsy();
		expect(await store.get('app-probe', contentId)).toBeFalsy();
		expect(
			(await store.list<AppStoreRecord>('app-probe')).data.filter((row) => row.key.includes(old.id))
		).toEqual([]);
		expect((await second.kernel.call('document-get', { document: old.id })).error?.code).toBe(
			'DOCUMENT_NOT_FOUND'
		);
		// The rest stay: one active, one trashed for less than 30 days.
		expect((await second.kernel.call('document-get', { document: kept.id })).success).toBe(true);
		expect(
			(await second.kernel.call<DocumentRecordV1>('document-get', { document: recent.id })).data
				?.status
		).toBe('trashed');
	});

	it('runs and journals nothing when nothing is old enough', async () => {
		const store = adapterOf();
		const first = await documents({ store });
		const record = await created(first);
		await first.kernel.call('document-trash', { document: record.id });
		await first.kernel.dispose();
		const journal = new MemoryJournalSink();
		await documents({ store, journal });
		expect((await journal.read()).some((entry) => entry.command === 'document-trash-expire')).toBe(
			false
		);
	});

	it('is no caller’s to run: a person, an agent and an app all get COMMAND_NOT_FOUND', async () => {
		const { kernel } = await documents();
		const input = { before: Number.MAX_SAFE_INTEGER };
		expect((await kernel.call('document-trash-expire', input)).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
		expect((await kernel.agent.call('document-trash-expire', input)).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
		expect((await kernel.appPort('probe').call('document-trash-expire', input)).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
	});
});

describe('P2-D6: a cross-project mutation on a document', () => {
	it('refuses a Beacon document in Atlas as SCOPE_MISMATCH naming Beacon, journaled, by a person and an agent', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const record = await created(workspace, { type: 'probe', title: 'Roadmap' }, scopes.beacon);
		const at = { scope: scopes.atlas };
		const person = await kernel.call('document-rename', { document: record.id, title: 'X' }, at);
		const agent = await kernel.agent.call(
			'document-rename',
			{ document: record.id, title: 'X' },
			at
		);
		const content = await kernel.call('probe-content-set', { document: record.id, text: 'X' }, at);
		expect(person.error).toMatchObject({
			code: 'SCOPE_MISMATCH',
			message: '`Roadmap` is in the project Beacon, not Atlas',
			suggestion: 'Switch with scope-set { project: "beacon" } and run this again.',
			details: { project: { id: scopes.beacon.project, slug: 'beacon', name: 'Beacon' } },
		});
		expect(errorOf(agent)).toBe(errorOf(person));
		expect(errorOf(content)).toBe(errorOf(person));
		const journaled = (await workspace.journal.read()).filter(
			(entry) => entry.result.error?.code === 'SCOPE_MISMATCH'
		);
		expect(journaled.map((entry) => entry.command)).toEqual([
			'document-rename',
			'document-rename',
			'probe-content-set',
		]);
		// A workspace document from a project names the workspace; the exempt commands name across.
		const loose = await created(workspace, { type: 'probe', title: 'Loose' });
		expect(
			(await kernel.call('document-rename', { document: loose.id, title: 'X' }, at)).error
		).toMatchObject({
			code: 'SCOPE_MISMATCH',
			message: '`Loose` is in the workspace, not Atlas',
			suggestion: 'Switch with scope-set { project: null } and run this again.',
		});
		expect((await kernel.call('document-get', { document: record.id }, at)).success).toBe(true);
		expect((await kernel.call('document-export', { document: record.id }, at)).error?.code).toBe(
			'SCOPE_MISMATCH'
		);
		expect((await kernel.call('document-trash', { document: record.id }, at)).success).toBe(true);
		expect((await kernel.call('document-restore', { document: record.id }, at)).success).toBe(true);
	});

	it('answers a restricted project’s document, for a non-member, in the same bytes as a missing id', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const vault = await citadelDocument(workspace);
		const missing = await kernel.call('document-get', { document: 'doc_nowhere00000' });
		expect(missing.error?.code).toBe('DOCUMENT_NOT_FOUND');
		for (const [name, input] of [
			['document-get', { document: vault.id }],
			['document-rename', { document: vault.id, title: 'X' }],
			['document-trash', { document: vault.id }],
			['document-move', { document: vault.id, project: null }],
			['document-export', { document: vault.id }],
		] as const) {
			expect(errorOf(await kernel.call(name, input)), name).toBe(errorOf(missing));
			expect(errorOf(await kernel.agent.call(name, input)), name).toBe(errorOf(missing));
		}
		const listed = await kernel.call<{ documents: DocumentRecordV1[]; total: number }>(
			'document-list',
			{
				project: 'all',
			}
		);
		expect(listed.data?.documents.map((record) => record.id)).not.toContain(vault.id);
		expect(listed.data?.total).toBe(0);
	});

	it('refuses the wrong type, and an instance command of a document that is not there', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const memo = await created(workspace, { type: 'probe-memo' }, scopes.atlas);
		const at = { scope: scopes.atlas };
		expect(
			(await kernel.call('probe-content-set', { document: memo.id, text: 'x' }, at)).error?.code
		).toBe('DOCUMENT_TYPE_MISMATCH');
		expect(
			(await kernel.call('probe-content-get', { document: 'doc_nowhere00000' }, at)).error?.code
		).toBe('DOCUMENT_NOT_FOUND');
	});

	it('bounds an instance command’s input at 256 KiB, before its handler, journaled without the content', async () => {
		const workspace = await documents();
		const { kernel, store } = workspace;
		const record = await created(workspace);
		const text = 'x'.repeat(DOCUMENT_INPUT_MAX_BYTES);
		const refused = await kernel.call('probe-content-set', { document: record.id, text });
		expect(refused.error?.code).toBe('DOCUMENT_CONTENT_TOO_LARGE');
		expect(refused.error?.suggestion).toContain("'probe'");
		const entry = (await workspace.journal.read()).at(-1);
		expect(entry?.command).toBe('probe-content-set');
		expect(entry?.input).toEqual({ document: record.id });
		expect(JSON.stringify(entry)).not.toContain('xxxxxxxx');
		// The handler never ran: the template's content is still there.
		const content = await store.get<AppStoreRecord>('app-probe', documentContentKey(record.id));
		expect(content?.value).toEqual({ text: '' });
	});

	it('refuses a mutation of a document in an archived project, and reads it', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const record = await created(workspace, { type: 'probe' }, scopes.beacon);
		await kernel.call('project-archive', { project: 'beacon' });
		const at = { scope: scopes.beacon };
		expect((await kernel.call('document-get', { document: record.id }, at)).success).toBe(true);
		expect(
			(await kernel.call('document-rename', { document: record.id, title: 'X' }, at)).error?.code
		).toBe('PROJECT_ARCHIVED');
		expect(
			(await kernel.call('probe-content-set', { document: record.id, text: 'X' }, at)).error?.code
		).toBe('PROJECT_ARCHIVED');
	});
});

describe('P2-D6: through a port, nothing widens', () => {
	/** Atlas's view of a Beacon document, by every path an app's call takes (3.6, 4.2). */
	async function paths(workspace: ScopedWorkspace) {
		const { kernel, scopes } = workspace;
		const port = kernel.appPort('probe');
		const surface = port.surface({ scope: scopes.atlas });
		return {
			surface: (name: string, input: unknown) => surface.call(name, input),
			nested: async (name: string, input: unknown) =>
				(
					await surface.call<{ answer: CommandResult<unknown> }>('probe-reach', {
						command: name,
						input,
					})
				).data?.answer as CommandResult<unknown>,
		};
	}

	it('answers a Beacon document, from Atlas, in the same bytes as a missing id, on each path', async () => {
		const workspace = await documents();
		const { scopes } = workspace;
		const beacon = await created(workspace, { type: 'probe', title: 'Beacon plan' }, scopes.beacon);
		const atlas = await created(workspace, { type: 'probe', title: 'Atlas plan' }, scopes.atlas);
		const vault = await citadelDocument(workspace);
		for (const [path, call] of Object.entries(await paths(workspace))) {
			const missing = await call('document-get', { document: 'doc_nowhere00000' });
			expect(missing.error?.code, path).toBe('DOCUMENT_NOT_FOUND');
			for (const document of [beacon.id, vault.id]) {
				expect(errorOf(await call('document-get', { document })), path).toBe(errorOf(missing));
				expect(errorOf(await call('probe-content-get', { document })), path).toBe(errorOf(missing));
			}
			expect((await call('document-get', { document: atlas.id })).data, path).toEqual(atlas);
			const own = await call('document-list', {});
			expect(
				(own.data as { documents: DocumentRecordV1[] }).documents.map((record) => record.id),
				path
			).toEqual([atlas.id]);
		}
	});

	it('refuses another project or all in document-list as SCOPE_NOT_GRANTED, whatever the project is', async () => {
		const workspace = await documents();
		await created(workspace, { type: 'probe' }, workspace.scopes.beacon);
		for (const [path, call] of Object.entries(await paths(workspace))) {
			const answers = [];
			for (const project of ['all', 'beacon', 'citadel', 'nowhere', null]) {
				answers.push(await call('document-list', { project }));
			}
			for (const answer of answers) {
				expect(answer.error?.code, path).toBe('SCOPE_NOT_GRANTED');
				expect(errorOf(answer), path).toBe(errorOf(answers[0] as CommandResult<unknown>));
			}
			// Its own project, named, is its own level.
			expect((await call('document-list', { project: 'atlas' })).success, path).toBe(true);
		}
	});

	it('lets no app create, rename, move or trash a record, and one without the grant read none', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const record = await created(workspace, { type: 'probe' }, scopes.atlas);
		const port = kernel.appPort('probe');
		for (const [name, input] of [
			['document-create', { type: 'probe' }],
			['document-rename', { document: record.id, title: 'X' }],
			['document-move', { document: record.id, project: null }],
			['document-trash', { document: record.id }],
			['document-update', { document: record.id, tags: [] }],
			['document-export', { document: record.id }],
			['document-import', { type: 'probe', envelope: {} }],
			['document-type-list', {}],
		] as const) {
			expect(
				(await port.surface({ scope: scopes.atlas }).call(name, input)).error?.code,
				name
			).toBe('CALL_NOT_GRANTED');
		}
		// `dual` has no `documents` grant: it reads no record at all.
		const dual = kernel.appPort('dual').surface({ scope: scopes.atlas });
		expect((await dual.call('document-get', { document: record.id })).error?.code).toBe(
			'CALL_NOT_GRANTED'
		);
		expect((await dual.call('document-list', {})).error?.code).toBe('CALL_NOT_GRANTED');
	});

	it('replays a session of document commands with zero differences', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const record = await created(workspace, { type: 'probe', template: 'greeting' }, scopes.atlas);
		const at = { scope: scopes.atlas };
		await kernel.call('probe-content-set', { document: record.id, text: 'Edited' }, at);
		await kernel.call('document-rename', { document: record.id, title: 'Edited' }, at);
		await kernel.call('document-export', { document: record.id }, at);
		await kernel.call('document-move', { document: record.id, project: 'beacon' }, at);
		await kernel.call('document-rename', { document: record.id, title: 'X' }, at);
		await kernel.call('probe-content-set', {
			document: record.id,
			text: 'x'.repeat(DOCUMENT_INPUT_MAX_BYTES),
		});
		await kernel.call('document-trash', { document: record.id }, at);
		await citadelDocument(workspace);
		const { report } = await replayKernel(await workspace.journal.read(), {
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		expect(report.diverged).toBe(false);
		expect(report.same).toBeGreaterThan(10);
		// The over-limit save is answered from its record: it never ran, and its content is not in the journal.
		expect(report.recorded.length).toBeGreaterThan(0);
	});
});
