/**
 * @fileoverview Whether a close prompt's answer is about the tab a close holds (phase 4 specification, 7.3; step 6's third
 * round, H), apart from the editor's elements so a unit reaches it.
 */

import type { AskedClose } from '../elements/events.js';

/** The tab a close holds: its id, the scope it is shown in, and its document, as the page knows them. */
export interface ShownClose {
	tab: string;
	scope: { workspace: string; project?: string } | undefined;
	document: string | undefined;
}

/**
 * Whether a close prompt's answer is about `shown` (phase 4's 7.3; step 6's third round, H): its tab, scope and document
 * all present and the same, since a tab id repeats per project and a closed tab can keep its mark. A missing one never
 * matches.
 */
export function sameClose(asked: AskedClose, shown: ShownClose): boolean {
	return (
		asked.scope !== undefined &&
		asked.document !== undefined &&
		shown.scope !== undefined &&
		shown.document !== undefined &&
		asked.tab === shown.tab &&
		asked.document === shown.document &&
		asked.scope.workspace === shown.scope.workspace &&
		asked.scope.project === shown.scope.project
	);
}
