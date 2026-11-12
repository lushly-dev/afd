/**
 * @fileoverview Scope decisions (`spec/authorization.md`, M6): the static rule, a host's
 * `ScopeResolver`, the decision on a whole request, and the challenge of a host whose callers
 * authenticate by a scheme of its own. Pure: no request, server or transport.
 */

import { isScopeToken } from './mcp-auth-resource.js';
import type { Credentials } from './mcp-auth-rules.js';

/**
 * A scope decision for one call: `'allowed'` when the credentials hold every scope it needs,
 * `{ missing }` naming the scopes it lacks (in the decider's order), or `'defer'` to let the
 * registry answer it (for when naming a scope would reveal something).
 */
export type ScopeDecision = 'allowed' | 'defer' | { missing: readonly string[] };

/**
 * A host's per-call scope rule (`spec/authorization.md`, M6, "A resolver"). It decides every call
 * instead of the static rule (a command's `scopes`); the server's `requiredScopes` still apply.
 *
 * `resolve` is asked twice for a call that runs a command: before dispatch, on the arguments as
 * sent (not validated, no defaults, pipeline references unresolved), for the 403 and again after
 * routing; and at execution, on the validated input, for every command the registry runs with
 * credentials. Decide on the values, not on whether they were sent, so both agree. For a
 * meta-tool that names no command (`afd-discover`, `afd-detail`, or `afd-call`, `afd-batch` and
 * `afd-pipe` without a command for every step), `command` is the tool's own name and `input` its
 * arguments as sent, which may name any command, hidden ones included: decide such a tool without
 * asking whether a command its input names exists. It is never asked about a name that does not
 * exist for the caller (unknown, not exposed to MCP, or not `known`).
 *
 * `visible` and `known` must be pure functions of the command and the credentials. With
 * `filterToolsByScope`, the listings show a command only when both hold, and a command `known`
 * rejects does not exist for the caller on any route (M6, "Hidden commands"). `known` defaults
 * to `visible`.
 */
export interface ScopeResolver {
	resolve(command: string, input: unknown, credentials: Credentials): ScopeDecision;
	visible(command: string, credentials: Credentials): boolean;
	known?(command: string, credentials: Credentials): boolean;
}

/**
 * The static rule (M6): a call needs `required` (the server's `requiredScopes`), then the
 * command's `scopes`, without repeats. `'allowed'` when `held` holds each one exactly
 * (case-sensitive, no hierarchy), else `{ missing }` with those not held, in that order. It never
 * defers.
 */
export function staticDecision(
	required: readonly string[],
	scopes: readonly string[],
	held: readonly string[]
): ScopeDecision {
	const missing: string[] = [];
	for (const scope of [...required, ...scopes]) {
		if (!held.includes(scope) && !missing.includes(scope)) missing.push(scope);
	}
	return missing.length === 0 ? 'allowed' : { missing };
}

/**
 * What a whole request gets from the decisions on its steps: `'proceed'` when none is missing
 * (a `'defer'` step is answered by the registry), else `{ forbidden }` naming every missing scope
 * of every step, each once, in step order.
 */
export type RequestDecision = 'proceed' | { forbidden: readonly string[] };

/** A host-facing warning sink for a resolver's mistakes; never given the call's input. */
export type ScopeWarning = (message: string) => void;

const defaultWarning: ScopeWarning = (message) => console.warn(`[afd] ${message}`);

/**
 * The decision on a request whose steps were decided `decisions` (M6). Any `{ missing }` refuses
 * the request, even one that names no scope or a name that is not a scope token: such a name is
 * the resolver's mistake, reported to `warn` without the call's input and left out of the list.
 */
export function requestDecision(
	decisions: readonly ScopeDecision[],
	warn: ScopeWarning = defaultWarning
): RequestDecision {
	let refused = false;
	const missing: string[] = [];
	for (const decision of decisions) {
		if (decision === 'allowed' || decision === 'defer') continue;
		refused = true;
		const named = Array.isArray(decision.missing) ? decision.missing : [];
		if (named.length === 0 || named.some((scope) => !isScopeToken(scope))) {
			warn('a scope decision answered missing without valid scope names; the call is refused');
		}
		for (const scope of named) {
			if (isScopeToken(scope) && !missing.includes(scope)) missing.push(scope);
		}
	}
	return refused ? { forbidden: missing } : 'proceed';
}

/** The required scopes' decision, then a call's own. */
export function mergeDecisions(required: ScopeDecision, decision: ScopeDecision): ScopeDecision {
	if (typeof required === 'object') {
		if (typeof decision !== 'object') return required;
		const missing = [...required.missing];
		for (const scope of decision.missing) if (!missing.includes(scope)) missing.push(scope);
		return { missing };
	}
	return decision;
}

/** Whether `decision` is one a resolver may return; anything else refuses, failing closed. */
export function checkedDecision(decision: unknown): ScopeDecision {
	if (decision === 'allowed' || decision === 'defer') return decision;
	const missing = (decision as { missing?: unknown } | null | undefined)?.missing;
	if (typeof decision === 'object' && Array.isArray(missing))
		return { missing: missing.map(String) };
	return { missing: [] };
}

/** An HTTP token (RFC 9110 5.6.2). */
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** A parameter value that is always one quoted string without escapes. */
const QUOTED_VALUE = /^[ \x21\x23-\x5B\x5D-\x7E]*$/;

/**
 * The `WWW-Authenticate` challenge of a host's 403 when its callers authenticate by a scheme of
 * its own rather than `Bearer` (`spec/authorization.md`, M6, "A host's own layer"):
 * `<scheme> <name>="<value>", ..., error="insufficient_scope", scope="<missing>"`, the host's
 * parameters first, in the order given, `scope` left out rather than sent empty, and nothing
 * pointing to protected-resource metadata.
 */
export class ScopeChallenge {
	readonly #scheme: string;
	readonly #params: readonly (readonly [string, string])[];

	/**
	 * @throws Error when `scheme` is not an HTTP token, or is `Bearer` in any case (M5's own
	 *   challenge); or a parameter's name is not an HTTP token, is `error` or `scope` in any case,
	 *   or is given twice, or its value holds anything but visible ASCII and spaces, or `"` or `\`
	 */
	constructor(scheme: string, params: Readonly<Record<string, string>> = {}) {
		if (typeof scheme !== 'string' || !HTTP_TOKEN.test(scheme)) {
			throw new Error(`[AFD] the challenge scheme ${JSON.stringify(scheme)} is not an HTTP token`);
		}
		if (scheme.toLowerCase() === 'bearer') {
			throw new Error(
				"[AFD] a Bearer 403 is M5's own challenge; a ScopeChallenge names another scheme"
			);
		}
		const seen = new Set<string>();
		const kept: [string, string][] = [];
		for (const [name, value] of Object.entries(params)) {
			const folded = name.toLowerCase();
			if (!HTTP_TOKEN.test(name)) {
				throw new Error(
					`[AFD] the challenge parameter ${JSON.stringify(name)} is not an HTTP token`
				);
			}
			if (folded === 'error' || folded === 'scope') {
				throw new Error(
					`[AFD] the challenge parameter ${JSON.stringify(name)} is set by the scope decision`
				);
			}
			if (seen.has(folded)) {
				throw new Error(
					`[AFD] the challenge parameter ${JSON.stringify(name)} is named more than once`
				);
			}
			if (typeof value !== 'string' || !QUOTED_VALUE.test(value)) {
				throw new Error(
					`[AFD] the value of the challenge parameter ${JSON.stringify(name)} must be visible ASCII or spaces, without '"' or '\\'`
				);
			}
			seen.add(folded);
			kept.push([name, value]);
		}
		this.#scheme = scheme;
		this.#params = Object.freeze(kept);
	}

	/** The challenge's value for the `missing` scopes, in order; only scope tokens are named. */
	headerValue(missing: readonly string[]): string {
		const params = this.#params.map(([name, value]) => `${name}="${value}"`);
		params.push('error="insufficient_scope"');
		const scopes = missing.filter((scope) => isScopeToken(scope)).join(' ');
		if (scopes) params.push(`scope="${scopes}"`);
		return `${this.#scheme} ${params.join(', ')}`;
	}
}
