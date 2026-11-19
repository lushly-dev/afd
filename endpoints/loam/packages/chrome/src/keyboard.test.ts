import { createDefaultLayout, SHELL_KEYBINDINGS_V0 } from '@lushly-dev/loam-kernel';
import { describe, expect, it } from 'vitest';
import {
	type ChordEvent,
	focusHolds,
	isMacPlatform,
	keyOf,
	matchKeybinding,
	nextPart,
	type PendingChord,
	pressKey,
	SEQUENCE_WAIT_MS,
	sameChord,
	toggleInput,
} from './keyboard.js';

const key = (init: Partial<ChordEvent>): ChordEvent => ({
	key: '',
	code: '',
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...init,
});

describe('reserved chords', () => {
	it('matches Mod as Command on macOS and Control elsewhere', () => {
		expect(matchKeybinding(key({ key: 'k', code: 'KeyK', metaKey: true }), true)?.command).toBe(
			'palette-open'
		);
		expect(matchKeybinding(key({ key: 'k', code: 'KeyK', ctrlKey: true }), false)?.command).toBe(
			'palette-open'
		);
		expect(matchKeybinding(key({ key: 'k', code: 'KeyK', ctrlKey: true }), true)).toBeUndefined();
		expect(
			matchKeybinding(key({ key: 'k', code: 'KeyK', ctrlKey: true, metaKey: true }), false)
		).toBeUndefined();
	});

	it('matches letters by physical key, so Alt does not change them', () => {
		const binding = matchKeybinding(
			key({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }),
			true
		);
		expect(binding).toMatchObject({ chord: 'Mod+Alt+B', toggle: 'inspector' });
		expect(matchKeybinding(key({ key: 'b', code: 'KeyB', ctrlKey: true }), false)?.toggle).toBe(
			'sidebar'
		);
	});

	it('matches F6 and Shift+F6 without a modifier', () => {
		expect(matchKeybinding(key({ key: 'F6' }), false)?.focus).toBe('next');
		expect(matchKeybinding(key({ key: 'F6', shiftKey: true }), false)?.focus).toBe('previous');
		expect(matchKeybinding(key({ key: 'F6', ctrlKey: true }), false)).toBeUndefined();
	});

	it('covers every reserved chord', () => {
		const events: Record<string, ChordEvent> = {
			'Mod+K': key({ code: 'KeyK', ctrlKey: true }),
			'Mod+B': key({ code: 'KeyB', ctrlKey: true }),
			'Mod+Alt+B': key({ code: 'KeyB', ctrlKey: true, altKey: true }),
			'Mod+J': key({ code: 'KeyJ', ctrlKey: true }),
			F6: key({ key: 'F6' }),
			'Shift+F6': key({ key: 'F6', shiftKey: true }),
			// The editor area's save (documents specification, 5.5).
			'Mod+S': key({ code: 'KeyS', ctrlKey: true }),
			// The project switcher (phase 4 specification, 8.4).
			'Mod+Alt+P': key({ key: 'π', code: 'KeyP', ctrlKey: true, altKey: true }),
		};
		for (const binding of SHELL_KEYBINDINGS_V0) {
			expect(matchKeybinding(events[binding.chord] as ChordEvent, false)?.chord).toBe(
				binding.chord
			);
		}
	});

	it('computes toggle inputs per class', () => {
		const layout = createDefaultLayout();
		expect(toggleInput('sidebar', layout, 'expanded')).toEqual({ sidebar: { open: false } });
		expect(toggleInput('inspector', layout, 'medium')).toEqual({ inspector: { open: true } });
		expect(toggleInput('panel', layout, 'expanded')).toEqual({ panel: { open: true } });
		expect(toggleInput('sidebar', layout, 'compact')).toEqual({ compact: { drawer: 'sidebar' } });
		const drawer = { ...layout, compact: { drawer: 'sidebar' as const, sheet: false } };
		expect(toggleInput('sidebar', drawer, 'compact')).toEqual({ compact: { drawer: null } });
		expect(toggleInput('inspector', drawer, 'compact')).toEqual({
			compact: { drawer: 'inspector' },
		});
		expect(toggleInput('panel', drawer, 'compact')).toEqual({ compact: { sheet: true } });
	});

	it('moves focus through the present parts in order, wrapping', () => {
		const present = ['statusbar', 'main', 'titlebar', 'rail', 'sidebar'] as const;
		expect(nextPart(present, undefined, 'next')).toBe('titlebar');
		expect(nextPart(present, undefined, 'previous')).toBe('statusbar');
		expect(nextPart(present, 'rail', 'next')).toBe('sidebar');
		expect(nextPart(present, 'statusbar', 'next')).toBe('titlebar');
		expect(nextPart(present, 'titlebar', 'previous')).toBe('statusbar');
		expect(nextPart(present, 'inspector', 'next')).toBe('titlebar');
		expect(nextPart([], 'main', 'next')).toBeUndefined();
	});

	it('stops at the toast region last, only while it is present (phase 4 specification, 6.7)', () => {
		const present = ['titlebar', 'main', 'statusbar', 'toasts'] as const;
		expect(nextPart(present, 'statusbar', 'next')).toBe('toasts');
		expect(nextPart(present, 'toasts', 'next')).toBe('titlebar');
		expect(nextPart(present, 'titlebar', 'previous')).toBe('toasts');
		expect(nextPart(['titlebar', 'statusbar'], 'statusbar', 'next')).toBe('titlebar');
	});

	it('matches an app chord after the reserved band, and a digit by its physical key', () => {
		const bindings = [
			...SHELL_KEYBINDINGS_V0,
			{ chord: 'Mod+Shift+H', command: 'hello-greet' },
			{ chord: 'Mod+Shift+1', command: 'hello-list' },
			{ chord: 'Mod+K', command: 'hello-forget' },
		];
		expect(
			matchKeybinding(
				key({ key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true }),
				false,
				bindings
			)?.command
		).toBe('hello-greet');
		expect(
			matchKeybinding(
				key({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }),
				false,
				bindings
			)?.command
		).toBe('hello-list');
		// A reserved chord wins, and the kernel refuses a manifest's anyway.
		expect(
			matchKeybinding(key({ key: 'k', code: 'KeyK', ctrlKey: true }), false, bindings)?.command
		).toBe('palette-open');
	});

	it('detects the macOS platform', () => {
		expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
		expect(isMacPlatform({ platform: 'Linux x86_64', userAgent: 'X11' })).toBe(false);
		expect(isMacPlatform(undefined)).toBe(false);
	});
});

describe('matching a key on any layout (phase 4 specification, 8.2; #877)', () => {
	it('reads a Latin letter or digit by key, so a German layout keeps its Z and Y', () => {
		// QWERTZ: the key in QWERTY's Y place types "z".
		expect(keyOf({ key: 'z', code: 'KeyY' })).toBe('Z');
		expect(keyOf({ key: 'y', code: 'KeyZ' })).toBe('Y');
		const undo = [{ chord: 'Mod+Z', command: 'hello-undo' }];
		expect(
			matchKeybinding(key({ key: 'z', code: 'KeyY', ctrlKey: true }), false, undo)?.command
		).toBe('hello-undo');
		expect(
			matchKeybinding(key({ key: 'y', code: 'KeyZ', ctrlKey: true }), false, undo)
		).toBeUndefined();
	});

	it('reads anything else by code: a Cyrillic letter, an Alt letter on macOS, a shifted digit', () => {
		expect(keyOf({ key: 'л', code: 'KeyK' })).toBe('K');
		expect(keyOf({ key: '∫', code: 'KeyB' })).toBe('B');
		expect(keyOf({ key: '!', code: 'Digit1' })).toBe('1');
		expect(keyOf({ key: ',', code: 'Comma' })).toBe(',');
		expect(keyOf({ key: ' ', code: 'Space' })).toBe('Space');
		expect(keyOf({ key: 'F6', code: 'F6' })).toBe('F6');
		expect(keyOf({ key: 'ArrowUp', code: 'ArrowUp' })).toBe('ArrowUp');
		expect(keyOf({ key: 'Control', code: 'ControlLeft' })).toBeUndefined();
		expect(keyOf({ key: 'Dead', code: 'BracketLeft' })).toBeUndefined();
		expect(matchKeybinding(key({ key: 'л', code: 'KeyK', ctrlKey: true }), false)?.command).toBe(
			'palette-open'
		);
		expect(
			matchKeybinding(key({ key: 'з', code: 'KeyP', ctrlKey: true, altKey: true }), false)?.switcher
		).toBe(true);
	});

	it('holds Ctrl and Meta apart from Mod on each platform', () => {
		const ctrl = [{ chord: 'Ctrl+K', command: 'hello-ctrl' }];
		expect(matchKeybinding(key({ code: 'KeyK', ctrlKey: true }), true, ctrl)?.command).toBe(
			'hello-ctrl'
		);
		expect(matchKeybinding(key({ code: 'KeyK', ctrlKey: true }), false, ctrl)).toBeUndefined();
		const meta = [{ chord: 'Meta+K', command: 'hello-meta' }];
		expect(matchKeybinding(key({ code: 'KeyK', metaKey: true }), false, meta)?.command).toBe(
			'hello-meta'
		);
	});

	it('compares chords whatever order their modifiers are written in', () => {
		expect(sameChord('Mod+Shift+Alt+H', 'Mod+Alt+Shift+H')).toBe(true);
		expect(sameChord('Mod+Shift+H', 'Mod+H')).toBe(false);
	});
});

describe('sequences (8.1)', () => {
	const bindings = [
		{ chord: 'Mod+G P', command: 'hello-project' },
		{ chord: 'Mod+G L', command: 'hello-list' },
		{ chord: 'Mod+Shift+H', command: 'hello-greet' },
	];
	const g = key({ key: 'g', code: 'KeyG', ctrlKey: true });
	const p = key({ key: 'p', code: 'KeyP' });

	it('waits 1,500 ms after the first chord, then runs the sequence its second chord ends', () => {
		const first = pressKey(g, false, bindings, null, 1000);
		expect(first).toEqual({
			kind: 'wait',
			pending: { first: 'Mod+G', until: 1000 + SEQUENCE_WAIT_MS },
		});
		const pending = (first as { pending: PendingChord }).pending;
		expect(pressKey(p, false, bindings, pending, 2000)).toEqual({
			kind: 'run',
			binding: bindings[0],
		});
		expect(pressKey(key({ key: 'l', code: 'KeyL' }), false, bindings, pending, 2500)).toEqual({
			kind: 'run',
			binding: bindings[1],
		});
	});

	it('keeps waiting through a modifier alone, and forgets the first chord after the wait', () => {
		const pending = { first: 'Mod+G', until: 2500 };
		const control = key({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
		expect(pressKey(control, false, bindings, pending, 2000)).toEqual({ kind: 'wait', pending });
		expect(pressKey(p, false, bindings, pending, 2501)).toEqual({ kind: 'none' });
	});

	it('ends the wait on any other key, which is matched afresh', () => {
		const pending = { first: 'Mod+G', until: 2500 };
		const greet = key({ key: 'H', code: 'KeyH', ctrlKey: true, shiftKey: true });
		expect(pressKey(greet, false, bindings, pending, 2000)).toEqual({
			kind: 'run',
			binding: bindings[2],
		});
		expect(pressKey(key({ key: 'x', code: 'KeyX' }), false, bindings, pending, 2000)).toEqual({
			kind: 'none',
		});
	});

	it('lets the first binding by precedence decide a first chord: a single chord, or a wait', () => {
		const single = { chord: 'Mod+G', command: 'hello-go' };
		expect(pressKey(g, false, [single, ...bindings], null, 0)).toEqual({
			kind: 'run',
			binding: single,
		});
		expect(pressKey(g, false, [...bindings, single], null, 0).kind).toBe('wait');
	});
});

describe("when's focus terms (8.1, R4)", () => {
	it('holds editor, sidebar and main by where focus is, and leaves the kernel’s terms to it', () => {
		const inMain = { part: 'main', editor: false };
		expect(focusHolds(undefined, inMain)).toBe(true);
		expect(focusHolds('main', inMain)).toBe(true);
		expect(focusHolds('sidebar', inMain)).toBe(false);
		expect(focusHolds('editor', inMain)).toBe(false);
		expect(focusHolds('editor && main', { part: 'main', editor: true })).toBe(true);
		expect(
			focusHolds('project && documentType == notes-page', { part: undefined, editor: false })
		).toBe(true);
	});
});
