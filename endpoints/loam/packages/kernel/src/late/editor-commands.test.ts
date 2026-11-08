/**
 * `document-open` and the `editor-*` commands (documents specification, 5.1 to 5.5, 4.2's `document-open`
 * and 11; step 10): D5's kernel half, on the scoped workspace with the `probe` type. A person's and an
 * agent's calls, a surface's port, a reload's `resetSession` and a replay.
 */

import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createScopedWorkspace,
	documentsDeployment,
	documentsPorts,
	replayKernel,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
} from '../testing.js';
import type { KernelEventV2, LoamKernelV2 } from '../types.js';

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

interface EditorRead {
	groups: Array<{
		id: string;
		active: string | null;
		tabs: Array<{
			id: string;
			document: string;
			dirty: boolean;
			pinned: boolean;
			preview: boolean;
		}>;
	}>;
	activeGroup: string;
}

/** A probe document, created by the person at `scope` (default the active one). */
async function probe(
	workspace: ScopedWorkspace,
	title: string,
	scope?: { workspace: string; project?: string }
) {
	const created = await workspace.kernel.call<{ id: string }>(
		'document-create',
		{ type: 'probe', title },
		scope ? { scope } : {}
	);
	expect(created.success, JSON.stringify(created.error)).toBe(true);
	return created.data?.id as string;
}

const editor = async (
	workspace: ScopedWorkspace,
	scope?: { workspace: string; project?: string }
) =>
	(await workspace.kernel.call<EditorRead>('editor-get', {}, scope ? { scope } : {}))
		.data as EditorRead;

const documentsOf = (read: EditorRead) =>
	read.groups.map((group) => group.tabs.map((tab) => tab.document));

describe('P2-D5: the editor commands', () => {
	it('P2-D5: opens, activates, pins, moves and closes, each with its undo, moving the URL as 6.3 says, and replays the same', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const events: KernelEventV2[] = [];
		kernel.subscribe((event) => events.push(event));
		const a = await probe(workspace, 'Alpha');
		const b = await probe(workspace, 'Beta');
		const opened = await kernel.call('document-open', { document: a });
		expect(opened.data).toEqual({ tab: 't1', group: 'g1' });
		expect(opened.undoCommand).toBe('editor-close');
		expect(opened.undoArgs).toEqual({ tab: 't1' });
		expect(events.at(-1)).toMatchObject({ command: 'document-open', mainChanged: 'push' });
		await kernel.call('document-open', { document: b, group: 'beside' });
		expect(documentsOf(await editor(workspace))).toEqual([[a], [b]]);
		expect((await kernel.call('section-get')).data).toEqual({
			section: 'documents',
			path: b,
			active: null,
		});

		const activated = await kernel.call('editor-activate', { tab: 't1' });
		expect(activated.data).toEqual({ tab: 't1', previous: 't2' });
		expect(activated.undoArgs).toEqual({ tab: 't2' });
		expect(events.at(-1)).toMatchObject({ command: 'editor-activate', mainChanged: 'replace' });
		expect((await kernel.call('section-get')).data).toMatchObject({ path: a });

		const pinned = await kernel.call('editor-pin', { tab: 't2', pinned: true });
		expect(pinned.undoArgs).toEqual({ tab: 't2', pinned: false });
		// Pinning moves no tab's activity, so the URL stays.
		expect(events.at(-1)?.mainChanged).toBeUndefined();

		const moved = await kernel.call('editor-move', { tab: 't2', group: 'g1' });
		expect(moved.data).toEqual({ tab: 't2', group: 'g1' });
		expect(moved.undoArgs).toEqual({ tab: 't2', group: 'new' });
		expect((await editor(workspace)).groups).toHaveLength(1);

		const closed = await kernel.call('editor-close', { tab: 't2' });
		expect(closed.data).toEqual({
			closed: 't2',
			previous: { document: b, group: 'g1', pinned: true },
		});
		expect(closed.undoCommand).toBe('document-open');
		expect(closed.undoArgs).toEqual({ document: b, preview: false });
		expect(events.at(-1)).toMatchObject({ command: 'editor-close', mainChanged: 'replace' });
		expect((await kernel.call('editor-close', { tab: 't9' })).error?.code).toBe(
			'EDITOR_TAB_UNKNOWN'
		);

		const { report } = await replayKernel(await workspace.journal.read(), {
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('P2-D5: a dirty tab refuses a close, naming its type’s save and discard: true; a first edit promotes a preview; a reload forgets dirty', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const a = await probe(workspace, 'Alpha');
		await kernel.call('document-open', { document: a, preview: true });
		expect((await editor(workspace)).groups[0]?.tabs[0]).toMatchObject({
			preview: true,
			dirty: false,
		});
		await kernel.call('editor-dirty-set', { tab: 't1', dirty: true });
		expect((await editor(workspace)).groups[0]?.tabs[0]).toMatchObject({
			preview: false,
			dirty: true,
		});
		const refused = await kernel.call('editor-close', { tab: 't1' });
		expect(refused.error?.code).toBe('EDITOR_TAB_DIRTY');
		expect(refused.error?.suggestion).toContain('probe-content-set');
		expect(refused.error?.suggestion).toContain('discard: true');
		await workspace.resetSession();
		expect((await editor(workspace)).groups[0]?.tabs[0]?.dirty).toBe(false);
		await kernel.call('editor-dirty-set', { tab: 't1', dirty: true });
		expect((await kernel.call('editor-close', { tab: 't1', discard: true })).success).toBe(true);
		expect((await kernel.call('editor-dirty-set', { tab: 't1', dirty: true })).error?.code).toBe(
			'EDITOR_TAB_UNKNOWN'
		);
	});

	it("P2-D5: keeps a record per scope, so Atlas's tabs are not Beacon's and come back on return", async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		await kernel.call('scope-set', { project: 'atlas' });
		const a = await probe(workspace, 'Atlas note');
		await kernel.call('document-open', { document: a });
		await kernel.call('scope-set', { project: 'beacon' });
		expect(documentsOf(await editor(workspace))).toEqual([[]]);
		expect((await kernel.call('section-get')).data).toMatchObject({
			section: 'documents',
			path: '',
		});
		await kernel.call('scope-set', { project: 'atlas' });
		expect(documentsOf(await editor(workspace))).toEqual([[a]]);
		// An agent naming Atlas from the workspace reads Atlas's record, as a replay would.
		await kernel.call('scope-set', { project: null });
		expect(documentsOf(await editor(workspace, workspace.scopes.atlas))).toEqual([[a]]);
	});

	it('P2-D5: a document in another scope switches to it by the switch’s rules, and through a port answers as a missing one', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const a = await probe(workspace, 'Atlas note', scopes.atlas);
		await kernel.call('scope-set', { project: 'beacon' });
		const opened = await kernel.call('document-open', { document: a });
		expect(opened.data).toEqual({
			tab: 't1',
			group: 'g1',
			scope: { from: scopes.beacon, to: scopes.atlas },
		});
		expect((await kernel.call<{ scope: unknown }>('scope-get')).data?.scope).toEqual(scopes.atlas);
		expect(documentsOf(await editor(workspace))).toEqual([[a]]);
		await kernel.call('scope-set', { project: 'beacon' });
		await kernel.call('app-open', { instance: 'probe' });
		const port = kernel.appPort('probe').surface({ scope: scopes.beacon });
		const crossed = await port.call('document-open', { document: a });
		const missing = await port.call('document-open', { document: 'doc_nothinghere' });
		expect(crossed.error?.code).toBe('DOCUMENT_NOT_FOUND');
		expect(JSON.stringify(crossed.error)).toBe(JSON.stringify(missing.error));
		expect((await kernel.call<{ scope: unknown }>('scope-get')).data?.scope).toEqual(scopes.beacon);
	});

	it('P2-D5: through a port, editor-get alone, and document-open only for the active app or the editor owner', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const here = { workspace: 'personal' };
		const a = await probe(workspace, 'Alpha');
		const b = await probe(workspace, 'Beta');
		const port = kernel.appPort('probe').surface({ scope: here });
		expect((await port.call('editor-get')).success).toBe(true);
		for (const name of [
			'editor-activate',
			'editor-close',
			'editor-pin',
			'editor-move',
			'editor-dirty-set',
			'editor-selection-set',
		]) {
			expect(
				(
					await port.call(name, {
						tab: 't1',
						pinned: true,
						group: 'new',
						dirty: true,
						selection: null,
					})
				).error?.code,
				name
			).toBe('CALL_NOT_GRANTED');
		}
		expect((await port.call('document-open', { document: a })).error?.code).toBe(
			'DOCUMENT_OPEN_NOT_ACTIVE'
		);
		// The person opens a probe document: probe is the editor owner, and may open another in its scope.
		await kernel.call('document-open', { document: a });
		const opened = await port.call('document-open', { document: b });
		expect(opened.success).toBe(true);
		expect(documentsOf(await editor(workspace))).toEqual([[a, b]]);
	});

	it('P2-D5: the editor owner may open a modal as an active app may, and gives up its overlays when main leaves it', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const here = { workspace: 'personal' };
		const port = kernel.appPort('probe').surface({ scope: here });
		const modal = { title: 'Sure?', body: 'Really.' };
		expect((await port.call('modal-open', modal)).error?.code).toBe('OVERLAY_OWNER_INACTIVE');
		await kernel.call('document-open', { document: await probe(workspace, 'Alpha') });
		const opened = await port.call<{ overlayId: string }>('modal-open', modal);
		expect(opened.success).toBe(true);
		await kernel.call('overlay-dismiss', { overlayId: opened.data?.overlayId, result: 'cancel' });
		await port.call('toast-show', { message: 'Saved' });
		expect(
			(await kernel.call<{ overlays: unknown[] }>('overlay-list')).data?.overlays
		).toHaveLength(1);
		// Leaving the documents section is an app switch for the editor owner (5.4).
		await kernel.call('section-open', { section: 'projects' });
		expect(
			(await kernel.call<{ overlays: unknown[] }>('overlay-list')).data?.overlays
		).toHaveLength(0);
	});

	it('P2-D5: trashing a document closes its tabs, and moving one closes them in the scope it leaves', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const events: KernelEventV2[] = [];
		kernel.subscribe((event) => events.push(event));
		const a = await probe(workspace, 'Alpha');
		const b = await probe(workspace, 'Beta');
		await kernel.call('document-open', { document: a });
		await kernel.call('document-open', { document: a, group: 'beside' });
		await kernel.call('document-open', { document: b });
		await kernel.call('editor-dirty-set', { tab: 't1', dirty: true });
		await kernel.call('document-trash', { document: a });
		expect(documentsOf(await editor(workspace))).toEqual([[b]]);
		await kernel.call('document-restore', { document: a });
		expect(documentsOf(await editor(workspace))).toEqual([[b]]);
		const moved = await kernel.call('document-move', { document: b, project: 'atlas' });
		expect(moved.success).toBe(true);
		expect(events.at(-1)).toMatchObject({ command: 'document-move', mainChanged: 'replace' });
		expect(documentsOf(await editor(workspace))).toEqual([[]]);
		expect(documentsOf(await editor(workspace, scopes.atlas))).toEqual([[]]);
	});

	it("P2-D5: holds a selection in the binding's shape, unjournaled, and refuses another shape", async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		await kernel.call('document-open', { document: await probe(workspace, 'Alpha') });
		const before = (await workspace.journal.read()).length;
		const held = await kernel.call('editor-selection-set', {
			tab: 't1',
			selection: { kind: 'text-range', start: 2, end: 5 },
		});
		expect(held.data).toEqual({ tab: 't1' });
		expect(
			(await kernel.call('editor-selection-set', { tab: 't1', selection: null })).success
		).toBe(true);
		expect((await workspace.journal.read()).length).toBe(before);
		for (const selection of [
			{ kind: 'item', id: 'x' },
			{ kind: 'text-range', start: 5, end: 2 },
			'text',
		]) {
			expect(
				(await kernel.call('editor-selection-set', { tab: 't1', selection })).error?.code
			).toBe('EDITOR_SELECTION_INVALID');
		}
	});

	it('P2-D5: view-state-set refuses an editor record, naming its commands, and a persisted bad record is ignored', async () => {
		const store = new MemoryAdapter();
		await store.create('settings', {
			id: 'loam.editor',
			category: 'view-state',
			value: { version: 1, groups: [], activeGroup: 'g1', nextTab: 1, nextGroup: 2 },
			updatedAt: new Date(0).toISOString(),
		});
		const workspace = await documents({ store });
		const { kernel } = workspace;
		expect(documentsOf(await editor(workspace))).toEqual([[]]);
		const refused = await kernel.call('view-state-set', {
			id: 'loam.editor',
			state: { version: 1 },
		});
		expect(refused.error?.code).toBe('VIEW_STATE_READ_ONLY');
		expect(refused.error?.suggestion).toContain('editor-*');
	});
});
