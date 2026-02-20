/**
 * Utility functions for adapters.
 */

import { STATUS_COLORS, StatusType, type StatusTypeValue } from './css-variables.js';

/**
 * Escape HTML special characters (fast regex version, no DOM).
 */
export function escapeHtml(text: unknown): string {
	if (typeof text !== 'string') return String(text);
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
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
