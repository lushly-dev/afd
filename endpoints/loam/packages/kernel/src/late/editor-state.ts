/**
 * @fileoverview The editor area's state, version 1, and its one validator (documents specification, 5.2;
 * D80), in the `late-editor` chunk with the commands that change it, importing types alone: one view-state
 * record per scope, `loam.editor` at workspace level and `loam.editor@<project id>` in a project, registered on first use and read from the store before anything
 * writes it, as a project's layout record is. Stage A's `hydrate` drops a record with no handler, so these
 * register in stage B (6). Dirty tabs and selections are in memory only: a reload loses an unsaved change,
 * so nothing persists a claim that cannot be true.
 */

import type { ViewStateHandler, ViewStateRegistry } from '@lushly-dev/afd-view-state';

export interface EditorTabV1 {
	/** `t<n>`, from `nextTab`. */
	id: string;
	document: string;
	pinned: boolean;
	preview: boolean;
}

export interface EditorGroupV1 {
	/** `g<n>`, from `nextGroup`. */
	id: string;
	/** At most 50. */
	tabs: EditorTabV1[];
	active: string | null;
}

export interface EditorStateV1 {
	version: 1;
	/** 1 to 3, in order, as columns. */
	groups: EditorGroupV1[];
	activeGroup: string;
	nextTab: number;
	nextGroup: number;
}

/** The workspace's record; a project's is `loam.editor@<project id>`, by the same suffix as layouts. */
export const EDITOR_STATE_ID = 'loam.editor';

export const editorStateId = (project: string | undefined): string =>
	project === undefined ? EDITOR_STATE_ID : `${EDITOR_STATE_ID}@${project}`;

export const isEditorStateId = (id: string): boolean =>
	id === EDITOR_STATE_ID || id.startsWith(`${EDITOR_STATE_ID}@`);

export const EDITOR_MAX_GROUPS = 3;
export const EDITOR_MAX_TABS = 50;

export const emptyEditorState = (): EditorStateV1 => ({
	version: 1,
	groups: [{ id: 'g1', tabs: [], active: null }],
	activeGroup: 'g1',
	nextTab: 1,
	nextGroup: 2,
});

export type EditorValidation =
	| { valid: true; state: EditorStateV1 }
	| { valid: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `n` of `<prefix><n>`, or 0 when `value` is not one. */
const serial = (prefix: string, value: unknown): number =>
	typeof value === 'string' && new RegExp(`^${prefix}[1-9]\\d{0,8}$`).test(value)
		? Number(value.slice(1))
		: 0;

/**
 * The one validator (5.2): a copy holding only the declared keys, or the invariant it breaks. A group's
 * `active` is one of its tabs, or null when it has none; at most one preview tab per group; a pinned tab is
 * not a preview; pinned tabs lead; at most one tab per document per group; a group with no tabs is removed
 * unless it is the only one. Ids are unique, and each below its counter, so a new one never repeats one.
 */
export function validateEditorState(value: unknown): EditorValidation {
	const bad = (reason: string): EditorValidation => ({ valid: false, reason });
	if (!isRecord(value) || value.version !== 1) return bad('The version is 1');
	const { groups, activeGroup, nextTab, nextGroup } = value;
	if (!Array.isArray(groups) || groups.length < 1 || groups.length > EDITOR_MAX_GROUPS) {
		return bad('There are 1 to 3 groups');
	}
	// Counters start at 1 and 2: the first group, `g1`, exists in every state, and no tab id is `t0`.
	if (!Number.isInteger(nextTab) || (nextTab as number) < 1)
		return bad('nextTab is an integer from 1');
	if (!Number.isInteger(nextGroup) || (nextGroup as number) < 2) {
		return bad('nextGroup is an integer from 2');
	}
	const seen = new Set<string>();
	const kept: EditorGroupV1[] = [];
	for (const group of groups) {
		if (!isRecord(group)) return bad('A group is an object');
		const index = serial('g', group.id);
		if (!index || index >= (nextGroup as number) || seen.has(group.id as string)) {
			return bad('A group id is g<n>, unique and below nextGroup');
		}
		seen.add(group.id as string);
		const { tabs, active } = group;
		if (!Array.isArray(tabs) || tabs.length > EDITOR_MAX_TABS)
			return bad('A group has at most 50 tabs');
		if (tabs.length === 0 && groups.length > 1) {
			return bad('A group with no tabs is removed unless it is the only one');
		}
		const documents = new Set<string>();
		let previews = 0;
		let unpinned = false;
		const own: EditorTabV1[] = [];
		for (const tab of tabs) {
			if (!isRecord(tab)) return bad('A tab is an object');
			const { id, document, pinned, preview } = tab;
			if (!serial('t', id) || serial('t', id) >= (nextTab as number) || seen.has(id as string)) {
				return bad('A tab id is t<n>, unique and below nextTab');
			}
			seen.add(id as string);
			if (typeof document !== 'string' || document === '' || document.length > 128) {
				return bad("A tab's document is an id of 1 to 128 characters");
			}
			if (typeof pinned !== 'boolean' || typeof preview !== 'boolean') {
				return bad('pinned and preview are booleans');
			}
			if (pinned && preview) return bad('A pinned tab is not a preview');
			if (pinned && unpinned) return bad('Pinned tabs lead');
			if (!pinned) unpinned = true;
			if (preview && ++previews > 1) return bad('A group has at most one preview tab');
			if (documents.has(document)) return bad('A group has at most one tab per document');
			documents.add(document);
			own.push({ id: id as string, document, pinned, preview });
		}
		if (active === null ? own.length > 0 : !own.some((tab) => tab.id === active)) {
			return bad("A group's active tab is one of its tabs, or null when it has none");
		}
		kept.push({ id: group.id as string, tabs: own, active: active as string | null });
	}
	if (!kept.some((group) => group.id === activeGroup))
		return bad('activeGroup is one of the groups');
	return {
		valid: true,
		state: {
			version: 1,
			groups: kept,
			activeGroup: activeGroup as string,
			nextTab: nextTab as number,
			nextGroup: nextGroup as number,
		},
	};
}

const clone = (state: EditorStateV1): EditorStateV1 => structuredClone(state);

/** Where a tab is: its group and its index there. */
export function findTab(
	state: EditorStateV1,
	tab: string
): { group: EditorGroupV1; index: number } | undefined {
	for (const group of state.groups) {
		const index = group.tabs.findIndex((held) => held.id === tab);
		if (index >= 0) return { group, index };
	}
	return undefined;
}

/** The active group's active tab, or null. */
export function activeTab(state: EditorStateV1): EditorTabV1 | null {
	const group = state.groups.find((held) => held.id === state.activeGroup);
	return group?.tabs.find((tab) => tab.id === group.active) ?? null;
}

/** A new group after the last, if there is room, else the last (5.4's `beside` and `new`). */
function groupAfter(state: EditorStateV1, after: EditorGroupV1): EditorGroupV1 {
	const index = state.groups.indexOf(after);
	const next = state.groups[index + 1];
	if (next) return next;
	if (state.groups.length >= EDITOR_MAX_GROUPS) return state.groups.at(-1) as EditorGroupV1;
	const created: EditorGroupV1 = { id: `g${state.nextGroup++}`, tabs: [], active: null };
	state.groups.push(created);
	return created;
}

/** Insert `tab` in `group`, after its active tab or at the end, and never before a pinned tab. */
function insert(group: EditorGroupV1, tab: EditorTabV1): void {
	const pinned = group.tabs.filter((held) => held.pinned).length;
	const after = group.tabs.findIndex((held) => held.id === group.active);
	group.tabs.splice(tab.pinned ? pinned : Math.max(pinned, after + 1), 0, tab);
}

/** A group left empty goes, unless it is the only one; the active group moves to a neighbour. */
function dropEmpty(state: EditorStateV1, group: EditorGroupV1): void {
	if (group.tabs.length > 0 || state.groups.length === 1) return;
	const index = state.groups.indexOf(group);
	state.groups.splice(index, 1);
	if (state.activeGroup === group.id) {
		state.activeGroup = (state.groups[Math.max(0, index - 1)] as EditorGroupV1).id;
	}
}

/**
 * Remove a tab; the group's next active is the tab to its right, else its left. Returns the group it was
 * in, before an empty group is dropped.
 */
function remove(state: EditorStateV1, tab: string): EditorGroupV1 | undefined {
	const found = findTab(state, tab);
	if (!found) return undefined;
	const { group, index } = found;
	group.tabs.splice(index, 1);
	if (group.active === tab) group.active = (group.tabs[index] ?? group.tabs[index - 1])?.id ?? null;
	dropEmpty(state, group);
	return group;
}

/**
 * Room for one more tab in `group`: none needed below 50; otherwise its first unpinned tab that is neither
 * dirty nor active goes, or the refusal, `EDITOR_TAB_LIMIT`, when none can (5.2).
 */
function makeRoom(
	group: EditorGroupV1,
	dirty: (tab: string) => boolean
): EditorChange<never> | undefined {
	if (group.tabs.length < EDITOR_MAX_TABS) return undefined;
	const dropped = group.tabs.find(
		(held) => !held.pinned && held.id !== group.active && !dirty(held.id)
	);
	if (dropped) {
		group.tabs.splice(group.tabs.indexOf(dropped), 1);
		return undefined;
	}
	return {
		code: 'EDITOR_TAB_LIMIT',
		message: 'This group has 50 tabs, each pinned, unsaved or active',
		suggestion: 'Close a tab with editor-close, or open it beside',
	};
}

/** The outcome of an operation: the new state, or the code and message of a refusal. */
export type EditorChange<T> =
	| { state: EditorStateV1; value: T }
	| { code: 'EDITOR_TAB_UNKNOWN' | 'EDITOR_TAB_LIMIT'; message: string; suggestion: string };

/** `EDITOR_TAB_UNKNOWN`: no such tab in this scope's record. */
export const unknownTab = (tab: string): EditorChange<never> => ({
	code: 'EDITOR_TAB_UNKNOWN',
	message: `No tab '${tab.slice(0, 64)}' is open in this scope`,
	suggestion: 'Read the open tabs with editor-get',
});

/**
 * `document-open` on the state (5.3, 5.4): an open tab of the document in the target group is activated,
 * and promoted when not opened as a preview; a preview replaces the group's preview; otherwise a new tab,
 * after the active one. A full group drops its first unpinned tab that is neither dirty nor active, and
 * refuses when it has none. `beside` is the group after the active one, created up to three, then the last.
 */
export function openDocument(
	current: EditorStateV1,
	document: string,
	options: { group?: 'active' | 'beside'; preview?: boolean; background?: boolean },
	dirty: (tab: string) => boolean
): EditorChange<{ tab: string; group: string; existed: boolean; previous: string | null }> {
	const state = clone(current);
	const previous = activeTab(state)?.id ?? null;
	const { background } = options;
	const active = state.groups.find((group) => group.id === state.activeGroup) as EditorGroupV1;
	// In the background a tab joins the active group and activates nothing: no group is made, and an active
	// preview is not replaced, so the new tab is a plain one there (5.3).
	const group = options.group === 'beside' && !background ? groupAfter(state, active) : active;
	let preview = options.preview === true;
	let tab = group.tabs.find((held) => held.document === document);
	const existed = tab !== undefined;
	if (tab) {
		if (!preview) tab.preview = false;
	} else {
		let replaced = preview ? group.tabs.find((held) => held.preview) : undefined;
		if (background && replaced?.id === group.active) {
			replaced = undefined;
			preview = false;
		}
		const full = replaced ? undefined : makeRoom(group, dirty);
		if (full) return full;
		tab = { id: `t${state.nextTab++}`, document, pinned: false, preview };
		if (replaced) group.tabs.splice(group.tabs.indexOf(replaced), 1, tab);
		else insert(group, tab);
	}
	if (!background || !group.active) {
		group.active = tab.id;
		state.activeGroup = group.id;
	}
	return { state, value: { tab: tab.id, group: group.id, existed, previous } };
}

/** `editor-activate`: the tab and its group become active. `previous` is the active tab before. */
export function activateTab(
	current: EditorStateV1,
	tab: string
): EditorChange<{ tab: string; previous: string | null }> {
	const state = clone(current);
	const found = findTab(state, tab);
	if (!found) return unknownTab(tab);
	const previous = activeTab(state)?.id ?? null;
	found.group.active = tab;
	state.activeGroup = found.group.id;
	return { state, value: { tab, previous } };
}

/** `editor-close`: the tab goes; `previous` is what it was, for the undo's `document-open`. */
export function closeTab(
	current: EditorStateV1,
	tab: string
): EditorChange<{ closed: string; previous: EditorTabV1 & { group: string } }> {
	const state = clone(current);
	const found = findTab(state, tab);
	if (!found) return unknownTab(tab);
	const previous = { ...(found.group.tabs[found.index] as EditorTabV1), group: found.group.id };
	remove(state, tab);
	return { state, value: { closed: tab, previous } };
}

/** `editor-pin`: a pinned tab is no preview, and leads; an unpinned one follows the pinned. */
export function pinTab(
	current: EditorStateV1,
	tab: string,
	pinned: boolean
): EditorChange<{ tab: string; pinned: boolean }> {
	const state = clone(current);
	const found = findTab(state, tab);
	if (!found) return unknownTab(tab);
	const held = found.group.tabs.splice(found.index, 1)[0] as EditorTabV1;
	held.pinned = pinned;
	if (pinned) held.preview = false;
	const lead = found.group.tabs.filter((each) => each.pinned).length;
	found.group.tabs.splice(lead, 0, held);
	return { state, value: { tab, pinned } };
}

/**
 * `editor-move`: to a group by id, or `new`, created up to three, then the last. A tab of the same document
 * already there is kept, and this one closes. `from` is the group it left, for the undo.
 */
export function moveTab(
	current: EditorStateV1,
	tab: string,
	to: string,
	dirty: (tab: string) => boolean = () => false
): EditorChange<{ tab: string; group: string; from: string }> {
	const state = clone(current);
	const found = findTab(state, tab);
	const named = state.groups.find((group) => group.id === to);
	if (!found) return unknownTab(tab);
	if (to !== 'new' && !named) {
		return {
			code: 'EDITOR_TAB_UNKNOWN',
			message: `No group '${to.slice(0, 64)}' is open in this scope`,
			suggestion: "Name a group from editor-get, or 'new'",
		};
	}
	const from = found.group;
	const held = { ...(from.tabs[found.index] as EditorTabV1) };
	// A new group goes after the last; a full area moves it to the last.
	const target = named ?? groupAfter(state, state.groups.at(-1) as EditorGroupV1);
	if (target === from) return { state, value: { tab, group: from.id, from: from.id } };
	const twin = target.tabs.find((each) => each.document === held.document);
	if (!twin) {
		// A moved preview replaces the target's, as a preview opened there would (5.3); otherwise a full
		// group makes room, or refuses (5.2).
		const prior = held.preview ? target.tabs.find((each) => each.preview) : undefined;
		if (prior) target.tabs.splice(target.tabs.indexOf(prior), 1);
		else {
			const full = makeRoom(target, dirty);
			if (full) return full;
		}
	}
	remove(state, tab);
	if (twin) target.active = twin.id;
	else {
		insert(target, held);
		target.active = held.id;
	}
	state.activeGroup = target.id;
	return { state, value: { tab: twin?.id ?? tab, group: target.id, from: from.id } };
}

/** A first edit promotes a preview tab (5.3). Unchanged when it is not one. */
export function promoteTab(current: EditorStateV1, tab: string): EditorStateV1 {
	const state = clone(current);
	const held = findTab(state, tab);
	const each = held?.group.tabs[held.index];
	if (each) each.preview = false;
	return state;
}

/**
 * Keep only the tabs whose document `keep` accepts: a restored record's, so a tampered one names nothing
 * outside its own scope. Undefined when every tab stays.
 */
export function keepTabs(
	current: EditorStateV1,
	keep: (document: string) => boolean
): EditorStateV1 | undefined {
	const state = clone(current);
	const gone = state.groups.flatMap((group) =>
		group.tabs.filter((tab) => !keep(tab.document)).map((tab) => tab.id)
	);
	if (gone.length === 0) return undefined;
	for (const tab of gone) remove(state, tab);
	return state;
}

/** Close every tab of `document` (a trashed or moved document's, 4.1), or undefined when none is open. */
export function closeDocument(current: EditorStateV1, document: string): EditorStateV1 | undefined {
	const state = clone(current);
	const tabs = state.groups.flatMap((group) =>
		group.tabs.filter((tab) => tab.document === document).map((tab) => tab.id)
	);
	if (tabs.length === 0) return undefined;
	for (const tab of tabs) remove(state, tab);
	return state;
}

/** The per-scope records, and what the kernel keeps of a tab in memory alone. */
export interface Editors {
	/**
	 * The record id of `project`'s scope, or the workspace's: registered from an empty state on first use,
	 * and read from the store before this resolves, so nothing writes it before its read (0b's note).
	 */
	ensure(project: string | undefined): Promise<string>;
	/** A registered record's state, or undefined for one not yet registered. */
	peek(project: string | undefined): EditorStateV1 | undefined;
	/** Write a registered record. A state the validator refuses is a bug here, so it throws. */
	put(project: string | undefined, state: EditorStateV1): void;
	/**
	 * `DirtyTabsV1`: whether a tab holds an unsaved change, by its record and id. A mark outlives a tab
	 * another's call closed, until the chrome's save of its editor clears it (Status deviation 16).
	 */
	dirty(project: string | undefined, tab: string): boolean;
	setDirty(project: string | undefined, tab: string, dirty: boolean): void;
	/** A tab of `document` holding an unsaved change, in any scope's record, and whether it is open. */
	unsaved(document: string): { tab: string; open: boolean } | undefined;
	/** The selection an editor reported, for the inspector; null when none. */
	selection(project: string | undefined, tab: string): unknown;
	setSelection(project: string | undefined, tab: string, selection: unknown): void;
	/** Forget what is in memory, as a reload does (`resetSession`). */
	reset(): void;
}

/** A person's drafts in memory: by record and tab, the document each unsaved tab shows, and the selections. */
export interface EditorDraftsV1 {
	dirty: Map<string, string>;
	selections: Map<string, unknown>;
}

/**
 * The drafts are the maps the dirty tabs (by record and tab, the document each unsaved tab shows) and the
 * selections live in, which `late` makes, so a change of person can move them out to be held and put the next
 * person's in (phase 3 specification, 4.4 and 4.5) with nothing added here.
 */
export function createEditors(
	viewState: ViewStateRegistry,
	{ dirty, selections }: EditorDraftsV1
): Editors {
	const records = new Map<string, EditorStateV1>();
	const reads = new Map<string, Promise<void>>();
	const key = (project: string | undefined, tab: string) => `${editorStateId(project)} ${tab}`;

	const register = (id: string): void => {
		records.set(id, emptyEditorState());
		// A persisted record the validator refuses is ignored, and the empty state stays (5.2). Only stage B's
		// read and `put` reach `set`: `view-state-set` refuses these records.
		const accept = (value: unknown) => {
			const checked = validateEditorState(value);
			if (checked.valid) records.set(id, checked.state);
		};
		const handler: ViewStateHandler<EditorStateV1 & Record<string, unknown>> = {
			get: () => clone(records.get(id) as EditorStateV1) as EditorStateV1 & Record<string, unknown>,
			set: accept,
			replace: accept,
		};
		viewState.register(id, handler as unknown as ViewStateHandler);
		reads.set(id, viewState.hydrateOne(id));
	};

	return {
		async ensure(project) {
			const id = editorStateId(project);
			if (!records.has(id)) register(id);
			await reads.get(id);
			return id;
		},
		peek: (project) => {
			const held = records.get(editorStateId(project));
			return held && clone(held);
		},
		put(project, state) {
			const checked = validateEditorState(state);
			if (!checked.valid) throw new Error(`The editor state is invalid: ${checked.reason}`);
			viewState.set(editorStateId(project), checked.state as unknown as Record<string, unknown>);
		},
		dirty: (project, tab) => dirty.has(key(project, tab)),
		setDirty(project, tab, value) {
			const found = value && findTab(records.get(editorStateId(project)) as EditorStateV1, tab);
			if (found) dirty.set(key(project, tab), found.group.tabs[found.index]?.document as string);
			else if (!value) dirty.delete(key(project, tab));
		},
		unsaved(document) {
			for (const [held, shows] of dirty) {
				if (shows !== document) continue;
				const [id, tab] = held.split(' ') as [string, string];
				return { tab, open: !!findTab(records.get(id) as EditorStateV1, tab) };
			}
		},
		selection: (project, tab) => selections.get(key(project, tab)) ?? null,
		setSelection(project, tab, selection) {
			if (selection === null) selections.delete(key(project, tab));
			else selections.set(key(project, tab), selection);
		},
		reset() {
			dirty.clear();
			selections.clear();
		},
	};
}
