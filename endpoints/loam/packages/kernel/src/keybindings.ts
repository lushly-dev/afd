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

/** The command and target 8.5 lists a reserved chord under: its command, else its action's name (R1, R2). */
function shellIdentity(binding: Readonly<ShellKeybindingV0>): { command: string; target?: string } {
	if (binding.toggle) return { command: binding.command as string, target: binding.toggle };
	if (binding.command) return { command: binding.command };
	if (binding.focus) return { command: `shell-focus-${binding.focus}` };
	return { command: binding.save ? 'shell-save' : 'shell-project-switcher' };
}

interface ParsedChord {
	mod: boolean;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
	key: string;
}

/** A chord's modifiers and key, whatever order the modifiers are written in. */
export function parseChord(chord: string): ParsedChord {
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

/** Whether two chords are one (`Mod+Shift+Alt+H` is `Mod+Alt+Shift+H`). */
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

/**
 * Whether two bindings' keys collide: the same keys, or a single chord and a sequence that begins on it, so that one
 * could never be pressed while the other is in force.
 */
export function keysCollide(a: string, b: string): boolean {
	const x = a.split(' ');
	const y = b.split(' ');
	if (x.length !== y.length) return sameChord(x[0] as string, y[0] as string);
	return x.every((chord, index) => sameChord(chord, y[index] as string));
}

/** Why a `when` is not 8.1's closed form: the manifest's rule, which `MANIFEST_KEYBINDING_WHEN` gives. */
export { keybindingWhenProblem as whenProblem } from '@lushly-dev/loam-manifest';

/** What the kernel knows that a `when` reads (R4): the active app, the active tab's owner and type, the project. */
export interface KeybindingContextV1 {
	active: string | null;
	/** The active tab's owner and its document's type, while the editor area shows it. */
	editor?: { owner: string; type: string } | null;
	/** Whether a project is in the active scope. */
	project: boolean;
}

/** Whether a `when`'s kernel terms hold; `editor`, `sidebar` and `main` are focus, the chrome's, and hold here (R4). */
export function whenHolds(when: string | undefined, context: KeybindingContextV1): boolean {
	if (when === undefined) return true;
	return when.split(' && ').every((term) => {
		if (term === 'project') return context.project;
		if (term === '!project') return !context.project;
		if (term.startsWith('documentType == '))
			return context.editor?.type === term.slice('documentType == '.length);
		return true;
	});
}

/** Whether a command an override names runs from a chord: registered and needing no input, or given its target. */
export type KeybindingRunnable = (command: string, target: string | undefined) => boolean;

interface Candidate {
	entry: KeybindingEntryV1;
	binding: KeybindingInForceV1;
	/** Its band is in force: the shell's, the person's, the active app's or the active tab owner's. */
	band: boolean;
	/** Replaced by an override of its command and target. */
	replaced?: true;
	/** An override whose command cannot run from a chord now. */
	idle?: true;
}

export interface ResolvedKeybindingsV1 {
	/** In force, first to last by precedence, the kernel's `when` terms holding: what the chrome matches. */
	force: KeybindingInForceV1[];
	/** Every binding, by precedence, with whether it is in force (not replaced, idle, shadowed or of an inactive app). */
	entries: Array<KeybindingEntryV1 & { inForce: boolean }>;
}

/**
 * The bindings in force (8.1): overrides, then the reserved chords, then the active app's, then the active tab owner's.
 * An override replaces every binding of its command and target, naming them as shadowed; `keys: null` only removes
 * them. Then, first to last, a binding whose keys collide with one kept before it, under the same `when`, is shadowed
 * by it; under a different `when`, both stay and the first whose `when` holds runs. With `everyApp`, every app's band
 * counts as active, as the palette shows each command's keys.
 */
export function resolveKeybindings(
	shell: readonly Readonly<ShellKeybindingV0>[],
	apps: readonly AppKeybinding[],
	overrides: readonly KeybindingOverrideV1[],
	context: KeybindingContextV1,
	runnable: KeybindingRunnable,
	everyApp = false
): ResolvedKeybindingsV1 {
	const owner = context.editor?.owner ?? null;
	const rank = (instance: string): number =>
		everyApp || instance === context.active ? 0 : instance === owner ? 1 : 2;
	const bases: Candidate[] = [
		...shell.map((binding) => ({
			entry: {
				keys: binding.chord,
				...shellIdentity(binding),
				source: 'shell' as const,
				active: false,
			},
			binding: { ...binding },
			band: true,
		})),
		...[...apps]
			.sort((a, b) => rank(a.instance) - rank(b.instance))
			.map(({ chord, command, instance, when }) => ({
				entry: {
					keys: chord,
					command,
					...(when !== undefined ? { when } : {}),
					source: 'app' as const,
					app: instance,
					active: false,
				},
				binding: { chord, command, ...(when !== undefined ? { when } : {}) },
				band: rank(instance) < 2,
			})),
	];
	const yours: Candidate[] = [];
	for (const { command, target, keys } of overrides) {
		const matched = bases.filter(
			(base) => base.entry.command === command && base.entry.target === target
		);
		for (const base of matched) base.replaced = true;
		if (keys === null) continue;
		const base = matched[0];
		const shadowed = matched.map(({ entry }) => ({ source: entry.source, command: entry.command }));
		// The person's binding holds everywhere: no app's `when` comes with it.
		const { when: _when, ...action } = base?.binding ?? { command };
		yours.push({
			entry: {
				keys,
				command,
				...(target !== undefined ? { target } : {}),
				source: 'you',
				...(base?.entry.app !== undefined ? { app: base.entry.app } : {}),
				...(shadowed.length > 0 ? { shadowed } : {}),
				active: false,
			},
			binding: { ...action, chord: keys, ...(target !== undefined ? { target } : {}) },
			band: true,
			...(base || runnable(command, target) ? {} : { idle: true as const }),
		});
	}
	const ordered = [...yours, ...bases];
	const kept: Candidate[] = [];
	for (const candidate of ordered) {
		if (candidate.replaced || candidate.idle || !candidate.band) continue;
		const over = kept.find(
			({ entry }) =>
				keysCollide(entry.keys, candidate.entry.keys) && entry.when === candidate.entry.when
		);
		if (!over) {
			kept.push(candidate);
			continue;
		}
		over.entry.shadowed = [
			...(over.entry.shadowed ?? []),
			{ source: candidate.entry.source, command: candidate.entry.command },
		];
	}
	for (const candidate of kept) candidate.entry.active = whenHolds(candidate.entry.when, context);
	return {
		force: kept.filter(({ entry }) => entry.active).map(({ binding }) => ({ ...binding })),
		entries: ordered.map((each) => ({
			...each.entry,
			...(each.entry.shadowed ? { shadowed: each.entry.shadowed.map((one) => ({ ...one })) } : {}),
			inForce: kept.includes(each),
		})),
	};
}

export interface KeybindingRegistry {
	/** The bindings in force now, first to last by precedence (8.1), as the chrome matches them. */
	list(active: string | null): KeybindingInForceV1[];
	/** The keys that run `command`, as `listCommands` reports them: the person's own, else its binding's. */
	keybindingFor(command: string): string | undefined;
	/** Every binding resolved for `context`, for `keybinding-list` (8.5). */
	resolve(context: KeybindingContextV1): ResolvedKeybindingsV1;
	/** What the kernel knows now that a `when` reads, for the active app. */
	context(active: string | null): KeybindingContextV1;
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

export function createKeybindings(
	shell: readonly Readonly<ShellKeybindingV0>[],
	apps: readonly AppKeybinding[],
	options: KeybindingRegistryOptions = {}
): KeybindingRegistry {
	let held = [...apps];
	let overrides: KeybindingOverrideV1[] = [];
	let editor: { owner: string; type: string } | null = null;
	let shown: Map<string, string> | undefined;
	const runnable = options.runnable ?? (() => false);
	const context = (active: string | null): KeybindingContextV1 => ({
		active,
		editor,
		project: options.project?.() ?? false,
	});
	return {
		list: (active) => resolveKeybindings(shell, held, overrides, context(active), runnable).force,
		keybindingFor(command) {
			if (!shown) {
				const map = new Map<string, string>();
				const all = resolveKeybindings(shell, held, overrides, context(null), runnable, true);
				for (const entry of all.entries) {
					if (entry.inForce && entry.target === undefined && !map.has(entry.command))
						map.set(entry.command, entry.keys);
				}
				shown = map;
			}
			return shown.get(command);
		},
		resolve: (at) => resolveKeybindings(shell, held, overrides, at, runnable),
		context,
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
