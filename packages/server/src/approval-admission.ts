/**
 * @fileoverview Which calls an approval step admitted (internal; not exported by the package).
 *
 * The execution engine records each call's declared approval policy on the call's own context
 * object before any middleware runs. The approval middleware decides from that record (the
 * command's own policy) and marks the call admitted when it lets it through. The engine then
 * refuses to dispatch a call whose policy is not `'not-required'` unless it was admitted, so a
 * declared policy holds whether or not an approval middleware is installed.
 *
 * Every call gets a fresh context object (`withContextDefaults` copies), so a batch item, a
 * pipeline step or a command run from inside another command's handler has its own record and
 * never inherits an outer call's admission.
 *
 * The records live in one WeakMap on `globalThis`, under a registered symbol, so that two
 * installed copies of this package (an engine from one, the middleware from the other) share it.
 */

import type { ApprovalPolicy, CommandContext } from '@lushly-dev/afd-core';

/** The command a call runs, as its admission record keeps it. */
export interface AdmissionCommand {
	name: string;
	approval?: ApprovalPolicy<never>;
	confirmPrompt?: string;
}

interface Admission {
	command: AdmissionCommand;
	admitted: boolean;
}

const KEY = Symbol.for('dev.afd/approval-admission');

function records(): WeakMap<CommandContext, Admission> {
	const holder = globalThis as { [KEY]?: WeakMap<CommandContext, Admission> };
	let map = holder[KEY];
	if (!(map instanceof WeakMap)) {
		map = new WeakMap();
		holder[KEY] = map;
	}
	return map;
}

/** Record, before any middleware runs, the command this call's `context` runs, not yet admitted. */
export function beginAdmission(context: CommandContext, command: AdmissionCommand): void {
	records().set(context, {
		command: {
			name: command.name,
			approval: command.approval,
			confirmPrompt: command.confirmPrompt,
		},
		admitted: false,
	});
}

/** Mark the call of `context` admitted by an approval step. A no-op outside the engine. */
export function admitApproval(context: CommandContext): void {
	const record = records().get(context);
	if (record) record.admitted = true;
}

/** Whether an approval step admitted the call of `context`. */
export function approvalAdmitted(context: CommandContext): boolean {
	return records().get(context)?.admitted === true;
}

/**
 * The declared policy of the command the call of `context` runs. `found` is false when the call
 * did not come through the engine (the middleware was called directly).
 */
export function livePolicy(context: CommandContext): {
	found: boolean;
	policy: ApprovalPolicy<never> | undefined;
} {
	const record = records().get(context);
	return record
		? { found: true, policy: record.command.approval }
		: { found: false, policy: undefined };
}

/** The command the call of `context` runs, as recorded by the engine; undefined outside it. */
export function liveCommand(context: CommandContext): AdmissionCommand | undefined {
	return records().get(context)?.command;
}
