/**
 * @fileoverview Pure value-formatting helpers shared across views and loaders (DOM-free).
 */
const COLOR_VALUE_RE =
	/^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(.+\))$/i;

/** Return true when a resolved token value can be shown in a decorative color swatch. */
export function isColorValue(value: unknown): value is string {
	return typeof value === 'string' && COLOR_VALUE_RE.test(value.trim());
}

/** Format any TokenValue (primitive, alias, or composite object) as readable text. */
export function formatTokenValue(value: unknown): string {
	if (value === null || value === undefined) return '—';
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return JSON.stringify(value);
}

/** Return trimmed CSS color text when `value` is swatchable, or `''`. */
export function toSwatch(value: unknown): string {
	return isColorValue(value) ? value.trim() : '';
}

/** Format an audit transition from `oldValue` to `value`. */
export function formatTransition(oldValue: unknown, value: unknown): string {
	if (oldValue === null || oldValue === undefined) return formatTokenValue(value);
	return `${formatTokenValue(oldValue)} → ${formatTokenValue(value)}`;
}
