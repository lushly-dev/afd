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
import type { DocumentRecordV1, DocumentTypeV1 } from '@lushly-dev/loam-sdk';
import type { LoamShell } from '../elements/shell.js';
import { editorAreaDefinition, type LoamEditorArea } from './editor-area.js';
import { editorFrameDefinition, type FrameListener, LoamEditorFrame } from './editor-frame.js';
import {
	EDITOR_GROUP_EVENT,
	type EditorGroupAction,
	type EditorTabView,
	editorGroupDefinition,
	type LoamEditorGroup,
} from './editor-group.js';
import {
	defineEditorElements,
	discardModal,
	type EditorReadV1,
	focusMain,
	type How,
	hostOf,
	isSave,
	keyOf,
	type Life,
	MODAL_RESULT_EVENT,
	mainWithEditor,
	notSaved,
	openFrame,
	PARKED_PER_GROUP,
	type Place,
	type RecordRead,
	type ScopeOf,
	same,
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
	/** Tabs whose person's close is saving or asking, as `<scope> <tab>`: their marks hold meanwhile. */
	readonly #asking = new Set<string>();
	/** By `<scope> <tab>`, the tabs a leave may still owe a mark to, a closed one's among them, which no read lists. */
	readonly #owed = new Map<string, [ScopeOf, string]>();
	/** The leaves of drafts kept while the area was away, waiting for it to show again. */
	readonly #waiting: Array<() => void> = [];
	/** The pass of `#marks` queued and not yet begun, which any later change shares. */
	#marking: Promise<void> | undefined;
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
	 * `#parking`, the leaving frames, each frame's life, the tabs the person is closing, the state rendered, and
	 * the tabs whose close is saving or asking, and the tabs a leave may still owe a mark.
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
			this.#asking,
			this.#owed,
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
			// No render while an app shows, yet a tab another's call closes leaves now, its editor saving at once,
			// and the marks still follow the editors.
			const read = await this.#kernel.call<EditorReadV1>('editor-get');
			if (read.success && read.data) {
				this.#state = read.data;
				this.#prune(read.data.groups.flatMap((group) => group.tabs));
			}
			void this.#reconcile();
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
		if (!icons) this.#icons ??= hostOf(this.#shell).then(() => this.sync());
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
		this.#prune(tabs);
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
			}
			const active = group.tabs.find((tab) => tab.id === group.active);
			for (const tab of group.tabs) this.#frames.get(tab.id)?.show(tab.id === active?.id);
			const ids = new Set(group.tabs.map((tab) => tab.id));
			if (active && !this.#closing.has(`${this.#visit} ${active.id}`)) {
				this.#showFrame(element, group.id, active, records.get(active.document), ids);
			}
		});
		void this.#reconcile();
		// The drafts kept while the area was away come back now.
		for (const go of this.#waiting.splice(0)) go();
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

	/** Each frame whose tab another's call closed leaves, whether the area or an app shows. */
	#prune(tabs: EditorReadV1['groups'][number]['tabs']): void {
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
	}

	/** Once the documents area shows, or at once when it does; a change of scope ends the wait too. */
	#whenShown(): Promise<void> {
		return this.#area.isConnected ? Promise.resolve() : new Promise((go) => this.#waiting.push(go));
	}

	/**
	 * `wantsMark`, the one rule for a tab's mark (5.4, Status deviation 16): `tab` of `scope` holds unsaved work
	 * when its editor, shown or parked, says so; when a leave of that tab, document and scope, of any visit,
	 * still holds its draft; or while the person's own close of it saves or asks.
	 */
	#wants(scope: ScopeOf, tab: string, document?: string): boolean {
		const frame = same(scope, this.#at)
			? (this.#frames.get(tab) ?? this.#parking.get(tab))
			: undefined;
		return (
			// Its own document's editor only: a tab id of another scope may name another document.
			(!!frame?.dirty && (document ?? frame.document) === frame.document) ||
			this.#asking.has(`${keyOf(scope)} ${tab}`) ||
			[...this.#leaving].some(
				(each) =>
					each.tab === tab &&
					(document ?? each.document) === each.document &&
					same(each.record?.scope, scope) &&
					!!this.#lives.get(each)?.draft
			)
		);
	}

	/**
	 * Bring the kernel's marks to `#wants`, one pass at a time in the queue, so a burst of changes sends each
	 * tab's last value once. Nothing in the queue awaits it: it would wait on itself.
	 */
	#reconcile(): Promise<void> {
		// A tab the last read left unmarked that `#wants` marks is marked at once, before any read: a set never
		// loses work, and an agent's trash then meets it. The queue waits for it, so `idle` does.
		for (const tab of this.#state?.groups.flatMap((group) => group.tabs) ?? []) {
			if (tab.dirty || !this.#wants(this.#at as ScopeOf, tab.id, tab.document)) continue;
			tab.dirty = true;
			const sent = this.#kernel.call(
				'editor-dirty-set',
				{ tab: tab.id, dirty: true },
				{ scope: this.#at }
			);
			this.#queue = Promise.all([this.#queue, sent]).then(() => undefined, reportError);
		}
		this.#marking ??= this.#queue = this.#queue
			.then(() => {
				this.#marking = undefined;
				return this.#marks();
			})
			.catch(reportError);
		return this.#marking;
	}

	/**
	 * The one place the chrome sets or clears a mark, always in the tab's own scope: every tab of the scope
	 * rendered, and each tab a leave may still owe, in its scope. Every mark is set before any goes, so a trash
	 * or a move meets one throughout, and a clear is asked again just before it is sent.
	 */
	async #marks(): Promise<void> {
		const at = this.#at;
		if (!at) return;
		const scopes = new Map([[keyOf(at), at]]);
		for (const [scope] of this.#owed.values()) scopes.set(keyOf(scope), scope);
		const sets: [ScopeOf, string][] = [];
		const clears: [ScopeOf, string, string?][] = [];
		// By `<scope> <tab>`, the tabs whose mark is known gone: read unmarked, or cleared by this pass.
		const settled = new Set<string>();
		const unreachable = new Set<string>();
		for (const [key, scope] of scopes) {
			const read = await this.#kernel.call<EditorReadV1>('editor-get', {}, { scope });
			// A scope it cannot read, the person signed out or no longer a member, keeps what it owes for a later
			// pass, which any sync runs, a sign-in or a return among them; this pass asks for none.
			if (!read.success) {
				unreachable.add(key);
				continue;
			}
			const tabs = read.data?.groups.flatMap((group) => group.tabs) ?? [];
			for (const tab of tabs) {
				if (key !== keyOf(at) && !this.#owed.has(`${key} ${tab.id}`)) continue;
				const wants = this.#wants(scope, tab.id, tab.document);
				if (!wants && !tab.dirty) settled.add(`${key} ${tab.id}`);
				if (wants !== tab.dirty) (wants ? sets : clears).push([scope, tab.id, tab.document]);
			}
			// A closed tab a leave owed: no read lists its mark, which goes once nothing holds it.
			for (const [own, tab] of this.#owed.values())
				if (keyOf(own) === key && !tabs.some((each) => each.id === tab)) clears.push([own, tab]);
		}
		const set = async (scope: ScopeOf, tab: string, dirty: boolean) => {
			const done = await this.#kernel.call('editor-dirty-set', { tab, dirty }, { scope });
			// What the immediate set trusts, true to what was sent: typing straight after a clear marks at once.
			const shown = done.success && same(scope, this.#at) && this.#tabOf(tab);
			if (shown) shown.dirty = dirty;
			return done.success;
		};
		for (const [scope, tab] of sets) await set(scope, tab, true);
		for (const [scope, tab, document] of clears) {
			if (this.#wants(scope, tab, document)) continue;
			// Known gone only once the clear succeeded; a refused one leaves its scope for a later pass.
			if (await set(scope, tab, false)) settled.add(`${keyOf(scope)} ${tab}`);
			else unreachable.add(keyOf(scope));
		}
		// An owed tab goes only once its mark is known gone. One nothing holds any more, whose clear this pass did
		// not send, as its leave let go during the pass, has another pass; one of a scope out of reach waits.
		for (const [key, [scope, tab]] of this.#owed) {
			if (this.#wants(scope, tab)) continue;
			if (settled.has(key)) this.#owed.delete(key);
			else if (!unreachable.has(keyOf(scope))) void this.#reconcile();
		}
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
		// Never a draft the person discarded: the tab its reopen opened draws its own editor, and closes.
		else if (!frame && adopted && !this.#discarded(adopted)) {
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
			void openFrame(frame, record, this.#types, this.#kernel, () => hostOf(this.#shell));
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
		if (
			/^(editor-|document-|auth-)/.test(event.command) ||
			event.scopeChanged ||
			event.mainChanged
		) {
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
		const life = frame && (this.#lives.get(frame) as Life);
		if (frame?.dirty === true || this.#tabOf(tab)?.dirty === true) {
			const asking = `${keyOf(at)} ${tab}`;
			this.#asking.add(asking);
			try {
				let saved = false;
				if (frame?.autosaveMs !== undefined) {
					try {
						await frame.save();
						saved = true;
					} catch {
						saved = false;
					}
				}
				if (!saved) {
					// The Discard is of the draft as the modal found it, wherever it is by then; typed into after, kept.
					const edits = life?.edits;
					if (!(await this.#confirmDiscard(frame?.title ?? 'this document'))) return false;
					if (life) life.discard = edits;
				}
			} finally {
				this.#asking.delete(asking);
				void this.#reconcile();
			}
		}
		const hadFocus = this.#area.matches(':focus-within');
		// Its own editor goes; so does one a reopen gave the discarded draft to, with the tab it opened for it.
		const mine = !!frame && (this.#frames.get(tab) ?? this.#parking.get(tab)) === frame;
		if (frame && (mine || (this.#live(frame) && this.#discarded(frame)))) {
			const other = frame.tab;
			this.#stopTimer(frame);
			await this.#move(frame, 'disposed');
			if (!mine && other === life?.opened) {
				await this.#kernel.call('editor-close', { tab: other, discard: true }, { scope: at });
			}
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
		const opened = await this.#kernel.call<{ overlayId: string }>(
			'modal-open',
			discardModal(title)
		);
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
		void this.#reconcile();
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
		void this.#reconcile();
		return to === 'disposed' ? frame.dispose() : undefined;
	}

	/** Whether the person discarded `frame`'s draft, with no edit since. */
	#discarded(frame: LoamEditorFrame): boolean {
		const life = this.#lives.get(frame);
		return !!life && life.discard === life.edits;
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
				life.busy = life.draft = false;
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
	 * of its document again, and a `parked` one goes back into its tab, which its group then holds beyond ten.
	 * While it holds its draft, its tab's mark holds; `#marks` then gives each tab what `#wants` says.
	 */
	async #leave(frame: LoamEditorFrame, how: How, shown: boolean): Promise<void> {
		const life = this.#lives.get(frame) as Life;
		const { tab, dirty } = frame;
		const scope = frame.record?.scope;
		life.busy = true;
		life.draft = dirty;
		if (scope) this.#owed.set(`${keyOf(scope)} ${tab}`, [scope, tab]);
		const saved = !dirty || (await this.#save(frame));
		if (saved) life.draft = false;
		// A parked frame whose tab another's call closed meanwhile ends as a close's.
		const closed = how === 'closed' || (how === 'parked' && !this.#tabOf(tab));
		const away = life.place === 'parked' || life.place === 'leaving';
		if (!saved && away && !this.#discarded(frame) && this.#here(frame)) {
			// Rejected while an app or another section shows: kept, it waits for the documents area.
			await this.#whenShown();
			if (this.#here(frame) && !this.#discarded(frame)) {
				if (closed) await this.#reopen(frame, shown);
				else if (how === 'parked' && !this.#frames.has(tab)) this.#move(frame, 'shown');
			}
		}
		// Kept, or gone after its toast, a draft that could not be kept taking its mark with it.
		life.busy = life.draft = false;
		if (life.place !== 'shown' && !life.queued) await this.#move(frame, 'disposed');
		await this.#reconcile();
	}

	/** `frame` held by `tab` of `group`, as its own. */
	#take(frame: LoamEditorFrame, tab: string, group: LoamEditorGroup): LoamEditorFrame {
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
		const life = this.#lives.get(frame) as Life;
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
			await this.#reconcile();
			if (shown) await this.#kernel.call('editor-activate', { tab: held.id }, at);
			return true;
		}
		this.#adopt.set(document, frame);
		const open = (more: object) =>
			this.#kernel.call<{ tab: string }>('document-open', { document, ...more });
		const beside = { group: 'beside', stay: 'active' };
		let opened = await open(unsaved ? beside : { stay: shown ? 'active' : 'background' });
		if (opened.error?.code === 'EDITOR_TAB_LIMIT') opened = await open(beside);
		const tab = opened.data?.tab as string;
		if (opened.undoCommand === 'editor-close') life.opened = tab;
		await this.idle;
		if (this.#adopt.get(document) === frame) this.#adopt.delete(document);
		if (!opened.success || !this.#here(frame)) return false;
		if (this.#discarded(frame)) {
			// Discarded while its tab opened: nothing takes it, and the tab it opened closes, while its own editor
			// holds nothing typed since.
			const other = this.#frames.get(tab);
			if (
				life.opened === tab &&
				!other?.dirty &&
				!this.#lives.get(other as LoamEditorFrame)?.edits
			) {
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
		await this.#reconcile();
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
			await this.#kernel.call('toast-show', notSaved(frame.title, cause));
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
		// A draft waiting for the area is of a scope that went: its leave ends, lost after its toast (7.6).
		for (const go of this.#waiting.splice(0)) go();
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
