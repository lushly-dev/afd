/**
 * @fileoverview The keybindings' resolver (phase 4 specification, 8.1, 8.3, 8.5; D123), in the `late-settings` chunk:
 * precedence, an override's replacement, colliding keys, the reserved chords' names (R1) and targets (R2), and the
 * `when` terms the kernel decides (R4). First paint's registry holds the reserved chords and the active app's until
 * this chunk gives it {@link KEYBINDING_RESOLVER}, since only this chunk reads a person's overrides.
 */

import type {
	AppKeybinding,
	KeybindingContextV1,
	KeybindingEntryV1,
	KeybindingInForceV1,
	KeybindingInfoV1,
	KeybindingOverrideV1,
	KeybindingResolverV1,
	ResolvedKeybindingsV1,
	ShellKeybindingV0,
} from '../keybindings.js';

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
	info: KeybindingInfoV1,
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
		// The registry's answer, for a command no binding names: whether a chord runs it, and whose it is (the reviews' 7).
		const known = info(command, target);
		const app = base?.entry.app ?? known.app;
		const shadowed = matched.map(({ entry }) => ({ source: entry.source, command: entry.command }));
		// The person's binding holds everywhere: no app's `when` comes with it.
		const { when: _when, ...action } = base?.binding ?? { command };
		yours.push({
			entry: {
				keys,
				command,
				...(target !== undefined ? { target } : {}),
				source: 'you',
				...(app !== undefined ? { app } : {}),
				...(shadowed.length > 0 ? { shadowed } : {}),
				active: false,
			},
			binding: { ...action, chord: keys, ...(target !== undefined ? { target } : {}) },
			band: true,
			...(base || known.runnable ? {} : { idle: true as const }),
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

/** The keys each command is run by, as the palette shows them: every app's band counted, the person's own first. */
export function keybindingShortcuts(
	shell: readonly Readonly<ShellKeybindingV0>[],
	apps: readonly AppKeybinding[],
	overrides: readonly KeybindingOverrideV1[],
	info: KeybindingInfoV1
): Map<string, string> {
	const map = new Map<string, string>();
	const all = resolveKeybindings(
		shell,
		apps,
		overrides,
		{ active: null, project: false },
		info,
		true
	);
	for (const entry of all.entries) {
		if (entry.inForce && entry.target === undefined && !map.has(entry.command))
			map.set(entry.command, entry.keys);
	}
	return map;
}

/** The resolver the registry is given at the late load. */
export const KEYBINDING_RESOLVER: KeybindingResolverV1 = Object.freeze({
	resolve: resolveKeybindings,
	shortcuts: keybindingShortcuts,
	collide: keysCollide,
});
