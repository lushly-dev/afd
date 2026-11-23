/**
 * @fileoverview The key matcher (phase 0 specification, section 7; phase 4 specification, 8.1 and 8.2): a key event
 * matched to the bindings in force on any layout, a sequence's wait, `when`'s focus terms, the `layout-set` input a
 * toggle chord computes, and F6's part order.
 */

import {
	type LayoutPatchV0,
	type LayoutStateV0,
	SHELL_KEYBINDINGS_V0,
	type ShellKeybindingV0,
} from '@lushly-dev/loam-kernel';
import type { LayoutClass } from './layout-class.js';

export interface ChordEvent {
	key: string;
	code: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	/** A held key's repeat (8.1): it keeps a sequence's wait, and never ends or completes it. */
	repeat?: boolean;
	/** AltGr's state, which Windows also reports as Ctrl and Alt (the re-check's 9). */
	getModifierState?(state: string): boolean;
}

/** A chord's modifiers and key, whatever order the modifiers are written in. */
function parseChord(chord: string) {
	const parts = chord.split('+');
	return {
		mod: parts.includes('Mod'),
		ctrl: parts.includes('Ctrl'),
		alt: parts.includes('Alt'),
		shift: parts.includes('Shift'),
		meta: parts.includes('Meta'),
		key: parts.at(-1) ?? '',
	};
}

/** Whether two chords are one, whatever order their modifiers are written in (`Mod+Shift+Alt+H`, `Mod+Alt+Shift+H`). */
export function sameChord(a: string, b: string): boolean {
	const x = parseChord(a);
	const y = parseChord(b);
	return (
		x.key === y.key &&
		x.mod === y.mod &&
		x.ctrl === y.ctrl &&
		x.alt === y.alt &&
		x.shift === y.shift &&
		x.meta === y.meta
	);
}

/** The keys named by `event.code` that a chord writes otherwise (phase 4 specification, 8.2). */
const CODE_NAMES: Readonly<Record<string, string>> = {
	Space: 'Space',
	Comma: ',',
	Period: '.',
	Slash: '/',
	Semicolon: ';',
	Equal: '=',
	Minus: '-',
};
const FUNCTION = /^F(?:[1-9]|1[0-9]|2[0-4])$/;
/** The keys that only modify another, which a sequence's wait lets pass (8.1). */
const MODIFIER = /^(?:Control|Shift|Alt|AltGraph|Meta|OS|Super|Hyper|Fn|CapsLock)$/;
const NAMED =
	/^(?:Enter|Escape|Tab|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/;

/**
 * The key a chord names for a key event (phase 4 specification, 8.2; #877): `event.key` when it is a single Latin
 * letter or digit, so a German layout's Z is its Z; otherwise `event.code`, so a Cyrillic layout's letter, macOS's
 * Alt+B ("∫") and a shifted digit are their physical key. Function keys by `code`. Undefined for a modifier alone.
 */
export function keyOf(event: Pick<ChordEvent, 'key' | 'code'>): string | undefined {
	if (/^[a-z0-9]$/i.test(event.key)) return event.key.toUpperCase();
	const code = event.code;
	const letter = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code);
	if (letter) return letter[1] ?? letter[2];
	if (FUNCTION.test(code) || NAMED.test(code)) return code;
	if (CODE_NAMES[code] !== undefined) return CODE_NAMES[code];
	// An event with no `code`, a synthetic one, is read by its `key` for a function or named key.
	return code === '' && (FUNCTION.test(event.key) || NAMED.test(event.key)) ? event.key : undefined;
}

/** Whether a key event is the chord. `Mod` is Command on macOS and Control elsewhere. */
export function chordMatches(chord: string, event: ChordEvent, mac: boolean): boolean {
	const parsed = parseChord(chord);
	const mod = mac ? event.metaKey : event.ctrlKey;
	const ctrl = mac ? event.ctrlKey : false;
	const meta = mac ? false : event.metaKey;
	if (mod !== parsed.mod || ctrl !== parsed.ctrl || meta !== parsed.meta) return false;
	if (event.altKey !== parsed.alt || event.shiftKey !== parsed.shift) return false;
	return keyOf(event) === parsed.key;
}

/** One chord or a sequence of two (8.1), as a binding's `chord` names it: `Mod+G P`. */
export function chordsOf(keys: string): string[] {
	return keys.split(' ');
}

/** The chord a key press makes, if any: of the reserved band, then `kernel.listKeybindings()`'s. */
export function matchKeybinding(
	event: ChordEvent,
	mac: boolean,
	bindings: readonly Readonly<ShellKeybindingV0>[] = SHELL_KEYBINDINGS_V0
): Readonly<ShellKeybindingV0> | undefined {
	return bindings.find(
		(binding) => !binding.chord.includes(' ') && chordMatches(binding.chord, event, mac)
	);
}

/** How long a sequence waits for its second chord (8.1). */
export const SEQUENCE_WAIT_MS = 1500;

/** A sequence's first chord, pressed, waiting for its second until `until`. */
export interface PendingChord {
	first: string;
	until: number;
}

/** What a key press does: run a binding, start a sequence's wait, or nothing of the keybindings'. */
export type KeyPress<T> =
	| { kind: 'run'; binding: T }
	| { kind: 'wait'; pending: PendingChord }
	| { kind: 'none' };

/**
 * A key press against the bindings in force, first to last by precedence (8.1). While a sequence waits, a modifier
 * alone keeps it waiting; the second chord of a sequence that began with `pending.first` runs it; any other key ends
 * the wait and is matched afresh. Afresh, the first binding whose first chord the press makes decides: one chord runs,
 * a sequence waits for its second, so a sequence and a single chord on its first key never both apply.
 */
export function pressKey<T extends { chord: string }>(
	event: ChordEvent,
	mac: boolean,
	bindings: readonly T[],
	pending: PendingChord | null,
	now: number
): KeyPress<T> {
	const waiting = pending !== null && now <= pending.until;
	// A held key's repeat keeps the wait, with its own deadline, and is never a second chord (the re-check's 4).
	if (waiting && event.repeat) return { kind: 'wait', pending };
	// A modifier alone keeps a sequence waiting; any other key no chord names ends the wait, left to the page.
	if (keyOf(event) === undefined)
		return waiting && MODIFIER.test(event.key) ? { kind: 'wait', pending } : { kind: 'none' };
	// A printable character AltGr makes is typing, though Windows reports AltGr as Ctrl and Alt (the re-check's 9).
	if (event.getModifierState?.('AltGraph') && [...event.key].length === 1) return { kind: 'none' };
	if (pending && waiting) {
		const second = bindings.find((binding) => {
			const [first, then] = chordsOf(binding.chord);
			return (
				then !== undefined &&
				sameChord(first as string, pending.first) &&
				chordMatches(then, event, mac)
			);
		});
		if (second) return { kind: 'run', binding: second };
	}
	const hit = bindings.find((binding) =>
		chordMatches(chordsOf(binding.chord)[0] as string, event, mac)
	);
	if (!hit) return { kind: 'none' };
	const [first, then] = chordsOf(hit.chord);
	if (then === undefined) return { kind: 'run', binding: hit };
	// A repeat starts no wait, past a deadline too: only a fresh press does (the third round's E).
	if (event.repeat) return { kind: 'none' };
	return { kind: 'wait', pending: { first: first as string, until: now + SEQUENCE_WAIT_MS } };
}

/**
 * Whether a binding's `when` holds for focus (phase 4 specification, 8.1; R4): `editor` while focus is in an editor,
 * `sidebar` and `main` while it is in that part. The kernel decided `project` and `documentType` before listing it.
 */
export function focusHolds(
	when: string | undefined,
	focus: { part: string | undefined; editor: boolean }
): boolean {
	if (when === undefined) return true;
	return when.split(' && ').every((term) => {
		if (term === 'editor') return focus.editor;
		if (term === 'sidebar' || term === 'main') return focus.part === term;
		return true;
	});
}

/**
 * The `layout-set` input of a toggle chord. In the compact class the sidebar and inspector chords
 * toggle `compact.drawer` and the panel chord `compact.sheet`.
 */
export function toggleInput(
	toggle: NonNullable<ShellKeybindingV0['toggle']>,
	layout: LayoutStateV0,
	layoutClass: LayoutClass
): LayoutPatchV0 {
	if (layoutClass === 'compact') {
		if (toggle === 'panel') return { compact: { sheet: !layout.compact.sheet } };
		return { compact: { drawer: layout.compact.drawer === toggle ? null : toggle } };
	}
	if (toggle === 'panel') return { panel: { open: !layout.panel.open } };
	return { [toggle]: { open: !layout[toggle].open } };
}

export type PartName =
	| 'titlebar'
	| 'rail'
	| 'tabbar'
	| 'sidebar'
	| 'main'
	| 'inspector'
	| 'panel'
	| 'statusbar'
	| 'toasts';

/**
 * F6's order; the rail and the tab bar are never present together. The toast region is a stop, last, only while it
 * holds a toast (phase 4 specification, 6.7).
 */
export const PART_ORDER: readonly PartName[] = Object.freeze([
	'titlebar',
	'rail',
	'tabbar',
	'sidebar',
	'main',
	'inspector',
	'panel',
	'statusbar',
	'toasts',
]);

/**
 * The part F6 (`next`) or Shift+F6 (`previous`) moves focus to, among the present parts, from the
 * part holding focus (or none).
 */
export function nextPart(
	present: readonly PartName[],
	current: PartName | undefined,
	direction: 'next' | 'previous'
): PartName | undefined {
	const order = PART_ORDER.filter((part) => present.includes(part));
	if (order.length === 0) return undefined;
	const index = current === undefined ? -1 : order.indexOf(current);
	if (index < 0) return direction === 'next' ? order[0] : order.at(-1);
	const step = direction === 'next' ? 1 : -1;
	return order[(index + step + order.length) % order.length];
}

/**
 * Whether the platform's `Mod` is Command. Prefer `navigator.platform` when present, because
 * non-macOS WebKit builds (Playwright on Windows/Linux) spoof `Macintosh` in `userAgent` while
 * keeping `platform` truthful (`Win32`, `Linux x86_64`).
 */
export function isMacPlatform(nav: { platform?: string; userAgent?: string } | undefined): boolean {
	const platform = nav?.platform?.trim();
	const text = platform || (nav?.userAgent ?? '');
	return /Mac|iPhone|iPad|iPod/.test(text);
}
