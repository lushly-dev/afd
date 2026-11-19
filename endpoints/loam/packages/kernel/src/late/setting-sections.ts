/**
 * @fileoverview The shell's own settings sections (phase 4 specification, 3.7): `loam.appearance` (3.6) and
 * `loam.documents` (A-P2-2) from step 1; `loam.rail`, `loam.keybindings` and `loam.notifications` from step 2, whose
 * three list keys use shapes an app cannot declare (an array of objects, and arrays of free instance ids), each checked
 * here and rendered by a named custom editor. `loam.limits` is step 10's; `loam.autonomy` and `loam.experiments` are
 * written only by their own commands (`SETTING_USE_AUTONOMY`), and join the tree with steps 8 and 9.
 */

import type { SettingSectionV1 } from '@lushly-dev/loam-manifest';
import type { KnownSectionV1, ShellKeyCheckV1 } from './setting-rules.js';

/**
 * `APPEARANCE_THEMES` and `APPEARANCE_DENSITIES`, as literals: imported, first paint's `appearance` module would be
 * parted into a chunk of its own, shared with this one (phase 3 specification, 13). A unit holds them equal.
 */
export const THEMES = ['system', 'light', 'dark', 'high-contrast'];
export const DENSITIES = ['comfortable', 'compact'];

/** The full ids `setting-*` refuses, since only their own commands write them (`SETTING_USE_AUTONOMY`). */
export const OWN_COMMAND_SECTIONS: Readonly<Record<string, string>> = Object.freeze({
	'loam.autonomy': 'autonomy-set',
	'loam.experiments': 'experiment-enable',
});

/** `loam.appearance`, a person-level shell section (3.6): `appearance-*` read and write its two keys. */
export const APPEARANCE_SECTION: SettingSectionV1 = Object.freeze({
	id: 'appearance',
	title: 'Appearance',
	description: 'The theme and density the shell paints with, yours on every project.',
	levels: ['person'],
	schema: {
		type: 'object',
		properties: {
			theme: {
				type: 'string',
				title: 'Theme',
				enum: THEMES,
				enumTitles: ['System', 'Light', 'Dark', 'High contrast'],
				default: 'system',
			},
			density: {
				type: 'string',
				title: 'Density',
				enum: DENSITIES,
				enumTitles: ['Comfortable', 'Compact'],
				default: 'comfortable',
			},
		},
		additionalProperties: false,
	},
}) as SettingSectionV1;

/** `loam.documents`, a workspace section (A-P2-2): its `trashDays` is written through to `WorkspaceV1.trashDays`. */
export const DOCUMENTS_SECTION: SettingSectionV1 = Object.freeze({
	id: 'documents',
	title: 'Documents',
	description: 'How long the trash keeps a document before it is deleted for good.',
	levels: ['workspace'],
	schema: {
		type: 'object',
		properties: {
			trashDays: {
				type: 'integer',
				title: 'Days in the trash',
				description: 'From 1 to 365 days.',
				minimum: 1,
				maximum: 365,
				default: 30,
			},
		},
		additionalProperties: false,
	},
}) as SettingSectionV1;

/** Most items in each list key of the shell's (3.7): 64 instance ids, 64 overrides. */
export const SHELL_LIST_MAX = 64;

/** An instance id, as a deployment entry names one (phase 1 specification, 4.2). */
const INSTANCE = /^[a-z][a-z0-9]{0,31}$/;

/** Why `value` is not a list of distinct instance ids, or undefined. Free ids: an app disabled now may return. */
function instanceList(value: unknown): string | undefined {
	if (!Array.isArray(value)) return 'must be a list';
	if (value.length > SHELL_LIST_MAX) return `must hold at most ${SHELL_LIST_MAX} items`;
	if (!value.every((item) => typeof item === 'string' && INSTANCE.test(item)))
		return 'must hold only instance ids, such as notes';
	return new Set(value).size === value.length ? undefined : 'must not repeat an item';
}

/** A key's name in a chord: a capital letter, a digit, a function key or a named key. */
const CHORD_KEY =
	/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Enter|Escape|Tab|Space|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|[,./;=-])$/;
const MODIFIERS = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'];

/** Whether `chord` is one chord: its modifiers in {@link MODIFIERS}' order, each once, then one key, as `Mod+Shift+H`. */
export function isChord(chord: string): boolean {
	const parts = chord.split('+');
	const key = parts.pop() as string;
	let at = -1;
	for (const modifier of parts) {
		const index = MODIFIERS.indexOf(modifier);
		if (index <= at) return false;
		at = index;
	}
	return CHORD_KEY.test(key);
}

/** The chords no override binds (8.3): focus between parts, and Escape. */
export const OVERRIDE_RESERVED: readonly string[] = Object.freeze(['F6', 'Shift+F6', 'Escape']);

/** A command's name, as the registry holds one. */
const COMMAND = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * `loam.keybindings.overrides` (3.7, 8.3): up to 64 `{ command, target?, keys }`, `keys` one chord or two separated by a
 * space, or `null` to unbind, each binding once. Stored and checked now; the matcher that applies them is step 7's.
 */
const overrides: ShellKeyCheckV1 = (value) => {
	if (!Array.isArray(value)) return { problem: 'must be a list' };
	if (value.length > SHELL_LIST_MAX)
		return { problem: `must hold at most ${SHELL_LIST_MAX} items` };
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== 'object' || item === null || Array.isArray(item))
			return { problem: 'must hold only { command, target?, keys } objects' };
		const { command, target, keys, ...rest } = item as Record<string, unknown>;
		const extra = Object.keys(rest)[0];
		if (extra !== undefined) return { problem: `must not name '${extra}' in an override` };
		if (typeof command !== 'string' || command.length > 128 || !COMMAND.test(command))
			return { problem: 'must name each command by its name, such as palette-open' };
		if (
			target !== undefined &&
			(typeof target !== 'string' || target.length < 1 || target.length > 128)
		)
			return { problem: 'must give a target of 1 to 128 characters, or none' };
		if (keys !== null) {
			const chords = typeof keys === 'string' ? keys.split(' ') : [];
			if (chords.length < 1 || chords.length > 2 || !chords.every(isChord))
				return {
					problem: 'must give keys as one chord or two, such as Mod+Shift+H, or null to unbind',
				};
			const reserved = chords.find((chord) => OVERRIDE_RESERVED.includes(chord));
			if (reserved) return { code: 'KEYBINDING_RESERVED', problem: `must not bind ${reserved}` };
		}
		const binding = JSON.stringify([command, target ?? null]);
		if (seen.has(binding)) return { problem: 'must override each binding once' };
		seen.add(binding);
	}
	return undefined;
};

/** `loam.notifications.muted` (3.7): instance ids, never the shell or an agent (`SETTING_MUTE_SHELL`). */
const muted: ShellKeyCheckV1 = (value) => {
	if (
		Array.isArray(value) &&
		value.some(
			(item) => item === 'shell' || (typeof item === 'string' && item.startsWith('agent:'))
		)
	)
		return { code: 'SETTING_MUTE_SHELL', problem: 'must not mute the shell or an agent' };
	const problem = instanceList(value);
	return problem ? { problem } : undefined;
};

/** `loam.rail.order`'s check: instance ids, first to last. */
const order: ShellKeyCheckV1 = (value) => {
	const problem = instanceList(value);
	return problem ? { problem } : undefined;
};

/** `loam.rail`, a person's own rail order (3.7; R8, D75): instance ids, first to last; the rest follow in theirs. */
export const RAIL_SECTION: SettingSectionV1 = Object.freeze({
	id: 'rail',
	title: 'Rail',
	description: 'The order of the apps in the rail, yours on every project.',
	levels: ['person'],
	schema: {
		type: 'object',
		properties: {
			order: {
				type: 'array',
				title: 'App order',
				description:
					'The apps listed here come first, in this order; the rest follow in the workspace’s order.',
				items: { type: 'string' },
				maxItems: SHELL_LIST_MAX,
				uniqueItems: true,
				default: [],
			},
		},
		additionalProperties: false,
	},
}) as unknown as SettingSectionV1;

/** `loam.keybindings` (3.7; 8.3): a person's overrides, human (3.2). */
export const KEYBINDINGS_SECTION: SettingSectionV1 = Object.freeze({
	id: 'keybindings',
	title: 'Keybindings',
	description:
		'Your own keys for commands: rebind or unbind any binding but F6, Shift+F6 and Escape.',
	levels: ['person'],
	schema: {
		type: 'object',
		properties: {
			overrides: {
				type: 'array',
				title: 'Overrides',
				description: 'Each names a command and its keys, or no keys to unbind it.',
				items: {
					type: 'object',
					properties: {
						command: { type: 'string' },
						target: { type: 'string' },
						keys: { type: ['string', 'null'] },
					},
					required: ['command', 'keys'],
					additionalProperties: false,
				},
				maxItems: SHELL_LIST_MAX,
				default: [],
			},
		},
		additionalProperties: false,
	},
}) as unknown as SettingSectionV1;

/**
 * `loam.notifications` (3.7): which toasts also land in the inbox (6.1; a sticky one always does), and the apps whose
 * notices stay quiet. A toast still dismisses itself on its timer whatever `toastSticky` says (step 5's correction).
 */
export const NOTIFICATIONS_SECTION: SettingSectionV1 = Object.freeze({
	id: 'notifications',
	title: 'Notifications',
	description: 'Which toasts are kept in your inbox, and the apps whose notices stay quiet.',
	levels: ['person'],
	schema: {
		type: 'object',
		properties: {
			toastSticky: {
				type: 'string',
				title: 'Keep toasts in the inbox',
				description:
					'Which toasts are also kept in your inbox after they close. Toasts an app marks to stay are always kept.',
				enum: ['never', 'danger', 'always'],
				enumTitles: ['Never', 'Only warnings', 'Always'],
				default: 'danger',
			},
			muted: {
				type: 'array',
				title: 'Muted apps',
				description:
					'Their notices are kept and counted, but never announced or shown as a toast. Confirmations are never muted.',
				items: { type: 'string' },
				maxItems: SHELL_LIST_MAX,
				uniqueItems: true,
				default: [],
			},
		},
		additionalProperties: false,
	},
}) as unknown as SettingSectionV1;

/**
 * The shell's sections, in the settings tree's order (3.5): Appearance, the rail beside it, Keybindings, Notifications
 * and Documents. Autonomy, Experiments and Limits join at their places as steps 8 to 10 build them.
 */
export const SHELL_SECTIONS: readonly KnownSectionV1[] = Object.freeze<KnownSectionV1[]>([
	{ fullId: 'loam.appearance', section: APPEARANCE_SECTION, owner: 'shell' },
	{ fullId: 'loam.rail', section: RAIL_SECTION, owner: 'shell', checks: { order } },
	{
		fullId: 'loam.keybindings',
		section: KEYBINDINGS_SECTION,
		owner: 'shell',
		checks: { overrides },
	},
	{
		fullId: 'loam.notifications',
		section: NOTIFICATIONS_SECTION,
		owner: 'shell',
		checks: { muted },
	},
	{ fullId: 'loam.documents', section: DOCUMENTS_SECTION, owner: 'shell' },
]);
