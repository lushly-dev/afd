/**
 * @fileoverview Private relay evidence carrier (`spec/command-metadata.md`, "Relay evidence").
 *
 * Set only by the MCP server's `HumanRelay` gate after `resume` returns `Approved`, read by
 * `createApprovalMiddleware`, and cleared by the execution engine before the command handler runs.
 * Never exported publicly, never read from tool arguments, `_meta`, headers or `requestState`,
 * and never stored as a property on `CommandContext` (so `JSON.stringify`, `Object.keys`,
 * `Object.getOwnPropertySymbols` and `util.inspect(ctx, { showHidden: true })` never expose it).
 *
 * Records live in one `WeakMap` on `globalThis` under a registered symbol, installed as a
 * non-writable, non-configurable, non-enumerable property (matching `approval-admission.ts`), so
 * split installations of `@lushly-dev/afd-server` (an engine from one copy and approval middleware
 * from another) share the carrier cleanly.
 *
 * Module-graph rule: loads no Node.js built-in and no MCP SDK, so `/direct` stays browser-safe.
 */

import type { CommandContext } from '@lushly-dev/afd-core';

/**
 * Server-private approval evidence from an approved `HumanRelay` decision.
 */
export interface RelayEvidence {
	readonly command: string;
	readonly inputDigest: string;
	readonly actor: string;
	readonly credentialsBinding: string;
	readonly decisionId: string;
}

/**
 * One-shot dispatch guard for a host-verified call, checked immediately before the handler runs
 * regardless of whether the command also declares an `approval` policy.
 */
export interface RelayDispatchAdmission {
	readonly command: string;
	readonly canonical: string;
	readonly canonicalize: (value: unknown) => string | undefined;
	taken?: boolean;
}

interface RelayCarrier {
	evidence?: RelayEvidence;
	validatedInput?: { command: string; data: unknown };
	dispatchAdmission?: RelayDispatchAdmission;
	transferred?: boolean;
}

const KEY = Symbol.for('dev.afd/relay-evidence');
// Captured once, so later changes to WeakMap.prototype do not reach these records.
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;
const weakDelete = WeakMap.prototype.delete;

/**
 * The shared map on `holder` (`globalThis`) when another copy installed it as this module does,
 * else a fresh one, installed on `holder` when the key is free. Exported for tests.
 */
export function installRelayEvidenceRecords(holder: object = globalThis): WeakMap<object, unknown> {
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

const RECORDS = installRelayEvidenceRecords() as WeakMap<CommandContext, RelayCarrier>;

function getOrCreate(context: CommandContext): RelayCarrier {
	let carrier = weakGet.call(RECORDS, context) as RelayCarrier | undefined;
	if (!carrier) {
		carrier = {};
		weakSet.call(RECORDS, context, carrier);
	}
	return carrier;
}

function getCarrier(context: CommandContext | undefined): RelayCarrier | undefined {
	if (!context) return undefined;
	return weakGet.call(RECORDS, context) as RelayCarrier | undefined;
}

/** Attach `evidence` to `context` off-object in the private WeakMap. */
export function attachRelayEvidence(context: CommandContext, evidence: RelayEvidence): void {
	getOrCreate(context).evidence = evidence;
}

/** Return a copy of `context` carrying private `evidence`. */
export function bindRelayEvidence(
	context: CommandContext,
	evidence: RelayEvidence
): CommandContext {
	const copy: CommandContext = { ...context };
	attachRelayEvidence(copy, evidence);
	return copy;
}

/** Read the private relay evidence bound to `context`, if any. */
export function relayEvidenceOf(context: CommandContext | undefined): RelayEvidence | undefined {
	return getCarrier(context)?.evidence;
}

/** Clear private relay evidence (and any unused prevalidated input) before the handler runs. */
export function clearRelayEvidence(context: CommandContext): void {
	const carrier = getCarrier(context);
	if (!carrier) return;
	carrier.evidence = undefined;
	carrier.validatedInput = undefined;
	if (!carrier.dispatchAdmission) {
		weakDelete.call(RECORDS, context);
	}
}

/** Attach already-validated input for a host-verified dispatch so dynamic defaults never drift. */
export function attachRelayValidatedInput(
	context: CommandContext,
	command: string,
	data: unknown
): void {
	getOrCreate(context).validatedInput = { command, data };
}

/** Take the already-validated input for `command` once, if attached. */
export function takeRelayValidatedInput(
	context: CommandContext | undefined,
	command: string
): { found: true; data: unknown } | undefined {
	const carrier = getCarrier(context);
	const entry = carrier?.validatedInput;
	if (!entry || entry.command !== command) return undefined;
	carrier.validatedInput = undefined;
	return { found: true, data: entry.data };
}

/** Attach a one-shot host-verified dispatch admission for `context`. */
export function attachRelayDispatchAdmission(
	context: CommandContext,
	admission: Omit<RelayDispatchAdmission, 'taken'>
): void {
	getOrCreate(context).dispatchAdmission = { ...admission, taken: false };
}

/**
 * Carry private relay state from `from` (`callerContext`) onto the engine's per-call `to`
 * (`context`) object, once only (on the `HumanRelay` -> engine handoff). Never moves or deletes
 * state off an active engine context, so nested `execute(..., context)` calls neither steal the
 * outer call's retry guard nor inherit its `taken` admission.
 */
export function transferRelayState(from: CommandContext, to: CommandContext): void {
	const carrier = getCarrier(from);
	if (!carrier || carrier.transferred) return;
	weakDelete.call(RECORDS, from);
	carrier.transferred = true;
	weakSet.call(RECORDS, to, carrier);
}

/**
 * Consume the one-shot host-verified dispatch admission on `context` right before invoking the
 * handler. Returns `'none'` for non-relay calls, `'admitted'` when this dispatch matches the
 * command and canonical input the person confirmed, and `'mismatch'` if input was mutated in
 * middleware or a retry middleware attempted a second dispatch under the same decision.
 */
export function takeRelayDispatchAdmission(
	context: CommandContext,
	commandName: string,
	data: unknown
): 'none' | 'admitted' | 'mismatch' {
	const carrier = getCarrier(context);
	const admission = carrier?.dispatchAdmission;
	if (!admission) return 'none';
	if (admission.taken) return 'mismatch';
	admission.taken = true;
	if (admission.command !== commandName) return 'mismatch';
	const canonical = admission.canonicalize(data);
	return canonical !== undefined && canonical === admission.canonical ? 'admitted' : 'mismatch';
}
