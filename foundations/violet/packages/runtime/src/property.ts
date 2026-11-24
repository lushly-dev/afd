/**
 * The one rule that names a Violet token's CSS custom property. Every writer of Violet custom
 * properties uses it: this runtime, `@lushly-dev/violet-core`'s CSS exporter, Loam's theme and
 * `@lushly-dev/violet-elements`' theme sheet. violet-elements takes no Violet dependency (Loam
 * D50), so its `theme:build` copies this file below this comment into its generated sources, and
 * CI fails when the copy differs: keep it free of imports. Others load it from
 * `@lushly-dev/violet-runtime/property` without the rest of the runtime.
 */

/**
 * The prefix of the properties `@lushly-dev/violet-elements` reads: its `tokens/interface.json`
 * records it as `cssPrefix`, and a test there holds the two equal.
 */
export const VIOLET_CSS_PREFIX = 'violet';

/**
 * `--`, the prefix and `-` when there is one, then the id with each `.` replaced by `-`:
 * `tokenCustomProperty('color.surface.page', 'violet')` gives `--violet-color-surface-page`, and
 * with no prefix `--color-surface-page`.
 */
export function tokenCustomProperty(id: string, prefix = ''): string {
	const name = id.replaceAll('.', '-');
	return prefix ? `--${prefix}-${name}` : `--${name}`;
}
