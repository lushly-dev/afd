/**
 * @fileoverview The experiments list's words (phase 4 specification, 5.2 and 5.4), apart from its element so a unit
 * reads them with no DOM: where an experiment's state comes from, and when it ends.
 */

/** A row of `experiment-list` (5.4). */
export interface ExperimentRow {
	fullId: string;
	owner: string;
	title: string;
	changes: string;
	ends: string;
	stage: 'hidden' | 'visible' | 'graduated' | 'removed';
	on: boolean;
	by: 'stage' | 'person' | 'workspace' | null;
	workspace: boolean;
	changed: boolean;
	overdue: boolean;
}

/** Where an experiment's state for the person comes from, in words (5.2). */
export function stateWords(row: ExperimentRow): string {
	if (row.stage === 'graduated') return 'On for everyone: it is part of the app now.';
	if (row.by === 'person') return row.on ? 'On: you turned it on.' : 'Off: you turned it off.';
	if (row.by === 'workspace') return 'On: an owner turned it on for the workspace.';
	return 'Off.';
}

/** `ends` as a reader says it, from `YYYY-MM-DD`, in UTC so no time zone moves the day. */
export function endWords(row: Pick<ExperimentRow, 'ends' | 'overdue'>): string {
	const day = new Date(`${row.ends}T00:00:00Z`);
	const said = Number.isNaN(day.getTime())
		? row.ends
		: day.toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				timeZone: 'UTC',
			});
	return row.overdue
		? `Was to end ${said}. It stays as it is until its app graduates or removes it.`
		: `Ends ${said}.`;
}
