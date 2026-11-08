/**
 * @fileoverview The `editor` chunk (documents specification, 5 and 6; D80): the editor area in main when the
 * documents section shows, loaded by the URL's chunk on the first document opened, restored or routed to,
 * as the `sections` chunk is, so first paint holds none of it. `syncEditor` follows the state; the area
 * then hears the kernel itself. It renders `editor-get` of the active scope, each group a
 * `loam-editor-group` and each active tab a `loam-editor-frame`, parking up to ten native editors a group.
 * It turns every person's action into a command, and owns saving: `autosave_ms`, Mod+S, a dirty tab's
 * close, and `pagehide`. A change of scope drops every editor, after asking each dirty one to save, so
 * nothing of one scope stays under another; switching to an app keeps them, off screen, with their drafts.
 * It imports nothing first paint holds but FAST, so it splits no chunk of first paint (scope and projects
 * specification, 2.4).
 */

import { type FASTElement, Updates } from '@lushly-dev/fast-element';
import type { KernelEventV2, LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type { DocumentRecordV1, DocumentRefV1, DocumentTypeV1 } from '@lushly-dev/loam-sdk';
import type { LoamShell } from '../elements/shell.js';
import { editorAreaDefinition, type LoamEditorArea } from './editor-area.js';
import {
	editorFrameDefinition,
	type FrameListener,
	LoamEditorFrame,
	type SurfaceHostV1,
} from './editor-frame.js';
import {
	EDITOR_GROUP_EVENT,
	type EditorGroupAction,
	type EditorTabView,
	editorGroupDefinition,
	type LoamEditorGroup,
} from './editor-group.js';
import {
	defineEditorElements,
	type EditorReadV1,
	focusMain,
	type How,
	isSave,
	type Life,
	MODAL_RESULT_EVENT,
	mainWithEditor,
	PARKED_PER_GROUP,
	type Place,
	type RecordRead,
	type ScopeOf,
	SURFACES_WAIT_MS,
} from './editor-parts.js';

export { defineEditorElements, type EditorReadV1, PARKED_PER_GROUP } from './editor-parts.js';

const controllers = new WeakMap<LoamShell, EditorController>();

/** Follow the state: show, update or hide the editor area. One at a time per shell, so a later state wins. */
export async function syncEditor(shell: LoamShell): Promise<void> {
	await defineEditorElements();
	let controller = controllers.get(shell);
	if (!controller) {
		controller = new EditorController(shell);
		controllers.set(shell, controller);
		// Where a test, or the console, finds what the area has rendered.
		(shell as LoamShell & { editor?: EditorController }).editor = controller;
	}
	return controller.sync();
}

/** The area's controller, for a test reading what it rendered. */
export function editorOf(shell: LoamShell): EditorController | undefined {
	return controllers.get(shell);
}

export class EditorController implements FrameListener {
	readonly #shell: LoamShell;
	readonly #kernel: LoamKernelV2;
	readonly #area: LoamEditorArea;
	readonly #groups = new Map<string, LoamEditorGroup>();
	/** Each tab's frame, by tab id, in the scope that is rendered. */
	readonly #frames = new Map<string, LoamEditorFrame>();
	/** The order frames were last shown in, per group, so the oldest parked one is dropped first. */
	readonly #shown = new Map<string, string[]>();
	readonly #records = new Map<string, RecordRead>();
	/** Each frame's autosave timer, by frame, so no frame of one scope stops another's of the same tab id. */
	readonly #timers = new Map<LoamEditorFrame, ReturnType<typeof setTimeout>>();
	/**
	 * Tabs a person is closing, as `<visit> <tab>`, whose frames a render between the save and the close must
	 * not make again.
	 */
	readonly #closing = new Set<string>();
	readonly #modals = new Map<string, (result: 'confirm' | 'cancel') => void>();
	#queue: Promise<void> = Promise.resolve();
	#scopeKey: string | null = null;
	/** The scope rendered, and its visit: each change of scope is a new one, so a return is not the same visit. */
	#at: ScopeOf | undefined;
	#visit = 0;
	#state: EditorReadV1 | null = null;
	#types = new Map<string, DocumentTypeV1>();
	/** The tab to focus once the strip renders, and whether focus then goes into its editor. */
	#focus: { tab: string; editor: boolean } | null = null;
	/** By tab, the parked frames still saving, which a tab shown again meanwhile takes back with their drafts. */
	readonly #parking = new Map<string, LoamEditorFrame>();
	/** Each frame's life, which only `#move` changes the place of. */
	readonly #lives = new WeakMap<LoamEditorFrame, Life>();
	/** The frames with a leave under way, one each at a time. */
	readonly #leaving = new Set<LoamEditorFrame>();
	/** By document, the frames waiting for their document's new tab, after their saves rejected (5.5). */
	readonly #adopt = new Map<string, LoamEditorFrame>();
	/** A render once the app surfaces have registered `ICONS_V1`, when one ran before them. */
	#icons: Promise<void> | undefined;

	constructor(shell: LoamShell) {
		this.#shell = shell;
		this.#kernel = shell.kernel as LoamKernelV2;
		this.#area = shell.ownerDocument.createElement(editorAreaDefinition.name) as LoamEditorArea;
		this.#area.shortcut = shell.shortcut;
		const view = shell.ownerDocument.defaultView ?? window;
		this.#kernel.subscribe((event) => this.#onEvent(event));
		// Before the shell's own listener, which leaves Mod+S to this one (5.5).
		view.addEventListener('keydown', (event) => this.#onKeydown(event), { capture: true });
		view.addEventListener('pagehide', () => this.#saveAll());
		shell.addEventListener(
			EDITOR_GROUP_EVENT,
			(event) =>
				void this.#onAction((event as CustomEvent<EditorGroupAction & { group: string }>).detail)
		);
		shell.addEventListener(MODAL_RESULT_EVENT, (event) => {
			const { overlayId, result } = (
				event as CustomEvent<{ overlayId: string; result: 'confirm' | 'cancel' }>
			).detail;
			this.#modals.get(overlayId)?.(result);
			this.#modals.delete(overlayId);
		});
	}

	/** One read at a time, so a later answer never renders under an earlier one. */
	sync(): Promise<void> {
		this.#queue = this.#queue.then(() => this.#sync()).catch(reportError);
		return this.#queue;
	}

	/**
	 * What a test reads, and its check of the frames' invariants, in this order: the visit rendered, `#frames`,
	 * `#parking`, the leaving frames, each frame's life, the tabs the person is closing, and the state rendered.
	 */
	get lifecycle() {
		return [
			this.#visit,
			this.#frames,
			this.#parking,
			this.#leaving,
			this.#lives,
			this.#closing,
			this.#state,
		] as const;
	}

	get idle(): Promise<void> {
		return this.#queue;
	}

	#main(): (HTMLElement & FASTElement) | null {
		return this.#shell.shadowRoot?.querySelector<HTMLElement & FASTElement>('loam-main') ?? null;
	}

	async #sync(): Promise<void> {
		const main = this.#main();
		if (!main) return;
		const state = await this.#shell.readState();
		const key = `${state.workspace.id} ${state.scope.project ?? ''}`;
		if (this.#scopeKey !== null && key !== this.#scopeKey) await this.#dropAll();
		this.#scopeKey = key;
		this.#at = state.scope.project
			? { workspace: state.workspace.id, project: state.scope.project }
			: { workspace: state.workspace.id };
		const shows = state.section === 'documents' && state.active === null;
		if (!shows) {
			// No render while an app shows, yet a mark an agent sets with no editor behind it still goes.
			const read = await this.#kernel.call<EditorReadV1>('editor-get');
			await Promise.all(this.#unmark(read.data?.groups.flatMap((group) => group.tabs) ?? []));
			if (this.#area.isConnected) {
				const hadFocus = this.#area.matches(':focus-within');
				this.#area.remove();
				if (main.dataset.section === 'documents') delete main.dataset.section;
				if (hadFocus) focusMain(this.#shell, main);
			}
			return;
		}
		if (!main.dataset.editorReady) {
			main.dataset.editorReady = '';
			main.$fastController.addStyles(mainWithEditor);
		}
		main.dataset.section = 'documents';
		if (!this.#area.isConnected) main.append(this.#area);
		const read = await this.#kernel.call<EditorReadV1>('editor-get');
		if (!read.success || !read.data) return;
		this.#state = read.data;
		await this.#render(read.data);
		// The first frame held main busy for a persisted documents section (6): it shows what it shows now.
		this.#shell.releaseMain();
	}

	/** The registry's types, for each tab's editor: what the frame mounts, and its `autosave_ms`. */
	async #readTypes(): Promise<void> {
		const result = await this.#kernel.call<{ types: DocumentTypeV1[] }>('document-type-list', {
			all: true,
		});
		this.#types = new Map((result.data?.types ?? []).map((type) => [type.id, type]));
	}

	async #record(document: string): Promise<RecordRead> {
		let held = this.#records.get(document);
		if (!held) {
			const result = await this.#kernel.call<DocumentRecordV1>('document-get', { document });
			held =
				result.success && result.data
					? result.data
					: {
							code: result.error?.code ?? 'DOCUMENT_NOT_FOUND',
							message: result.error?.message ?? 'This document is not available',
							suggestion: result.error?.suggestion,
						};
			this.#records.set(document, held);
		}
		return held;
	}

	async #render(state: EditorReadV1): Promise<void> {
		const tabs = state.groups.flatMap((group) => group.tabs);
		this.#area.empty = tabs.length === 0;
		if (this.#types.size === 0 || tabs.some((tab) => !this.#frames.has(tab.id))) {
			await this.#readTypes();
		}
		const records = new Map(
			await Promise.all(
				tabs.map(async (tab) => [tab.document, await this.#record(tab.document)] as const)
			)
		);
		const titleOf = (document: string) => {
			const held = records.get(document);
			return held && 'title' in held ? held.title : 'Unavailable document';
		};
		// Blank until the app surfaces register `ICONS_V1`, then drawn again, as the rail's entries are (2.4).
		const icons = this.#shell.apps !== null;
		if (!icons) this.#icons ??= this.#host().then(() => this.sync());
		const iconOf = (document: string) => {
			const held = records.get(document);
			return icons
				? (held && 'type' in held && this.#types.get(held.type)?.icon) || 'system/document'
				: '';
		};
		const compact = this.#shell.dataset.layoutClass === 'compact';
		// The tab focus is on, in its strip or its editor, so focus stays with it if a change takes it (5.8).
		const had = [...this.#groups.values()].find((group) => group.matches(':focus-within'));
		const was =
			(had?.shadowRoot?.activeElement as HTMLElement | null)?.dataset.tab ?? had?.activeTab?.id;
		// Groups in order, as columns; a group the state no longer has goes with its frames.
		const kept = new Set(state.groups.map((group) => group.id));
		for (const [id, element] of this.#groups) {
			if (kept.has(id)) continue;
			element.remove();
			this.#groups.delete(id);
			this.#shown.delete(id);
		}
		const live = new Set(tabs.map((tab) => tab.id));
		for (const [tab, frame] of this.#frames) {
			if (live.has(tab)) continue;
			this.#stopTimer(frame);
			// Closed by a call not the person's own close: an editor still unsaved saves first, and its save
			// clears the mark the kernel keeps for it, which holds a trash or a move until then (5.5).
			this.#retire(frame, 'closed');
		}
		// A parked one whose tab closed leaves the map; its leave, finding the tab gone, ends as a close's.
		for (const [tab, frame] of this.#parking) {
			if (live.has(tab)) continue;
			(this.#lives.get(frame) as Life).queued = undefined;
			this.#move(frame, 'leaving');
		}
		const marks: Promise<unknown>[] = [];
		state.groups.forEach((group, index) => {
			let element = this.#groups.get(group.id);
			if (!element) {
				element = this.#shell.ownerDocument.createElement(
					editorGroupDefinition.name
				) as LoamEditorGroup;
				element.group = group.id;
				element.mac = this.#shell.mac;
				this.#groups.set(group.id, element);
			}
			element.label = state.groups.length > 1 ? `Documents, group ${index + 1}` : 'Documents';
			element.compact = compact;
			// The compact class shows only the active group (5.2).
			element.hidden = compact && group.id !== state.activeGroup;
			element.tabs = group.tabs.map(
				(tab): EditorTabView => ({
					...tab,
					title: titleOf(tab.document),
					icon: iconOf(tab.document),
					active: tab.id === group.active,
				})
			);
			if (this.#area.children[index] !== element)
				this.#area.insertBefore(element, this.#area.children[index] ?? null);
			for (const tab of group.tabs) {
				const frame = this.#frames.get(tab.id);
				if (frame && frame.parentElement !== element) element.append(frame);
				// An editor that still says unsaved is, whoever marked its tab saved (5.5): only one of this scope.
				if (frame?.dirty && !tab.dirty && this.#here(frame))
					marks.push(
						this.#kernel.call(
							'editor-dirty-set',
							{ tab: tab.id, dirty: true },
							{ scope: frame.record?.scope as ScopeOf }
						)
					);
			}
			const active = group.tabs.find((tab) => tab.id === group.active);
			for (const tab of group.tabs) this.#frames.get(tab.id)?.show(tab.id === active?.id);
			const ids = new Set(group.tabs.map((tab) => tab.id));
			if (active && !this.#closing.has(`${this.#visit} ${active.id}`)) {
				this.#showFrame(element, group.id, active, records.get(active.document), ids);
			}
		});
		await Promise.all([...marks, ...this.#unmark(tabs)]);
		const activeGroup = state.groups.find((group) => group.id === state.activeGroup);
		const activeTab = activeGroup?.tabs.find((tab) => tab.id === activeGroup.active);
		this.#area.heading = activeTab ? titleOf(activeTab.document) : '';
		await Updates.next();
		const focus = this.#focus;
		this.#focus = null;
		const groupOf = (tab?: string) => this.#groupOf(tab);
		const doc = this.#shell.ownerDocument;
		if (focus) {
			if (focus.editor) this.#frames.get(focus.tab)?.focusEditor();
			else groupOf(focus.tab)?.tabButton(focus.tab)?.focus();
		} else if (had && doc.activeElement === doc.body) {
			// Focus went with what had it, as another's close or move takes a tab: to the tab, in the group it
			// moved to, or its group's active tab, or main (5.8).
			const holder = groupOf(was);
			const to =
				holder && holder !== had
					? holder.tabButton(was as string)
					: had.isConnected && had.activeTab && had.tabButton(had.activeTab.id);
			const main = this.#main();
			if (to) to.focus();
			else if (main) focusMain(this.#shell, main);
		}
	}

	/**
	 * The chrome's editors are the truth about unsaved work (5.4): a tab marked unsaved with no editor, no leave
	 * and no close of the person's behind it holds nothing, and its mark goes, from the person's page.
	 */
	#unmark(tabs: EditorReadV1['groups'][number]['tabs']): Promise<unknown>[] {
		return tabs
			.filter((tab) => {
				if (!tab.dirty || this.#closing.has(`${this.#visit} ${tab.id}`)) return false;
				if (this.#held(tab.id, tab.document)) return false;
				// An editor ready, clean and of this visit says there is nothing unsaved, whoever marked it.
				const frame = this.#frames.get(tab.id);
				if (frame) return frame.state === 'ready' && !frame.dirty && this.#here(frame);
				return !this.#parking.has(tab.id);
			})
			.map((tab) =>
				this.#kernel.call('editor-dirty-set', { tab: tab.id, dirty: false }, { scope: this.#at })
			);
	}

	/**
	 * Whether a frame of `tab` and scope `at` (the scope rendered unless named), of any visit, but `but`, still
	 * leaves or parks with `document`'s draft, its save or reopen under way: the tab keeps its mark until that
	 * leave's own end clears it, whatever a newer editor, or a newer leave, of the tab says. Every clear asks it.
	 */
	#held(
		tab: string,
		document: string,
		but?: LoamEditorFrame,
		at: ScopeOf | undefined = this.#at
	): boolean {
		return [...this.#leaving].some(
			(each) =>
				each !== but &&
				each.tab === tab &&
				each.document === document &&
				!!this.#lives.get(each)?.busy &&
				((at === this.#at && this.#here(each)) ||
					(each.record?.scope.workspace === at?.workspace &&
						each.record?.scope.project === at?.project))
		);
	}

	/** The active tab's frame, made and opened once, and the group's oldest parked ones over ten dropped. */
	#showFrame(
		group: LoamEditorGroup,
		groupId: string,
		tab: EditorReadV1['groups'][number]['tabs'][number],
		record: RecordRead | undefined,
		ids: ReadonlySet<string>
	): void {
		let frame = this.#frames.get(tab.id);
		// One parked and still saving, taken back by its own tab; or one whose save rejected after another's
		// close, with its draft, taken by its document's new tab.
		const parking = this.#parking.get(tab.id);
		const adopted = this.#adopt.get(tab.document);
		if (!frame && parking) frame = this.#take(parking, tab.id, group);
		// Not one the person discarded meanwhile: its leave lets it go.
		else if (!frame && adopted && !this.#lives.get(adopted)?.discarded) {
			this.#adopt.delete(tab.document);
			frame = this.#take(adopted, tab.id, group);
		}
		if (!frame) {
			frame = this.#shell.ownerDocument.createElement(
				editorFrameDefinition.name
			) as LoamEditorFrame;
			frame.tab = tab.id;
			frame.dataset.tab = tab.id;
			frame.document = tab.document;
			frame.listener = this;
			frame.dirty = tab.dirty;
			this.#lives.set(frame, { visit: this.#visit, place: 'leaving', edits: 0 });
			group.append(frame);
			this.#move(frame, 'shown');
			void this.#open(frame, record);
		}
		if (record && 'title' in record) frame.title = record.title;
		frame.show(true);
		// This group's tabs only: a tab moved away is the other group's to park.
		const order = (this.#shown.get(groupId) ?? []).filter(
			(id) => id !== tab.id && this.#frames.has(id) && ids.has(id)
		);
		order.push(tab.id);
		while (order.length > PARKED_PER_GROUP) {
			const oldest = order.shift() as string;
			const parked = this.#frames.get(oldest);
			if (parked) {
				this.#stopTimer(parked);
				this.#retire(parked, 'parked');
			}
		}
		this.#shown.set(groupId, order);
	}

	async #open(frame: LoamEditorFrame, record: RecordRead | undefined): Promise<void> {
		if (!record || !('title' in record)) {
			frame.title = 'This document';
			frame.fail(
				record ?? {
					code: 'DOCUMENT_NOT_FOUND',
					message: 'No document with that id is available to you',
				}
			);
			return;
		}
		frame.record = record;
		frame.title = record.title;
		const type = this.#types.get(record.type);
		if (!type) {
			frame.fail({
				code: 'DOCUMENT_TYPE_UNAVAILABLE',
				message: `No app this workspace runs provides the document type '${record.type}'`,
				suggestion:
					'List the apps with app-list, or redeploy the app that provides it; the document is kept.',
			});
			return;
		}
		if (record.contentVersion > type.contentVersion) {
			frame.fail({
				code: 'DOCUMENT_CONTENT_VERSION_NEWER',
				message: `This document was written by a newer version of '${type.app}', so it is not opened here`,
				suggestion: 'Update the app; nothing is overwritten.',
			});
			return;
		}
		const declared = this.#kernel
			.appPort(type.instance)
			.manifest.ui?.documents?.find((each) => each.id === type.id);
		const element =
			declared?.editor && 'element' in declared.editor ? declared.editor.element : undefined;
		if (type.editorKind !== 'native' || element === undefined) {
			frame.fail({
				code: 'DOCUMENT_TYPE_UNAVAILABLE',
				message: "This document's editor is a view, which this shell does not open yet",
				suggestion: 'Its commands still work from the command palette.',
			});
			return;
		}
		frame.autosaveMs = declared?.autosave_ms;
		const host = await this.#host();
		if (!host) {
			frame.fail({
				code: 'APP_RUNTIME_UNAVAILABLE',
				message: 'The app surfaces did not load',
				suggestion: 'Reload; check that the deployment serves its assets.',
			});
			return;
		}
		const reference: DocumentRefV1 = {
			id: record.id,
			type: record.type,
			title: record.title,
			scope: record.scope,
			contentVersion: record.contentVersion,
			binding: record.binding,
			readOnly: false,
		};
		await frame.open(host, type.instance, element, reference);
	}

	/** The app surfaces' way in, once they have loaded beside stage B. */
	async #host(): Promise<SurfaceHostV1 | undefined> {
		const until = Date.now() + SURFACES_WAIT_MS;
		while (!this.#shell.apps && Date.now() < until)
			await new Promise((resolve) => setTimeout(resolve, 50));
		return (this.#shell.apps as { host?(): SurfaceHostV1 } | null)?.host?.();
	}

	// ─── What the kernel says ──────────────────────────────────────────────────────

	#onEvent(event: KernelEventV2): void {
		// Another call changed a document: every open editor of it re-reads, its own calls included (5.7).
		if (event.document !== undefined && event.success) {
			for (const frame of this.#frames.values()) {
				if (frame.document !== event.document) continue;
				frame.changed({
					document: event.document,
					command: event.command,
					...(event.seq !== undefined ? { seq: event.seq } : {}),
				});
			}
		}
		if (!event.scopeChanged && !(event.success && event.mutation)) return;
		// A record's title, status or scope may have changed: each is read again.
		if (event.command.startsWith('document-')) this.#records.clear();
		if (/^(editor-|document-)/.test(event.command) || event.scopeChanged || event.mainChanged) {
			void this.sync();
		}
	}

	// ─── A person's actions ────────────────────────────────────────────────────────

	async #onAction(action: EditorGroupAction & { group: string }): Promise<void> {
		const kernel = this.#kernel;
		const { tab } = action;
		switch (action.action) {
			case 'activate':
				this.#focus = { tab, editor: action.focus === true };
				if (this.#isActive(tab)) await this.sync();
				else await kernel.call('editor-activate', { tab });
				return;
			case 'close':
				await this.close(tab);
				return;
			case 'pin':
			case 'unpin':
				this.#keepFocus(action.group, tab);
				await kernel.call('editor-pin', { tab, pinned: action.action === 'pin' });
				return;
			case 'close-others': {
				const group = this.#state?.groups.find((each) => each.id === action.group);
				const visit = this.#visit;
				for (const other of group?.tabs ?? []) {
					// Not past a change of scope, whose tabs are another scope's.
					if (visit !== this.#visit) return;
					if (other.id !== tab && !other.pinned && !(await this.close(other.id))) return;
				}
				return;
			}
			case 'beside': {
				const document = this.#frames.get(tab)?.document ?? this.#tabOf(tab)?.document;
				if (document) await kernel.call('document-open', { document, group: 'beside' });
				return;
			}
			case 'new-group':
				// Focus follows the tab into its new group, from wherever the menu was opened in the strip.
				this.#keepFocus(action.group, tab);
				await kernel.call('editor-move', { tab, group: 'new' });
				return;
		}
	}

	/** When focus is on the tab, it stays on it once the strip renders, in whichever group then holds it. */
	#keepFocus(group: string, tab: string): void {
		const active = this.#groups.get(group)?.shadowRoot?.activeElement as HTMLElement | null;
		if (active?.dataset.tab === tab) this.#focus = { tab, editor: false };
	}

	#tabOf(tab: string) {
		return this.#state?.groups.flatMap((group) => group.tabs).find((each) => each.id === tab);
	}

	#isActive(tab: string): boolean {
		const state = this.#state;
		const group = state?.groups.find((each) => each.id === state.activeGroup);
		return group?.active === tab;
	}

	/**
	 * Close a tab as a person asks (5.5): a dirty one saves first when its type autosaves; otherwise, or when
	 * the save rejects, the phase 1 modal asks, Discard or Keep editing. Focus goes to the tab that becomes
	 * active, or main. False when the person kept editing.
	 */
	async close(tab: string): Promise<boolean> {
		const visit = this.#visit;
		const id = `${visit} ${tab}`;
		this.#closing.add(id);
		try {
			return await this.#close(tab, visit, this.#at);
		} finally {
			this.#closing.delete(id);
		}
	}

	/** The tab of `at`, the scope rendered when the person asked, whatever scope is active by its end. */
	async #close(tab: string, visit: number, at: ScopeOf | undefined): Promise<boolean> {
		// Its editor, shown or parked while it saves: the person's Discard is the one way its draft goes.
		const frame = this.#frames.get(tab) ?? this.#parking.get(tab);
		const dirty = frame?.dirty === true || this.#tabOf(tab)?.dirty === true;
		if (dirty) {
			let saved = false;
			if (frame?.autosaveMs !== undefined) {
				try {
					await frame.save();
					saved = true;
				} catch {
					saved = false;
				}
			}
			if (!saved && !(await this.#confirmDiscard(frame?.title ?? 'this document'))) return false;
		}
		const hadFocus = this.#area.matches(':focus-within');
		// Only while the frame is still this tab's: a reopen meanwhile may have given it, with its draft, to
		// another tab, whose editor it is now.
		if (frame && frame.tab === tab && (this.#frames.get(tab) ?? this.#parking.get(tab)) === frame) {
			this.#stopTimer(frame);
			await this.#move(frame, 'disposed');
		} else if (frame?.tab === tab && this.#leaving.has(frame) && this.#here(frame)) {
			// Still leaving under this tab, another's close having taken it: the person's Discard holds, so a save
			// that rejects brings nothing back. One already under way may still write; it began before.
			(this.#lives.get(frame) as Life).discarded = true;
		}
		const closed = await this.#kernel.call<{ previous: { group: string } }>(
			'editor-close',
			{ tab, discard: true },
			{ scope: at }
		);
		if (!closed.success || visit !== this.#visit) return closed.success;
		// Focus goes to the next tab of the same group, which APG's tabs keep it in, or the active group's when
		// that one went with its last tab, or main (5.8).
		await this.idle;
		const state = this.#state;
		const own = state?.groups.find((each) => each.id === closed.data?.previous.group);
		const group = own ?? state?.groups.find((each) => each.id === state.activeGroup);
		if (hadFocus) {
			const next = group?.active ? this.#groups.get(group.id)?.tabButton(group.active) : null;
			const main = this.#main();
			if (next) next.focus();
			else if (main) focusMain(this.#shell, main);
		}
		return true;
	}

	/** The phase 1 modal: `Close without saving?`, Discard as `danger`, or Keep editing (5.5). */
	async #confirmDiscard(title: string): Promise<boolean> {
		const opened = await this.#kernel.call<{ overlayId: string }>('modal-open', {
			title: 'Close without saving?',
			body: `Your changes to ${title.slice(0, 200)} are not saved. Closing loses them.`,
			confirmLabel: 'Discard',
			cancelLabel: 'Keep editing',
			danger: true,
		});
		const overlayId = opened.data?.overlayId;
		if (!opened.success || overlayId === undefined) return false;
		const result = await new Promise<'confirm' | 'cancel'>((resolve) =>
			this.#modals.set(overlayId, resolve)
		);
		return result === 'confirm';
	}

	// ─── Saving (5.5) ──────────────────────────────────────────────────────────────

	dirty(frame: LoamEditorFrame, dirty: boolean): void {
		if (!this.#live(frame)) return;
		if (dirty) (this.#lives.get(frame) as Life).edits++;
		// Every edit restarts the timer; the kernel hears a change only.
		this.#stopTimer(frame);
		if (dirty && frame.autosaveMs !== undefined) {
			this.#timers.set(
				frame,
				setTimeout(() => {
					if (this.#live(frame)) void this.#save(frame);
				}, frame.autosaveMs)
			);
		}
		if (frame.dirty === dirty) return;
		frame.dirty = dirty;
		// A newer editor's clean report leaves the mark to an earlier one still saving the tab's draft.
		if (!dirty && this.#held(frame.tab, frame.document, frame)) return;
		void this.#kernel.call('editor-dirty-set', { tab: frame.tab, dirty });
	}

	selection(frame: LoamEditorFrame, selection: unknown): void {
		if (!this.#live(frame)) return;
		void this.#kernel.call('editor-selection-set', { tab: frame.tab, selection });
	}

	/**
	 * Whether `frame` is held by its tab or parked while it saves, in the scope rendered, which only those maps
	 * hold: tab ids repeat across scopes, and a leaving frame is no tab's.
	 */
	#live(frame: LoamEditorFrame): boolean {
		const place = this.#lives.get(frame)?.place;
		return place === 'shown' || place === 'parked';
	}

	/**
	 * The one way a frame changes place: out of both maps, then into the one its place names, or disposed, once.
	 * So a frame is in one map or none, and only frames of the scope rendered are in either.
	 */
	#move(frame: LoamEditorFrame, to: Place): Promise<void> | undefined {
		const life = this.#lives.get(frame) as Life;
		if (life.place === 'disposed') return;
		const map = to === 'shown' ? this.#frames : to === 'parked' ? this.#parking : undefined;
		// A slot another frame holds is never taken over: that would lose the other one, so it is refused.
		if ((map?.get(frame.tab) ?? frame) !== frame) throw new Error(`Tab ${frame.tab} is held`);
		if (this.#frames.get(frame.tab) === frame) this.#frames.delete(frame.tab);
		if (this.#parking.get(frame.tab) === frame) this.#parking.delete(frame.tab);
		life.place = to;
		map?.set(frame.tab, frame);
		return to === 'disposed' ? frame.dispose() : undefined;
	}

	/** Whether `frame` was made in this visit of the scope rendered: never after a change of scope, even back. */
	#here(frame: LoamEditorFrame): boolean {
		return this.#lives.get(frame)?.visit === this.#visit;
	}

	/**
	 * A frame leaving (5.5, 5.6): parked, it waits in `#parking`, where its tab can take it back; else it leaves
	 * both maps. One leave at a time: asked again while one runs, it runs once that settles, unless its tab has
	 * taken the frame back; then the frame goes. A frame of another scope than the one rendered only leaves, as
	 * `left`, and goes: it never returns to a map, reopens or reports a mark here (5.1, 7.6).
	 */
	#retire(frame: LoamEditorFrame, how: How = 'left'): void {
		const life = this.#lives.get(frame) as Life;
		if (life.place === 'disposed') return;
		const kind = this.#here(frame) ? how : 'left';
		// Off the page as it starts leaving, so nothing is typed into an editor no tab holds (5.5).
		const shown = !frame.hidden;
		frame.show(false);
		this.#move(frame, kind === 'parked' ? 'parked' : 'leaving');
		if (this.#leaving.has(frame)) {
			life.queued = kind;
			return;
		}
		this.#leaving.add(frame);
		void this.#leave(frame, kind, shown)
			.catch(reportError)
			.finally(() => {
				this.#leaving.delete(frame);
				life.busy = false;
				const again = life.queued;
				life.queued = undefined;
				if (life.place === 'shown') return;
				if (again) this.#retire(frame, again);
				else void this.#move(frame, 'disposed');
			});
	}

	/**
	 * A leave's work: a dirty frame saves first, a rejection a toast (5.5). When its save rejects while main
	 * shows its scope's area, its draft is kept for the person (Status deviation 16): a `closed` one takes a tab
	 * of its document again, and a `parked` one goes back into its tab, which its group then holds beyond ten. A
	 * save clears its tab's mark in its document's scope, unless its editor reported an edit since the save
	 * began, or that scope's tab holds a newer unsaved edit (7.6); so does a draft that could not be kept; a
	 * `closed` frame clears its closed tab's mark in any case, since that call may have left one.
	 */
	async #leave(frame: LoamEditorFrame, how: How, shown: boolean): Promise<void> {
		const life = this.#lives.get(frame) as Life;
		const { tab, dirty } = frame;
		const scope = frame.record?.scope;
		const edits = life.edits;
		life.busy = true;
		const saved = !dirty || (await this.#save(frame));
		// A parked frame whose tab another's call closed meanwhile ends as a close's.
		const closed = how === 'closed' || (how === 'parked' && !this.#tabOf(tab));
		const away = life.place === 'parked' || life.place === 'leaving';
		if (!saved && away && !life.discarded && this.#here(frame) && this.#area.isConnected) {
			if (closed) await this.#reopen(frame, shown);
			else if (how === 'parked' && !this.#frames.has(tab)) this.#move(frame, 'shown');
		}
		life.busy = false;
		// Neither kept nor leaving again: off the page before its mark goes. A draft that could not be kept is
		// gone, after its toast, and its mark with it. A frame its tab took back keeps the tab's mark: its editor
		// reports for itself.
		if (life.place !== 'shown' && !life.queued) await this.#move(frame, 'disposed');
		const lost = !saved && life.place === 'disposed';
		const now = this.#frames.get(tab);
		if (
			scope &&
			(closed || lost || (dirty && saved && life.edits === edits && !this.#live(frame))) &&
			!(now?.dirty && now.record?.scope.project === scope.project) &&
			!this.#held(tab, frame.document, frame, scope)
		)
			await this.#kernel.call('editor-dirty-set', { tab, dirty: false }, { scope });
	}

	/** `frame` held by `tab` of `group`, as its own. */
	#take(frame: LoamEditorFrame, tab: string, group: LoamEditorGroup): LoamEditorFrame {
		// A Discard holds for the leave it was given in, and no longer than that.
		(this.#lives.get(frame) as Life).discarded = false;
		this.#move(frame, 'leaving');
		frame.tab = tab;
		frame.dataset.tab = tab;
		group.append(frame);
		this.#move(frame, 'shown');
		return frame;
	}

	#groupOf(tab?: string): LoamEditorGroup | undefined {
		return [...this.#groups.values()].find((each) => each.tabs.some((held) => held.id === tab));
	}

	/**
	 * A closed tab's frame, its draft unsaved, back in a tab of its document: one whose editor is clean, or not
	 * drawn, in any group, the active one first, which takes it, the clean editor going; else a new tab, through
	 * the person's own `document-open` with `stay`, which moves no one and opens only where main shows, active
	 * when the closed tab was, else in the background, or beside when every group holding the document has an
	 * unsaved editor, or when a full group refuses it. Whichever tab takes it is marked unsaved before the
	 * closed tab's mark goes, so a trash or a move meets one throughout (Status deviation 16).
	 */
	async #reopen(frame: LoamEditorFrame, shown: boolean): Promise<boolean> {
		const { document } = frame;
		const at = { scope: frame.record?.scope as ScopeOf };
		const mark = (tab: string) => this.#kernel.call('editor-dirty-set', { tab, dirty: true }, at);
		const state = this.#state;
		const groups = state
			? [
					...state.groups.filter((group) => group.id === state.activeGroup),
					...state.groups.filter((group) => group.id !== state.activeGroup),
				]
			: [];
		let unsaved = false;
		for (const each of groups) {
			const held = each.tabs.find((tab) => tab.document === document);
			const group = held && this.#groups.get(each.id);
			if (!held || !group) continue;
			// A tab's editor parked and still saving is its editor too: unsaved, it is not clean.
			const parked = this.#parking.get(held.id);
			const other = this.#frames.get(held.id) ?? parked;
			if (other?.dirty) {
				unsaved = true;
				continue;
			}
			// A clean one goes: a parked one once its leave settles, a shown one now.
			if (other) void this.#move(other, parked ? 'leaving' : 'disposed');
			this.#take(frame, held.id, group);
			await mark(held.id);
			if (shown) await this.#kernel.call('editor-activate', { tab: held.id }, at);
			return true;
		}
		this.#adopt.set(document, frame);
		const open = (more: object) =>
			this.#kernel.call<{ tab: string }>('document-open', { document, ...more });
		const beside = { group: 'beside', stay: 'active' };
		let opened = await open(unsaved ? beside : { stay: shown ? 'active' : 'background' });
		if (opened.error?.code === 'EDITOR_TAB_LIMIT') opened = await open(beside);
		await this.idle;
		if (this.#adopt.get(document) === frame) this.#adopt.delete(document);
		const tab = opened.data?.tab as string;
		if (!opened.success || !this.#here(frame)) return false;
		// The person discarded it while the tab opened: the tab it would take, new, closes, and nothing reopens.
		if (this.#lives.get(frame)?.discarded) {
			if (opened.undoCommand === 'editor-close') {
				await this.#kernel.call('editor-close', { tab, discard: true }, at);
			}
			return false;
		}
		if (this.#frames.get(tab) !== frame) {
			// In the background its tab draws no frame, so it takes the tab where it is.
			const into = !this.#frames.has(tab) && this.#groupOf(tab);
			if (!into) return false;
			this.#take(frame, tab, into);
		}
		await mark(tab);
		return true;
	}

	/** A frame's Close, after a failure: no editor holds a draft there. */
	closeFrame(frame: LoamEditorFrame): void {
		void this.close(frame.tab);
	}

	#stopTimer(frame: LoamEditorFrame): void {
		clearTimeout(this.#timers.get(frame));
		this.#timers.delete(frame);
	}

	/** An editor's `save()`; a rejection keeps the tab dirty and is a `danger` toast with its code (5.5). */
	async #save(frame: LoamEditorFrame): Promise<boolean> {
		this.#stopTimer(frame);
		try {
			await frame.save();
			return true;
		} catch (cause) {
			const { code, suggestion } = (cause ?? {}) as { code?: string; suggestion?: string };
			const message = cause instanceof Error ? cause.message : String(cause);
			await this.#kernel.call('toast-show', {
				message:
					`${frame.title} was not saved: ${message}${code ? ` (${code})` : ''}${suggestion ? `. ${suggestion}` : ''}`.slice(
						0,
						200
					),
				tone: 'danger',
				durationMs: 30_000,
			});
			return false;
		}
	}

	/** Every dirty editor's `save()`, not waited for, as on `pagehide` (5.5). */
	#saveAll(): void {
		for (const frame of this.#frames.values())
			if (frame.dirty) void frame.save().catch(reportError);
	}

	#onKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || !isSave(event, this.#shell.mac) || !this.#area.isConnected)
			return;
		const state = this.#state;
		const group = state?.groups.find((each) => each.id === state.activeGroup);
		// The editor holding focus, which may be in another group than the active one, or the active tab's.
		const frame =
			(event.composedPath().find((node) => node instanceof LoamEditorFrame) as
				| LoamEditorFrame
				| undefined) ?? (group?.active ? this.#frames.get(group.active) : undefined);
		if (frame?.state !== 'ready' || !this.#frames.has(frame.tab)) return;
		// Only with an editor the active owner: the browser keeps Mod+S everywhere else (5.5).
		event.preventDefault();
		if (event.repeat) return;
		// A person who asked to save hears that it did, politely, through the shell's live region.
		void this.#save(frame).then((saved) => {
			if (!saved) return;
			this.#shell.announcement = '';
			requestAnimationFrame(() => {
				this.#shell.announcement = `${frame.title} saved`;
			});
		});
	}

	/** A change of scope: each dirty editor is asked to save, and every one goes (7.6). */
	async #dropAll(): Promise<void> {
		for (const frame of [...this.#timers.keys()]) this.#stopTimer(frame);
		// A new visit: no frame of this one is here again, even after a return to the same scope.
		this.#visit++;
		for (const frame of this.#leaving) {
			const life = this.#lives.get(frame) as Life;
			if (life.queued) life.queued = 'left';
		}
		const frames = [...this.#frames.values()];
		// Parked ones still saving leave both maps; their leaves end in `left`, as their scope went.
		for (const frame of [...this.#parking.values()]) this.#move(frame, 'leaving');
		this.#adopt.clear();
		this.#shown.clear();
		this.#records.clear();
		for (const group of this.#groups.values()) group.remove();
		this.#groups.clear();
		this.#state = null;
		// Each dirty one saves, clearing its own scope's dirty flag, and goes; a clean one goes now.
		for (const frame of frames) this.#retire(frame);
	}
}
