/**
 * @fileoverview The appearance of the pages that boot no kernel (phase 3 specification, 14; the coordinator's R9,
 * 2026-11-22): the join and recovery pages (5.6, 5.7) and the OAuth login and consent pages (9.4). Each shows the
 * person's appearance where this profile knows one, `loam.appearance.last`, which a `provider` shell keeps as the
 * person's own after every paint (phase 4 specification, 3.6), and otherwise the system's theme; forced colors win,
 * as in the shell (`displayedTheme`). It follows the system's changes while the page is open. In first paint's entry,
 * since everything it uses already is: imported lazily, it would part those modules into chunks of their own, and
 * first paint's chunk list is held (phase 2 specification, 2.4).
 */

import { applyAppearance } from '@lushly-dev/loam-chrome';
import {
	APPEARANCE_DENSITIES,
	APPEARANCE_QUERIES,
	APPEARANCE_THEMES,
	type AppearanceDensityV0,
	type AppearanceThemeV0,
	resolveTheme,
} from '@lushly-dev/loam-kernel';
import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';

import { mediaEnvironment, STORE_NAME } from './host.js';

const THEMES: readonly string[] = APPEARANCE_THEMES;
const DENSITIES: readonly string[] = APPEARANCE_DENSITIES;

/** The profile's last appearance, each key only if valid; none when the store does not exist or cannot be read. */
async function lastAppearance(
	view: Window
): Promise<{ theme?: AppearanceThemeV0; density?: AppearanceDensityV0 }> {
	try {
		// Opened only when it exists: opening a missing database would make an empty one.
		const names = (await view.indexedDB.databases()).map((entry) => entry.name);
		if (!names.includes(STORE_NAME)) return {};
		const store = new IndexedDbAdapter({ name: STORE_NAME, indexedDB: view.indexedDB });
		const row = await store
			.get<{ value?: Record<string, unknown> }>('settings', 'loam.appearance.last')
			.catch(() => null);
		const value = row?.value ?? {};
		return {
			...(typeof value.theme === 'string' && THEMES.includes(value.theme)
				? { theme: value.theme as AppearanceThemeV0 }
				: {}),
			...(typeof value.density === 'string' && DENSITIES.includes(value.density)
				? { density: value.density as AppearanceDensityV0 }
				: {}),
		};
	} catch {
		return {};
	}
}

/** Set `data-loam-theme` and `data-loam-density` before the page mounts, and again when the system's media change. */
export async function applyPageAppearance(doc: Document, view: Window): Promise<void> {
	const last = await lastAppearance(view);
	const theme = last.theme ?? 'system';
	const density = last.density ?? 'comfortable';
	const environment = mediaEnvironment(view);
	const apply = () =>
		applyAppearance(
			doc,
			{ theme, density, resolved: resolveTheme(theme, environment) },
			environment.matches(APPEARANCE_QUERIES.forcedColors)
		);
	apply();
	for (const query of [
		APPEARANCE_QUERIES.dark,
		APPEARANCE_QUERIES.forcedColors,
		APPEARANCE_QUERIES.moreContrast,
	])
		environment.onChange(query, apply);
}
