/**
 * @fileoverview A settings section and its keys (phase 4 specification, 3.1; D116): the types, the check of a
 * value against its key, and the manifest's `ui.settings` rules beyond the schema. No validator and no DOM: the
 * kernel's `late-settings` chunk checks a written value with {@link checkSettingValue}, the same function the
 * rules check a default with, so an author and a writer are told the same thing.
 */

import type { Finding } from './core-rules.js';
import type { ManifestRefusalCode, ManifestV3 } from './types.js';

/** Where a value is set (3.1): the person's own, every member's in a project, or every member's in the workspace. */
export type SettingLevelV1 = 'person' | 'workspace' | 'project';

/** The levels, in the order the settings section offers them. */
export const SETTING_LEVELS_V1: readonly SettingLevelV1[] = Object.freeze([
	'person',
	'workspace',
	'project',
]);

interface SettingKeyBaseV1 {
	/** 1 to 60. */
	title: string;
	/** 1 to 200, plain text. */
	description?: string;
	/** Narrows its section's levels. */
	levels?: SettingLevelV1[];
}

/** One key of a section: a closed subset of JSON Schema, with a default inside its bounds (3.1). */
export type SettingKeyV1 = SettingKeyBaseV1 &
	(
		| { type: 'boolean'; default: boolean }
		| { type: 'string'; enum: string[]; enumTitles?: string[]; default: string }
		| { type: 'string'; maxLength: number; default: string }
		| { type: 'integer' | 'number'; minimum: number; maximum: number; default: number }
		| {
				type: 'array';
				items: { type: 'string'; enum: string[] };
				maxItems: number;
				uniqueItems: true;
				default: string[];
		  }
	);

export interface SettingSchemaV1 {
	type: 'object';
	/** 1 to 32 keys, each `^[a-z][a-zA-Z0-9]{0,39}$`. */
	properties: Record<string, SettingKeyV1>;
	additionalProperties: false;
}

/** A settings section (3.1). Its full id is `<plugin.id>.<id>`; the shell's are `loam.<id>`. */
export interface SettingSectionV1 {
	/** `^[a-z0-9][a-z0-9-]{0,39}$`, unique in the app. */
	id: string;
	/** 1 to 40. */
	title: string;
	/** 1 to 200, plain text. */
	description?: string;
	/** At least one. */
	levels: SettingLevelV1[];
	schema: SettingSchemaV1;
	/** The experiment, by full id, the section is present for alone (5.3). */
	requires_experiment?: string;
}

/** At most this many sections per app (`MANIFEST_SETTINGS_LIMIT`). */
export const MANIFEST_SETTINGS_MAX = 8;

/** A section's resolved object is at most this many bytes of JSON (`SETTING_TOO_LARGE`). */
export const SETTING_SECTION_MAX_BYTES = 16_384;

/** A key named like a secret (`MANIFEST_SETTING_SECRET`): a setting is plain text that every reader sees. */
const SECRET = /secret|passw(or)?d|passphrase|token|api_?key|credential|private_?key/i;

/** In display text, a title or an enum's value: any control or bidirectional formatting character (`textRules`'s). */
const DISPLAY_CONTROL = /[\p{Cc}\p{Bidi_Control}]/u;

/** A control character, or a bidirectional formatting one; text may still hold a tab or a line break. */
const CONTROL = /[\p{Cc}\p{Bidi_Control}]/u;

/** The levels a key may be set at: its own, else its section's (3.1). */
export const keyLevels = (section: SettingSectionV1, key: SettingKeyV1): SettingLevelV1[] =>
	key.levels ?? section.levels;

/**
 * Why `value` is no value of `key`, or undefined when it is one: what `setting-set` refuses as `VALIDATION_ERROR`
 * and the manifest's rules refuse as `MANIFEST_SETTING_DEFAULT`. Text is plain: no control character.
 */
export function checkSettingValue(key: SettingKeyV1, value: unknown): string | undefined {
	switch (key.type) {
		case 'boolean':
			return typeof value === 'boolean' ? undefined : 'must be true or false';
		case 'string': {
			if (typeof value !== 'string') return 'must be a string';
			if ('enum' in key) {
				return key.enum.includes(value) ? undefined : `must be one of ${key.enum.join(', ')}`;
			}
			const { maxLength } = key as { maxLength: number };
			if (value.length > maxLength) return `must be at most ${maxLength} characters`;
			return CONTROL.test(value.replace(/[\t\n\r]/g, ''))
				? 'must not hold a control character'
				: undefined;
		}
		case 'integer':
		case 'number': {
			if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
			if (key.type === 'integer' && !Number.isInteger(value)) return 'must be a whole number';
			return value < key.minimum || value > key.maximum
				? `must be from ${key.minimum} to ${key.maximum}`
				: undefined;
		}
		case 'array': {
			if (!Array.isArray(value)) return 'must be a list';
			if (value.length > key.maxItems) return `must hold at most ${key.maxItems} items`;
			if (new Set(value).size !== value.length) return 'must not repeat an item';
			const allowed = key.items.enum;
			return value.every((item) => typeof item === 'string' && allowed.includes(item))
				? undefined
				: `must hold only ${allowed.join(', ')}`;
		}
	}
}

/** The fields each type may carry beside `type`, `title`, `description`, `levels` and `default` (3.1). */
const FIELDS: Readonly<Record<SettingKeyV1['type'], readonly (readonly string[])[]>> = {
	boolean: [[]],
	string: [['enum'], ['enum', 'enumTitles'], ['maxLength']],
	integer: [['minimum', 'maximum']],
	number: [['minimum', 'maximum']],
	array: [['items', 'maxItems', 'uniqueItems']],
};
const COMMON = new Set(['type', 'title', 'description', 'levels', 'default']);

/** Why `key`'s fields are not one of 3.1's shapes, or undefined when they are. */
function shapeProblem(key: Record<string, unknown>): string | undefined {
	const type = key.type as SettingKeyV1['type'];
	const own = Object.keys(key)
		.filter((field) => !COMMON.has(field))
		.sort();
	const shapes = FIELDS[type] ?? [];
	if (!shapes.some((shape) => [...shape].sort().join() === own.join())) {
		const told = shapes
			.map((shape) => (shape.length === 0 ? 'no other field' : shape.join(' and ')))
			.join('; or ');
		return `A \`${type}\` key takes ${told}`;
	}
	if (type === 'string' && Array.isArray(key.enumTitles)) {
		if (key.enumTitles.length !== (key.enum as unknown[]).length)
			return '`enumTitles` must name each of `enum`, in order';
	}
	if (type === 'integer' || type === 'number') {
		const { minimum, maximum } = key as { minimum: number; maximum: number };
		if (minimum > maximum) return '`minimum` must not be above `maximum`';
		if (type === 'integer' && !(Number.isInteger(minimum) && Number.isInteger(maximum)))
			return 'An `integer` key needs whole bounds';
	}
	return undefined;
}

type Refuse = (
	code: ManifestRefusalCode,
	pointer: string,
	message: string,
	suggestion: string
) => void;

/**
 * `ui.settings`'s rules beyond the schema (3.1, 12.1): no section for a mounted app; at most eight; each id once;
 * each key a shape of 3.1, its levels within its section's, and a default inside its bounds; a key named like a
 * secret warns.
 */
export function settingRules(manifest: ManifestV3, refuse: Refuse, warnings: Finding[]): void {
	const sections = (manifest.ui?.settings ?? []) as unknown as SettingSectionV1[];
	if (sections.length === 0) return;
	if (manifest.plugin.kind === 'mounted') {
		refuse(
			'MANIFEST_SETTINGS_MOUNTED',
			'/ui/settings',
			'A mounted app declares no settings section in phase 4.',
			'Remove `ui.settings`: the server keeps its own configuration.'
		);
		return;
	}
	if (sections.length > MANIFEST_SETTINGS_MAX) {
		refuse(
			'MANIFEST_SETTINGS_LIMIT',
			`/ui/settings/${MANIFEST_SETTINGS_MAX}`,
			`An app declares at most ${MANIFEST_SETTINGS_MAX} settings sections; this one declares ${sections.length}.`,
			'Merge related keys into fewer sections.'
		);
	}
	const seen = new Set<string>();
	sections.forEach((section, index) => {
		const at = `/ui/settings/${index}`;
		if (seen.has(section.id)) {
			refuse(
				'MANIFEST_DUPLICATE',
				`${at}/id`,
				`The settings section \`${section.id}\` is repeated.`,
				'Give each section its own id.'
			);
		}
		seen.add(section.id);
		// Text a person reads, plain (3.1; the second review's K): as `textRules` checks every other title.
		const text = (pointer: string, value: unknown) => {
			if (typeof value === 'string' && DISPLAY_CONTROL.test(value)) {
				refuse(
					'MANIFEST_TEXT_INVALID',
					pointer,
					"It holds a control or bidirectional formatting character, and it reaches a person's screen.",
					'Remove the control character.'
				);
			}
		};
		text(`${at}/title`, section.title);
		text(`${at}/description`, section.description);
		/** The defaults alone, which a section's resolved values may never exceed (3.1's 16 KiB). */
		const defaults: Record<string, unknown> = {};
		for (const [name, key] of Object.entries(section.schema.properties)) {
			const pointer = `${at}/schema/properties/${name}`;
			text(`${pointer}/title`, key.title);
			text(`${pointer}/description`, key.description);
			const choices = key as { enum?: unknown[]; enumTitles?: unknown[] };
			(choices.enum ?? []).forEach((value, place) => {
				text(`${pointer}/enum/${place}`, value);
			});
			(choices.enumTitles ?? []).forEach((value, place) => {
				text(`${pointer}/enumTitles/${place}`, value);
			});
			if ('default' in key) defaults[name] = key.default;
			const problem = shapeProblem(key as unknown as Record<string, unknown>);
			if (problem) {
				refuse(
					'MANIFEST_SETTING_SCHEMA',
					pointer,
					`${problem}.`,
					'Use one of the shapes of the settings subset: a boolean, a string with `enum` or `maxLength`, a number with `minimum` and `maximum`, or an array of `enum` strings with `maxItems` and `uniqueItems = true`.'
				);
				continue;
			}
			const outside = (key.levels ?? []).filter((level) => !section.levels.includes(level));
			if (outside.length > 0) {
				refuse(
					'MANIFEST_SETTING_SCHEMA',
					`${pointer}/levels`,
					`A key's levels narrow its section's, and the section has no ${outside.join(' or ')} level.`,
					`Use only ${section.levels.join(', ')}, or add the level to the section.`
				);
			}
			const wrong =
				'default' in key ? checkSettingValue(key, key.default) : 'is missing: every key has one';
			if (wrong) {
				refuse(
					'MANIFEST_SETTING_DEFAULT',
					`${pointer}/default`,
					`The default ${wrong}.`,
					'Give the key a default inside its own bounds.'
				);
			}
			if (SECRET.test(name)) {
				warnings.push({
					code: 'MANIFEST_SETTING_SECRET',
					pointer,
					message: `\`${name}\` reads like a secret, and a setting is plain text that every reader of its level sees.`,
					suggestion: 'Keep secrets out of settings: the `secrets` grant holds them from phase 6.',
				});
			}
		}
		// A section whose defaults alone are over 16 KiB could never be read or written (the second review's F).
		const bytes = new TextEncoder().encode(JSON.stringify(defaults)).length;
		if (bytes > SETTING_SECTION_MAX_BYTES) {
			refuse(
				'MANIFEST_SETTING_SCHEMA',
				`${at}/schema`,
				`The section's defaults alone are ${bytes} bytes, over the ${SETTING_SECTION_MAX_BYTES} a section's values may hold.`,
				'Shorten the longest defaults, or split the section.'
			);
		}
	});
}
