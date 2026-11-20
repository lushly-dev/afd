/**
 * Phase 4's step 7 (its 8.1, 8.3 and 8.5; D123), the pure half: the bindings in force by precedence (overrides, the
 * reserved chords, the active app's, the active tab owner's), what an override replaces and what colliding keys
 * shadow, the reserved chords' names (R1) and targets (R2), and the `when` terms the kernel decides (R4).
 */

import { keybindingWhenProblem as whenProblem } from '@lushly-dev/loam-manifest';
import { describe, expect, it } from 'vitest';
import {
	type AppKeybinding,
	createKeybindings,
	type KeybindingContextV1,
	SHELL_KEY_ACTIONS,
	SHELL_KEYBINDINGS_V0,
} from './keybindings.js';
import {
	KEYBINDING_RESOLVER,
	keysCollide,
	resolveKeybindings,
	whenHolds,
} from './late/keybinding-resolve.js';
import { RESERVED_CHORDS } from './late/setting-sections.js';

const APPS: AppKeybinding[] = [
	{ chord: 'Mod+Shift+H', command: 'hello-greet', instance: 'hello' },
	{ chord: 'Mod+G P', command: 'hello-board', instance: 'hello', when: 'project' },
	{ chord: 'Mod+Shift+T', command: 'count-add', instance: 'count' },
	{
		chord: 'Mod+Shift+N',
		command: 'jot-new',
		instance: 'jot',
		when: 'documentType == jot-page',
	},
];
const at = (context: Partial<KeybindingContextV1> = {}): KeybindingContextV1 => ({
	active: 'hello',
	editor: null,
	project: false,
	...context,
});
const runnable = (command: string, target: string | undefined): boolean =>
	command === 'section-open' ? target !== undefined : /^(hello|count|jot)-/.test(command);
const info = (command: string, target: string | undefined) => ({
	runnable: runnable(command, target),
	...(/^(hello|count|jot)-/.test(command) ? { app: command.split('-')[0] as string } : {}),
});
const resolve = (
	overrides: Parameters<typeof resolveKeybindings>[2] = [],
	context: Partial<KeybindingContextV1> = {}
) => resolveKeybindings(SHELL_KEYBINDINGS_V0, APPS, overrides, at(context), info);

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
		const { force, entries } = resolve([], { editor: { owner: 'count', type: 'count-sheet' } });
		expect(force.map(({ chord }) => chord)).toEqual([
			...SHELL_KEYBINDINGS_V0.map(({ chord }) => chord),
			'Mod+Shift+H',
			'Mod+Shift+T',
		]);
		// hello's board needs a project; jot is neither active nor the tab's owner.
		const jot = entries.find((entry) => entry.app === 'jot');
		expect(jot).toMatchObject({ inForce: false, active: false });
		expect(entries.find((entry) => entry.command === 'hello-board')).toMatchObject({
			inForce: true,
			active: false,
		});
	});

	it('decides project and documentType, and counts focus terms as holding (R4)', () => {
		expect(whenHolds('project', at({ project: true }))).toBe(true);
		expect(whenHolds('!project', at({ project: true }))).toBe(false);
		expect(whenHolds('main && editor && sidebar', at())).toBe(true);
		expect(whenHolds('documentType == jot-page', at())).toBe(false);
		expect(
			whenHolds('documentType == jot-page', at({ editor: { owner: 'jot', type: 'jot-page' } }))
		).toBe(true);
		const { force } = resolve([], {
			project: true,
			editor: { owner: 'jot', type: 'jot-page' },
		});
		expect(force.map(({ command }) => command)).toContain('hello-board');
		expect(force.find(({ command }) => command === 'jot-new')).toMatchObject({
			when: 'documentType == jot-page',
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
			{ chord: 'Mod+G P', command: 'count-pick', instance: 'count' },
			{ chord: 'Mod+Shift+Y', command: 'hello-yes', instance: 'hello', when: 'main' },
			{ chord: 'Mod+Shift+Y', command: 'count-yes', instance: 'count', when: 'sidebar' },
		];
		const { entries, force } = resolveKeybindings(
			SHELL_KEYBINDINGS_V0,
			apps,
			[],
			at({ editor: { owner: 'count', type: 'count-sheet' } }),
			info
		);
		expect(entries.find((entry) => entry.command === 'hello-go')?.shadowed).toEqual([
			{ source: 'app', command: 'count-pick' },
		]);
		expect(entries.find((entry) => entry.command === 'count-pick')?.inForce).toBe(false);
		expect(
			force.filter(({ chord }) => chord === 'Mod+Shift+Y').map(({ command }) => command)
		).toEqual(['hello-yes', 'count-yes']);
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
		const { entries, force } = resolve([{ command: 'count-add', keys: 'Mod+B' }]);
		expect(entries[0]).toMatchObject({
			keys: 'Mod+B',
			source: 'you',
			app: 'count',
			shadowed: [
				{ source: 'app', command: 'count-add' },
				{ source: 'shell', command: 'layout-set' },
			],
		});
		expect(force.filter(({ chord }) => chord === 'Mod+B')).toEqual([
			{ chord: 'Mod+B', command: 'count-add' },
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
	const source = (person: () => string | undefined) => ({
		person,
		info: (command: string, target: string | undefined) => ({
			runnable: runnable(command, target),
			...(/^count-/.test(command) ? { app: 'count' } : {}),
		}),
	});

	it("dispatches only F6 and Shift+F6 until the person's overrides are known (step 7's reviews, 6)", () => {
		const registry = createKeybindings(SHELL_KEYBINDINGS_V0, APPS);
		// Before the late load: nothing rebindable, as a stored unbind may hold any of it.
		expect(registry.list('hello').map(({ chord }) => chord)).toEqual(['F6', 'Shift+F6']);
		registry.setResolver(
			KEYBINDING_RESOLVER,
			source(() => 'ada')
		);
		// The resolver, but no overrides read for Ada yet.
		expect(registry.list('hello').map(({ chord }) => chord)).toEqual(['F6', 'Shift+F6']);
		registry.setOverrides([{ command: 'layout-set', target: 'sidebar', keys: null }], 'ada');
		const known = registry.list('hello').map(({ chord }) => chord);
		expect(known).toContain('Mod+K');
		expect(known).not.toContain('Mod+B');
	});

	it("drops a person's overrides the moment the person changes, before the next read (step 7's reviews, 2)", () => {
		let person: string | undefined = 'ada';
		const registry = createKeybindings(SHELL_KEYBINDINGS_V0, APPS);
		registry.setResolver(
			KEYBINDING_RESOLVER,
			source(() => person)
		);
		registry.setOverrides([{ command: 'palette-open', keys: 'Mod+Shift+K' }], 'ada');
		expect(registry.list(null)[0]?.chord).toBe('Mod+Shift+K');
		person = 'olu';
		expect(registry.list(null).map(({ chord }) => chord)).toEqual(['F6', 'Shift+F6']);
		expect(
			registry.resolve(registry.context(null)).entries.some((entry) => entry.source === 'you')
		).toBe(false);
		person = 'ada';
		expect(registry.list(null)[0]?.chord).toBe('Mod+Shift+K');
	});

	it('lists in force for the active app, and gives the palette each command its keys, the person’s own first', () => {
		let project = false;
		const registry = createKeybindings(SHELL_KEYBINDINGS_V0, [], { project: () => project });
		registry.setApps(APPS);
		expect(registry.resolve(registry.context('hello'))).toEqual({ force: [], entries: [] });
		expect(registry.collide('Mod+G', 'Mod+G P')).toBe(false);
		registry.setResolver(
			KEYBINDING_RESOLVER,
			source(() => undefined)
		);
		registry.setOverrides([], undefined);
		expect(registry.collide('Mod+G', 'Mod+G P')).toBe(true);
		expect(registry.list('count').map(({ chord }) => chord)).toContain('Mod+Shift+T');
		expect(registry.list('hello').map(({ chord }) => chord)).not.toContain('Mod+G P');
		project = true;
		expect(registry.list('hello').map(({ chord }) => chord)).toContain('Mod+G P');
		expect(registry.keybindingFor('count-add')).toBe('Mod+Shift+T');
		expect(registry.keybindingFor('palette-open')).toBe('Mod+K');
		registry.setOverrides(
			[
				{ command: 'count-add', keys: 'Mod+Shift+A' },
				{ command: 'palette-open', keys: null },
			],
			undefined
		);
		expect(registry.keybindingFor('count-add')).toBe('Mod+Shift+A');
		expect(registry.keybindingFor('palette-open')).toBeUndefined();
		registry.setEditor({ owner: 'jot', type: 'jot-page' });
		expect(registry.context('hello')).toEqual({
			active: 'hello',
			editor: { owner: 'jot', type: 'jot-page' },
			project: true,
		});
		expect(registry.list('hello').map(({ chord }) => chord)).toContain('Mod+Shift+N');
	});
});
