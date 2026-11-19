/**
 * @fileoverview The settings section's editors' rules, with no DOM (phase 4 specification, 3.7 and 8.3): which editor
 * each of the shell's custom keys has, the chord a key press records, and what an override would do that the person
 * should hear first.
 */

/** A person's override of a binding (8.3): `keys` null unbinds it. */
export interface OverrideV1 {
	command: string;
	target?: string;
	keys: string | null;
}

/**
 * The chords the shell keeps (phase 0's seven, `SHELL_KEYBINDINGS_V0`, held equal by a unit), and Escape: an override
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
];
export const NEVER_BOUND: readonly string[] = ['F6', 'Shift+F6', 'Escape'];

const NAMED = new Set([
	'Enter',
	'Escape',
	'Tab',
	'Backspace',
	'Delete',
	'Home',
	'End',
	'PageUp',
	'PageDown',
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
]);

/**
 * The chord a key press makes, or undefined for a modifier alone (8.2's rule: a Latin letter or digit by `key`, else
 * `code`): modifiers in the order `Mod`, `Ctrl`, `Alt`, `Shift`, `Meta`, then the key. `Mod` is Command on macOS.
 */
export function chordOf(
	event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
	mac: boolean
): string | undefined {
	let key: string | undefined;
	if (/^[a-z0-9]$/i.test(event.key)) key = event.key.toUpperCase();
	else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
	else if (/^(Key[A-Z]|Digit[0-9])$/.test(event.code)) key = event.code.slice(-1);
	else if (event.key === ' ') key = 'Space';
	else if (NAMED.has(event.key)) key = event.key;
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

/** What an override would do that the person should hear first (8.3): shadow a shell chord, or leave Mod+K unbound. */
export function overrideWarning(override: OverrideV1): string | undefined {
	const chords = override.keys?.split(' ') ?? [];
	const kept = chords.find((chord) => SHELL_CHORDS.includes(chord));
	if (kept) return `${kept} is the shell's own; this binding would shadow it.`;
	if (override.command === 'palette-open')
		return override.keys === null
			? 'This unbinds Mod+K, which opens the command palette.'
			: 'Mod+K would no longer open the command palette.';
	return undefined;
}

/** The editor of each of the shell's custom keys (3.7), by `<section>.<key>`. */
export const CUSTOM_EDITORS: Readonly<Record<string, string>> = {
	'loam.rail.order': 'loam-rail-order-editor',
	'loam.notifications.muted': 'loam-instance-picker',
	'loam.keybindings.overrides': 'loam-keybinding-editor',
};
