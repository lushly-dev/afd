/**
 * @fileoverview Which calls an approval step admitted (internal; not exported by the package).
 *
 * The execution engine records each call's declared approval policy on the call's own context
 * object before any middleware runs. The approval middleware decides from that record (the
 * command's own policy) and, when it lets the call through, records what it decided on: the
 * command name and the canonical JSON of the input. The engine dispatches a call whose policy is
 * not `'not-required'` only when such an admission matches the command and validated input it is
 * about to run, and it takes the admission as it dispatches, so one admission runs one handler.
 *
 * Every call gets a fresh context object (`withContextDefaults` copies), so a batch item, a
 * pipeline step or a command run from inside another command's handler has its own record and
 * never inherits an outer call's admission.
 *
 * The records live in one WeakMap on `globalThis`, under a registered symbol, so that two
 * installed copies of this package (an engine from one, the middleware from the other) share it.
 * The first copy installs it as a non-writable, non-configurable property; a later copy uses it
 * only when it is that: a plain `WeakMap` installed that way. Anything else there is ignored and
 * this copy keeps its records to itself, so an admission from elsewhere is not honoured. This is
 * not a boundary against code running in the same process or page.
 */

import type { ApprovalPolicy, CommandContext } from '@lushly-dev/afd-core';

/** The command a call runs, as its admission record keeps it. */
export interface AdmissionCommand {
	name: string;
	approval?: ApprovalPolicy<never>;
	confirmPrompt?: string;
}

/** The canonical JSON of a value, or undefined when it has none. */
export type Canonicalize = (value: unknown) => string | undefined;

/** What an approval step admitted: the command and input it decided on. */
interface Admitted {
	name: string;
	/** The canonical JSON of the input, or undefined when it has none (compared by identity). */
	canonical: string | undefined;
	input: unknown;
	/**
	 * The approval step's own canonical JSON, so a host without the approval middleware does not
	 * bundle it.
	 */
	canonicalize: Canonicalize;
}

interface Admission {
	command: AdmissionCommand;
	admitted: Admitted | undefined;
	/** Set once a dispatch took an admission, so a second dispatch reads as a mismatch. */
	taken?: boolean;
}

const KEY = Symbol.for('dev.afd/approval-admission');
// Captured once, so later changes to WeakMap.prototype do not reach these records.
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;

/**
 * The shared map on `holder` (`globalThis`) when another copy installed it as this module does,
 * else a fresh one, installed on `holder` when the key is free. Exported for its tests.
 */
export function installAdmissionRecords(holder: object = globalThis): WeakMap<object, unknown> {
	const existing = Object.getOwnPropertyDescriptor(holder, KEY);
	if (existing === undefined) {
		const map = new WeakMap<object, unknown>();
		try {
			Object.defineProperty(holder, KEY, {
				value: map,
				writable: false,
				configurable: false,
				enumerable: false,
			});
		} catch {
			// A frozen or non-extensible global: keep the records private.
		}
		return map;
	}
	const value = existing.value as unknown;
	if (
		'value' in existing &&
		existing.writable === false &&
		existing.configurable === false &&
		value instanceof WeakMap &&
		Object.getPrototypeOf(value) === WeakMap.prototype &&
		Reflect.ownKeys(value).length === 0
	) {
		return value as WeakMap<object, unknown>;
	}
	return new WeakMap();
}

const RECORDS = installAdmissionRecords() as WeakMap<CommandContext, Admission>;

function record(context: CommandContext): Admission | undefined {
	return weakGet.call(RECORDS, context) as Admission | undefined;
}

/** Record, before any middleware runs, the command this call's `context` runs, not yet admitted. */
export function beginAdmission(context: CommandContext, command: AdmissionCommand): void {
	weakSet.call(RECORDS, context, {
		command: {
			name: command.name,
			approval: command.approval,
			confirmPrompt: command.confirmPrompt,
		},
		admitted: undefined,
	});
}

/**
 * Record that an approval step admitted the call of `context` to run `commandName` on `input`.
 * The input's canonical form (`canonicalize`) is computed only for a command that declares a
 * gating policy. A no-op outside the engine.
 */
export function admitApproval(
	context: CommandContext,
	commandName: string,
	input: unknown,
	canonicalize: Canonicalize
): void {
	const found = record(context);
	if (!found) return;
	found.admitted = {
		name: commandName,
		canonical: gates(found.command.approval) ? canonicalize(input) : undefined,
		input,
		canonicalize,
	};
}

/** Whether a declared policy needs an approval step: anything but unset or `'not-required'`. */
export function gates(policy: ApprovalPolicy<never> | undefined): boolean {
	return policy !== undefined && policy !== 'not-required';
}

/**
 * Take the admission of the call of `context`: `admitted` when it admitted `commandName` on
 * `input`: the same name, and the same canonical input (the same value, when the input has no
 * canonical form), `missing` with none, `mismatch` otherwise. Taken whatever the answer, so a
 * second dispatch needs a second admission.
 */
export function takeAdmission(
	context: CommandContext,
	commandName: string,
	input: unknown
): 'admitted' | 'missing' | 'mismatch' {
	const found = record(context);
	const admitted = found?.admitted;
	if (!found) return 'missing';
	if (!admitted) return found.taken ? 'mismatch' : 'missing';
	found.admitted = undefined;
	found.taken = true;
	if (admitted.name !== commandName) return 'mismatch';
	const canonical = admitted.canonicalize(input);
	const same =
		admitted.canonical === undefined
			? admitted.input === input && canonical === undefined
			: canonical === admitted.canonical;
	return same ? 'admitted' : 'mismatch';
}

/**
 * The declared policy of the command the call of `context` runs. `found` is false when the call
 * did not come through the engine (the middleware was called directly).
 */
export function livePolicy(context: CommandContext): {
	found: boolean;
	policy: ApprovalPolicy<never> | undefined;
} {
	const found = record(context);
	return found
		? { found: true, policy: found.command.approval }
		: { found: false, policy: undefined };
}

/** The command the call of `context` runs, as recorded by the engine; undefined outside it. */
export function liveCommand(context: CommandContext): AdmissionCommand | undefined {
	return record(context)?.command;
}
