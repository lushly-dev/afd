/**
 * @fileoverview Appearance, theme and density (D51; phase 0 specification, 6.3). Stored as the
 * `loam.appearance` view-state record, which phase 4's settings take over without changing the
 * commands.
 */

import type { CommandError } from '@lushly-dev/afd-core';
import type { KernelEnvironmentV0 } from './types.js';

export const APPEARANCE_THEMES = ['system', 'light', 'dark', 'high-contrast'] as const;
export const APPEARANCE_DENSITIES = ['comfortable', 'compact'] as const;

export type AppearanceThemeV0 = (typeof APPEARANCE_THEMES)[number];
export type AppearanceDensityV0 = (typeof APPEARANCE_DENSITIES)[number];
export type ResolvedThemeV0 = Exclude<AppearanceThemeV0, 'system'>;

/** The stored appearance. */
export interface AppearanceStateV0 {
	theme: AppearanceThemeV0;
	density: AppearanceDensityV0;
}

/** What `appearance-get` and `appearance-set` return. */
export interface AppearanceV0 extends AppearanceStateV0 {
	resolved: ResolvedThemeV0;
}

/** The view-state id of the appearance. */
export const APPEARANCE_VIEW_STATE_ID = 'loam.appearance';

/** The media queries the `system` theme follows, in the order they decide. */
export const APPEARANCE_QUERIES = {
	forcedColors: '(forced-colors: active)',
	moreContrast: '(prefers-contrast: more)',
	dark: '(prefers-color-scheme: dark)',
} as const;

export function createDefaultAppearance(): AppearanceStateV0 {
	return { theme: 'system', density: 'comfortable' };
}

/**
 * The theme `theme` resolves to. `system` follows the environment: forced colors or more contrast
 * give high contrast, otherwise a dark color scheme gives dark, otherwise light.
 */
export function resolveTheme(
	theme: AppearanceThemeV0,
	environment: KernelEnvironmentV0
): ResolvedThemeV0 {
	if (theme !== 'system') return theme;
	if (
		environment.matches(APPEARANCE_QUERIES.forcedColors) ||
		environment.matches(APPEARANCE_QUERIES.moreContrast)
	) {
		return 'high-contrast';
	}
	return environment.matches(APPEARANCE_QUERIES.dark) ? 'dark' : 'light';
}

export type AppearanceValidation =
	| { valid: true; state: AppearanceStateV0 }
	| { valid: false; error: CommandError };

const FIELDS: Record<keyof AppearanceStateV0, readonly string[]> = {
	theme: APPEARANCE_THEMES,
	density: APPEARANCE_DENSITIES,
};

function refuse(field: string, message: string, suggestion: string): AppearanceValidation {
	return {
		valid: false,
		error: { code: 'VALIDATION_ERROR', message, suggestion, retryable: false, details: { field } },
	};
}

/**
 * Check a partial appearance and apply it to `state`; with `complete`, every field must be given,
 * as a replacement needs. Unknown fields are refused. `state` is not changed.
 */
export function validateAppearancePatch(
	state: AppearanceStateV0,
	patch: unknown,
	complete = false
): AppearanceValidation {
	if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
		return refuse(
			'',
			'An appearance must be an object',
			'Pass { "theme": "dark" } or { "density": "compact" }'
		);
	}
	const next: AppearanceStateV0 = { ...state };
	const given = patch as Record<string, unknown>;
	for (const [key, value] of Object.entries(given)) {
		if (value === undefined) continue;
		// Own keys only: an inherited name such as `constructor` is an unknown field.
		const allowed = Object.hasOwn(FIELDS, key) ? FIELDS[key as keyof AppearanceStateV0] : undefined;
		if (!allowed) {
			return refuse(key, `Unknown appearance field "${key}"`, 'Use only theme and density');
		}
		if (typeof value !== 'string' || !allowed.includes(value)) {
			return refuse(
				key,
				`${key} must be one of ${allowed.join(', ')}; got ${JSON.stringify(value) ?? String(value)}`,
				`Set ${key} to one of ${allowed.join(', ')}`
			);
		}
		(next as unknown as Record<string, string>)[key] = value;
	}
	if (complete) {
		for (const key of Object.keys(FIELDS)) {
			if (!Object.hasOwn(given, key) || given[key] === undefined) {
				return refuse(
					key,
					`A complete appearance needs ${key}`,
					'Pass both theme and density, or omit replace to merge a partial appearance'
				);
			}
		}
	}
	return { valid: true, state: next };
}
