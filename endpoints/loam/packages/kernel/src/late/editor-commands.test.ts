/**
 * `document-open` and the `editor-*` commands (documents specification, 5.1 to 5.5, 4.2's `document-open`
 * and 11; step 10): D5's kernel half, on the scoped workspace with the `probe` type. A person's and an
 * agent's calls, a surface's port, a reload's `resetSession` and a replay.
 */

import { readFileSync } from 'node:fs';
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { createScopeRuntime } from '../scope/runtime.js';
import { registerShellState } from '../shell-state.js';
import {
	createScopedWorkspace,
	documentsDeployment,
	documentsPorts,
	replayKernel,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
} from '../testing.js';
import type { KernelEventV2, LoamKernelV2 } from '../types.js';
import { DOCUMENT_KIT } from './document-kit.js';
import { createEditorParts } from './editor-commands.js';
import { type EditorStateV1, emptyEditorState } from './editor-state.js';

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

	it('P2-D5: a dirty tab refuses a close, saying the person has unsaved changes and naming discard: true; a first edit promotes a preview; a reload forgets dirty', async () => {
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
		expect(refused.error?.message).toBe('The person has unsaved changes in tab t1');
		expect(refused.error?.suggestion).toContain('Retry once they save');
		expect(refused.error?.suggestion).not.toContain('probe-content-set');
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

	it('P2-D5: a trash or a move waits while a tab of the document is unsaved, an agent cannot mark it saved, and once the person’s page has, it runs', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const a = await probe(workspace, 'Alpha');
		await kernel.call('document-open', { document: a });
		await kernel.call('editor-dirty-set', { tab: 't1', dirty: true });
		const content = async () =>
			(await kernel.call('probe-content-get', { document: a })).data as unknown;
		const kept = await content();
		// An agent's trash and move are refused, naming the type's save and an editor-close that saves first.
		const trashed = await kernel.agent.call('document-trash', { document: a });
		expect(trashed.error?.code).toBe('EDITOR_TAB_DIRTY');
		expect(trashed.error?.suggestion).toContain('Retry once they save');
		expect(trashed.error?.suggestion).toContain('editor-close { tab: "t1", discard: true }');
		const moved = await kernel.agent.call('document-move', { document: a, project: 'atlas' });
		expect(moved.error?.code).toBe('EDITOR_TAB_DIRTY');
		// Nor may it mark the tab saved, which would let them through: only the person's page does.
		const marked = await kernel.agent.call('editor-dirty-set', { tab: 't1', dirty: false });
		expect(marked.error?.code).toBe('EDITOR_TAB_DIRTY');
		expect(marked.error?.suggestion).toContain('Retry once they save');
		expect((await editor(workspace)).groups[0]?.tabs[0]?.dirty).toBe(true);
		expect((await kernel.agent.call('editor-dirty-set', { tab: 't1', dirty: true })).success).toBe(
			true
		);
		expect(
			(await kernel.call<{ status: string }>('document-get', { document: a })).data
		).toMatchObject({ status: 'active', scope: { workspace: 'personal' } });
		expect(await content()).toEqual(kept);
		// An agent's close with discard: true closes the tab and keeps the mark, which the chrome's save of the
		// open editor clears from the person's page; until then a trash waits for it.
		expect((await kernel.agent.call('editor-close', { tab: 't1', discard: true })).success).toBe(
			true
		);
		expect(documentsOf(await editor(workspace))).toEqual([[]]);
		const waiting = await kernel.agent.call('document-trash', { document: a });
		expect(waiting.error?.code).toBe('EDITOR_TAB_DIRTY');
		// Its tab is gone, so the suggestion names no editor-close.
		expect(waiting.error?.suggestion).toBe(
			'Its tab is closed and its editor is saving them; retry once it has'
		);
		expect(
			(await kernel.agent.call('editor-dirty-set', { tab: 't1', dirty: false })).error?.code
		).toBe('EDITOR_TAB_DIRTY');
		expect((await kernel.call('editor-dirty-set', { tab: 't1', dirty: false })).success).toBe(true);
		// A closed tab takes no new mark.
		expect((await kernel.call('editor-dirty-set', { tab: 't1', dirty: true })).error?.code).toBe(
			'EDITOR_TAB_UNKNOWN'
		);
		expect((await kernel.agent.call('document-trash', { document: a })).success).toBe(true);
	});

	it('P2-D5: the person marking a tab unsaved in the same tick as an agent’s trash ends with the trash refused, the tab kept', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const a = await probe(workspace, 'Alpha');
		await kernel.call('document-open', { document: a });
		const [marked, trashed] = await Promise.all([
			kernel.call('editor-dirty-set', { tab: 't1', dirty: true }),
			kernel.agent.call('document-trash', { document: a }),
		]);
		expect(marked.success).toBe(true);
		expect(trashed.error?.code).toBe('EDITOR_TAB_DIRTY');
		expect((await editor(workspace)).groups[0]?.tabs[0]).toMatchObject({
			document: a,
			dirty: true,
		});
		expect(
			(await kernel.call<{ status: string }>('document-get', { document: a })).data?.status
		).toBe('active');
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

	it('P2-D5: opening a document already open activates it, and its undo activates what was active, closing nothing', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const a = await probe(workspace, 'Alpha');
		const b = await probe(workspace, 'Beta');
		await kernel.call('document-open', { document: a });
		await kernel.call('document-open', { document: b });
		const again = await kernel.call('document-open', { document: a });
		expect(again.data).toEqual({ tab: 't1', group: 'g1' });
		expect(again.undoCommand).toBe('editor-activate');
		expect(again.undoArgs).toEqual({ tab: 't2' });
		await kernel.call(again.undoCommand as string, again.undoArgs);
		const after = await editor(workspace);
		expect(documentsOf(after)).toEqual([[a, b]]);
		expect(after.groups[0]?.active).toBe('t2');
		// Opening the active one changes nothing, so it has nothing to undo.
		expect((await kernel.call('document-open', { document: b })).undoCommand).toBeUndefined();
	});

	it('P2-D5: decides a switch from the active scope, whatever scope the call names, and reports only a switch that ran', async () => {
		const workspace = await documents();
		const { kernel, scopes } = workspace;
		const atlasNote = await probe(workspace, 'Atlas note', scopes.atlas);
		const beaconNote = await probe(workspace, 'Beacon note', scopes.beacon);
		// Named Atlas, its own document's scope, while the workspace is active: the screen moves to Atlas.
		const own = await kernel.call(
			'document-open',
			{ document: atlasNote },
			{ scope: scopes.atlas }
		);
		expect(own.data).toMatchObject({
			scope: { from: { workspace: 'personal' }, to: scopes.atlas },
		});
		expect((await kernel.call<{ scope: unknown }>('scope-get')).data?.scope).toEqual(scopes.atlas);
		// Named Atlas, active, for a document in a third scope, Beacon: from Atlas to Beacon.
		const third = await kernel.call(
			'document-open',
			{ document: beaconNote },
			{ scope: scopes.atlas }
		);
		expect(third.data).toMatchObject({ scope: { from: scopes.atlas, to: scopes.beacon } });
		// Named Atlas, not active, for Beacon's document, already active: no switch, and none reported.
		const none = await kernel.call(
			'document-open',
			{ document: beaconNote },
			{ scope: scopes.atlas }
		);
		expect(none.success).toBe(true);
		expect((none.data as { scope?: unknown }).scope).toBeUndefined();
		expect(documentsOf(await editor(workspace, scopes.beacon))).toEqual([[beaconNote]]);
	});

	it('P2-D5: an editor owner that is disabled owns nothing, so it cannot raise a modal or open a document', async () => {
		const workspace = await documents();
		const { kernel } = workspace;
		const here = { workspace: 'personal' };
		const port = kernel.appPort('probe').surface({ scope: here });
		const a = await probe(workspace, 'Alpha');
		const b = await probe(workspace, 'Beta');
		await kernel.call('document-open', { document: a });
		expect((await port.call('modal-open', { title: 'Sure?', body: 'Really.' })).success).toBe(true);
		await kernel
			.call<{ overlays: Array<{ overlayId: string }> }>('overlay-list')
			.then((listed) =>
				Promise.all(
					(listed.data?.overlays ?? []).map((overlay) =>
						kernel.call('overlay-dismiss', { overlayId: overlay.overlayId, result: 'cancel' })
					)
				)
			);
		await kernel.call('workspace-app-set', { instance: 'probe', enabled: false });
		expect((await port.call('modal-open', { title: 'Sure?', body: 'Really.' })).error?.code).toBe(
			'OVERLAY_OWNER_INACTIVE'
		);
		expect((await port.call('document-open', { document: b })).error?.code).toBe(
			'DOCUMENT_OPEN_NOT_ACTIVE'
		);
		await kernel.call('workspace-app-set', { instance: 'probe', enabled: true });
		await kernel.call('scope-set', { project: 'atlas' });
		await kernel.call('scope-set', { project: null });
		await kernel.call('section-open', { section: 'documents' });
		// Enabled again, the owner is back: its own document-open works, as it did.
		expect((await port.call('document-open', { document: b })).success).toBe(true);
	});

	it("P2-D5: a restore drops a persisted tab whose document is in another scope, so nothing of it reaches the editor's answers", async () => {
		const store = new MemoryAdapter();
		const first = await documents({ store });
		const atlasNote = await probe(first, 'Atlas note', first.scopes.atlas);
		const mine = await probe(first, 'Mine');
		await first.kernel.call('document-open', { document: mine });
		await first.kernel.flush();
		// The workspace's record, edited outside the shell, names Atlas's document beside the person's own.
		const record = (await store.get<{
			value: { groups: Array<{ tabs: unknown[] }>; nextTab: number };
		}>('settings', 'loam.editor')) as {
			value: { groups: Array<{ tabs: unknown[] }>; nextTab: number };
		};
		record.value.groups[0]?.tabs.push({
			id: 't9',
			document: atlasNote,
			pinned: false,
			preview: false,
		});
		record.value.nextTab = 10;
		await store.update('settings', 'loam.editor', record);
		await first.kernel.dispose();
		const second = await documents({ store });
		const read = await editor(second);
		expect(documentsOf(read)).toEqual([[mine]]);
		expect(JSON.stringify(read)).not.toContain(atlasNote);
		expect(
			(await second.kernel.call('editor-selection-set', { tab: 't9', selection: null })).error?.code
		).toBe('EDITOR_TAB_UNKNOWN');
	});

	it('P2-D5: forgets a document it trusted once a move closes its tabs, so a record naming it again is checked again', async () => {
		const viewState = new ViewStateRegistry({ adapter: new MemoryAdapter() });
		const store = new MemoryAdapter();
		const parts = createEditorParts(
			{
				scope: createScopeRuntime({ id: 'personal', name: 'Personal' }),
				viewState,
				state: registerShellState(viewState),
				store,
				overlays: {} as never,
				apps: () => ({}) as never,
				lateScope: {} as never,
				check: {} as never,
				isMutation: () => true,
			},
			DOCUMENT_KIT
		);
		const here = { workspace: 'personal' };
		await store.create(DOCUMENT_KIT.table, { id: 'doc_x', workspace: 'personal', scope: here });
		// What a read of the store would put there: the workspace's record naming the document.
		const naming: EditorStateV1 = {
			...emptyEditorState(),
			groups: [
				{
					id: 'g1',
					active: 't1',
					tabs: [{ id: 't1', document: 'doc_x', pinned: false, preview: false }],
				},
			],
			nextTab: 2,
		};
		const tabs = () =>
			(viewState.get('loam.editor') as unknown as EditorStateV1).groups.flatMap((group) =>
				group.tabs.map((tab) => tab.document)
			);
		await parts.ensure(undefined);
		viewState.set('loam.editor', naming as never);
		await parts.ensure(undefined);
		expect(tabs()).toEqual(['doc_x']);
		// Moved to Atlas: its tab closes in the scope it left, and that scope trusts it no longer.
		await store.update(DOCUMENT_KIT.table, 'doc_x', { scope: { ...here, project: 'atlas' } });
		await parts.closeDocument('doc_x', here, { traceId: 'move' });
		expect(tabs()).toEqual([]);
		viewState.set('loam.editor', naming as never);
		await parts.ensure(undefined);
		expect(tabs()).toEqual([]);
	});

	it('P2-D5: the late-editor chunk imports types alone, but its own state module, which imports types alone', () => {
		// A runtime import of what first paint or `late` holds would part their chunks (scope and projects
		// specification, 2.4): `late` hands the chunk what it runs with, in `DOCUMENT_KIT`.
		const imports = (file: string) =>
			readFileSync(new URL(file, import.meta.url), 'utf8').match(/^import\s[^;]*;/gm) ?? [];
		const entry = imports('./editor-commands.ts');
		expect(entry.length).toBeGreaterThan(0);
		expect(
			entry.filter(
				(statement) =>
					!/^import type\s/.test(statement) && !statement.includes("'./editor-state.js'")
			)
		).toEqual([]);
		expect(
			imports('./editor-state.ts').filter((statement) => !/^import type\s/.test(statement))
		).toEqual([]);
		for (const file of ['./editor-commands.ts', './editor-state.ts']) {
			expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(
				/\bimport\s*\(|^export\s+(\*|\{[^}]*\})\s+from\s/m
			);
		}
	});
});
