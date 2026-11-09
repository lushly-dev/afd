/** @fileoverview The editor's pure parts, which the unit suite runs with no page. */

import type { ChecklistItemV1 } from './handlers.js';

/** "2 of 5 done", or nothing for an empty checklist, whose empty state says so. */
export function summaryOf(items: readonly ChecklistItemV1[]): string {
	if (items.length === 0) return '';
	const done = items.filter((item) => item.done).length;
	return `${done} of ${items.length} done`;
}

/**
 * Where focus goes when the focused item `gone` leaves the list: the next item that stays, else the previous
 * one, else null, the new-item field. `before` is the order the list showed.
 */
export function focusAfterRemoval(
	before: readonly string[],
	gone: string,
	kept: ReadonlySet<string>
): string | null {
	const at = before.indexOf(gone);
	if (at === -1) return null;
	const after = before.slice(at + 1).find((id) => kept.has(id));
	if (after !== undefined) return after;
	return (
		before
			.slice(0, at)
			.reverse()
			.find((id) => kept.has(id)) ?? null
	);
}
