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

import { css, type FASTElement, Updates } from '@lushly-dev/fast-element';
import type { KernelEventV2, LoamKernelV2 } from '@lushly-dev/loam-kernel';
import type { DocumentRecordV1, DocumentRefV1, DocumentTypeV1 } from '@lushly-dev/loam-sdk';
import type { LoamShell } from '../elements/shell.js';
import { editorAreaDefinition, LoamEditorArea } from './editor-area.js';
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
	LoamEditorGroup,
} from './editor-group.js';

/** `editor-get`'s answer (5.4): the call's scope's state, with `dirty` per tab. */
export interface EditorReadV1 {
	version: 1;
	groups: Array<{
		id: string;
		active: string | null;
		tabs: Array<{
			id: string;
			document: string;
			pinned: boolean;
			preview: boolean;
			dirty: boolean;
		}>;
	}>;
	activeGroup: string;
}

/** How many native editors a group keeps parked, its oldest dropped through `dispose` (5.6). */
export const PARKED_PER_GROUP = 10;

/** The phase 1 modal's `MODAL_RESULT_EVENT`, named here so this chunk imports no element of `surfaces`. */
const MODAL_RESULT_EVENT = 'loam-modal-result';

/** How long the area waits for the app surfaces, which load beside stage B, before a frame fails. */
const SURFACES_WAIT_MS = 15_000;

/** Added to `loam-main` from this chunk, so the empty shell's styles do not grow. */
const mainWithEditor = css`
	:host([data-section='documents']) {
		display: flex;
		flex-direction: column;
		padding: 0;
		overflow: hidden;
	}
	:host([data-section]) .landing {
		display: none;
	}
	:host([data-section][route='not-found']) .landing {
		display: grid;
	}
	:host([route='not-found']) ::slotted(loam-editor-area) {
		display: none;
	}
`;

let defined: Promise<unknown> | undefined;
/** Define the chunk's elements once; FAST's `define` settles later, so it is awaited before any is made. */
function define(): Promise<unknown> {
	defined ??= Promise.all(
		[
			[LoamEditorArea, editorAreaDefinition],
			[LoamEditorGroup, editorGroupDefinition],
			[LoamEditorFrame, editorFrameDefinition],
		].map(([type, definition]) =>
			customElements.get((definition as { name: string }).name)
				? undefined
				: (type as typeof FASTElement).define(definition as never)
		)
	);
	return defined;
}

/** A document's scope, as a call's option takes it. */
type ScopeOf = DocumentRecordV1['scope'];

/** A tab's record, or why `document-get` gave none. */
type RecordRead = DocumentRecordV1 | { code: string; message: string; suggestion?: string };

/** Main, or the panel when a maximized panel has made main inert, as the `sections` chunk does. */
function focusMain(shell: LoamShell, main: HTMLElement): void {
	const target = main.inert ? shell.shadowRoot?.querySelector<HTMLElement>('loam-panel') : main;
	if (!target) return;
	target.setAttribute('tabindex', '-1');
	target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
	target.focus();
}

/** The chunk's elements, defined, for a fixture that renders them on their own. */
export const defineEditorElements = (): Promise<unknown> => define();

const controllers = new WeakMap<LoamShell, EditorController>();

/** Follow the state: show, update or hide the editor area. One at a time per shell, so a later state wins. */
export async function syncEditor(shell: LoamShell): Promise<void> {
	await define();
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

/** Whether a key event is Mod+S: Command on macOS, Control elsewhere, by physical key. */
const isSave = (event: KeyboardEvent, mac: boolean): boolean =>
	(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
	!event.altKey &&
	!event.shiftKey &&
	event.code === 'KeyS';

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
	readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Tabs a person is closing, whose frames a render between the save and the close must not make again. */
	readonly #closing = new Set<string>();
	readonly #modals = new Map<string, (result: 'confirm' | 'cancel') => void>();
	#queue: Promise<void> = Promise.resolve();
	#scopeKey: string | null = null;
	#state: EditorReadV1 | null = null;
	#types = new Map<string, DocumentTypeV1>();
	/** The tab to focus once the strip renders, and whether focus then goes into its editor. */
	#focus: { tab: string; editor: boolean } | null = null;
	/** By tab, the parked frames still saving, which a tab shown again meanwhile takes back with their drafts. */
	readonly #parking = new Map<string, LoamEditorFrame>();
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

	/** What a test reads: the frames by tab, and the area. */
	get frames(): ReadonlyMap<string, LoamEditorFrame> {
		return this.#frames;
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
		const shows = state.section === 'documents' && state.active === null;
		if (!shows) {
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
			this.#frames.delete(tab);
			this.#stopTimer(tab);
			// Closed by a call not the person's own close: an editor still unsaved saves first, and its save
			// clears the mark the kernel keeps for it, which holds a trash or a move until then (5.5).
			this.#retire(frame, 'closed');
		}
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
				// An editor that still says unsaved is, whoever marked its tab saved (5.5).
				if (frame?.dirty && !tab.dirty)
					void this.#kernel.call(
						'editor-dirty-set',
						{ tab: tab.id, dirty: true },
						{ scope: frame.record?.scope as ScopeOf }
					);
			}
			const active = group.tabs.find((tab) => tab.id === group.active);
			for (const tab of group.tabs) this.#frames.get(tab.id)?.show(tab.id === active?.id);
			const ids = new Set(group.tabs.map((tab) => tab.id));
			if (active && !this.#closing.has(active.id)) {
				this.#showFrame(element, group.id, active, records.get(active.document), ids);
			}
		});
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

	/** The active tab's frame, made and opened once, and the group's oldest parked ones over ten dropped. */
	#showFrame(
		group: LoamEditorGroup,
		groupId: string,
		tab: EditorReadV1['groups'][number]['tabs'][number],
		record: RecordRead | undefined,
		ids: ReadonlySet<string>
	): void {
		let frame = this.#frames.get(tab.id);
		// A frame whose save rejected after another's close, with its draft, taken by its document's new tab;
		// or one parked and still saving, taken back by its own tab.
		const adopted = this.#adopt.get(tab.document);
		const parking = this.#parking.get(tab.id);
		if (!frame && parking) {
			this.#parking.delete(tab.id);
			frame = this.#take(parking, tab.id, group);
		} else if (!frame && adopted) {
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
			this.#frames.set(tab.id, frame);
			group.append(frame);
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
			this.#frames.delete(oldest);
			this.#stopTimer(oldest);
			if (parked) this.#retire(parked, 'parked');
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
				for (const other of group?.tabs ?? []) {
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
		this.#closing.add(tab);
		try {
			return await this.#close(tab);
		} finally {
			this.#closing.delete(tab);
		}
	}

	async #close(tab: string): Promise<boolean> {
		const frame = this.#frames.get(tab);
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
		if (frame) {
			this.#frames.delete(tab);
			this.#stopTimer(tab);
			await frame.dispose();
		}
		const closed = await this.#kernel.call<{ previous: { group: string } }>('editor-close', {
			tab,
			discard: true,
		});
		if (!closed.success) return false;
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
		// Every edit restarts the timer; the kernel hears a change only.
		this.#stopTimer(frame.tab);
		if (dirty && frame.autosaveMs !== undefined) {
			this.#timers.set(
				frame.tab,
				setTimeout(() => {
					if (this.#live(frame)) void this.#save(frame);
				}, frame.autosaveMs)
			);
		}
		if (frame.dirty === dirty) return;
		frame.dirty = dirty;
		void this.#kernel.call('editor-dirty-set', { tab: frame.tab, dirty });
	}

	selection(frame: LoamEditorFrame, selection: unknown): void {
		if (!this.#live(frame)) return;
		void this.#kernel.call('editor-selection-set', { tab: frame.tab, selection });
	}

	/**
	 * Whether `frame` is the one now held for its tab, or parked and still saving: tab ids repeat across scopes,
	 * and a retired frame is gone.
	 */
	#live(frame: LoamEditorFrame): boolean {
		return this.#frames.get(frame.tab) === frame || this.#parking.get(frame.tab) === frame;
	}

	/**
	 * A frame leaving: a dirty one saves first, a rejection a toast (5.5). A save clears its tab's dirty mark in
	 * its document's scope, whatever scope is active by then, unless that scope's tab holds a newer unsaved edit,
	 * as after a return there (7.6). When its save rejects while main still shows its scope's area, its draft is
	 * kept for the person to save or discard (Status deviation 16): one another's call `closed` takes a tab of
	 * its document again, and a `parked` one goes back into its tab, which its group then holds beyond ten. A
	 * `closed` frame also clears its closed tab's mark, saved, kept or clean, since that call may have left one.
	 */
	#retire(frame: LoamEditorFrame, how: 'closed' | 'parked' | 'left' = 'left'): void {
		void this.#leave(frame, how).catch(reportError);
	}

	async #leave(frame: LoamEditorFrame, how: 'closed' | 'parked' | 'left'): Promise<void> {
		const { tab, dirty } = frame;
		const scope = frame.record?.scope;
		const key = this.#scopeKey;
		// A closed tab's frame was showing when its tab was the active one.
		const shown = !frame.hidden;
		let kept = false;
		if (how === 'parked') this.#parking.set(tab, frame);
		try {
			const saved = !dirty || (await this.#save(frame));
			if (!saved && key === this.#scopeKey && this.#area.isConnected) {
				kept =
					how === 'closed'
						? await this.#reopen(frame, shown)
						: how === 'parked' && !this.#frames.has(tab) && !!this.#tabOf(tab);
				// Back in its tab, out of the parking order until it shows again.
				if (kept && how === 'parked') this.#frames.set(tab, frame);
			}
			const now = this.#frames.get(tab);
			if (
				scope &&
				(how === 'closed' || (dirty && saved)) &&
				!(now?.dirty && now.record?.scope.project === scope.project)
			)
				await this.#kernel.call('editor-dirty-set', { tab, dirty: false }, { scope });
		} finally {
			if (this.#parking.get(tab) === frame) this.#parking.delete(tab);
			// Taken back by its tab while it saved, it is that tab's frame now.
			if (!kept && this.#frames.get(tab) !== frame) await frame.dispose();
		}
	}

	/** `frame` held by `tab` of `group`, as its own. */
	#take(frame: LoamEditorFrame, tab: string, group: LoamEditorGroup): LoamEditorFrame {
		frame.tab = tab;
		frame.dataset.tab = tab;
		this.#frames.set(tab, frame);
		group.append(frame);
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
			const other = this.#frames.get(held.id);
			if (other?.dirty) {
				unsaved = true;
				continue;
			}
			if (other) void other.dispose();
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
		if (!opened.success) return false;
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

	#stopTimer(tab: string): void {
		clearTimeout(this.#timers.get(tab));
		this.#timers.delete(tab);
	}

	/** An editor's `save()`; a rejection keeps the tab dirty and is a `danger` toast with its code (5.5). */
	async #save(frame: LoamEditorFrame): Promise<boolean> {
		this.#stopTimer(frame.tab);
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
		for (const tab of [...this.#timers.keys()]) this.#stopTimer(tab);
		const frames = [...this.#frames.values()];
		this.#frames.clear();
		this.#shown.clear();
		this.#parking.clear();
		this.#records.clear();
		for (const group of this.#groups.values()) group.remove();
		this.#groups.clear();
		this.#state = null;
		// Each dirty one saves, clearing its own scope's dirty flag, and goes; a clean one goes now.
		for (const frame of frames) this.#retire(frame);
	}
}
