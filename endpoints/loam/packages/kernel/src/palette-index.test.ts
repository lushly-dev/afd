import { describe, expect, it } from 'vitest';
import { keybindingFor, SHELL_KEYBINDINGS_V0 } from './keybindings.js';
import { createPaletteIndex, type PaletteEntry } from './palette-index.js';
import { createReferenceWorkspace } from './testing.js';

const entries: PaletteEntry[] = [
	{ name: 'layout-set', title: 'Set layout', description: 'Open, close or resize shell parts' },
	{ name: 'layout-get', description: 'Get the shell layout' },
	{ name: 'appearance-set', title: 'Set appearance', description: 'Set the theme and density' },
	{ name: 'notes-create', description: 'Create a note in the layout of the current project' },
	{ name: 'palette-open', title: 'Open the command palette', description: 'Open the palette' },
];

describe('createPaletteIndex', () => {
	const index = createPaletteIndex(entries);

	it('holds every entry', () => {
		expect(index.size).toBe(5);
	});

	it('returns every entry by name, with score 0, for an empty query', () => {
		expect(
			index.search('  ').map((item) => [item.name, item.score, item.field, item.matches])
		).toEqual([
			['appearance-set', 0, 'name', []],
			['layout-get', 0, 'name', []],
			['layout-set', 0, 'name', []],
			['notes-create', 0, 'name', []],
			['palette-open', 0, 'name', []],
		]);
	});

	it('matches a subsequence, scoring runs and word starts, weighted by field', () => {
		const [first] = index.search('lset');
		// l(word start, +2) s(word start, +2) e(run, +1) t(run, +1): (4 + 4 + 2) × name weight 3.
		expect(first).toEqual({
			name: 'layout-set',
			title: 'Set layout',
			description: 'Open, close or resize shell parts',
			score: 30,
			field: 'name',
			matches: [
				[0, 1],
				[7, 10],
			],
		});
	});

	it('prefers the name over the title and the title over the description', () => {
		const items = index.search('layout');
		expect(items.map((item) => [item.name, item.field])).toEqual([
			['layout-get', 'name'],
			['layout-set', 'name'],
			['notes-create', 'description'],
		]);
		// Same score in the name: ties break by name.
		expect(items[0]?.score).toBe(items[1]?.score);
		const title = index.search('command palette');
		expect(title[0]).toMatchObject({ name: 'palette-open', field: 'title' });
	});

	it('ignores case and whitespace, and reports matches in the original text', () => {
		const [item] = index.search('Set Lay');
		expect(item).toMatchObject({
			name: 'layout-set',
			field: 'title',
			matches: [
				[0, 3],
				[4, 7],
			],
		});
	});

	it('tries word starts beyond the first occurrence', () => {
		const camel = createPaletteIndex([{ name: 'shell-info-get', description: 'Shell infoGet' }]);
		const [item] = camel.search('ig');
		// In the description "infoGet", G starts a word; in the name, i and g both start words.
		expect(item?.field).toBe('name');
		expect(item?.matches).toEqual([
			[6, 7],
			[11, 12],
		]);
		const description = createPaletteIndex([{ name: 'x-y', description: 'Shell infoGet' }]);
		expect(description.search('ig')[0]?.matches).toEqual([
			[6, 7],
			[10, 11],
		]);
	});

	it('returns nothing for a query no field holds in order', () => {
		expect(index.search('zzz')).toEqual([]);
		expect(index.search('qx')).toEqual([]);
		expect(index.search('setlayoutx')).toEqual([]);
	});

	it('honours the limit', () => {
		expect(index.search('e', 2)).toHaveLength(2);
		expect(index.search('e', 0)).toEqual([]);
	});

	it('is deterministic over the reference workspace', () => {
		const workspace = createReferenceWorkspace({ seed: 'phase-0', size: 2000 });
		const a = createPaletteIndex(workspace.commands);
		const b = createPaletteIndex(workspace.commands);
		for (const query of workspace.queries.slice(0, 50)) {
			expect(a.search(query)).toEqual(b.search(query));
		}
		const matched = workspace.queries.filter((query) => a.search(query, 1).length > 0);
		expect(matched.length).toBeGreaterThan(100);
	});
});

describe('SHELL_KEYBINDINGS_V0', () => {
	it('holds the reserved chords', () => {
		expect(SHELL_KEYBINDINGS_V0.map((binding) => [binding.chord, binding.command])).toEqual([
			['Mod+K', 'palette-open'],
			['Mod+B', 'layout-set'],
			['Mod+Alt+B', 'layout-set'],
			['Mod+J', 'layout-set'],
			['F6', null],
			['Shift+F6', null],
		]);
		expect(Object.isFrozen(SHELL_KEYBINDINGS_V0)).toBe(true);
	});

	it('gives a keybinding only to a command a chord runs without input', () => {
		expect(keybindingFor('palette-open')).toBe('Mod+K');
		expect(keybindingFor('layout-set')).toBeUndefined();
		expect(keybindingFor('layout-get')).toBeUndefined();
	});
});

describe('non-ASCII text', () => {
	it('indexes a character whose lower case is longer, with offsets into the original', () => {
		const index = createPaletteIndex([
			{ name: 'city-open', title: 'İstanbul İzmir', description: 'Open a city' },
		]);
		const [item] = index.search('zmir');
		expect(item).toMatchObject({ name: 'city-open', field: 'title', matches: [[10, 14]] });
		expect(index.search('İst')[0]?.matches).toEqual([[0, 3]]);
	});
});
