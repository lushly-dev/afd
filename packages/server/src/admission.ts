/**
 * @fileoverview One admission pipeline for every lane of the MCP server (#1743).
 *
 * Each lane (the MCP 2026-07-28 `/mcp` endpoint and stdio, the 2025-era `/message` lane, and the
 * HTTP `/rpc`, `/batch` and `/stream` routes) only decodes its request into a {@link DecodedCall}
 * and encodes the outcome. Admission runs the same named stages for all of them, in this order:
 *
 * 1. `evidence`: approval evidence in the arguments is refused, from any caller (rule 5 of
 *    "Approval evidence from an approver client", `spec/command-metadata.md`).
 * 2. `meta`: a meta-tool's `meta` argument counts as `_meta` from here on.
 * 3. `principal`: the call's context state, `createContext`'s values, the declared context fields
 *    and the output-budget ask (`createContext` wins over a declared field), and the actor and
 *    credentials the call starts with.
 * 4. `approver`: whether the caller is an approver, and whether it may carry its evidence here
 *    (only on one command from an MCP 2026-07-28 client).
 * 5. `bind`: the call's `CommandContext`: the values a handler sees, with the session, scope view,
 *    approver and the lane's channels in its host state (`host-state.ts`).
 *
 * Then the tool router (`tool-router.ts`) runs the rest, the same on every lane:
 *
 * 6. `scope`: MCP authorization (M6), a batch or pipeline as a whole;
 * 7. `resolve`: the tool to its commands (one for `afd-call`, a grouped action or a command's own
 *    tool; several for `afd-batch` and `afd-pipe`; none for `afd-discover` and `afd-detail`);
 * 8. `allow`, 9. `lookup` (D4: unexposed and hidden commands are unknown), 10. `context`
 *    (`COMMAND_NOT_IN_CONTEXT`), 11. `host-verified`, 12. `confirm`, 13. `task`;
 * 14. `execute`: the engine (`spec/dispatch.md`, from input validation on).
 *
 * A stage that refuses ends the call with its error. A refusal of stages 1 to 5 is a `CommandResult`
 * over MCP, whatever the tool (`spec/vectors/approver-client.json`), a `BatchResult` on `/batch`
 * and an error chunk on `/stream`; the router shapes its own refusals as the tool's result. The
 * HTTP routes decode as the meta-tools they stand for: `/rpc` and `/stream` as `afd-call`, and
 * `/batch` as `afd-batch`, so one call gets the same answer on every lane.
 *
 * Unexpected errors (a throwing `createContext` or `approver` predicate, credentials that cannot
 * be bound) are thrown to the lane, which answers them as an internal error.
 */

import type { Actor, CommandContext, CommandError } from '@lushly-dev/afd-core';
import { AFD_IDEMPOTENCY_KEY_META_KEY } from '@lushly-dev/afd-core';
import {
	type ApproverCall,
	type ApproverPredicate,
	approvalKeyInInput,
	bindApprover,
	decideApprover,
} from './approver.js';
import type { ContextState } from './bootstrap/afd-context.js';
import { type ContextField, contextFieldValues } from './context-fields.js';
import { bindContextState } from './context-scope.js';
import { withHostState } from './host-state.js';
import type { IdempotencyCaller } from './idempotency-step.js';
import { liftMetaArgument, metaArgumentKeys } from './meta-argument.js';
import { withMetaOutputBudget } from './output-budget.js';
import { bindScopeView, type ScopeView } from './scope-view.js';
import type { RouteOutcome, RunAdmitted, ToolRouter } from './tool-router.js';

/** Which lane received a call: what it can carry differs, the stages do not. */
export type AdmissionLane =
	/** MCP 2026-07-28: `POST /mcp` and a modern stdio connection. */
	| 'mcp'
	/** A 2025-era MCP request: the `/message` lane, a legacy `/mcp` or stdio connection. */
	| 'mcp-legacy'
	/** The HTTP `/rpc`, `/batch` and `/stream` routes. */
	| 'rest';

/** The stages admission runs before the router, by name. */
export const ADMISSION_STAGES = ['evidence', 'meta', 'principal', 'approver', 'bind'] as const;

/** Who a call runs as, as it starts. */
export interface CallPrincipal {
	/** The actor the commands run with: `createContext`'s, or the server's default. */
	readonly actor: Actor | undefined;
	/** `createContext`'s (or the verified request's) credentials. */
	readonly credentials: unknown;
	/** The approver's call, when the caller is an approver. */
	readonly approver: ApproverCall | undefined;
}

/** One call, as a lane decoded it. */
export interface DecodedCall {
	readonly lane: AdmissionLane;
	/** The tool called. `/rpc` and `/stream` decode as `afd-call`, `/batch` as `afd-batch`. */
	readonly tool: string;
	/** The tool's arguments, without `_meta`. */
	readonly args: unknown;
	/** The request's own `_meta`. */
	readonly meta: unknown;
	/**
	 * The caller's context state, given the call's `_meta` values (the `meta` stage's): a
	 * session's, a request's, `null` for a caller without one, or `undefined` for the server's own.
	 * May throw the lane's protocol error (an unknown context, an unknown session).
	 */
	state(meta: unknown): ContextState | null | undefined;
	/** `createContext`'s values for the request (none on stdio). */
	values(): Promise<Record<string, unknown>> | Record<string, unknown>;
	/** The request's scope view under MCP authorization (M6). */
	readonly view?: ScopeView;
	/** Aborts the call (the client went away). */
	readonly signal?: AbortSignal;
	/**
	 * How the lane tells callers apart, for the idempotency step (`spec/idempotency.md`, S3):
	 * `http` for an HTTP request, or the connection a stdio call arrived on. Absent: in process.
	 */
	readonly transport?:
		| { readonly kind: 'http' }
		| { readonly kind: 'connection'; readonly connection: object };
	/**
	 * Bind what this request can carry (confirmation and relay channels, the approval relay, task
	 * dispatch) to the call's context, once its principal is known.
	 */
	channels?(context: CommandContext, principal: CallPrincipal): CommandContext;
}

/** What stages 1 to 5 decided. */
export type Admission =
	| { kind: 'refused'; stage: (typeof ADMISSION_STAGES)[number]; error: CommandError }
	| { kind: 'admitted'; tool: string; args: unknown; context: CommandContext };

export interface AdmissionDeps {
	/** Runs stages 6 to 14. */
	router: ToolRouter;
	/** Declared context fields, read from each call's `_meta`. */
	contextFields?: readonly ContextField[];
	/** Which callers are approvers (the server's `approver` option). */
	approver?: ApproverPredicate;
	/** The actor of a call whose context has none (the server's `actor` option). */
	actor?: Actor;
	/**
	 * Whether the server can tell apart the HTTP caller with `credentials` (S3): it has `auth` and
	 * the request carries credentials, or `createContext` is declared to identify every caller.
	 * Default: it cannot.
	 */
	identifiesHttpCaller?: (credentials: unknown) => boolean;
}

export interface AdmissionPipeline {
	/** Run stages 1 to 5. */
	admit(call: DecodedCall): Promise<Admission>;
	/**
	 * Admit `call` and route it; `run` replaces the engine for the one command a single-command
	 * call admits (the `/stream` lane streams it).
	 */
	run(call: DecodedCall, run?: RunAdmitted): Promise<RouteOutcome>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** `_meta["dev.afd/idempotencyKey"]` as `idempotencyKey`, or nothing for an absent or null key. */
function idempotencyKeyOf(meta: unknown): { idempotencyKey?: string } {
	if (!isRecord(meta)) return {};
	const key = meta[AFD_IDEMPOTENCY_KEY_META_KEY];
	return key === undefined || key === null ? {} : { idempotencyKey: key as string };
}

/** A shallow copy of a plain object; anything else as it is. */
function shallowCopy(value: unknown): unknown {
	return isRecord(value) ? { ...value } : value;
}

/** Create the admission pipeline every lane of one server shares. */
export function createAdmission(deps: AdmissionDeps): AdmissionPipeline {
	const metaKeys = metaArgumentKeys(deps.contextFields);

	async function admit(call: DecodedCall): Promise<Admission> {
		// 1. evidence: approval evidence is never input, from any caller.
		const keyed = approvalKeyInInput(call.args);
		if (keyed) return { kind: 'refused', stage: 'evidence', error: keyed };

		// 2. meta: a meta-tool's `meta` argument counts as `_meta` from here on.
		const lifted = liftMetaArgument(call.tool, call.args, call.meta, metaKeys);
		if (!lifted.ok) return { kind: 'refused', stage: 'meta', error: lifted.error };

		// 3. principal. Declared fields from `_meta` first, so a value `createContext` sets wins.
		// Neither `actor` nor `credentials` can be a declared field: only `createContext` sets them.
		const state = call.state(lifted.meta);
		const values = await call.values();
		const callValues: CommandContext = withMetaOutputBudget(
			{
				...contextFieldValues(deps.contextFields, lifted.meta),
				// The idempotency key, as sent: the engine checks its form between the context check and
				// validation (spec/idempotency.md, K2). A value `createContext` sets wins (K1).
				...idempotencyKeyOf(lifted.meta),
				...values,
			},
			lifted.meta,
			values
		);
		// Copied, so that code changing them in place later cannot change what a channel binds.
		const actor = shallowCopy(callValues.actor ?? deps.actor) as Actor | undefined;
		const credentials = shallowCopy(callValues.credentials);

		// 4. approver: an approver's call carries its evidence in the request's own `_meta`.
		const carrier = decideApprover({
			approver: deps.approver,
			context: { ...callValues, actor, interface: 'mcp' },
			actor,
			credentials,
			meta: call.meta,
			tool: call.tool,
			modern: call.lane === 'mcp',
		});
		if (carrier.kind === 'refuse')
			return { kind: 'refused', stage: 'approver', error: carrier.error };

		// 5. bind: the values a handler sees, and the host state it cannot.
		const values5: CommandContext = {
			...callValues,
			...(call.signal && { signal: call.signal }),
			interface: 'mcp',
		};
		let context = bindScopeView(
			state === undefined ? values5 : bindContextState(values5, state),
			call.view
		);
		const caller = idempotencyCaller(call, callValues.actor as Actor | undefined, credentials);
		if (caller) context = withHostState(context, { idempotencyCaller: caller });
		if (carrier.approver) context = bindApprover(context, carrier.approver);
		if (call.channels) {
			context = call.channels(context, { actor, credentials, approver: carrier.approver });
		}
		return { kind: 'admitted', tool: call.tool, args: lifted.args ?? {}, context };
	}

	/**
	 * Who the lane says the caller is (S3): an HTTP caller, identified or not; or, on a connection
	 * lane, the connection, for a caller with neither an actor nor credentials of its own.
	 */
	function idempotencyCaller(
		call: DecodedCall,
		ownActor: Actor | undefined,
		credentials: unknown
	): IdempotencyCaller | undefined {
		const transport = call.transport;
		if (!transport) return undefined;
		if (transport.kind === 'http') {
			return { kind: 'http', identified: deps.identifiesHttpCaller?.(credentials) === true };
		}
		return ownActor === undefined && (credentials === undefined || credentials === null)
			? { kind: 'connection', connection: transport.connection }
			: undefined;
	}

	return {
		admit,
		async run(call, run) {
			const admission = await admit(call);
			if (admission.kind === 'refused') return { kind: 'refused', error: admission.error };
			return deps.router.route(admission.tool, admission.args, admission.context, run);
		},
	};
}
