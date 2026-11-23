/**
 * @fileoverview Fragment resolution for `loam-settings-section` (phase 4 specification, 3.5; #2098): kept apart from
 * the custom element so unit tests run it in Node without a DOM.
 */

export interface SettingsSectionState {
	section: string | null;
	path: string;
	active: string | null;
}

/**
 * Resolve a `hashchange` inside the settings section to the `section-open` target it asks for, or `undefined` when
 * the fragment already matches the kernel's `section-get` state (the shell's own `#<key>` URL write) or when the
 * location changed while `section-get` was in flight. Comparing the full `<section>/<key>` route path against
 * `section-get` rather than `#shown` also handles a fast Back before `show()` has caught up.
 */
export async function settingsHashTarget(
	location: Pick<Location, 'pathname' | 'hash'>,
	selected: string | undefined,
	readSection: () => Promise<{ success: boolean; data?: SettingsSectionState } | undefined>
): Promise<string | undefined> {
	const { pathname, hash } = location;
	let key = '';
	try {
		key = decodeURIComponent(hash.slice(1));
	} catch {
		return undefined;
	}
	if (key === '') return undefined;
	const match = /\/~\/settings\/([^/]+)$/.exec(pathname);
	let section = selected;
	if (match?.[1]) {
		try {
			section = decodeURIComponent(match[1]);
		} catch {
			return undefined;
		}
	}
	if (!section) return undefined;
	const routePath = `${section}/${key}`;
	const current = await readSection();
	// Discard stale reads if another navigation moved the URL while section-get was in flight.
	if (location.pathname !== pathname || location.hash !== hash) return undefined;
	if (
		!current?.success ||
		!current.data ||
		current.data.section !== 'settings' ||
		current.data.active !== null ||
		current.data.path === routePath
	) {
		return undefined;
	}
	return `${section}.${key}`;
}
