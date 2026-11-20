/**
 * @fileoverview The settings section's editors' rules, with no DOM (phase 4 specification, 3.7 and 8.3): which editor
 * each of the shell's custom keys has, the chord a key press records, and what an override would do that the person
 * should hear first.
 */

// The `settings` chunk imports nothing of first paint (phase 3 specification, 13), so the matcher's three rules it
// needs are repeated here, and `editor-rules.test.ts` holds each equal to first paint's over a table.

/** How long a recorded Mod chord waits for a sequence's second key: `SEQUENCE_WAIT_MS` (8.1). */
export const SEQUENCE_WAIT = 1500;

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
const NAMED =
	/^(?:Enter|Escape|Tab|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/;

/** The key a chord names for a key event (8.2, #877): the matcher's `keyOf`. */
export function keyOf(event: Pick<KeyboardEvent, 'key' | 'code'>): string | undefined {
	if (/^[a-z0-9]$/i.test(event.key)) return event.key.toUpperCase();
	const letter = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
	if (letter) return letter[1] ?? letter[2];
	if (FUNCTION.test(event.code) || NAMED.test(event.code)) return event.code;
	if (CODE_NAMES[event.code] !== undefined) return CODE_NAMES[event.code];
	return event.code === '' && (FUNCTION.test(event.key) || NAMED.test(event.key))
		? event.key
		: undefined;
}

/** A chord's modifiers, in one order, and its key: what two chords written differently share when they are one. */
const canonical = (chord: string): string => {
	const parts = chord.split('+');
	const key = parts.at(-1) ?? '';
	return [...['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'].filter((m) => parts.includes(m)), key].join(
		'+'
	);
};

/** Whether two bindings' keys collide (8.1): the kernel's `keysCollide`. */
export function keysCollide(a: string, b: string): boolean {
	const x = a.split(' ').map(canonical);
	const y = b.split(' ').map(canonical);
	if (x.length !== y.length) return x[0] === y[0];
	return x.every((chord, index) => chord === y[index]);
}

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
 * What an override would do that the person should hear first (8.3, 15): shadow a shell chord, leave Mod+K unbound, or,
 * given the bindings, shadow another on colliding keys. Each is said, none hiding another (the re-check's 7). Of the
 * person's own, the earlier in the list `stored` would become wins: an edit keeps its place, an addition goes last.
 */
export function overrideWarning(
	override: OverrideV1,
	bindings: readonly ListedBindingV1[] = [],
	stored?: readonly OverrideV1[]
): string | undefined {
	const said: string[] = [];
	const chords = override.keys?.split(' ') ?? [];
	const kept = chords.find((chord) => SHELL_CHORDS.includes(chord));
	if (kept) said.push(`${kept} is the shell's own; this binding would shadow it.`);
	if (override.command === 'palette-open')
		said.push(
			override.keys === null
				? 'This unbinds Mod+K, which opens the command palette.'
				: 'Mod+K would no longer open the command palette.'
		);
	const keys = override.keys;
	if (keys !== null) {
		const same = (each: { command: string; target?: string }) =>
			each.command === override.command && (each.target ?? null) === (override.target ?? null);
		const nameOf = (each: { command: string; target?: string }) =>
			each.target ? `${each.command} (${each.target})` : each.command;
		const mine =
			stored ??
			bindings
				.filter((binding) => binding.source === 'you')
				.map(({ command, target, keys: bound }) => ({
					command,
					...(target ? { target } : {}),
					keys: bound,
				}));
		const proposed = withOverride(mine, override);
		const at = proposed.findIndex(same);
		const yours = proposed.findIndex(
			(each, index) => index !== at && each.keys !== null && keysCollide(each.keys, keys)
		);
		if (yours >= 0) {
			const other = proposed[yours] as OverrideV1;
			// The other is not in force now: its command cannot run from a chord, as `keybinding-list` says.
			const idle = bindings.some(
				(binding) =>
					binding.source === 'you' &&
					binding.command === other.command &&
					(binding.target ?? null) === (other.target ?? null) &&
					!binding.active
			);
			const note = idle ? ', not in force now' : '';
			said.push(
				yours < at
					? `${other.keys} is already yours, for ${nameOf(other)}${note}, which would win: this binding would be shadowed.`
					: `${other.keys} is yours too, for ${nameOf(other)}${note}; this binding comes first and would shadow it.`
			);
		} else if (!kept) {
			const hit = bindings.find(
				(binding) => binding.source !== 'you' && !same(binding) && keysCollide(binding.keys, keys)
			);
			if (hit)
				said.push(
					`${hit.keys} runs ${nameOf(hit)}, the ${hit.source === 'app' ? "app's" : "shell's"}; this binding would shadow it.`
				);
		}
	}
	return said.length > 0 ? said.join(' ') : undefined;
}

/** A chord's modifiers, in this order, each once: the kernel's `isChord`. */
const MODIFIERS = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'];
const CHORD_KEY =
	/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Enter|Escape|Tab|Space|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|[,./;=-])$/;
const isChord = (chord: string): boolean => {
	const parts = chord.split('+');
	const key = parts.pop() as string;
	let at = -1;
	for (const modifier of parts) {
		const index = MODIFIERS.indexOf(modifier);
		if (index <= at) return false;
		at = index;
	}
	return CHORD_KEY.test(key);
};
const COMMAND = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** How many overrides a person keeps (3.7). */
const MOST_OVERRIDES = 64;

/**
 * Why the kernel would refuse a whole list of overrides, in words, or undefined: the kernel's `overridesProblem`,
 * repeated so the editor refuses before Add what the write would (the reviews' 8); a unit holds the two equal.
 */
export function overridesRefused(list: readonly OverrideV1[]): string | undefined {
	if (list.length > MOST_OVERRIDES)
		return `You keep at most ${MOST_OVERRIDES} overrides: remove one first.`;
	const seen = new Set<string>();
	for (const { command, target, keys } of list) {
		if (typeof command !== 'string' || command.length > 128 || !COMMAND.test(command))
			return `'${command}' is not a command's name, such as palette-open.`;
		if (target !== undefined && (target.length < 1 || target.length > 128))
			return 'A target is 1 to 128 characters, or none.';
		if (
			target !== undefined &&
			command !== 'section-open' &&
			!(command === 'layout-set' && ['sidebar', 'inspector', 'panel'].includes(target))
		)
			return 'Give a target only to section-open, a section, or layout-set, sidebar, inspector or panel.';
		if (keys !== null) {
			const chords = keys.split(' ');
			if (chords.length > 2 || !chords.every(isChord))
				return `${keys} is not one chord or two, such as Mod+Shift+H.`;
			const refused = keysRefused(keys);
			if (refused) return refused;
			const [first, second] = chords as [string, string | undefined];
			const modifiers = first.split('+').slice(0, -1);
			if (
				second === undefined &&
				!/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(first.split('+').pop() as string) &&
				!modifiers.some((modifier) => ['Mod', 'Ctrl', 'Meta'].includes(modifier))
			)
				return `${first} alone is pressed by typing: bind a chord with Mod, or a function key.`;
		}
		const refused = overrideRefused({ command, keys: null });
		if (refused) return refused;
		const binding = JSON.stringify([command, target ?? null]);
		if (seen.has(binding)) return `${command} is overridden twice.`;
		seen.add(binding);
	}
	return undefined;
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
