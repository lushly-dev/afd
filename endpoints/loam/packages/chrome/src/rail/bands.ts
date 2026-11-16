/**
 * @fileoverview Which band of the rail an app's entry is in, and whether it is dimmed (phase 2
 * specification, 7.1 and 7.3), in first paint. Pure: `RailBands` gives it `app-list`'s row and the active
 * scope. A mounted instance's `projects` reach it through the row's `available`, which the kernel reads
 * against them, so it needs no project list of its own.
 */

import type { AppSummaryV2 } from '@lushly-dev/loam-kernel';

export type RailBand = 'top' | 'bottom';

export interface RailPlacement {
	band: RailBand;
	/** `aria-disabled`, in the Tab order, with a tooltip saying why. */
	dimmed: boolean;
}

/** Where `entry` goes with `project` active, or `null` when it has no entry. */
export function bandFor(
	entry: Pick<AppSummaryV2, 'scopeLevels' | 'available' | 'rail' | 'state'>,
	project: string | undefined
): RailPlacement | null {
	if (!entry.rail || entry.state === 'disabled') return null;
	if (!entry.scopeLevels.includes('project')) return { band: 'bottom', dimmed: false };
	// D29, open with the owner: a dual-scope app with no project is in the bottom band. A different answer
	// changes this row alone, and E3's expectation.
	if (entry.scopeLevels.includes('workspace') && project === undefined) {
		return { band: 'bottom', dimmed: false };
	}
	return { band: 'top', dimmed: !entry.available };
}

/**
 * The one comparator of both bands, R8's seam: the active persona's emphasized apps first, in the order it
 * names them (phase 3 specification, 6.2), then `order`, then the instance. Emphasis orders and never hides.
 */
export const railOrder = (
	a: Pick<AppSummaryV2, 'order' | 'instance'>,
	b: Pick<AppSummaryV2, 'order' | 'instance'>,
	emphasis: readonly string[] = []
): number => {
	// An emphasized app's place in the list, and every other's after them all.
	const rank = (app: { instance: string }) =>
		(emphasis.indexOf(app.instance) + emphasis.length + 1) % (emphasis.length + 1);
	return (
		rank(a) - rank(b) ||
		a.order - b.order ||
		(a.instance < b.instance ? -1 : a.instance > b.instance ? 1 : 0)
	);
};

/** A dimmed entry's tooltip: why it cannot open here. */
export const dimmedTip = (title: string, project: string | undefined): string =>
	project === undefined
		? `Choose a project to open ${title}`
		: `${title} is not available in ${project}`;
