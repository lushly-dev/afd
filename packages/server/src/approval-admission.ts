/**
 * @fileoverview Which calls an approval step admitted (internal; not exported by the package).
 *
 * The execution engine records each call's declared approval policy on the call's own context
 * object before any middleware runs. The approval middleware decides from that record (the
 * command's own policy) and, when it lets the call through, records what it decided on: the
 * command name, the canonical JSON of the input it decided on, and whether the policy its
 * `commands` option lists for the command gates it. The engine dispatches a call whose own or
 * listed policy is not `'not-required'` only when every such admission matches the command and
 * validated input it is about to run, and it takes them as it dispatches, so one admission runs
 * one handler. An input with no canonical form, which only a policy that let the call through
 * admits (the middleware refuses to hold one), is compared by identity, so a change inside it is
 * not seen.
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
	/** The command's `secret` declaration, which the journal middleware reads. */
	secret?: boolean;
	/** The command's `mutation` declaration, which the retry middleware reads. */
	mutation?: boolean;
}

/** The canonical JSON of a value, or undefined when it has none. */
export type Canonicalize = (value: unknown) => string | undefined;

/** What an approval step admitted: the command and input it decided on. */
interface Admitted {
	/** The approval step (one middleware instance) that admitted it. */
	step: object;
	name: string;
	/** The canonical JSON of the input it decided on, or undefined when it has none (compared by identity). */
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
	/**
	 * The continuations the engine itself built for this call's middleware chain. Only a
	 * middleware the engine invoked holds one, so a recorder handed one of these is the engine's;
	 * a recorder a handler runs itself, on the same context and with a `next` of its own, is not.
	 */
	chain?: WeakSet<object>;
	/**
	 * What each approval step admitted since the last dispatch. Two approval middlewares on one
	 * engine each admit, and the dispatch must match them all, so a later one never replaces or
	 * weakens an earlier one's binding.
	 */
	admitted: Admitted[];
	/**
	 * Every approval step that ever admitted this call. A dispatch needs a fresh admission from
	 * each, so a retry that reruns only the steps after one of them is refused.
	 */
	steps: Set<object>;
	/** Set once a dispatch took an admission, so a second dispatch reads as a mismatch. */
	taken?: boolean;
	/**
	 * Set by the approval step when the policy its `commands` option lists for the command gates
	 * it, so the engine takes and checks the admission as it does for the command's own policy.
	 * Never cleared: a later dispatch on the same context is checked too.
	 */
	listedGate?: boolean;
}

const KEY = Symbol.for('dev.afd/approval-admission');
// Captured once, so later changes to WeakMap.prototype do not reach these records.
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;

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
			...(command.secret === true && { secret: true }),
			// Always a boolean in this copy's records, so a record from an older copy of the
			// package, which never sets it, reads as unknown.
			mutation: command.mutation === true,
		},
		admitted: [],
		steps: new Set(),
	});
}

/** What an approval step decided on when it let a call through. */
export interface Admit {
	/** The approval step (one middleware instance) admitting it. */
	step: object;
	commandName: string;
	/**
	 * The canonical JSON of the input it decided on (verified a token against, or found not to
	 * need approval), computed before any await, or undefined when it has none.
	 */
	canonical: string | undefined;
	/** The input it decided on, compared by identity when it has no canonical form. */
	input: unknown;
	/** Whether the policy its `commands` option lists for the command gates it. */
	listedGate: boolean;
	/** Its canonical JSON, for the engine to compare the input it dispatches. */
	canonicalize: Canonicalize;
}

/** Record that an approval step admitted the call of `context`. A no-op outside the engine. */
export function admitApproval(context: CommandContext, admit: Admit): void {
	const found = record(context);
	if (!found) return;
	if (admit.listedGate) found.listedGate = true;
	setAdd.call(found.steps, admit.step);
	found.admitted.push({
		step: admit.step,
		name: admit.commandName,
		canonical: admit.canonical,
		input: admit.input,
		canonicalize: admit.canonicalize,
	});
}

/**
 * Record that the policy an approval step's `commands` option lists for the command the call of
 * `context` runs gates it, whatever name the step was called with, so a call renamed on its way
 * to the step is still checked at dispatch. A no-op outside the engine.
 */
export function markListedGate(context: CommandContext): void {
	const found = record(context);
	if (found) found.listedGate = true;
}

/**
 * Whether the engine must take and check an admission before it dispatches the call of
 * `context`: its command's own policy gates it, or an approval step recorded that its listed
 * policy does.
 */
export function needsAdmission(context: CommandContext): boolean {
	const found = record(context);
	return found !== undefined && (gates(found.command.approval) || found.listedGate === true);
}

/** Whether a declared policy needs an approval step: anything but unset or `'not-required'`. */
export function gates(policy: ApprovalPolicy<never> | undefined): boolean {
	return policy !== undefined && policy !== 'not-required';
}

/**
 * Take the admissions of the call of `context`: `admitted` when every approval step that ever
 * admitted it admitted it again since the last dispatch, each on `commandName` and `input`: the
 * same name, and the same canonical input (the same value, by `Object.is`, when the input has no
 * canonical form; a change inside such a value is not seen), `missing` with none, `mismatch`
 * otherwise. Taken whatever the answer, so a second dispatch needs a second admission from each.
 */
export function takeAdmission(
	context: CommandContext,
	commandName: string,
	input: unknown
): 'admitted' | 'missing' | 'mismatch' {
	const found = record(context);
	if (!found) return 'missing';
	const admitted = found.admitted;
	if (admitted.length === 0) return found.taken ? 'mismatch' : 'missing';
	found.admitted = [];
	found.taken = true;
	const fresh = new Set<object>();
	for (const step of admitted) setAdd.call(fresh, step.step);
	for (const step of found.steps) if (!setHas.call(fresh, step)) return 'mismatch';
	const same = admitted.every((step) => {
		if (step.name !== commandName) return false;
		const canonical = step.canonicalize(input);
		return step.canonical === undefined
			? Object.is(step.input, input) && canonical === undefined
			: canonical === step.canonical;
	});
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

/**
 * Mark `inner` as the engine's when `outer` is: `composeMiddleware` builds continuations of its own
 * for the parts it composes, and a part the engine reached through it is still the engine's.
 */
export function inheritEngineNext(context: CommandContext, outer: object, inner: object): void {
	const found = record(context);
	if (found?.chain && weakSetHas.call(found.chain, outer)) weakSetAdd.call(found.chain, inner);
}

/** Mark `next` as a continuation the engine built for the call of `context`. */
export function markEngineNext(context: CommandContext, next: object): void {
	const found = record(context);
	if (!found) return;
	if (!found.chain) found.chain = new WeakSet();
	weakSetAdd.call(found.chain, next);
}

/**
 * Whether the command the engine runs for `context` declares `secret`, for the journal: `true` or
 * `false` for a middleware the engine invoked (its `next` is one the engine built), and
 * `undefined` for any other recorder: outside the engine, or one a handler runs itself on the
 * same context, at any time.
 */
export function liveSecret(context: CommandContext, next: object): boolean | undefined {
	const found = record(context);
	if (!found?.chain || !weakSetHas.call(found.chain, next)) return undefined;
	return found.command.secret === true;
}

/**
 * Whether the command the engine runs for `context` declares `mutation`, for the retry
 * middleware: `true` or `false` for a middleware the engine invoked, and `undefined` for any other
 * caller, as {@link liveSecret} decides.
 */
export function liveMutation(context: CommandContext, next: object): boolean | undefined {
	const found = record(context);
	if (!found?.chain || !weakSetHas.call(found.chain, next)) return undefined;
	const mutation = found.command.mutation;
	return typeof mutation === 'boolean' ? mutation : undefined;
}
