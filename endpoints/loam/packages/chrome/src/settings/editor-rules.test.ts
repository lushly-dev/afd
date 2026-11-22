/**
 * The keybinding editor's pure parts (phase 4 specification, 3.7 and 8.3): the chord a key press records, the
 * warnings it gives before an override shadows a shell chord or unbinds Mod+K, and the shell's chords held equal to the
 * kernel's. The editors' DOM is P4-E1's Chromium file, `web/test/browser/settings.test.ts`.
 */

import { SHELL_KEYBINDINGS_V0 } from '@lushly-dev/loam-kernel';
import { keysCollide as kernelCollide, overridesProblem } from '@lushly-dev/loam-kernel/testing';
import { describe, expect, it } from 'vitest';
import { keyOf as matcherKeyOf, SEQUENCE_WAIT_MS } from '../keyboard.js';
import {
	CUSTOM_EDITORS,
	chordOf,
	keyOf,
	keysCollide,
	keysRefused,
	NEVER_BOUND,
	type OverrideV1,
	overrideRefused,
	overridesRefused,
	overrideWarning,
	reorder,
	SEQUENCE_WAIT,
	SHELL_CHORDS,
	toggled,
	withOverride,
} from './editor-rules.js';

const press = (key: string, code: string, modifiers: Partial<Record<string, boolean>> = {}) => ({
	key,
	code,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...modifiers,
});

describe('P4-E9: the keybinding editor (8.2, 8.3)', () => {
	it('records a chord as Mod, Ctrl, Alt, Shift and Meta, then the key, by key for a letter or digit, else by code', () => {
		expect(chordOf(press('k', 'KeyK', { ctrlKey: true, shiftKey: true }), false)).toBe(
			'Mod+Shift+K'
		);
		expect(chordOf(press('k', 'KeyK', { metaKey: true }), true)).toBe('Mod+K');
		expect(chordOf(press('k', 'KeyK', { ctrlKey: true }), true)).toBe('Ctrl+K');
		expect(chordOf(press('k', 'KeyK', { metaKey: true }), false)).toBe('Meta+K');
		// A German layout's Alt+P, and a Cyrillic layout's letter, by the physical key.
		expect(chordOf(press('π', 'KeyP', { ctrlKey: true, altKey: true }), false)).toBe('Mod+Alt+P');
		expect(chordOf(press('л', 'KeyK', { ctrlKey: true }), false)).toBe('Mod+K');
		expect(chordOf(press('F6', 'F6', { shiftKey: true }), false)).toBe('Shift+F6');
		expect(chordOf(press(' ', 'Space', { altKey: true }), false)).toBe('Alt+Space');
		expect(chordOf(press('ArrowUp', 'ArrowUp'), false)).toBe('ArrowUp');
		// A modifier alone records nothing yet.
		expect(chordOf(press('Control', 'ControlLeft', { ctrlKey: true }), false)).toBeUndefined();
		expect(chordOf(press('Dead', 'BracketLeft'), false)).toBeUndefined();
	});

	it('warns before shadowing a shell chord or unbinding Mod+K', () => {
		expect(overrideWarning({ command: 'hello-greet', keys: 'Mod+B' })).toBe(
			"Mod+B is the shell's own; this binding would shadow it."
		);
		expect(overrideWarning({ command: 'palette-open', keys: null })).toBe(
			'This unbinds Mod+K, which opens the command palette.'
		);
		expect(overrideWarning({ command: 'palette-open', keys: 'Mod+P' })).toMatch(/Mod\+K/);
		expect(overrideWarning({ command: 'hello-greet', keys: 'Mod+G H' })).toBeUndefined();
		// Mod+Alt+P, the project switcher's (8.4), is the shell's too.
		expect(overrideWarning({ command: 'hello-greet', keys: 'Mod+Alt+P' })).toMatch(/shadow/);
	});

	it('warns before shadowing another binding on colliding keys, never the one it rebinds (8.3, 15)', () => {
		const bindings = [
			{ keys: 'Mod+Shift+H', command: 'hello-greet', source: 'app' as const, active: true },
			{ keys: 'Mod+G P', command: 'count-pick', source: 'app' as const, active: true },
			{ keys: 'Mod+Shift+Q', command: 'jot-quit', source: 'app' as const, active: false },
		];
		expect(overrideWarning({ command: 'count-add', keys: 'Mod+Shift+H' }, bindings)).toBe(
			"Mod+Shift+H runs hello-greet, the app's; this binding would shadow it."
		);
		expect(overrideWarning({ command: 'count-add', keys: 'Mod+G' }, bindings)).toMatch(
			/^Mod\+G P runs count-pick/
		);
		expect(
			overrideWarning({ command: 'hello-greet', keys: 'Mod+Shift+H' }, bindings)
		).toBeUndefined();
		// An app's binding not in force now still warns: it holds whenever its app is active.
		expect(overrideWarning({ command: 'count-add', keys: 'Mod+Shift+Q' }, bindings)).toMatch(
			/jot-quit/
		);
		expect(
			overrideWarning({ command: 'count-add', keys: 'Mod+Shift+Z' }, bindings)
		).toBeUndefined();
		// One of your own on colliding keys: said, and which wins, the earlier of yours (the reviews' 8).
		const yours = [
			...bindings,
			{ keys: 'Mod+Shift+Z', command: 'jot-zap', source: 'you' as const, active: true },
		];
		expect(overrideWarning({ command: 'count-add', keys: 'Mod+Shift+Z' }, yours)).toBe(
			'Mod+Shift+Z is already yours, for jot-zap, which would win: this binding would be shadowed.'
		);
		// Rebinding your own command is no collision.
		expect(overrideWarning({ command: 'jot-zap', keys: 'Mod+Shift+Z' }, yours)).toBeUndefined();
	});

	it("says which of the person's own wins by the list's order, for an edit kept in place too (the re-check's 7)", () => {
		const stored = [
			{ command: 'palette-open', keys: 'Mod+Shift+L' },
			{ command: 'section-open', target: 'projects', keys: 'Mod+Shift+M' },
		];
		// Both valid and in force: `projects` is a section (the fifth round's R12 fixed this fixture, which had it idle).
		const listed = [
			{ keys: 'Mod+Shift+L', command: 'palette-open', source: 'you' as const, active: true },
			{
				keys: 'Mod+Shift+M',
				command: 'section-open',
				target: 'projects',
				source: 'you' as const,
				active: true,
			},
		];
		// Editing the second in place onto the first's keys: the first, earlier, wins.
		expect(
			overrideWarning(
				{ command: 'section-open', target: 'projects', keys: 'Mod+Shift+L' },
				listed,
				stored
			)
		).toBe(
			'Mod+Shift+L is already yours, for palette-open, which would win: this binding would be shadowed.'
		);
		// Editing the first onto the second's keys: the first keeps its place, so it wins.
		expect(overrideWarning({ command: 'palette-open', keys: 'Mod+Shift+M' }, listed, stored)).toBe(
			'Mod+K would no longer open the command palette. Mod+Shift+M is yours too, for section-open (projects); this binding comes first and would shadow it.'
		);
		// A shell chord's warning hides no collision with one of the person's own.
		expect(
			overrideWarning({ command: 'count-add', keys: 'Mod+B' }, listed, [
				...stored,
				{ command: 'jot-zap', keys: 'Mod+B' },
			])
		).toBe(
			"Mod+B is the shell's own; this binding would shadow it. Mod+B is already yours, for jot-zap, which would win: this binding would be shadowed."
		);
	});

	it("leaves out of the winner an earlier override no chord runs (the third round's G)", () => {
		const stored = [
			{ command: 'ghost-gone', keys: 'Mod+Shift+L' },
			{ command: 'section-open', target: 'projects', keys: 'Mod+Shift+M' },
		];
		const listed = [
			{
				keys: 'Mod+Shift+L',
				command: 'ghost-gone',
				source: 'you' as const,
				active: false,
				idle: true,
			},
			{
				keys: 'Mod+Shift+M',
				command: 'section-open',
				target: 'projects',
				source: 'you' as const,
				active: true,
			},
		];
		// Editing the second onto the first's keys: the first is not in force, so this one is the binding that runs.
		expect(
			overrideWarning(
				{ command: 'section-open', target: 'projects', keys: 'Mod+Shift+L' },
				listed,
				stored
			)
		).toBe(
			'Mod+Shift+L is yours too, for ghost-gone, not in force now; this binding would be the one in force.'
		);
	});

	it("names the resolver's winner among three: the first of the person's own in force (the fourth round's 4)", () => {
		// `active: false` with `idle`: no chord runs it, as the resolver says (the fifth round's R12).
		const you = (command: string, keys: string, active: boolean, target?: string) => ({
			keys,
			command,
			...(target ? { target } : {}),
			source: 'you' as const,
			active,
			...(active ? {} : { idle: true }),
		});
		// X, not in force, then palette-open, in force, then the edited Z: palette-open runs.
		const stored = [
			{ command: 'ghost-gone', keys: 'Mod+Shift+L' },
			{ command: 'palette-open', keys: 'Mod+Shift+L' },
			{ command: 'section-open', target: 'projects', keys: 'Mod+Shift+M' },
		];
		const listed = [
			you('ghost-gone', 'Mod+Shift+L', false),
			you('palette-open', 'Mod+Shift+L', true),
			you('section-open', 'Mod+Shift+M', true, 'projects'),
		];
		expect(
			overrideWarning(
				{ command: 'section-open', target: 'projects', keys: 'Mod+Shift+L' },
				listed,
				stored
			)
		).toBe(
			'Mod+Shift+L is already yours, for palette-open, which would win: this binding would be shadowed.'
		);
		// The edited one first but not in force, a later one in force: the later one runs.
		const first = [
			{ command: 'ghost-gone', keys: 'Mod+Shift+P' },
			{ command: 'section-open', target: 'projects', keys: 'Mod+Shift+L' },
		];
		const firstListed = [
			you('ghost-gone', 'Mod+Shift+P', false),
			you('section-open', 'Mod+Shift+L', true, 'projects'),
		];
		expect(
			overrideWarning({ command: 'ghost-gone', keys: 'Mod+Shift+L' }, firstListed, first)
		).toBe(
			'Mod+Shift+L is yours too, for section-open (projects), which runs: this binding is not in force now.'
		);
	});

	it("runs the resolver's rule over the proposed list: a shadowed binding freed by the edit wins (the fifth round's R12)", () => {
		const you = (command: string, keys: string, active: boolean) => ({
			keys,
			command,
			source: 'you' as const,
			active,
		});
		// Opus: [B: Mod+L, A: Mod+L, C: Mod+P]; A is shadowed by B, not idle. Moving A onto Mod+P frees it, and A,
		// before C in the list, is the one in force.
		const stored = [
			{ command: 'jot-b', keys: 'Mod+L' },
			{ command: 'jot-a', keys: 'Mod+L' },
			{ command: 'jot-c', keys: 'Mod+P' },
		];
		const listed = [
			you('jot-b', 'Mod+L', true),
			you('jot-a', 'Mod+L', false),
			you('jot-c', 'Mod+P', true),
		];
		expect(overrideWarning({ command: 'jot-a', keys: 'Mod+P' }, listed, stored)).toBe(
			'Mod+P is yours too, for jot-c; this binding comes first and would shadow it.'
		);
		// Astra: A and B share a chord, C another; B, shadowed by A, moves onto C's: B comes first there.
		const astra = [
			{ command: 'jot-a', keys: 'Mod+Shift+A' },
			{ command: 'jot-b', keys: 'Mod+Shift+A' },
			{ command: 'jot-c', keys: 'Mod+Shift+C' },
		];
		const astraListed = [
			you('jot-a', 'Mod+Shift+A', true),
			you('jot-b', 'Mod+Shift+A', false),
			you('jot-c', 'Mod+Shift+C', true),
		];
		expect(overrideWarning({ command: 'jot-b', keys: 'Mod+Shift+C' }, astraListed, astra)).toBe(
			'Mod+Shift+C is yours too, for jot-c; this binding comes first and would shadow it.'
		);
		// A sequence: Mod+G is shadowed by the earlier Mod+G Q, so an added Mod+G P, which collides with Mod+G alone, is
		// in force; a first-colliding rule would name Mod+G.
		const sequence = [
			{ command: 'jot-q', keys: 'Mod+G Q' },
			{ command: 'jot-g', keys: 'Mod+G' },
		];
		const sequenceListed = [you('jot-q', 'Mod+G Q', true), you('jot-g', 'Mod+G', false)];
		expect(overrideWarning({ command: 'jot-p', keys: 'Mod+G P' }, sequenceListed, sequence)).toBe(
			'Mod+G is yours too, for jot-g; this binding would be the one in force.'
		);
	});

	it('refuses keys never bound, and a sequence that begins on a reserved chord or without Mod (8.1)', () => {
		expect(keysRefused(null)).toBeUndefined();
		expect(keysRefused('Mod+G P')).toBeUndefined();
		expect(keysRefused('Shift+F6')).toBe('Shift+F6 cannot be bound: bind another key.');
		expect(keysRefused('Mod+G Escape')).toBe('Escape cannot be bound: bind another key.');
		expect(keysRefused('Mod+K P')).toMatch(/cannot begin on Mod\+K/);
		expect(keysRefused('Alt+G P')).toBe('A sequence begins on a Mod chord, such as Mod+G P.');
		// 8.3: F6 and Shift+F6 themselves are neither rebound nor unbound.
		expect(overrideRefused({ command: 'shell-focus-next', keys: null })).toMatch(/^F6 moves focus/);
		expect(overrideRefused({ command: 'shell-focus-previous', keys: 'Mod+G' })).toMatch(
			/^Shift\+F6 moves focus/
		);
		expect(overrideRefused({ command: 'shell-save', keys: 'Mod+Shift+S' })).toBeUndefined();
	});

	it("holds the shell's chords equal to the kernel's, and the three no override binds", () => {
		expect([...SHELL_CHORDS]).toEqual(SHELL_KEYBINDINGS_V0.map(({ chord }) => chord));
		expect([...NEVER_BOUND]).toEqual(['F6', 'Shift+F6', 'Escape']);
	});

	it('names an editor for each of the three custom keys', () => {
		expect(CUSTOM_EDITORS).toEqual({
			'loam.rail.order': 'loam-rail-order-editor',
			'loam.notifications.muted': 'loam-instance-picker',
			'loam.keybindings.overrides': 'loam-keybinding-editor',
		});
	});
});

describe("the editors' lists keep what they do not show (the review's 3)", () => {
	it('reorders the shown apps and keeps every stored id that is not shown, at the end', () => {
		// `ghost` is stored but disabled now, so not shown: a move of the others keeps it.
		expect(reorder(['ghost', 'alpha', 'beta'], ['beta', 'alpha'])).toEqual([
			'beta',
			'alpha',
			'ghost',
		]);
		expect(reorder([], ['b', 'a'])).toEqual(['b', 'a']);
	});

	it('mutes or unmutes one app, keeping every other stored id in place', () => {
		expect(toggled(['gone', 'alpha'], 'beta', true)).toEqual(['gone', 'alpha', 'beta']);
		expect(toggled(['gone', 'alpha', 'beta'], 'alpha', false)).toEqual(['gone', 'beta']);
	});

	it('replaces only the override of the same command and target', () => {
		const stored = [
			{ command: 'section-open', target: 'documents', keys: 'Mod+G D' },
			{ command: 'section-open', target: 'projects', keys: 'Mod+G P' },
			{ command: 'palette-open', keys: 'Mod+P' },
		];
		expect(
			withOverride(stored, { command: 'section-open', target: 'projects', keys: null })
		).toEqual([stored[0], { command: 'section-open', target: 'projects', keys: null }, stored[2]]);
		expect(withOverride(stored, { command: 'section-open', keys: 'Mod+G S' })).toEqual([
			...stored,
			{ command: 'section-open', keys: 'Mod+G S' },
		]);
	});
});

describe("the settings chunk's copies of first paint's rules (phase 3 specification, 13)", () => {
	it('reads each key as the matcher does', () => {
		const presses: Array<[string, string]> = [
			['z', 'KeyY'],
			['л', 'KeyK'],
			['∫', 'KeyB'],
			['!', 'Digit1'],
			[',', 'Comma'],
			[' ', 'Space'],
			['F6', 'F6'],
			['F6', ''],
			['ArrowUp', 'ArrowUp'],
			['Escape', ''],
			['Control', 'ControlLeft'],
			['Dead', 'BracketLeft'],
		];
		for (const [key, code] of presses)
			expect(keyOf({ key, code }), `${key} ${code}`).toBe(matcherKeyOf({ key, code }));
	});

	it("collides keys as the kernel's resolver does, and waits the matcher's 1,500 ms (the reviews' 14)", () => {
		const keys = [
			'Mod+G',
			'Mod+G P',
			'Mod+G Q',
			'Mod+Shift+Alt+H',
			'Mod+Alt+Shift+H',
			'Mod+H',
			'F7',
			'Ctrl+K',
		];
		for (const a of keys)
			for (const b of keys) expect(keysCollide(a, b), `${a} ${b}`).toBe(kernelCollide(a, b));
		expect(SEQUENCE_WAIT).toBe(SEQUENCE_WAIT_MS);
	});

	it("refuses a proposed list as the kernel's check does (the reviews' 8)", () => {
		const one = (override: object) => [override];
		const lists: unknown[] = [
			one({ command: 'palette-open', keys: 'Mod+Shift+K' }),
			one({ command: 'Palette', keys: 'Mod+K' }),
			one({ command: 'palette-open', keys: 'Shift+F6' }),
			one({ command: 'palette-open', keys: 'Mod+K P' }),
			one({ command: 'palette-open', keys: 'Alt+G P' }),
			one({ command: 'palette-open', keys: 'A' }),
			one({ command: 'palette-open', keys: 'F7' }),
			one({ command: 'palette-open', keys: 'Mod+G P Q' }),
			one({ command: 'palette-open', target: 'documents', keys: 'Mod+K' }),
			one({ command: 'layout-set', target: 'footer', keys: 'Mod+Shift+K' }),
			one({ command: 'layout-set', target: 'sidebar', keys: null }),
			one({ command: 'section-open', target: 'documents', keys: 'Mod+G D' }),
			one({ command: 'shell-focus-next', keys: null }),
			one({ command: 'palette-open', target: '', keys: 'Mod+K' }),
			[
				{ command: 'palette-open', keys: 'Mod+K' },
				{ command: 'palette-open', keys: 'Mod+L' },
			],
			Array.from({ length: 65 }, (_, index) => ({ command: `count-c${index}`, keys: 'Mod+K' })),
			Array.from({ length: 64 }, (_, index) => ({ command: `count-c${index}`, keys: 'Mod+K' })),
		];
		for (const list of lists) {
			const kernel = overridesProblem(list);
			expect(
				overridesRefused(list as OverrideV1[]) !== undefined,
				JSON.stringify(list).slice(0, 80)
			).toBe(kernel !== undefined);
		}
	});
});
