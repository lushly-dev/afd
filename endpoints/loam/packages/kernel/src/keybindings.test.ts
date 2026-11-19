/**
 * Phase 4's step 7 (its 8.1, 8.3 and 8.5; D123), the pure half: the bindings in force by precedence (overrides, the
 * reserved chords, the active app's, the active tab owner's), what an override replaces and what colliding keys
 * shadow, the reserved chords' names (R1) and targets (R2), and the `when` terms the kernel decides (R4).
 */

import { describe, expect, it } from 'vitest';
import {
	type AppKeybinding,
	createKeybindings,
	type KeybindingContextV1,
	keysCollide,
	resolveKeybindings,
	SHELL_KEY_ACTIONS,
	SHELL_KEYBINDINGS_V0,
	whenHolds,
	whenProblem,
} from './keybindings.js';
import { RESERVED_CHORDS } from './late/setting-sections.js';

const APPS: AppKeybinding[] = [
	{ chord: 'Mod+Shift+H', command: 'hello-greet', instance: 'hello' },
	{ chord: 'Mod+G P', command: 'hello-board', instance: 'hello', when: 'project' },
	{ chord: 'Mod+Shift+T', command: 'tally-add', instance: 'tally' },
	{
		chord: 'Mod+Shift+N',
		command: 'notes-new',
		instance: 'notes',
		when: 'documentType == notes-page',
	},
];
const at = (context: Partial<KeybindingContextV1> = {}): KeybindingContextV1 => ({
	active: 'hello',
	editor: null,
	project: false,
	...context,
});
const runnable = (command: string, target: string | undefined) =>
	command === 'section-open' ? target !== undefined : /^(hello|tally|notes)-/.test(command);
const resolve = (
	overrides: Parameters<typeof resolveKeybindings>[2] = [],
	context: Partial<KeybindingContextV1> = {}
) => resolveKeybindings(SHELL_KEYBINDINGS_V0, APPS, overrides, at(context), runnable);

describe('the reserved chords as bindings (8.4, R1, R2)', () => {
	it('names each by its command, or by its action in the shell domain, and each layout toggle by its part', () => {
		const { entries } = resolve();
		const shell = entries.filter((entry) => entry.source === 'shell');
		expect(shell.map(({ keys, command, target }) => ({ keys, command, target }))).toEqual([
			{ keys: 'Mod+K', command: 'palette-open', target: undefined },
			{ keys: 'Mod+B', command: 'layout-set', target: 'sidebar' },
			{ keys: 'Mod+Alt+B', command: 'layout-set', target: 'inspector' },
			{ keys: 'Mod+J', command: 'layout-set', target: 'panel' },
			{ keys: 'F6', command: 'shell-focus-next', target: undefined },
			{ keys: 'Shift+F6', command: 'shell-focus-previous', target: undefined },
			{ keys: 'Mod+S', command: 'shell-save', target: undefined },
			{ keys: 'Mod+Alt+P', command: 'shell-project-switcher', target: undefined },
		]);
		expect([...SHELL_KEY_ACTIONS]).toEqual([
			'shell-focus-next',
			'shell-focus-previous',
			'shell-save',
			'shell-project-switcher',
		]);
		expect(shell.every((entry) => entry.active && entry.inForce)).toBe(true);
	});

	it("holds late-settings' copy of the reserved chords equal to the kernel's", () => {
		expect([...RESERVED_CHORDS]).toEqual(SHELL_KEYBINDINGS_V0.map(({ chord }) => chord));
	});
});

describe('precedence (8.1)', () => {
	it("puts the reserved chords first, then the active app's, then the active tab owner's; another app's are not in force", () => {
		const { force, entries } = resolve([], { editor: { owner: 'tally', type: 'tally-sheet' } });
		expect(force.map(({ chord }) => chord)).toEqual([
			...SHELL_KEYBINDINGS_V0.map(({ chord }) => chord),
			'Mod+Shift+H',
			'Mod+Shift+T',
		]);
		// hello's board needs a project; notes is neither active nor the tab's owner.
		const notes = entries.find((entry) => entry.app === 'notes');
		expect(notes).toMatchObject({ inForce: false, active: false });
		expect(entries.find((entry) => entry.command === 'hello-board')).toMatchObject({
			inForce: true,
			active: false,
		});
	});

	it('decides project and documentType, and counts focus terms as holding (R4)', () => {
		expect(whenHolds('project', at({ project: true }))).toBe(true);
		expect(whenHolds('!project', at({ project: true }))).toBe(false);
		expect(whenHolds('main && editor && sidebar', at())).toBe(true);
		expect(whenHolds('documentType == notes-page', at())).toBe(false);
		expect(
			whenHolds(
				'documentType == notes-page',
				at({ editor: { owner: 'notes', type: 'notes-page' } })
			)
		).toBe(true);
		const { force } = resolve([], {
			project: true,
			editor: { owner: 'notes', type: 'notes-page' },
		});
		expect(force.map(({ command }) => command)).toContain('hello-board');
		expect(force.find(({ command }) => command === 'notes-new')).toMatchObject({
			when: 'documentType == notes-page',
		});
	});

	it("checks a `when` against 8.1's closed terms", () => {
		for (const when of ['editor', 'main && project', '!project', 'documentType == hello-note'])
			expect(whenProblem(when), when).toBeUndefined();
		for (const when of [
			'panel',
			'project &&',
			'main && main',
			'documentType == Hello',
			'x'.repeat(201),
		])
			expect(whenProblem(when), when).toBeDefined();
	});
});

describe('collisions (8.1)', () => {
	it('collides on the same keys, and on a single chord and a sequence that begins on it', () => {
		expect(keysCollide('Mod+G', 'Mod+G P')).toBe(true);
		expect(keysCollide('Mod+G P', 'Mod+G')).toBe(true);
		expect(keysCollide('Mod+G P', 'Mod+G Q')).toBe(false);
		expect(keysCollide('Mod+Shift+Alt+H', 'Mod+Alt+Shift+H')).toBe(true);
		expect(keysCollide('Mod+G P', 'Mod+G P')).toBe(true);
	});

	it('shadows a lower binding on colliding keys under the same when; under another when both stay', () => {
		const apps: AppKeybinding[] = [
			{ chord: 'Mod+G', command: 'hello-go', instance: 'hello' },
			{ chord: 'Mod+G P', command: 'tally-pick', instance: 'tally' },
			{ chord: 'Mod+Shift+Y', command: 'hello-yes', instance: 'hello', when: 'main' },
			{ chord: 'Mod+Shift+Y', command: 'tally-yes', instance: 'tally', when: 'sidebar' },
		];
		const { entries, force } = resolveKeybindings(
			SHELL_KEYBINDINGS_V0,
			apps,
			[],
			at({ editor: { owner: 'tally', type: 'tally-sheet' } }),
			runnable
		);
		expect(entries.find((entry) => entry.command === 'hello-go')?.shadowed).toEqual([
			{ source: 'app', command: 'tally-pick' },
		]);
		expect(entries.find((entry) => entry.command === 'tally-pick')?.inForce).toBe(false);
		expect(
			force.filter(({ chord }) => chord === 'Mod+Shift+Y').map(({ command }) => command)
		).toEqual(['hello-yes', 'tally-yes']);
	});
});

describe("a person's overrides (8.3)", () => {
	it('rebinds a reserved chord, naming what it replaced as shadowed, and keeps its action', () => {
		const { entries, force } = resolve([
			{ command: 'shell-project-switcher', keys: 'Mod+Shift+O' },
		]);
		const mine = entries.find((entry) => entry.source === 'you');
		expect(mine).toMatchObject({
			keys: 'Mod+Shift+O',
			command: 'shell-project-switcher',
			shadowed: [{ source: 'shell', command: 'shell-project-switcher' }],
			active: true,
			inForce: true,
		});
		expect(force[0]).toEqual({ chord: 'Mod+Shift+O', command: null, switcher: true });
		expect(force.some(({ chord }) => chord === 'Mod+Alt+P')).toBe(false);
		expect(entries.find((entry) => entry.keys === 'Mod+Alt+P')).toMatchObject({
			inForce: false,
			active: false,
		});
	});

	it('names a layout toggle by its part; one without a target changes nothing (R2)', () => {
		const sidebar = resolve([{ command: 'layout-set', target: 'sidebar', keys: 'Mod+Shift+B' }]);
		expect(sidebar.force[0]).toEqual({
			chord: 'Mod+Shift+B',
			command: 'layout-set',
			toggle: 'sidebar',
			target: 'sidebar',
		});
		expect(sidebar.force.some(({ chord }) => chord === 'Mod+B')).toBe(false);
		// Step 2 stored `{ command: 'layout-set', keys: null }`: no binding has that command with no target.
		const none = resolve([{ command: 'layout-set', keys: null }]);
		expect(none.force).toEqual(resolve().force);
	});

	it('unbinds with null, Mod+K included, listing nothing for it', () => {
		const { force, entries } = resolve([{ command: 'palette-open', keys: null }]);
		expect(force.some(({ command }) => command === 'palette-open')).toBe(false);
		expect(entries.filter((entry) => entry.source === 'you')).toEqual([]);
		expect(entries.find((entry) => entry.keys === 'Mod+K')?.inForce).toBe(false);
	});

	it("comes first: an override on a reserved chord's keys shadows it", () => {
		const { entries, force } = resolve([{ command: 'tally-add', keys: 'Mod+B' }]);
		expect(entries[0]).toMatchObject({
			keys: 'Mod+B',
			source: 'you',
			app: 'tally',
			shadowed: [
				{ source: 'app', command: 'tally-add' },
				{ source: 'shell', command: 'layout-set' },
			],
		});
		expect(force.filter(({ chord }) => chord === 'Mod+B')).toEqual([
			{ chord: 'Mod+B', command: 'tally-add' },
		]);
	});

	it("runs section-open with its target, holds everywhere without an app's when, and idles on a command that cannot run", () => {
		const { force, entries } = resolve([
			{ command: 'section-open', target: 'documents', keys: 'Mod+G D' },
			{ command: 'hello-board', keys: 'Mod+Shift+J' },
			{ command: 'ghost-gone', keys: 'Mod+Shift+Q' },
		]);
		expect(force.slice(0, 2)).toEqual([
			{ chord: 'Mod+G D', command: 'section-open', target: 'documents' },
			{ chord: 'Mod+Shift+J', command: 'hello-board' },
		]);
		expect(entries.find((entry) => entry.command === 'ghost-gone')).toMatchObject({
			inForce: false,
			active: false,
		});
	});
});

describe('the registry', () => {
	it('lists in force for the active app, and gives the palette each command its keys, the person’s own first', () => {
		let project = false;
		const registry = createKeybindings(SHELL_KEYBINDINGS_V0, [], {
			runnable,
			project: () => project,
		});
		registry.setApps(APPS);
		expect(registry.list('tally').map(({ chord }) => chord)).toContain('Mod+Shift+T');
		expect(registry.list('hello').map(({ chord }) => chord)).not.toContain('Mod+G P');
		project = true;
		expect(registry.list('hello').map(({ chord }) => chord)).toContain('Mod+G P');
		expect(registry.keybindingFor('tally-add')).toBe('Mod+Shift+T');
		expect(registry.keybindingFor('palette-open')).toBe('Mod+K');
		registry.setOverrides([
			{ command: 'tally-add', keys: 'Mod+Shift+A' },
			{ command: 'palette-open', keys: null },
		]);
		expect(registry.keybindingFor('tally-add')).toBe('Mod+Shift+A');
		expect(registry.keybindingFor('palette-open')).toBeUndefined();
		registry.setEditor({ owner: 'notes', type: 'notes-page' });
		expect(registry.context('hello')).toEqual({
			active: 'hello',
			editor: { owner: 'notes', type: 'notes-page' },
			project: true,
		});
		expect(registry.list('hello').map(({ chord }) => chord)).toContain('Mod+Shift+N');
	});
});
