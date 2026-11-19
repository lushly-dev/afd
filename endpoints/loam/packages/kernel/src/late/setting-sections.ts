/**
 * @fileoverview The shell's own settings sections that phase 4's step 1 serves (phase 4 specification, 3.7):
 * `loam.appearance` (3.6) and `loam.documents` (A-P2-2). The rest of 3.7's table (`loam.rail`, `loam.keybindings`,
 * `loam.notifications`, `loam.limits`) needs the custom editors and the commands of later steps, and is registered
 * with them; `loam.autonomy` and `loam.experiments` are written only by their own commands (`SETTING_USE_AUTONOMY`).
 */

import type { SettingSectionV1 } from '@lushly-dev/loam-manifest';
import type { KnownSectionV1 } from './setting-rules.js';

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

/** The shell's sections, in the settings tree's order (3.5). */
export const SHELL_SECTIONS: readonly KnownSectionV1[] = Object.freeze([
	{ fullId: 'loam.appearance', section: APPEARANCE_SECTION, owner: 'shell' },
	{ fullId: 'loam.documents', section: DOCUMENTS_SECTION, owner: 'shell' },
]);
