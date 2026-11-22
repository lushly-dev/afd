/**
 * @fileoverview The `calls` grant to a mounted callee (phase 5 specification, 7.5; D30, D152), as one rule the app port
 * checks before a call and phase 4's confirmed run checks again before it runs: the caller holds the `calls` grant, its
 * `[[calls]]` names the command by its callee's app, and the callee's instance entry sets that command's `expose.apps`.
 * Native callees wait for milestone B. Pure, so the `apps` and `late` chunks each carry it.
 */

/** What the rule reads of the callee's command. */
export interface CalleeV1 {
	app: string;
	instance: string;
	recorded?: true;
	apps?: true;
}

export function mountCallGranted(
	callee: CalleeV1 | undefined,
	command: string,
	caller: string,
	granted: ReadonlySet<string>,
	calls: ReadonlyArray<{ app: string; commands: readonly string[] }> | undefined
): boolean {
	return (
		callee?.recorded === true &&
		callee.apps === true &&
		callee.instance !== caller &&
		granted.has('calls') &&
		(calls ?? []).some((call) => call.app === callee.app && call.commands.includes(command))
	);
}
