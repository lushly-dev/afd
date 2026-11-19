/**
 * The keybinding editor's pure parts (phase 4 specification, 3.7 and 8.3): the chord a key press records, the
 * warnings it gives before an override shadows a shell chord or unbinds Mod+K, and the shell's chords held equal to the
 * kernel's. The editors' DOM is P4-E1's Chromium file, `web/test/browser/settings.test.ts`.
 */

import { SHELL_KEYBINDINGS_V0 } from '@lushly-dev/loam-kernel';
import { describe, expect, it } from 'vitest';
import {
	CUSTOM_EDITORS,
	chordOf,
	keysRefused,
	NEVER_BOUND,
	overrideRefused,
	overrideWarning,
	reorder,
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

describe('the keybinding editor (8.2, 8.3)', () => {
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
			{ keys: 'Mod+G P', command: 'tally-pick', source: 'app' as const, active: true },
			{ keys: 'Mod+Shift+Q', command: 'notes-quit', source: 'app' as const, active: false },
		];
		expect(overrideWarning({ command: 'tally-add', keys: 'Mod+Shift+H' }, bindings)).toBe(
			"Mod+Shift+H runs hello-greet, the app's; this binding would shadow it."
		);
		expect(overrideWarning({ command: 'tally-add', keys: 'Mod+G' }, bindings)).toMatch(
			/^Mod\+G P runs tally-pick/
		);
		expect(
			overrideWarning({ command: 'hello-greet', keys: 'Mod+Shift+H' }, bindings)
		).toBeUndefined();
		// An app's binding not in force now still warns: it holds whenever its app is active.
		expect(overrideWarning({ command: 'tally-add', keys: 'Mod+Shift+Q' }, bindings)).toMatch(
			/notes-quit/
		);
		expect(
			overrideWarning({ command: 'tally-add', keys: 'Mod+Shift+Z' }, bindings)
		).toBeUndefined();
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
