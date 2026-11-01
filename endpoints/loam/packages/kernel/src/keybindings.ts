/**
 * @fileoverview The chrome's reserved chords (phase 0 specification, section 7). A keybindings
 * registry arrives with the keybindings surface in phase 1.
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
