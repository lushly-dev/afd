/**
 * @fileoverview The settings section's editors' rules, with no DOM (phase 4 specification, 3.7 and 8.3): which editor
 * each of the shell's custom keys has, the chord a key press records, and what an override would do that the person
 * should hear first.
 */

import { keysCollide } from '@lushly-dev/loam-kernel';
import { keyOf } from '../keyboard.js';

/** A person's override of a binding (8.3): `keys` null unbinds it. */
export interface OverrideV1 {
	command: string;
	target?: string;
	keys: string | null;
}

/**
 * The chords the shell keeps (phase 0's seven and 8.4's Mod+Alt+P, `SHELL_KEYBINDINGS_V0`, held equal by a unit), and Escape: an override
 * on one shadows it, and F6, Shift+F6 and Escape no override may take (8.3, `KEYBINDING_RESERVED`).
 */
export const SHELL_CHORDS: readonly string[] = [
	'Mod+K',
	'Mod+B',
	'Mod+Alt+B',
	'Mod+J',
	'F6',
	'Shift+F6',
	'Mod+S',
	'Mod+Alt+P',
];
export const NEVER_BOUND: readonly string[] = ['F6', 'Shift+F6', 'Escape'];

/**
 * The chord a key press makes, or undefined for a modifier alone (8.2's rule, the matcher's `keyOf`: a Latin letter or
 * digit by `key`, else `code`): modifiers in the order `Mod`, `Ctrl`, `Alt`, `Shift`, `Meta`, then the key. `Mod` is
 * Command on macOS.
 */
export function chordOf(
	event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
	mac: boolean
): string | undefined {
	const key = keyOf(event);
	if (key === undefined) return undefined;
	const parts = [
		...((mac ? event.metaKey : event.ctrlKey) ? ['Mod'] : []),
		...(mac && event.ctrlKey ? ['Ctrl'] : []),
		...(event.altKey ? ['Alt'] : []),
		...(event.shiftKey ? ['Shift'] : []),
		...(!mac && event.metaKey ? ['Meta'] : []),
	];
	return [...parts, key].join('+');
}

/** A binding as `keybinding-list { all: true }` gives it (8.5), as much as the editor reads. */
export interface ListedBindingV1 {
	keys: string;
	command: string;
	target?: string;
	source: 'shell' | 'app' | 'you';
	active: boolean;
}

/** The reserved chords' actions an override never names (8.3): F6's and Shift+F6's. */
const NEVER_REBOUND: Readonly<Record<string, string>> = {
	'shell-focus-next': 'F6',
	'shell-focus-previous': 'Shift+F6',
};

/**
 * Why an override could not be added at all, or undefined: F6 and Shift+F6 are neither rebound nor unbound, F6,
 * Shift+F6 and Escape never bound, and a sequence begins on a Mod chord that is not reserved (8.1, 8.3).
 */
export function overrideRefused(override: OverrideV1): string | undefined {
	const kept = NEVER_REBOUND[override.command];
	if (kept) return `${kept} moves focus between the parts: it is never rebound or unbound.`;
	return keysRefused(override.keys);
}

/** Why the keys could not be added at all, or undefined: never F6, Shift+F6 or Escape; a sequence's first chord (8.1). */
export function keysRefused(keys: string | null): string | undefined {
	if (keys === null) return undefined;
	const chords = keys.split(' ');
	const never = chords.find((chord) => NEVER_BOUND.includes(chord));
	if (never) return `${never} cannot be bound: bind another key.`;
	const [first, second] = chords as [string, string | undefined];
	if (second === undefined) return undefined;
	if (SHELL_CHORDS.includes(first))
		return `A sequence cannot begin on ${first}, which the shell keeps: begin it on another chord.`;
	if (!first.split('+').includes('Mod'))
		return 'A sequence begins on a Mod chord, such as Mod+G P.';
	return undefined;
}

/**
 * What an override would do that the person should hear first (8.3, 15): shadow a shell chord, leave Mod+K unbound,
 * or, given the bindings, shadow another binding on colliding keys.
 */
export function overrideWarning(
	override: OverrideV1,
	bindings: readonly ListedBindingV1[] = []
): string | undefined {
	const chords = override.keys?.split(' ') ?? [];
	const kept = chords.find((chord) => SHELL_CHORDS.includes(chord));
	if (kept) return `${kept} is the shell's own; this binding would shadow it.`;
	if (override.command === 'palette-open')
		return override.keys === null
			? 'This unbinds Mod+K, which opens the command palette.'
			: 'Mod+K would no longer open the command palette.';
	if (override.keys === null) return undefined;
	const keys = override.keys;
	const hit = bindings.find(
		(binding) =>
			binding.source !== 'you' &&
			!(binding.command === override.command && binding.target === override.target) &&
			keysCollide(binding.keys, keys)
	);
	if (!hit) return undefined;
	const what = hit.target ? `${hit.command} (${hit.target})` : hit.command;
	return `${hit.keys} runs ${what}, the ${hit.source === 'app' ? "app's" : "shell's"}; this binding would shadow it.`;
}

/** The editor of each of the shell's custom keys (3.7), by `<section>.<key>`. */
export const CUSTOM_EDITORS: Readonly<Record<string, string>> = {
	'loam.rail.order': 'loam-rail-order-editor',
	'loam.notifications.muted': 'loam-instance-picker',
	'loam.keybindings.overrides': 'loam-keybinding-editor',
};

/**
 * A rail order after a move among the apps shown (R8; the review's 3): the shown apps in their new order, then every
 * stored id that is not shown (an app disabled, failed or set by a command), in the order stored, so none is lost.
 */
export function reorder(stored: readonly string[], shown: readonly string[]): string[] {
	const visible = new Set(shown);
	return [...shown, ...stored.filter((id) => !visible.has(id))];
}

/** A muted list with `instance` on or off, every other stored id kept where it was (the review's 3). */
export function toggled(stored: readonly string[], instance: string, on: boolean): string[] {
	const kept = stored.filter((id) => id !== instance);
	return on ? [...kept, instance] : kept;
}

/** The overrides with `next` in place of the one for the same command and target only (8.3; the review's 3). */
export function withOverride(stored: readonly OverrideV1[], next: OverrideV1): OverrideV1[] {
	const same = (each: OverrideV1) =>
		each.command === next.command && (each.target ?? null) === (next.target ?? null);
	const at = stored.findIndex(same);
	return at < 0 ? [...stored, next] : stored.map((each, index) => (index === at ? next : each));
}
