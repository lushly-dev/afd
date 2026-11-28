/**
 * @fileoverview The commands a replay answers from their record rather than running them again (phase 1
 * specification, 7.6), shared by the replay (`testing.ts`) and the journal's order (`journal-order.ts`, #2727).
 * Private to the kernel.
 */

/**
 * Queries whose answers depend on what has loaded, not on a command, so a replay answers them from the
 * record (phase 1 specification, 7.6). `project-summary-get` too: a wall-clock deadline decided its rows,
 * and a summary that timed out left no nested entry to answer from (phase 2 specification, 7.7 and 10).
 */
export const REPLAY_RECORDED_QUERIES: readonly string[] = Object.freeze([
	'app-list',
	'app-get',
	'app-command-list',
	'app-instance-list',
	'project-summary-get',
]);

/** Whether a replay answers every call of `command` from its record, whatever its context: its place orders nothing. */
export function recordedCommand(command: string): boolean {
	return REPLAY_RECORDED_QUERIES.includes(command) || command.startsWith('copilot-');
}
