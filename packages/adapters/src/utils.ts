/**
 * Utility functions for adapters.
 */

import { STATUS_COLORS, StatusType, type StatusTypeValue } from './css-variables.js';

/**
 * Escape HTML special characters (fast regex version, no DOM).
 *
 * Any value is converted with `String(value)` first and then escaped, so a number, an object
 * with a custom `toString()` or an error message cannot inject markup. `&`, `<`, `>`, `"` and
 * `'` are escaped, which makes the result safe in element content and in single- or
 * double-quoted attribute values.
 */
export function escapeHtml(text: unknown): string {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Create a styled span using CSS variables.
 */
export function styledSpan(
	text: string,
	status: StatusTypeValue = StatusType.NEUTRAL,
	bold = false
): string {
	const color = STATUS_COLORS[status] || 'inherit';
	const fontWeight = bold ? 'font-weight: bold;' : '';
	const style = `color: ${color}; ${fontWeight}`.trim();

	return `<span style="${style}">${escapeHtml(text)}</span>`;
}
