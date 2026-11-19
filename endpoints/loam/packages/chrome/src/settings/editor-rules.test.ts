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
	NEVER_BOUND,
	overrideWarning,
	SHELL_CHORDS,
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
