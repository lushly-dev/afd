/**
 * @fileoverview The reserved chords (phase 0 specification, section 7): matching a key event to
 * `SHELL_KEYBINDINGS_V0`, the `layout-set` input a toggle chord computes, and F6's part order.
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
}

interface ParsedChord {
	mod: boolean;
	alt: boolean;
	shift: boolean;
	key: string;
}

function parse(chord: string): ParsedChord {
	const parts = chord.split('+');
	const key = parts.at(-1) ?? '';
	return {
		mod: parts.includes('Mod'),
		alt: parts.includes('Alt'),
		shift: parts.includes('Shift'),
		key,
	};
}

/** Whether a key event is the chord. `Mod` is Command on macOS and Control elsewhere. */
export function chordMatches(chord: string, event: ChordEvent, mac: boolean): boolean {
	const parsed = parse(chord);
	const mod = mac ? event.metaKey : event.ctrlKey;
	const other = mac ? event.ctrlKey : event.metaKey;
	if (mod !== parsed.mod || other || event.altKey !== parsed.alt) return false;
	if (event.shiftKey !== parsed.shift) return false;
	// Letters match by physical key, because Alt changes `key` on macOS (Alt+B is "∫").
	if (/^[A-Z]$/.test(parsed.key)) return event.code === `Key${parsed.key}`;
	return event.key === parsed.key;
}

/** The reserved chord a key event presses, if any. */
export function matchKeybinding(
	event: ChordEvent,
	mac: boolean
): Readonly<ShellKeybindingV0> | undefined {
	return SHELL_KEYBINDINGS_V0.find((binding) => chordMatches(binding.chord, event, mac));
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
	| 'statusbar';

/** F6's order; the rail and the tab bar are never present together. */
export const PART_ORDER: readonly PartName[] = Object.freeze([
	'titlebar',
	'rail',
	'tabbar',
	'sidebar',
	'main',
	'inspector',
	'panel',
	'statusbar',
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

/** Whether the platform's `Mod` is Command. */
export function isMacPlatform(nav: { platform?: string; userAgent?: string } | undefined): boolean {
	const text = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
	return /Mac|iPhone|iPad|iPod/.test(text);
}
