/**
 * @fileoverview The reserved chords (phase 0 specification, section 7; phase 4's 8.4 adds Mod+Alt+P) and the keybindings registry
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
	/**
	 * Mod+S: the active editor's `save()`. The shell has no save command, so this is a binding of its own,
	 * which the editor area answers only while an editor is the active owner (documents specification, 5.5).
	 */
	save?: true;
	/**
	 * Mod+Alt+P (phase 4 specification, 8.4; #857): the project switcher's list, opened as its button's press. Like
	 * F6's focus, it is the chrome's, with no command.
	 */
	switcher?: true;
}

const BINDINGS: ShellKeybindingV0[] = [
	{ chord: 'Mod+K', command: 'palette-open' },
	{ chord: 'Mod+B', command: 'layout-set', toggle: 'sidebar' },
	{ chord: 'Mod+Alt+B', command: 'layout-set', toggle: 'inspector' },
	{ chord: 'Mod+J', command: 'layout-set', toggle: 'panel' },
	{ chord: 'F6', command: null, focus: 'next' },
	{ chord: 'Shift+F6', command: null, focus: 'previous' },
	{ chord: 'Mod+S', command: null, save: true },
	{ chord: 'Mod+Alt+P', command: null, switcher: true },
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

/** One chord an app holds: the manifest's binding, once load admitted it; `chord` is one chord or a sequence of two. */
export interface AppKeybinding {
	chord: string;
	command: string;
	instance: string;
	/** 8.1's closed `when`, as the manifest gave it. */
	when?: string;
}

/** A binding as 8.1 names it, and as `keybinding-list` returns it. */
export interface KeybindingV1 {
	/** One chord, or two separated by a space: `Mod+G P`. */
	keys: string;
	command: string;
	/** For `section-open`, the section; for `layout-set`, the part a toggle chord toggles (R2). */
	target?: string;
	/** `editor`, `sidebar`, `main`, `project`, `!project`, `documentType == <type>`, joined by ` && `. */
	when?: string;
}

/** One row of `keybinding-list` (8.5). */
export interface KeybindingEntryV1 extends KeybindingV1 {
	source: 'shell' | 'app' | 'you';
	/** The instance whose command it runs, for an app's binding or an override of one. */
	app?: string;
	/** What it shadows: lower bindings on colliding keys, and the bindings an override replaces. */
	shadowed?: Array<{ source: 'shell' | 'app' | 'you'; command: string }>;
	/** In force now, with the `when` terms the kernel decides holding; focus terms count as holding (R4). */
	active: boolean;
}

/** A person's override (8.3): `keys` null unbinds every binding of the command and target. */
export interface KeybindingOverrideV1 {
	command: string;
	target?: string;
	keys: string | null;
}

/** A binding in force, as the chrome matches it: the reserved shape, with an override's target and an app's `when`. */
export type KeybindingInForceV1 = ShellKeybindingV0 & { target?: string; when?: string };

/**
 * The names `keybinding-list` and overrides give the reserved chords that run no command (R1): in the shell's domain,
 * which no app may declare, and refused when called (`KEYBINDING_ACTION_ONLY`), until they are real commands.
 */
export const SHELL_KEY_ACTIONS: readonly string[] = Object.freeze([
	'shell-focus-next',
	'shell-focus-previous',
	'shell-save',
	'shell-project-switcher',
]);

/** What the kernel knows that a `when` reads (R4): the active app, the active tab's owner and type, the project. */
export interface KeybindingContextV1 {
	active: string | null;
	/** The active tab's owner and its document's type, while the editor area shows it. */
	editor?: { owner: string; type: string } | null;
	/** Whether a project is in the active scope. */
	project: boolean;
}

/** Whether a command an override names runs from a chord: registered and needing no input, or given its target. */
export type KeybindingRunnable = (command: string, target: string | undefined) => boolean;

export interface ResolvedKeybindingsV1 {
	/** In force, first to last by precedence, the kernel's `when` terms holding: what the chrome matches. */
	force: KeybindingInForceV1[];
	/** Every binding, by precedence, with whether it is in force (not replaced, idle, shadowed or of an inactive app). */
	entries: Array<KeybindingEntryV1 & { inForce: boolean }>;
}

/**
 * The resolver `late-settings` gives the registry (phase 4 specification, 8.1): `late/keybinding-resolve.ts`, out of
 * first paint, since only the late load reads a person's overrides.
 */
export interface KeybindingResolverV1 {
	resolve(
		shell: readonly Readonly<ShellKeybindingV0>[],
		apps: readonly AppKeybinding[],
		overrides: readonly KeybindingOverrideV1[],
		context: KeybindingContextV1,
		runnable: KeybindingRunnable,
		everyApp?: boolean
	): ResolvedKeybindingsV1;
	collide(a: string, b: string): boolean;
}

/** Why a `when` is not 8.1's closed form: the manifest's rule, which `MANIFEST_KEYBINDING_WHEN` gives. */
export { keybindingWhenProblem as whenProblem } from '@lushly-dev/loam-manifest';

export interface KeybindingRegistry {
	/** The bindings in force now, first to last by precedence (8.1), as the chrome matches them. */
	list(active: string | null): KeybindingInForceV1[];
	/** The keys that run `command`, as `listCommands` reports them: the person's own, else its binding's. */
	keybindingFor(command: string): string | undefined;
	/** Every binding resolved for `context`, for `keybinding-list` (8.5); none before the resolver is given. */
	resolve(context: KeybindingContextV1): ResolvedKeybindingsV1;
	/** What the kernel knows now that a `when` reads, for the active app. */
	context(active: string | null): KeybindingContextV1;
	/** Whether two keys collide: the resolver's rule, else only the same keys (8.1). */
	collide(a: string, b: string): boolean;
	/** The resolver, once `late-settings` has loaded. */
	setResolver(resolver: KeybindingResolverV1): void;
	/** The apps' bindings, once stage B has loaded them. */
	setApps(apps: readonly AppKeybinding[]): void;
	/** The person's overrides, which `late-settings` reads at its load, after each write and on a change of person. */
	setOverrides(overrides: readonly KeybindingOverrideV1[]): void;
	/** The active tab's owner and document type, after a call that may have moved them. */
	setEditor(editor: { owner: string; type: string } | null): void;
}

export interface KeybindingRegistryOptions {
	runnable?: KeybindingRunnable;
	/** Whether a project is in the active scope now. */
	project?: () => boolean;
}

/**
 * The registry (phase 1 specification, 4.2; phase 4 specification, 8.1). Until `late-settings` gives the resolver, the
 * reserved chords and the active app's bindings with no `when`, as phase 1 had them; then 8.1's precedence.
 */
export function createKeybindings(
	shell: readonly Readonly<ShellKeybindingV0>[],
	apps: readonly AppKeybinding[],
	options: KeybindingRegistryOptions = {}
): KeybindingRegistry {
	let held = [...apps];
	let overrides: KeybindingOverrideV1[] = [];
	let editor: { owner: string; type: string } | null = null;
	let resolver: KeybindingResolverV1 | undefined;
	let shown: Map<string, string> | undefined;
	const runnable = options.runnable ?? (() => false);
	const context = (active: string | null): KeybindingContextV1 => ({
		active,
		editor,
		project: options.project?.() ?? false,
	});
	return {
		list(active) {
			if (resolver)
				return resolver.resolve(shell, held, overrides, context(active), runnable).force;
			const band = held
				.filter((binding) => binding.instance === active && binding.when === undefined)
				.map(({ chord, command }) => ({ chord, command }));
			return [...shell.map((binding) => ({ ...binding })), ...band];
		},
		keybindingFor(command) {
			if (!resolver)
				return keybindingFor(command) ?? held.find((binding) => binding.command === command)?.chord;
			if (!shown) {
				const map = new Map<string, string>();
				const all = resolver.resolve(shell, held, overrides, context(null), runnable, true);
				for (const entry of all.entries) {
					if (entry.inForce && entry.target === undefined && !map.has(entry.command))
						map.set(entry.command, entry.keys);
				}
				shown = map;
			}
			return shown.get(command);
		},
		resolve: (at) =>
			resolver?.resolve(shell, held, overrides, at, runnable) ?? { force: [], entries: [] },
		context,
		collide: (a, b) => resolver?.collide(a, b) ?? a === b,
		setResolver(next) {
			resolver = next;
			shown = undefined;
		},
		setApps(next) {
			held = [...next];
			shown = undefined;
		},
		setOverrides(next) {
			overrides = next.map((each) => ({ ...each }));
			shown = undefined;
		},
		setEditor(next) {
			editor = next ? { ...next } : null;
		},
	};
}

/**
 * Whether a command's JSON Schema needs input, by its shape: the manifest's predicate, which its rules also
 * use, so the palette, a chord and New agree (phase 1 specification, 4.2; documents specification, 2.1).
 */
export { needsInputShape as needsInput } from '@lushly-dev/loam-manifest';
