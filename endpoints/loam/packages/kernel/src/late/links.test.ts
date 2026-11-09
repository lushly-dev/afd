/**
 * References (documents specification, 9.3; step 12): the `document-link-*` commands and their index, D9's
 * kernel units, and D6's port rows for the link commands. The fixture is the `probe` type.
 */

import { type CommandResult, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { DocumentLinkV1, DocumentRecordV1, LinkRowV1 } from '@lushly-dev/loam-sdk';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createReferenceWorkspace,
	createScopedWorkspace,
	documentsDeployment,
	documentsPorts,
	replayKernel,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
} from '../testing.js';
import type { LoamKernelV2 } from '../types.js';
import { createDocumentIndex, LINK_TABLE } from './links.js';

const kernels: LoamKernelV2[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

async function documents(options: ScopedWorkspaceOptions = {}): Promise<ScopedWorkspace> {
	const workspace = await createScopedWorkspace({
		deployment: documentsDeployment(),
		ports: documentsPorts(),
		...options,
	});
	kernels.push(workspace.kernel);
	return workspace;
}

type Scope = { workspace: string; project?: string };

async function created(
	workspace: ScopedWorkspace,
	title: string,
	scope?: Scope
): Promise<DocumentRecordV1> {
	const result = await workspace.kernel.call<DocumentRecordV1>(
		'document-create',
		{ type: 'probe', title },
		scope ? { scope } : {}
	);
	expect(result.error).toBeFalsy();
	return result.data as DocumentRecordV1;
}

const signIn = (workspace: ScopedWorkspace) =>
	workspace.kernel.call('auth-sign-in', {
		method: 'credentials',
		email: 'someone@example.com',
		password: 'x',
	});

const errorOf = (result: CommandResult<unknown>) => JSON.stringify(result.error);
const titles = (rows: LinkRowV1[] | undefined) => (rows ?? []).map((row) => row.document.title);

describe('P2-D9: references', () => {
	it('links across projects, and leaves out a backlink from a refused project with no count', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const atlas = await created(workspace, 'Atlas plan', scopes.atlas);
		const beacon = await created(workspace, 'Beacon notes', scopes.beacon);
		const across = await kernel.call<DocumentLinkV1>(
			'document-link-add',
			{ from: atlas.id, to: beacon.id },
			{ scope: scopes.atlas }
		);
		expect(across.data).toMatchObject({ from: atlas.id, to: beacon.id, kind: 'reference' });
		expect(across.data?.id).toMatch(/^lnk_[0-9a-z]{12}$/);
		expect(across.undoCommand).toBe('document-link-remove');
		// A member of Citadel links its own document to Atlas's.
		await signIn(workspace);
		const vault = await created(workspace, 'Vault', scopes.citadel);
		expect(
			(
				await kernel.call(
					'document-link-add',
					{ from: vault.id, to: atlas.id },
					{ scope: scopes.citadel }
				)
			).success
		).toBe(true);
		const member = await kernel.call<{ out: LinkRowV1[]; in: LinkRowV1[] }>(
			'document-link-list',
			{ document: atlas.id },
			{ scope: scopes.atlas }
		);
		expect(titles(member.data?.in)).toEqual(['Vault']);
		await kernel.call('auth-sign-out');
		// Signed out, Citadel is refused: its backlink is not there, and nothing says one was.
		const reader = await kernel.call<{ out: LinkRowV1[]; in: LinkRowV1[] }>(
			'document-link-list',
			{ document: atlas.id },
			{ scope: scopes.atlas }
		);
		expect(reader.data).toEqual({
			out: [
				{
					link: across.data,
					document: {
						id: beacon.id,
						title: 'Beacon notes',
						type: 'probe',
						status: 'active',
						scope: scopes.beacon,
					},
				},
			],
			in: [],
		});
		expect(JSON.stringify(reader)).not.toContain('Vault');
		expect(JSON.stringify(reader)).not.toContain(vault.id);
		// Out and in alone, and from the other end.
		const back = await kernel.call<{ out: LinkRowV1[]; in: LinkRowV1[] }>(
			'document-link-list',
			{ document: beacon.id, direction: 'in' },
			{ scope: scopes.beacon }
		);
		expect(titles(back.data?.in)).toEqual(['Atlas plan']);
		expect(back.data?.out).toEqual([]);
		// The refused one's own links answer as a missing document.
		const refused = await kernel.call('document-link-list', { document: vault.id });
		const missing = await kernel.call('document-link-list', { document: 'doc_nowhere00000' });
		expect(refused.error?.code).toBe('DOCUMENT_NOT_FOUND');
		expect(errorOf(refused)).toBe(errorOf(missing));
	});

	it('keeps a trashed target’s row with its status, refuses a trashed source, and links a document to itself', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const from = await created(workspace, 'From');
		const to = await created(workspace, 'To');
		await kernel.call('document-link-add', { from: from.id, to: to.id });
		await kernel.call('document-trash', { document: to.id });
		const rows = await kernel.call<{ out: LinkRowV1[] }>('document-link-list', {
			document: from.id,
		});
		expect(rows.data?.out.map((row) => row.document.status)).toEqual(['trashed']);
		// A trashed target may be named; a trashed source may not change.
		expect(
			(await kernel.call('document-link-add', { from: from.id, to: to.id, kind: 'embed' })).success
		).toBe(true);
		const refused = await kernel.call('document-link-add', { from: to.id, to: from.id });
		expect(refused.error?.code).toBe('DOCUMENT_TRASHED');
		const self = await kernel.call<DocumentLinkV1>('document-link-add', {
			from: from.id,
			to: from.id,
		});
		expect(self.data).toMatchObject({ from: from.id, to: from.id });
	});

	it('answers an existing link as it is, and undoes add and remove with the same id', async () => {
		const workspace = await documents();
		const { kernel, store } = workspace;
		const a = await created(workspace, 'A');
		const b = await created(workspace, 'B');
		const first = await kernel.call<DocumentLinkV1>('document-link-add', {
			from: a.id,
			to: b.id,
			anchor: { kind: 'text-range', start: 1, end: 4 },
		});
		const again = await kernel.call<DocumentLinkV1>('document-link-add', {
			from: a.id,
			to: b.id,
			anchor: { kind: 'text-range', start: 1, end: 4 },
		});
		expect(again.data).toEqual(first.data);
		// Nothing changed, so nothing to undo.
		expect(again.undoCommand).toBeUndefined();
		// Another anchor or kind is another link.
		const other = await kernel.call<DocumentLinkV1>('document-link-add', {
			from: a.id,
			to: b.id,
			kind: 'embed',
		});
		expect(other.data?.id).not.toBe(first.data?.id);
		const id = first.data?.id as string;
		const removed = await kernel.call('document-link-remove', { link: id });
		expect(removed.data).toEqual({ link: id });
		expect(removed.undoCommand).toBe('document-link-add');
		expect(await store.get(LINK_TABLE, id)).toBeFalsy();
		const restored = await kernel.call<DocumentLinkV1>(
			removed.undoCommand as string,
			removed.undoArgs
		);
		expect(restored.data).toMatchObject({ ...first.data, createdAt: expect.any(Number) });
		expect(restored.data?.id).toBe(id);
		const listed = await kernel.call<{ out: LinkRowV1[] }>('document-link-list', {
			document: a.id,
			direction: 'out',
		});
		expect(listed.data?.out.map((row) => row.link.id).sort()).toEqual(
			[id, other.data?.id as string].sort()
		);
		// A missing link answers as a missing document.
		const gone = await kernel.call('document-link-remove', { link: 'lnk_nowhere00000' });
		const missing = await kernel.call('document-get', { document: 'doc_nowhere00000' });
		expect(errorOf(gone)).toBe(errorOf(missing));
	});

	it('refuses an anchor over 1 KiB and a kind off its pattern', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const a = await created(workspace, 'A');
		const big = await kernel.call('document-link-add', {
			from: a.id,
			to: a.id,
			anchor: 'x'.repeat(1100),
		});
		expect(big.error?.code).toBe('VALIDATION_ERROR');
		const kind = await kernel.call('document-link-add', { from: a.id, to: a.id, kind: 'Embed' });
		expect(kind.error?.code).toBe('VALIDATION_ERROR');
	});

	it('builds its index once, by one list of the table, and keeps it by the commands', async () => {
		const store = new MemoryAdapter();
		let lists = 0;
		const list = store.list.bind(store);
		store.list = ((table: string, params?: never) => {
			if (table === LINK_TABLE) lists += 1;
			return list(table, params);
		}) as DataAdapter['list'];
		const workspace = await documents({ store });
		const { kernel } = workspace;
		const a = await created(workspace, 'A');
		const b = await created(workspace, 'B');
		expect(lists).toBe(0);
		await kernel.call('document-link-add', { from: a.id, to: b.id });
		await kernel.call('document-link-list', { document: a.id });
		const link = await kernel.call<DocumentLinkV1>('document-link-add', { from: b.id, to: a.id });
		await kernel.call('document-link-remove', { link: link.data?.id });
		const listed = await kernel.call<{ out: LinkRowV1[]; in: LinkRowV1[] }>('document-link-list', {
			document: a.id,
		});
		expect(lists).toBe(1);
		expect(titles(listed.data?.out)).toEqual(['B']);
		expect(listed.data?.in).toEqual([]);
	});

	it('A4 at its smallest: an index over the reference workspace’s links answers each document’s', async () => {
		const reference = createReferenceWorkspace({
			seed: 'phase-2',
			size: 1,
			documents: 200,
			links: 2_000,
		});
		expect(reference.documents.length).toBe(200);
		expect(reference.links.length).toBe(2_000);
		const store = new MemoryAdapter();
		await store.batch(
			reference.links.map((link) => ({
				method: 'PUT' as const,
				path: `/${LINK_TABLE}/${link.id}`,
				body: link,
			}))
		);
		const index = createDocumentIndex(store);
		const first = reference.documents[0]?.id as string;
		const held = await index.of(first);
		expect(held.out.length).toBe(reference.links.filter((link) => link.from === first).length);
		expect(held.in.length).toBe(reference.links.filter((link) => link.to === first).length);
		// Deterministic for a seed.
		expect(
			createReferenceWorkspace({ seed: 'phase-2', size: 1, documents: 200, links: 2_000 }).links
		).toEqual(reference.links);
	});

	it('re-executes in a replay with no difference, the list reading what was added', async () => {
		const journal = new MemoryJournalSink();
		const workspace = await documents({ journal });
		const { kernel, scopes } = workspace;
		const a = await created(workspace, 'A', scopes.atlas);
		const b = await created(workspace, 'B', scopes.beacon);
		const link = await kernel.call<DocumentLinkV1>(
			'document-link-add',
			{ from: a.id, to: b.id },
			{ scope: scopes.atlas }
		);
		await kernel.call('document-link-list', { document: a.id }, { scope: scopes.atlas });
		await kernel.call('document-link-remove', { link: link.data?.id }, { scope: scopes.atlas });
		await kernel.call('document-link-list', { document: b.id }, { scope: scopes.beacon });
		const entries = await journal.read();
		expect(entries.filter((entry) => entry.command.startsWith('document-link-')).length).toBe(4);
		const { report } = await replayKernel(entries, {
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		expect(report.diverged).toBe(false);
	});
});

describe('P2-D6: the link commands through a port', () => {
	it('answer a Beacon end, from Atlas, in the bytes of a missing id, and leave out a Beacon row with no count', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const atlas = await created(workspace, 'Atlas plan', scopes.atlas);
		const other = await created(workspace, 'Atlas other', scopes.atlas);
		const beacon = await created(workspace, 'Beacon notes', scopes.beacon);
		const across = await kernel.call<DocumentLinkV1>(
			'document-link-add',
			{ from: beacon.id, to: atlas.id },
			{ scope: scopes.beacon }
		);
		await kernel.call(
			'document-link-add',
			{ from: atlas.id, to: other.id },
			{ scope: scopes.atlas }
		);
		const surface = kernel.appPort('probe').surface({ scope: scopes.atlas });
		const missing = await surface.call('document-get', { document: 'doc_nowhere00000' });
		expect(missing.error?.code).toBe('DOCUMENT_NOT_FOUND');
		// `document-link-list` leaves out the Beacon row, and holds no count.
		const listed = await surface.call<{ out: LinkRowV1[]; in: LinkRowV1[] }>('document-link-list', {
			document: atlas.id,
		});
		expect(listed.success).toBe(true);
		expect(Object.keys(listed.data ?? {}).sort()).toEqual(['in', 'out']);
		expect(titles(listed.data?.out)).toEqual(['Atlas other']);
		expect(listed.data?.in).toEqual([]);
		expect(JSON.stringify(listed)).not.toContain(beacon.id);
		// Each of a Beacon end, and a Beacon document's own list, is a missing id.
		for (const answer of [
			await surface.call('document-link-list', { document: beacon.id }),
			await surface.call('document-link-add', { from: atlas.id, to: beacon.id }),
			await surface.call('document-link-add', { from: beacon.id, to: atlas.id }),
			await surface.call('document-link-remove', { link: across.data?.id }),
		]) {
			expect(errorOf(answer)).toBe(errorOf(missing));
		}
		// Within Atlas, a surface links and removes.
		const made = await surface.call<DocumentLinkV1>('document-link-add', {
			from: other.id,
			to: atlas.id,
		});
		expect(made.success).toBe(true);
		expect((await surface.call('document-link-remove', { link: made.data?.id })).success).toBe(
			true
		);
		// An app never chooses a link's id.
		const chosen = await surface.call('document-link-add', {
			from: other.id,
			to: atlas.id,
			id: 'lnk_000000000000',
		});
		expect(chosen.error?.code).toBe('VALIDATION_ERROR');
	});

	it('refuses a handler’s link mutation as nested, lets it list, and refuses an app without the grant', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const atlas = await created(workspace, 'Atlas plan', scopes.atlas);
		const surface = kernel.appPort('probe').surface({ scope: scopes.atlas });
		const reach = async (command: string, input: unknown) =>
			(await surface.call<{ answer: CommandResult<unknown> }>('probe-reach', { command, input }))
				.data?.answer as CommandResult<unknown>;
		expect((await reach('document-link-add', { from: atlas.id, to: atlas.id })).error?.code).toBe(
			'NESTED_MUTATION_REFUSED'
		);
		expect((await reach('document-link-list', { document: atlas.id })).success).toBe(true);
		const dual = kernel.appPort('dual').surface({ scope: scopes.atlas });
		for (const name of ['document-link-list', 'document-link-add', 'document-link-remove']) {
			expect((await dual.call(name, { document: atlas.id })).error?.code, name).toBe(
				'CALL_NOT_GRANTED'
			);
		}
	});
});
