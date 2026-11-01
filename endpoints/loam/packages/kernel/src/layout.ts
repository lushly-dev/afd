/**
 * @fileoverview Layout state version 0 and its one validator (phase 0 specification, 5.2).
 *
 * `validateLayoutPatch` runs in the handlers, never in an input schema, so a refusal reaches the
 * journal. `layout-set`, `layout-reset` and the `loam.layout` view-state handler (and with it
 * `view-state-set { id: 'loam.layout' }`) all go through it.
 */

import type { CommandError } from '@lushly-dev/afd-core';

/** The shell's layout, version 0. The same in every layout class. */
export interface LayoutStateV0 {
	version: 0;
	sidebar: { open: boolean; width: number };
	inspector: { open: boolean; width: number };
	panel: { open: boolean; height: number; maximized: boolean };
	compact: { drawer: 'sidebar' | 'inspector' | null; sheet: boolean };
}

/**
 * A deep partial of {@link LayoutStateV0}. `layout-set` takes it without `version`; the
 * view-state handler also accepts `version: 0`, which changes nothing.
 */
export interface LayoutPatchV0 {
	version?: 0;
	sidebar?: Partial<LayoutStateV0['sidebar']>;
	inspector?: Partial<LayoutStateV0['inspector']>;
	panel?: Partial<LayoutStateV0['panel']>;
	compact?: Partial<LayoutStateV0['compact']>;
}

/**
 * Sizes in CSS pixels. The theme's `shell.size.*` tokens hold the same values, and the theme
 * package's `theme:check` fails when they disagree.
 */
export const LAYOUT_DEFAULTS_V0 = {
	sidebar: { default: 260, min: 200, max: 480 },
	inspector: { default: 300, min: 240, max: 520 },
	panel: { default: 240, min: 120 },
	mainMin: 360,
} as const;

/** The view-state id of the layout. */
export const LAYOUT_VIEW_STATE_ID = 'loam.layout';

/** A fresh copy of the default layout. */
export function createDefaultLayout(): LayoutStateV0 {
	return {
		version: 0,
		sidebar: { open: true, width: LAYOUT_DEFAULTS_V0.sidebar.default },
		inspector: { open: false, width: LAYOUT_DEFAULTS_V0.inspector.default },
		panel: { open: false, height: LAYOUT_DEFAULTS_V0.panel.default, maximized: false },
		compact: { drawer: null, sheet: false },
	};
}

/** The outcome of {@link validateLayoutPatch}. */
export type LayoutValidation =
	| { valid: true; state: LayoutStateV0 }
	| { valid: false; error: CommandError };

type FieldRule =
	| { kind: 'boolean' }
	| { kind: 'size'; min: number; max?: number; example: number }
	| { kind: 'drawer' };

const RULES: Record<Exclude<keyof LayoutStateV0, 'version'>, Record<string, FieldRule>> = {
	sidebar: {
		open: { kind: 'boolean' },
		width: {
			kind: 'size',
			min: LAYOUT_DEFAULTS_V0.sidebar.min,
			max: LAYOUT_DEFAULTS_V0.sidebar.max,
			example: LAYOUT_DEFAULTS_V0.sidebar.default,
		},
	},
	inspector: {
		open: { kind: 'boolean' },
		width: {
			kind: 'size',
			min: LAYOUT_DEFAULTS_V0.inspector.min,
			max: LAYOUT_DEFAULTS_V0.inspector.max,
			example: LAYOUT_DEFAULTS_V0.inspector.default,
		},
	},
	panel: {
		open: { kind: 'boolean' },
		height: {
			kind: 'size',
			min: LAYOUT_DEFAULTS_V0.panel.min,
			example: LAYOUT_DEFAULTS_V0.panel.default,
		},
		maximized: { kind: 'boolean' },
	},
	compact: {
		drawer: { kind: 'drawer' },
		sheet: { kind: 'boolean' },
	},
};

const PARTS = Object.keys(RULES) as (keyof typeof RULES)[];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
	if (value === undefined) return 'nothing';
	const text = JSON.stringify(value);
	return text === undefined ? String(value) : text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

function invalid(
	field: string,
	message: string,
	suggestion: string,
	details: Record<string, unknown> = {}
): LayoutValidation {
	return {
		valid: false,
		error: {
			code: 'VALIDATION_ERROR',
			message,
			suggestion,
			retryable: false,
			details: { field, ...details },
		},
	};
}

function rangeText(rule: Extract<FieldRule, { kind: 'size' }>): string {
	return rule.max === undefined ? `${rule.min} or more` : `from ${rule.min} to ${rule.max}`;
}

function checkField(field: string, rule: FieldRule, value: unknown): LayoutValidation | null {
	switch (rule.kind) {
		case 'boolean':
			return typeof value === 'boolean'
				? null
				: invalid(
						field,
						`${field} must be true or false; got ${describe(value)}`,
						`Set ${field} to true or false`
					);
		case 'drawer':
			return value === null || value === 'sidebar' || value === 'inspector'
				? null
				: invalid(
						field,
						`${field} must be "sidebar", "inspector" or null; got ${describe(value)}`,
						`Set ${field} to "sidebar", "inspector" or null`
					);
		case 'size': {
			const inRange =
				typeof value === 'number' &&
				Number.isInteger(value) &&
				value >= rule.min &&
				(rule.max === undefined || value <= rule.max);
			if (inRange) return null;
			return invalid(
				field,
				`${field} must be an integer ${rangeText(rule)} CSS pixels; got ${describe(value)}`,
				`Use a whole number ${rangeText(rule)}, e.g. ${rule.example}`,
				{ min: rule.min, ...(rule.max !== undefined ? { max: rule.max } : {}), value }
			);
		}
		default:
			return invalid(
				field,
				`Unknown layout field "${field}"`,
				'Use only the fields layout-get returns'
			);
	}
}

/**
 * Check `patch`, a deep partial of {@link LayoutStateV0}, against the constraints and apply it to
 * `state`. Returns the new state, or a `VALIDATION_ERROR` naming the field, the range and a
 * suggestion. Unknown fields are refused; `version` may only be `0`. `state` is not changed.
 */
export function validateLayoutPatch(state: LayoutStateV0, patch: unknown): LayoutValidation {
	if (!isRecord(patch)) {
		return invalid(
			'',
			`A layout patch must be an object; got ${describe(patch)}`,
			'Pass an object such as { "sidebar": { "open": false } }'
		);
	}
	const next = cloneLayout(state);
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		if (key === 'version') {
			if (value !== 0) {
				return invalid(
					'version',
					`version must be 0; got ${describe(value)}`,
					'Leave version out; layout state version 0 is the only version'
				);
			}
			continue;
		}
		// Own keys only: an inherited name such as `constructor` is an unknown field.
		const rules = Object.hasOwn(RULES, key) ? RULES[key as keyof typeof RULES] : undefined;
		if (!rules) {
			return invalid(key, `Unknown layout field "${key}"`, `Use only ${PARTS.join(', ')}`);
		}
		if (!isRecord(value)) {
			return invalid(
				key,
				`${key} must be an object; got ${describe(value)}`,
				`Pass ${key} as an object of the fields to change`
			);
		}
		const target = next[key as keyof typeof RULES] as Record<string, unknown>;
		for (const [name, fieldValue] of Object.entries(value)) {
			// An absent optional field, as a spread of optional values leaves it.
			if (fieldValue === undefined) continue;
			const field = `${key}.${name}`;
			const rule = Object.hasOwn(rules, name) ? rules[name] : undefined;
			if (!rule) {
				return invalid(
					field,
					`Unknown layout field "${field}"`,
					`Use only ${Object.keys(rules)
						.map((known) => `${key}.${known}`)
						.join(', ')}`
				);
			}
			const refusal = checkField(field, rule, fieldValue);
			if (refusal) return refusal;
			target[name] = fieldValue;
		}
	}
	return { valid: true, state: next };
}

/**
 * Check that `value` is a complete {@link LayoutStateV0}, as a replacement must be. Returns the
 * state (a copy) or a `VALIDATION_ERROR` naming the first missing or invalid field.
 */
export function validateLayoutState(value: unknown): LayoutValidation {
	if (!isRecord(value)) {
		return invalid(
			'',
			`A layout state must be an object; got ${describe(value)}`,
			'Pass a complete layout state, as layout-get returns it'
		);
	}
	if (value.version !== 0) {
		return invalid(
			'version',
			`version must be 0; got ${describe(value.version)}`,
			'Set version to 0'
		);
	}
	for (const part of PARTS) {
		const fields = value[part];
		for (const name of Object.keys(RULES[part])) {
			if (!isRecord(fields) || !Object.hasOwn(fields, name) || fields[name] === undefined) {
				return invalid(
					`${part}.${name}`,
					`A complete layout state needs ${part}.${name}`,
					'Pass a complete layout state, as layout-get returns it, or omit replace to merge a partial one'
				);
			}
		}
	}
	return validateLayoutPatch(createDefaultLayout(), value);
}

/** A deep copy of a layout state. */
export function cloneLayout(state: LayoutStateV0): LayoutStateV0 {
	return {
		version: 0,
		sidebar: { ...state.sidebar },
		inspector: { ...state.inspector },
		panel: { ...state.panel },
		compact: { ...state.compact },
	};
}

/**
 * The values `state` holds for each field `patch` names, in the patch's shape: the undo of
 * applying `patch` to `state`. `version` is left out.
 */
export function layoutUndoPatch(state: LayoutStateV0, patch: LayoutPatchV0): LayoutPatchV0 {
	const undo: Record<string, Record<string, unknown>> = {};
	for (const part of PARTS) {
		const fields = patch[part];
		if (!fields) continue;
		const previous = state[part] as Record<string, unknown>;
		undo[part] = Object.fromEntries(Object.keys(fields).map((name) => [name, previous[name]]));
	}
	return undo as LayoutPatchV0;
}

/** `state` without `version`, as `layout-set` takes it. */
export function layoutAsPatch(state: LayoutStateV0): LayoutPatchV0 {
	const { version: _version, ...rest } = cloneLayout(state);
	return rest;
}
