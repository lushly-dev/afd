/**
 * The editor area's state, version 1 (documents specification, 5.2 and 5.3; step 10): D5's invariants as a
 * table, and each operation on a state, pure.
 */

import { describe, expect, it } from 'vitest';
import {
	activateTab,
	closeDocument,
	closeTab,
	EDITOR_MAX_TABS,
	type EditorChange,
	type EditorStateV1,
	editorStateId,
	emptyEditorState,
	isEditorStateId,
	keepTabs,
	moveTab,
	openDocument,
	pinTab,
	promoteTab,
	validateEditorState,
} from './editor-state.js';

const clean = () => false;

/** The state a change holds, or the test fails. */
function held<T>(change: EditorChange<T>): { state: EditorStateV1; value: T } {
	if ('code' in change) throw new Error(`${change.code}: ${change.message}`);
	return change;
}

const tab = (
	id: string,
	document: string,
	extra: Partial<{ pinned: boolean; preview: boolean }> = {}
) => ({
	id,
	document,
	pinned: false,
	preview: false,
	...extra,
});

const valid: EditorStateV1 = {
	version: 1,
	groups: [
		{ id: 'g1', tabs: [tab('t1', 'doc_a', { pinned: true }), tab('t2', 'doc_b')], active: 't2' },
		{ id: 'g2', tabs: [tab('t3', 'doc_a', { preview: true })], active: 't3' },
	],
	activeGroup: 'g2',
	nextTab: 4,
	nextGroup: 3,
};

describe('P2-D5: validateEditorState', () => {
	it('P2-D5: accepts a state that holds every invariant, and keeps only its declared keys', () => {
		const checked = validateEditorState({ ...valid, extra: true });
		expect(checked).toEqual({ valid: true, state: valid });
		expect(validateEditorState(emptyEditorState())).toMatchObject({ valid: true });
	});

	const broken: Array<[string, (state: EditorStateV1) => unknown, string]> = [
		['no version 1', (s) => ({ ...s, version: 2 }), 'The version is 1'],
		['no group', (s) => ({ ...s, groups: [] }), 'There are 1 to 3 groups'],
		[
			'four groups',
			(s) => ({
				...s,
				groups: [
					...s.groups,
					{ id: 'g3', tabs: [tab('t4', 'x')], active: 't4' },
					{ id: 'g4', tabs: [tab('t5', 'y')], active: 't5' },
				],
				nextTab: 6,
				nextGroup: 5,
			}),
			'There are 1 to 3 groups',
		],
		[
			"a group's active tab is not one of its tabs",
			(s) => ({ ...s, groups: [{ ...s.groups[0], active: 't3' }, s.groups[1]] }),
			"A group's active tab is one of its tabs, or null when it has none",
		],
		[
			'a group with tabs and no active tab',
			(s) => ({ ...s, groups: [{ ...s.groups[0], active: null }, s.groups[1]] }),
			"A group's active tab is one of its tabs, or null when it has none",
		],
		[
			'two preview tabs in one group',
			(s) => ({
				...s,
				groups: [
					{
						id: 'g1',
						tabs: [tab('t1', 'a', { preview: true }), tab('t2', 'b', { preview: true })],
						active: 't1',
					},
				],
				activeGroup: 'g1',
			}),
			'A group has at most one preview tab',
		],
		[
			'a pinned preview',
			(s) => ({
				...s,
				groups: [
					{ id: 'g1', tabs: [tab('t1', 'a', { pinned: true, preview: true })], active: 't1' },
				],
				activeGroup: 'g1',
			}),
			'A pinned tab is not a preview',
		],
		[
			'a pinned tab after an unpinned one',
			(s) => ({
				...s,
				groups: [
					{ id: 'g1', tabs: [tab('t1', 'a'), tab('t2', 'b', { pinned: true })], active: 't1' },
				],
				activeGroup: 'g1',
			}),
			'Pinned tabs lead',
		],
		[
			'two tabs of one document in a group',
			(s) => ({
				...s,
				groups: [{ id: 'g1', tabs: [tab('t1', 'a'), tab('t2', 'a')], active: 't1' }],
				activeGroup: 'g1',
			}),
			'A group has at most one tab per document',
		],
		[
			'an empty group beside another',
			(s) => ({ ...s, groups: [s.groups[0], { id: 'g2', tabs: [], active: null }] }),
			'A group with no tabs is removed unless it is the only one',
		],
		[
			'51 tabs',
			(s) => ({
				...s,
				groups: [
					{
						id: 'g1',
						tabs: Array.from({ length: EDITOR_MAX_TABS + 1 }, (_, index) =>
							tab(`t${index + 1}`, `d${index}`)
						),
						active: 't1',
					},
				],
				activeGroup: 'g1',
				nextTab: 60,
			}),
			'A group has at most 50 tabs',
		],
		[
			'nextTab 0',
			(s) => ({
				...s,
				groups: [{ id: 'g1', tabs: [], active: null }],
				activeGroup: 'g1',
				nextTab: 0,
			}),
			'nextTab is an integer from 1',
		],
		[
			'nextGroup 1',
			(s) => ({
				...s,
				groups: [{ id: 'g1', tabs: [], active: null }],
				activeGroup: 'g1',
				nextGroup: 1,
			}),
			'nextGroup is an integer from 2',
		],
		[
			'a tab id at its counter',
			(s) => ({ ...s, nextTab: 3 }),
			'A tab id is t<n>, unique and below nextTab',
		],
		[
			'a repeated tab id',
			(s) => ({
				...s,
				groups: [s.groups[0], { ...s.groups[1], tabs: [tab('t2', 'c')], active: 't2' }],
			}),
			'A tab id is t<n>, unique and below nextTab',
		],
		[
			'an unknown active group',
			(s) => ({ ...s, activeGroup: 'g9' }),
			'activeGroup is one of the groups',
		],
		[
			'a document id over 128 characters',
			(s) => ({
				...s,
				groups: [{ id: 'g1', tabs: [tab('t1', 'x'.repeat(129))], active: 't1' }],
				activeGroup: 'g1',
			}),
			"A tab's document is an id of 1 to 128 characters",
		],
	];

	it.each(broken)('P2-D5: refuses %s', (_name, change, reason) => {
		expect(validateEditorState(change(structuredClone(valid)))).toEqual({ valid: false, reason });
	});

	it('P2-D5: names records per scope by the suffix layouts use', () => {
		expect(editorStateId(undefined)).toBe('loam.editor');
		expect(editorStateId('prj_atlas')).toBe('loam.editor@prj_atlas');
		expect(isEditorStateId('loam.editor@prj_atlas')).toBe(true);
		expect(isEditorStateId('loam.editors')).toBe(false);
	});
});

describe('P2-D5: the operations on the state', () => {
	it('P2-D5: a preview replaces the group’s preview, and opening it again, or an edit, promotes it', () => {
		let state = emptyEditorState();
		state = held(openDocument(state, 'a', { preview: true }, clean)).state;
		state = held(openDocument(state, 'b', { preview: true }, clean)).state;
		expect(state.groups[0]?.tabs).toEqual([tab('t2', 'b', { preview: true })]);
		state = held(openDocument(state, 'b', {}, clean)).state;
		expect(state.groups[0]?.tabs[0]?.preview).toBe(false);
		state = held(openDocument(state, 'c', { preview: true }, clean)).state;
		expect(promoteTab(state, 't3').groups[0]?.tabs.map((each) => each.preview)).toEqual([
			false,
			false,
		]);
		expect(validateEditorState(state).valid).toBe(true);
	});

	it('P2-D5: a pinned tab leads, no preview replaces it, and unpinned it follows the pinned', () => {
		let state = emptyEditorState();
		state = held(openDocument(state, 'a', {}, clean)).state;
		state = held(openDocument(state, 'b', { preview: true }, clean)).state;
		state = held(pinTab(state, 't2', true)).state;
		expect(state.groups[0]?.tabs.map((each) => [each.id, each.pinned, each.preview])).toEqual([
			['t2', true, false],
			['t1', false, false],
		]);
		state = held(openDocument(state, 'c', { preview: true }, clean)).state;
		// After the active tab, the pinned one, and never before a pinned tab.
		expect(state.groups[0]?.tabs.map((each) => each.document)).toEqual(['b', 'c', 'a']);
		state = held(pinTab(state, 't2', false)).state;
		expect(state.groups[0]?.tabs.map((each) => each.id)).toEqual(['t2', 't3', 't1']);
	});

	it('P2-D5: beside makes up to three groups, and a fourth beside uses the last', () => {
		let state = emptyEditorState();
		state = held(openDocument(state, 'a', {}, clean)).state;
		for (const document of ['b', 'c', 'd']) {
			state = held(openDocument(state, document, { group: 'beside' }, clean)).state;
		}
		expect(state.groups.map((group) => group.tabs.map((each) => each.document))).toEqual([
			['a'],
			['b'],
			['c', 'd'],
		]);
		expect(state.activeGroup).toBe('g3');
		expect(validateEditorState(state).valid).toBe(true);
	});

	it('P2-D5: in the background, a tab joins the active group and activates nothing, and replaces no active preview', () => {
		let state = emptyEditorState();
		// With no tab yet, the group's first tab is its active one, as the invariants require.
		state = held(openDocument(state, 'a', { preview: true, background: true }, clean)).state;
		expect(state.groups[0]?.active).toBe('t1');
		state = held(openDocument(state, 'b', { group: 'beside' }, clean)).state;
		state = held(activateTab(state, 't1')).state;
		// The active tab is a preview: the background's tab is a plain one beside it, in the active group.
		const opened = held(
			openDocument(state, 'c', { preview: true, group: 'beside', background: true }, clean)
		);
		expect(opened.value).toEqual({ tab: 't3', group: 'g1', existed: false, previous: 't1' });
		expect(opened.state.groups.map((group) => group.active)).toEqual(['t1', 't2']);
		expect(opened.state.activeGroup).toBe('g1');
		expect(opened.state.groups[0]?.tabs.map((each) => [each.document, each.preview])).toEqual([
			['a', true],
			['c', false],
		]);
		expect(validateEditorState(opened.state).valid).toBe(true);
		// A document already open stays where it is, and the active tab stays active.
		const again = held(openDocument(opened.state, 'c', { background: true }, clean));
		expect(again.value).toMatchObject({ tab: 't3', existed: true });
		expect(again.state.groups[0]?.active).toBe('t1');
	});

	it('P2-D5: activates a tab and its group, and says which was active', () => {
		let state = emptyEditorState();
		state = held(openDocument(state, 'a', {}, clean)).state;
		state = held(openDocument(state, 'b', { group: 'beside' }, clean)).state;
		const activated = held(activateTab(state, 't1'));
		expect(activated.value).toEqual({ tab: 't1', previous: 't2' });
		expect(activated.state.activeGroup).toBe('g1');
		expect(activateTab(state, 't9')).toMatchObject({ code: 'EDITOR_TAB_UNKNOWN' });
	});

	it('P2-D5: closing a tab activates its neighbour, and an emptied group goes', () => {
		let state = emptyEditorState();
		for (const document of ['a', 'b', 'c'])
			state = held(openDocument(state, document, {}, clean)).state;
		state = held(activateTab(state, 't2')).state;
		const closed = held(closeTab(state, 't2'));
		expect(closed.value).toMatchObject({ closed: 't2', previous: { document: 'b', group: 'g1' } });
		expect(closed.state.groups[0]?.active).toBe('t3');
		state = held(openDocument(closed.state, 'd', { group: 'beside' }, clean)).state;
		state = held(closeTab(state, 't4')).state;
		expect(state.groups.map((group) => group.id)).toEqual(['g1']);
		expect(state.activeGroup).toBe('g1');
	});

	it('P2-D5: moves a tab to a group or a new one, keeping a twin already there', () => {
		let state = emptyEditorState();
		state = held(openDocument(state, 'a', {}, clean)).state;
		state = held(openDocument(state, 'b', {}, clean)).state;
		const moved = held(moveTab(state, 't2', 'new'));
		expect(moved.value).toEqual({ tab: 't2', group: 'g2', from: 'g1' });
		expect(moved.state.groups.map((group) => group.tabs.map((each) => each.id))).toEqual([
			['t1'],
			['t2'],
		]);
		state = held(openDocument(moved.state, 'a', {}, clean)).state;
		const twin = held(moveTab(state, 't3', 'g1'));
		expect(twin.state.groups.map((group) => group.tabs.map((each) => each.id))).toEqual([
			['t1'],
			['t2'],
		]);
		expect(moveTab(state, 't3', 'g9')).toMatchObject({ code: 'EDITOR_TAB_UNKNOWN' });
	});

	it('P2-D5: a full group drops its first unpinned clean tab, and refuses when none can go', () => {
		let state = emptyEditorState();
		for (let index = 0; index < EDITOR_MAX_TABS; index++) {
			state = held(openDocument(state, `d${index}`, {}, clean)).state;
		}
		const opened = held(openDocument(state, 'extra', {}, (each) => each === 't1'));
		expect(opened.state.groups[0]?.tabs).toHaveLength(EDITOR_MAX_TABS);
		expect(opened.state.groups[0]?.tabs.map((each) => each.id)).not.toContain('t2');
		expect(openDocument(state, 'extra', {}, () => true)).toMatchObject({
			code: 'EDITOR_TAB_LIMIT',
		});
	});

	it("P2-D5: a moved preview replaces the target's preview, as a preview opened there does", () => {
		let state = emptyEditorState();
		state = held(openDocument(state, 'a', { preview: true }, clean)).state;
		state = held(openDocument(state, 'b', { group: 'beside', preview: true }, clean)).state;
		const moved = held(moveTab(state, 't1', 'g2'));
		expect(
			moved.state.groups.map((group) => group.tabs.map((each) => [each.document, each.preview]))
		).toEqual([[['a', true]]]);
		expect(validateEditorState(moved.state).valid).toBe(true);
	});

	it('P2-D5: a move into a full group drops its first clean, unpinned, inactive tab, or refuses with EDITOR_TAB_LIMIT', () => {
		let state = emptyEditorState();
		for (let index = 0; index < EDITOR_MAX_TABS; index++) {
			state = held(openDocument(state, `d${index}`, {}, clean)).state;
		}
		state = held(openDocument(state, 'extra', { group: 'beside' }, clean)).state;
		const extra = state.groups[1]?.tabs[0]?.id as string;
		const moved = held(moveTab(state, extra, 'g1', (tab) => tab === 't1'));
		expect(moved.state.groups.map((group) => group.tabs.length)).toEqual([EDITOR_MAX_TABS]);
		expect(moved.state.groups[0]?.tabs.map((each) => each.id)).not.toContain('t2');
		expect(validateEditorState(moved.state).valid).toBe(true);
		expect(moveTab(state, extra, 'g1', () => true)).toMatchObject({ code: 'EDITOR_TAB_LIMIT' });
	});

	it('P2-D5: keeps only the tabs a restore may trust, and nothing changes when all may stay', () => {
		let state = emptyEditorState();
		state = held(openDocument(state, 'mine', {}, clean)).state;
		state = held(openDocument(state, 'elsewhere', { group: 'beside' }, clean)).state;
		const kept = keepTabs(state, (document) => document !== 'elsewhere') as EditorStateV1;
		expect(kept.groups.map((group) => group.tabs.map((each) => each.document))).toEqual([['mine']]);
		expect(validateEditorState(kept).valid).toBe(true);
		expect(keepTabs(state, () => true)).toBeUndefined();
	});

	it('P2-D5: closes every tab of a trashed or moved document, and nothing when it has none', () => {
		let state = emptyEditorState();
		state = held(openDocument(state, 'a', {}, clean)).state;
		state = held(openDocument(state, 'a', { group: 'beside' }, clean)).state;
		state = held(openDocument(state, 'b', {}, clean)).state;
		const closed = closeDocument(state, 'a') as EditorStateV1;
		expect(closed.groups.map((group) => group.tabs.map((each) => each.document))).toEqual([['b']]);
		expect(validateEditorState(closed).valid).toBe(true);
		expect(closeDocument(state, 'z')).toBeUndefined();
	});
});
