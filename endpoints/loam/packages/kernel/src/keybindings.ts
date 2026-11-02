/**
 * @fileoverview The reserved chords (phase 0 specification, section 7) and the keybindings registry
 * (phase 1 specification, 4.2), with the active app's bindings as its second band.
 */

/** One reserved chord. `Mod` is Command on macOS and Control elsewhere. */
export interface ShellKeybindingV0 {
	chord: string;
	/** The command the chord calls; `null` for focus movement, which is not state. */
	command: string | null;
	/**
	 * For `layout-set` chords, the part whose open state the chord toggles. In the compact class
	 * the sidebar and inspector chords toggle `compact.drawer` and the panel chord `compact.sheet`.
	 */
	toggle?: 'sidebar' | 'inspector' | 'panel';
	/** For `F6` and `Shift+F6`, the direction focus moves between present parts. */
	focus?: 'next' | 'previous';
}

const BINDINGS: ShellKeybindingV0[] = [
	{ chord: 'Mod+K', command: 'palette-open' },
	{ chord: 'Mod+B', command: 'layout-set', toggle: 'sidebar' },
	{ chord: 'Mod+Alt+B', command: 'layout-set', toggle: 'inspector' },
	{ chord: 'Mod+J', command: 'layout-set', toggle: 'panel' },
	{ chord: 'F6', command: null, focus: 'next' },
	{ chord: 'Shift+F6', command: null, focus: 'previous' },
];

/** The reserved chords, frozen with every entry. */
export const SHELL_KEYBINDINGS_V0: readonly Readonly<ShellKeybindingV0>[] = Object.freeze(
	BINDINGS.map((binding) => Object.freeze(binding))
);

/**
 * The chord that runs `command` as the palette lists it, with no input of its own. A toggle
 * chord computes its input, so it is not the command's keybinding.
 */
export function keybindingFor(command: string): string | undefined {
	return SHELL_KEYBINDINGS_V0.find(
		(binding) => binding.command === command && binding.toggle === undefined
	)?.chord;
}

/** One chord an app holds: the manifest's binding, once load admitted it. */
export interface AppKeybinding {
	chord: string;
	command: string;
	instance: string;
}

export interface KeybindingRegistry {
	/** The reserved chords, then `active`'s bindings. */
	list(active: string | null): ShellKeybindingV0[];
	/** The chord that runs `command`, as `listCommands` reports it. */
	keybindingFor(command: string): string | undefined;
}

export function createKeybindings(
	shell: readonly Readonly<ShellKeybindingV0>[],
	apps: readonly AppKeybinding[]
): KeybindingRegistry {
	return {
		list(active) {
			const band = apps
				.filter((binding) => binding.instance === active)
				.map(({ chord, command }) => ({ chord, command }));
			return [...shell.map((binding) => ({ ...binding })), ...band];
		},
		keybindingFor(command) {
			return keybindingFor(command) ?? apps.find((binding) => binding.command === command)?.chord;
		},
	};
}

/**
 * Whether a command's JSON Schema needs input: it has a required property, or every branch of a
 * union does. A chord runs only a command that does not (4.2).
 */
export function needsInput(schema: unknown): boolean {
	if (typeof schema !== 'object' || schema === null) return false;
	const record = schema as { required?: unknown; anyOf?: unknown; oneOf?: unknown };
	if (Array.isArray(record.required) && record.required.length > 0) return true;
	const branches = Array.isArray(record.anyOf)
		? record.anyOf
		: Array.isArray(record.oneOf)
			? record.oneOf
			: undefined;
	return branches !== undefined && branches.length > 0 && branches.every(needsInput);
}
