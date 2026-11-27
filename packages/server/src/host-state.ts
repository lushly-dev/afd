/**
 * @fileoverview Trusted host state: what the server's lanes and gates know about a call, kept
 * apart from the values a handler sees on its `CommandContext` (#1743).
 *
 * The lanes and the admission pipeline (`admission.ts`) bind the call's session, scope view,
 * channels and the rest here, once, as one frozen record. A context carries it as one opaque
 * token under one module-private symbol. Spreading the context (`{ ...context, traceId }`) copies
 * the token, so a command a handler runs with its own context is still decided under the caller's
 * session and authorization. Nothing else can read, change or forge it:
 *
 * - the token is an empty frozen object; the record lives in this module's `WeakMap`, so
 *   `JSON.stringify`, `Object.keys` and the token itself reveal nothing;
 * - tool arguments and `createContext` values are string keys, so they cannot reach the symbol;
 * - a token this module did not mint is a forged one: it carries no state, and its command
 *   `allow` refuses every command (`command-allow.ts`), so forging never widens a call.
 *
 * A handler can still remove the token from its own context (its key is one of the context's own
 * symbols), as it could remove each of the nine symbols this record replaced: what it then runs is
 * a fresh in-process call, with the engine's own context state and no scope view or `allow`.
 *
 * The cross-copy records keyed under `Symbol.for` (approval admission, relay evidence, the
 * journal, the output-budget ask) stay where they are: they are shared between installed copies
 * of this package on purpose.
 *
 * Module-graph rule: loads nothing at run time, so the engine, the router and `/direct` stay
 * browser-safe.
 */

import type { CommandContext } from '@lushly-dev/afd-core';
import type { DirectAllow } from '@lushly-dev/afd-core/internal/direct-allow';
import type { ApprovalRelay, UpFrontApproval } from './approval-relay.js';
import type { ApproverCall } from './approver.js';
import type { ContextState } from './bootstrap/afd-context.js';
import type { ConfirmationChannel } from './confirmations.js';
import type { HumanRelayChannel } from './human-relay.js';
import type { IdempotencyCaller } from './idempotency-step.js';
import type { ScopeView } from './scope-view.js';
import type { TaskDispatch } from './task-dispatch.js';

/** Everything the host knows about a call that its handler must not read or change. */
export interface HostState {
	/**
	 * The caller's context state: a session's, a request's, or `null` for a caller without one
	 * (a stateless HTTP request). Absent: the engine's own (stdio, in process).
	 */
	readonly contextState?: ContextState | null;
	/** The request's scope view under MCP authorization (M6). */
	readonly scopeView?: ScopeView;
	/** The approver's call, when the caller is an approver. */
	readonly approver?: ApproverCall;
	/** The approval relay of a call that can elicit. */
	readonly approvalRelay?: ApprovalRelay;
	/** The up-front approval of an `afd-batch` or `afd-pipe` step. */
	readonly upFrontApproval?: UpFrontApproval;
	/** What the request can carry for confirmations. */
	readonly confirmationChannel?: ConfirmationChannel;
	/** What the request can carry for a host-verified relay. */
	readonly humanRelayChannel?: HumanRelayChannel;
	/** MCP Tasks dispatch for the call. */
	readonly taskDispatch?: TaskDispatch;
	/** Who the lane says the caller is, for the idempotency step (`spec/idempotency.md`, S3). */
	readonly idempotencyCaller?: IdempotencyCaller;
	/** Set on a call that runs as an MCP task, on which the idempotency step never acts (S11). */
	readonly taskRun?: true;
	/** A direct registry call's `allow` predicate, combined with any it was nested in. */
	readonly commandAllow?: DirectAllow;
	/** Set on the state of a token this module did not mint. */
	readonly forged?: true;
}

const HOST = Symbol('afd.hostState');
const EMPTY: Readonly<HostState> = Object.freeze({});
const FORGED: Readonly<HostState> = Object.freeze({ forged: true });

/** The records behind the tokens this module minted. */
const records = new WeakMap<object, Readonly<HostState>>();

/** A new token for `state`. A forged state stays forged: `forged` is spread in with the rest. */
function mint(state: HostState): object {
	const token = Object.freeze({});
	records.set(token, Object.freeze(state));
	return token;
}

/**
 * The host state `context` carries: empty without a token, and `{ forged: true }` for a token
 * this module did not mint (any value under the symbol, `undefined` included).
 */
export function hostState(context: CommandContext | undefined): Readonly<HostState> {
	if (!context || !(HOST in context)) return EMPTY;
	return records.get((context as Record<symbol, object>)[HOST] as object) ?? FORGED;
}

/** A copy of `context` whose host state is its own with `patch` applied (`undefined` removes). */
export function withHostState<T extends CommandContext>(context: T, patch: Partial<HostState>): T {
	return { ...context, [HOST]: mint({ ...hostState(context), ...patch }) };
}

/**
 * Apply `patch` to the host state of `context` itself, not a copy, when it carries one. Only the
 * approval middleware does this, to release a step's up-front approval before its handler runs
 * (`releaseUpFrontApproval`).
 */
export function patchHostStateInPlace(context: CommandContext, patch: Partial<HostState>): void {
	if (HOST in context) {
		(context as Record<symbol, object>)[HOST] = mint({ ...hostState(context), ...patch });
	}
}
