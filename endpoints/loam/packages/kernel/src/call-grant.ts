/**
 * @fileoverview The `calls` grant (phase 5 specification, 7.5 and 9.1; D30, D152), as one rule that AFD's
 * `createAppCallRegistry` asks before an app's call to another app runs, and phase 4's confirmed run asks again: the
 * caller holds the `calls` grant, its `[[calls]]` names the command by its callee's app (the plugin id, so each of two
 * mounts of one plugin is matched by its own commands), the callee is another instance, and the callee's command sets
 * `expose.apps`, from a version 3 manifest or a mounted instance's entry. Pure, so the `apps` and `late` chunks each
 * carry it, and first paint only its symbol.
 */

/** What the rule reads of the callee's command. */
export interface CalleeV1 {
	app: string;
	instance: string;
	recorded?: true;
	apps?: true;
}

/** A caller's `[[calls]]`, as its manifest holds them. */
export type CallsV1 = ReadonlyArray<{ app: string; commands: readonly string[] }> | undefined;

/**
 * Set on an app call's fields by the port, and on its context by the kernel: the `apps` registry's grant check marks it
 * admitted, so the port tells an admission denial, which no middleware journaled, from the callee's own refusal, which
 * its own entry did (9.1's step 3).
 */
export const ADMISSION = Symbol.for('dev.loam/admission');

/** The holder {@link ADMISSION} names: `admitted` once the grant check let the call in. */
export interface AdmissionV1 {
	admitted: boolean;
}

/** Whether `caller` may call `command` of `callee` under its grants and `[[calls]]` (9.1's step 2, less liveness). */
export function appCallGranted(
	callee: CalleeV1 | undefined,
	command: string,
	caller: string,
	granted: ReadonlySet<string>,
	calls: CallsV1
): boolean {
	return (
		callee !== undefined &&
		callee.apps === true &&
		callee.instance !== caller &&
		granted.has('calls') &&
		(calls ?? []).some((call) => call.app === callee.app && call.commands.includes(command))
	);
}

/** A mounted callee (7.5): the rule, for a command whose call is recorded. */
export function mountCallGranted(
	callee: CalleeV1 | undefined,
	command: string,
	caller: string,
	granted: ReadonlySet<string>,
	calls: CallsV1
): boolean {
	return callee?.recorded === true && appCallGranted(callee, command, caller, granted, calls);
}

/**
 * The concrete instances `caller` may call at least one command of (9.2's `grantedInstances`): two mounts of one plugin
 * are each granted only by a command of their own that `[[calls]]` names and their entry exposes to apps.
 */
export function grantedInstances(
	owners: ReadonlyMap<string, CalleeV1>,
	caller: string,
	granted: ReadonlySet<string>,
	calls: CallsV1
): Set<string> {
	const found = new Set<string>();
	if (!granted.has('calls')) return found;
	for (const call of calls ?? [])
		for (const command of call.commands) {
			const callee = owners.get(command);
			if (callee && appCallGranted(callee, command, caller, granted, calls))
				found.add(callee.instance);
		}
	return found;
}
