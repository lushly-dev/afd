/**
 * @fileoverview Pre-execution approval gate (#272).
 *
 * `createApprovalMiddleware` holds a call whose command's `approval` policy requires a human's
 * sign-off and returns `APPROVAL_REQUIRED` before the handler runs. The result carries an
 * approval token; once a human approves, the surface retries the same call with that token in
 * `context.approval`.
 *
 * Token format: `afdap1.<payload>.<mac>`, both parts base64url. The payload is JSON:
 *
 * - `c`: the command name;
 * - `i`: HMAC-SHA256 of the canonical JSON of the validated input;
 * - `a`: HMAC-SHA256 of the canonical JSON of the actor's `kind`, `id` and `onBehalfOf`
 *   (`null` when the call has no actor);
 * - `iat`, `exp`: issue and expiry times in epoch milliseconds;
 * - `n`: a 128-bit random nonce.
 *
 * The MAC is HMAC-SHA256 over `afdap1.<payload>` with the application's secret. The input and
 * actor are keyed digests rather than plain hashes, so a token reveals neither a low-entropy
 * input (such as a record ID) nor the actor ID. Every comparison is constant-time, and compares
 * the encoded form, so a token has exactly one valid spelling.
 *
 * The crypto is WebCrypto (`globalThis.crypto`), so the middleware runs in Node.js 22 and in a
 * browser alike. In a page, the secret is visible to every script on that page: it stops a model
 * from approving its own call through tool input, not code running in the page.
 *
 * With `relay: 'mcp-elicitation'` (#418), an MCP call that can carry a form elicitation is not
 * answered with a token at all: the MCP lane asks the human behind the client, and the retry runs
 * once the signed `requestState` and the human's answer check out (see `approval-relay.ts`).
 */

import type {
	Actor,
	ApprovalDecision,
	ApprovalPolicy,
	Clock,
	CommandContext,
	CommandError,
	CommandMiddleware,
} from '@lushly-dev/afd-core';
import { ErrorCodes, failure, systemClock } from '@lushly-dev/afd-core';
import {
	directApprovalExchange,
	holdDirectApproval,
	takeDirectApproval,
} from '@lushly-dev/afd-core/internal/direct-approval';
import { admitApproval, gates, liveCommand, markListedGate } from './approval-admission.js';
import {
	type ApprovalKey,
	type ApprovalSecret,
	actorJson,
	base64url,
	base64urlText,
	canonicalJson,
	canonicalOrUndefined,
	createMemoryNonceStore,
	decodeBase64urlText,
	digest,
	hmac,
	inputChanged,
	inputNotCanonical,
	randomBytes,
	safeEqualText,
	sha256Base64url,
	toKeys,
	WebCryptoUnavailableError,
} from './approval-crypto.js';
import { markApprovalProcessState } from './approval-process-state.js';
import {
	type AcceptedApproval,
	type ApprovalAdmission,
	approvalRelay,
	relayMessage,
	type UpFrontDeps,
	upFrontApproval,
} from './approval-relay.js';
import { approverCall, takeApproverEvidence } from './approver.js';
import {
	credentialsBinding,
	type PrincipalCredentials,
	principalBinding,
} from './principal-binding.js';
import { type RelayEvidence, relayEvidenceOf } from './relay-evidence.js';

export { type ApprovalSecret, canonicalJson };

const TOKEN_PREFIX = 'afdap1';
const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_TTL_MS = 24 * 60 * 60_000;
/** Longer evidence is rejected unread, so a caller cannot make the server hash megabytes. */
const MAX_TOKEN_LENGTH = 1024;

/** What the middleware reads from a command: its name, approval policy and confirmation prompt. */
export interface ApprovalCommand {
	name: string;
	approval?: ApprovalPolicy<never>;
	confirmPrompt?: string;
}

/** Why a supplied approval token was not accepted. */
export type ApprovalRejection =
	| 'malformed'
	| 'invalid-signature'
	| 'expired'
	| 'command-mismatch'
	| 'input-mismatch'
	| 'actor-mismatch'
	| 'credentials-mismatch'
	| 'already-used';

/**
 * Records which single-use tokens have been spent. The default keeps them in memory, which
 * holds only within one process: give servers that run several instances a shared store.
 */
export interface ApprovalNonceStore {
	/**
	 * Mark `nonce` as used until `expiresAt` (epoch milliseconds; it can be forgotten after).
	 * Return `false` when it was already used. Must be atomic: of two concurrent calls with the
	 * same nonce, exactly one returns `true`.
	 */
	consume(nonce: string, expiresAt: number): boolean | Promise<boolean>;
}

/** A call held for approval, as passed to `onApprovalRequired`. */
export interface ApprovalRequest {
	command: string;
	/** The validated input the token is bound to. */
	input: unknown;
	actor?: Actor;
	approvalToken: string;
	/**
	 * The `approvalId` the call's approval summary will carry once this token admits it
	 * (`spec/command-metadata.md`, "The approval summary", rule 5): keep it beside the person who
	 * approves, to join their decision to the call `onApprovalAccepted` reports.
	 */
	approvalId: string;
	/** ISO 8601 expiry of `approvalToken`. */
	expiresAt: string;
	summary: string;
	/** Set when the call carried a token that was rejected. */
	rejected?: ApprovalRejection;
}

/**
 * What the approval step gives `onApprovalAccepted` when it admits a held call
 * (`spec/command-metadata.md`, "The approval summary"). It holds no token, nonce, key or decision
 * id, and grants nothing: no AFD code reads it back.
 */
export interface ApprovalSummary {
	/**
	 * How the call was admitted: an approval token (`token`), an answer over the MCP relay
	 * (`elicitation`), a `HumanRelay`'s evidence (`relay`), or DirectClient's private exchange
	 * (`direct`).
	 */
	via: 'token' | 'elicitation' | 'relay' | 'direct';
	/** The command's name. */
	command: string;
	/**
	 * Unpadded base64url SHA-256 of the canonical JSON of the validated input. Unkeyed, so a short
	 * or predictable input can be guessed from it: store it only where you would store the input
	 * (leave it out for a command that declares `secret`).
	 */
	inputDigest: string;
	/**
	 * Unpadded base64url SHA-256 of `approval`, a zero byte and the evidence's single-use key. It
	 * names the approval, not the admission: a token reused under `replay: 'within-ttl'` gives
	 * every call it admits the same id, and the dispatch id tells them apart.
	 */
	approvalId: string;
	/** Epoch milliseconds the evidence was issued, when it carries one (a token). */
	issuedAt?: number;
	/** Epoch milliseconds the evidence expires, when it carries one (a token, an elicitation hold). */
	expiresAt?: number;
}

/** Options for {@link createApprovalMiddleware}. */
export interface ApprovalMiddlewareOptions {
	/**
	 * The HMAC key, or several during a key rotation: the first signs, any of them verifies.
	 * Required, with no default; each key must be at least 32 bytes. Keep it out of source.
	 */
	secret: ApprovalSecret | readonly ApprovalSecret[];

	/**
	 * Optional. The middleware decides from the policy and `confirmPrompt` of the command each call
	 * runs (under `createMcpServer` and `createDirectRegistry`), and also from the policy this list
	 * gives that command: a call is held when either holds it, so a gate declared only here still
	 * holds. Outside those engines, where no engine names the command, only this list decides, and
	 * a command missing from it is not held. Each policy given is validated.
	 */
	commands?: Iterable<ApprovalCommand>;

	/** How long a token stays valid, in milliseconds. Default: 300000 (5 minutes); at most 24 hours. */
	ttlMs?: number;

	/**
	 * `'single-use'` (default): a token runs the command once; a second call with it is held
	 * again with `rejected: 'already-used'`. `'within-ttl'`: a token runs the same command, input
	 * and actor as often as it is presented until it expires, so one approval also covers
	 * repeats (for example duplicate batch items), not only retries after a transient failure.
	 */
	replay?: 'single-use' | 'within-ttl';

	/**
	 * Where single-use nonces are recorded. Default: in memory, for this middleware instance
	 * only. Share one store between every instance that uses the same secret (several
	 * processes, or both a server and a `createDirectRegistry`), or a token works once on each.
	 */
	nonceStore?: ApprovalNonceStore;

	/**
	 * The text shown to the human who approves, from the call. Default (also for an empty
	 * string): the command's `confirmPrompt`, else `Run <command>`.
	 */
	summarize?: (command: string, input: unknown, context: CommandContext) => string | undefined;

	/**
	 * Whether the `APPROVAL_REQUIRED` result carries `details.approvalToken`. Default: `false`
	 * when `context.interface` is `'mcp'` (every MCP lane, and the HTTP routes of
	 * `createMcpHandler`), whose caller is the agent, and `true` elsewhere. Without the token in the result, deliver it to the approving human through
	 * `onApprovalRequired`. `true` is safe only while the gated caller cannot set
	 * `context.approval` itself. DirectClient, createDirectRegistry and the in-process CLI
	 * use a private exchange instead: evidence is omitted regardless of this option.
	 */
	includeToken?: boolean;

	/**
	 * How an MCP call asks the human. `'none'` (default): it fails with `APPROVAL_REQUIRED`, and
	 * the application obtains the approval out of band. `'mcp-elicitation'`: a call to a single
	 * command from an MCP client that declares form elicitation is answered with a form
	 * elicitation showing the summary, and runs once the human accepts. No token is issued on that
	 * path. An `afd-batch` or `afd-pipe` from such a client is asked about once, before any step
	 * runs, listing every gated step; a pipeline whose gated step takes its input from an earlier
	 * step runs nothing and fails with `APPROVAL_REQUIRED`. Calls that cannot elicit (no
	 * capability, a 2025-era HTTP request) still fail with `APPROVAL_REQUIRED`.
	 *
	 * This trusts the MCP client application to show the question to a human: the server cannot
	 * tell a person's answer from client code that accepts on its own. Leave it off when the
	 * agent's own code is the MCP client. Servers with several instances must share
	 * `confirmationKey` (it signs the elicitation state) and `nonceStore`.
	 */
	relay?: 'none' | 'mcp-elicitation';

	/**
	 * Called for every call held with a token, before the result is returned, for example to notify
	 * a human. Not called for a call whose approval is asked over MCP (`relay`): no token exists.
	 */
	onApprovalRequired?: (request: ApprovalRequest) => void | Promise<void>;

	/**
	 * Called when this step admits a call a policy held, after the evidence is checked and spent
	 * and before the rest of the chain and the handler run (`spec/command-metadata.md`, "The
	 * approval summary"), with the call's {@link ApprovalSummary} and its `dispatchId`, so a host
	 * can record the approval beside the dispatch. The step waits for it, and it fails closed: a
	 * throw or a rejection fails the call with `COMMAND_EXECUTION_ERROR` before the handler runs, as
	 * an uncaught middleware error does, and the evidence stays spent. A call no policy held, or
	 * one held and not admitted, calls nothing. `dispatchId` is `undefined` only when this
	 * middleware runs outside an AFD engine.
	 */
	onApprovalAccepted?: (
		summary: ApprovalSummary,
		dispatchId: string | undefined
	) => void | Promise<void>;

	/**
	 * Source of time for issuing and expiring tokens and for forgetting spent nonces. Default:
	 * the system clock. `context.clock` is never used: a caller can set it, and this is
	 * security time.
	 */
	clock?: Clock;
}

/** What a token's `a` binds: the actor JSON, or an approver's principal binding (M8). */
interface Binding {
	purpose: 'actor' | 'principal';
	value: string;
}

type Verdict =
	| { ok: true; nonce: string; issuedAt: number; expiresAt: number }
	| { ok: false; reason: ApprovalRejection };

interface TokenPayload {
	c: string;
	i: string;
	a: string;
	iat: number;
	exp: number;
	n: string;
}

/**
 * Create a middleware that runs a command whose `approval` policy requires approval only when
 * `context.approval` holds a valid token for this command, input and actor. Otherwise it
 * returns `APPROVAL_REQUIRED` with a fresh token, and the handler does not run.
 *
 * Install it after any middleware that sets or refines `context.actor` (such as auth), since
 * tokens are bound to the actor. `context.approval` must only ever be set by trusted surface
 * code once a human approved, never from tool arguments: whoever holds a token can use it.
 *
 * Under `createMcpServer` and `createDirectRegistry` it decides from each command's own policy.
 * Without it, those engines refuse a command whose policy is not `'not-required'` with
 * `APPROVAL_UNAVAILABLE`, so a declared policy always holds.
 *
 * @example
 * ```typescript
 * const server = createMcpServer({
 *   name: 'todo',
 *   version: '1.0.0',
 *   commands: [todoDelete, todoList],
 *   middleware: [createApprovalMiddleware({ secret: process.env.AFD_APPROVAL_SECRET! })],
 * });
 * ```
 *
 * @throws TypeError when no secret is given, a secret is shorter than 32 bytes, `ttlMs` is not
 * a positive number, or a command declares an approval policy that is not valid
 */
export function createApprovalMiddleware(options: ApprovalMiddlewareOptions): CommandMiddleware {
	const keys = toKeys(options.secret);
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
		throw new TypeError(
			'Approval ttlMs must be a positive number of milliseconds, at most 24 hours'
		);
	}
	const clock = options.clock ?? systemClock;
	const singleUse = (options.replay ?? 'single-use') === 'single-use';
	const memoryStore = options.nonceStore ? undefined : createMemoryNonceStore();
	const relayMode = options.relay ?? 'none';
	if (relayMode !== 'none' && relayMode !== 'mcp-elicitation') {
		throw new TypeError("Approval relay must be 'none' or 'mcp-elicitation'");
	}

	const commands = new Map<string, ApprovalCommand>();
	for (const command of options.commands ?? []) {
		const { approval } = command;
		if (
			approval !== undefined &&
			approval !== 'required' &&
			approval !== 'not-required' &&
			typeof approval !== 'function'
		) {
			throw new TypeError(
				`Command '${command.name}' has an invalid approval policy: use 'required', 'not-required' or a function`
			);
		}
		commands.set(command.name, command);
	}

	/**
	 * The command `commandName` names for this call: the one the engine runs (its own policy and
	 * prompt), else, for another step of an up-front batch or pipeline, the server's definition,
	 * else, outside the engine, the `commands` option's entry.
	 */
	function commandFor(commandName: string, context: CommandContext): ApprovalCommand | undefined {
		const live = liveCommand(context);
		if (live?.name === commandName) return live;
		return upFrontApproval(context)?.command(commandName) ?? commands.get(commandName);
	}

	/**
	 * The policies that decide `commandName` for this call: the command's own (see
	 * {@link commandFor}) and, when it differs, the one the `commands` option lists for it. The call
	 * is held when either holds it.
	 */
	function policiesFor(
		commandName: string,
		context: CommandContext
	): Array<ApprovalPolicy<never> | undefined> {
		const own = commandFor(commandName, context)?.approval;
		const listed = commands.get(commandName)?.approval;
		return listed === undefined || listed === own ? [own] : [own, listed];
	}

	/** Whether this call of `commandName` needs approval: its own policy or its listed one holds it. */
	async function holds(
		commandName: string,
		input: unknown,
		context: CommandContext
	): Promise<boolean> {
		for (const policy of policiesFor(commandName, context)) {
			if (await requiresApproval(policy, input, context)) return true;
		}
		return false;
	}

	async function requiresApproval(
		policy: ApprovalPolicy<never> | undefined,
		input: unknown,
		context: CommandContext
	): Promise<boolean> {
		if (policy === undefined || policy === 'not-required') return false;
		// Fail closed: 'required' or anything that is not a function holds the call.
		if (typeof policy !== 'function') return true;
		const decide = policy as (
			input: unknown,
			context: CommandContext
		) => ApprovalDecision | Promise<ApprovalDecision>;
		// Fail closed: anything but an explicit 'not-required' holds the call.
		return (await decide(input, context)) !== 'not-required';
	}

	/**
	 * Check `evidence` against this call. `who` is what `a` binds: the actor JSON, or for an
	 * approver's call its principal binding, whose mismatch is `credentials-mismatch`.
	 */
	async function verify(
		evidence: unknown,
		commandName: string,
		input: string,
		who: Binding,
		now: number
	): Promise<Verdict> {
		if (typeof evidence !== 'string' || evidence.length > MAX_TOKEN_LENGTH) {
			return { ok: false, reason: 'malformed' };
		}
		const parts = evidence.split('.');
		if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return { ok: false, reason: 'malformed' };
		const [, encodedPayload = '', encodedMac = ''] = parts;
		const signingInput = `${TOKEN_PREFIX}.${encodedPayload}`;
		// Compare the encoded MACs, so that a token has exactly one valid spelling (base64url
		// decoding ignores padding bits). The key that signed the token also keyed its digests.
		let key: ApprovalKey | undefined;
		for (const candidate of keys) {
			if (safeEqualText(encodedMac, base64url(await hmac(candidate, signingInput)))) {
				key = candidate;
				break;
			}
		}
		if (!key) return { ok: false, reason: 'invalid-signature' };

		const payload = parsePayload(encodedPayload);
		if (!payload) return { ok: false, reason: 'malformed' };
		if (now >= payload.exp) return { ok: false, reason: 'expired' };
		if (!safeEqualText(payload.c, commandName)) {
			return { ok: false, reason: 'command-mismatch' };
		}
		if (!safeEqualText(payload.i, base64url(await digest(key, 'input', input)))) {
			return { ok: false, reason: 'input-mismatch' };
		}
		if (!safeEqualText(payload.a, base64url(await digest(key, who.purpose, who.value)))) {
			return {
				ok: false,
				reason: who.purpose === 'principal' ? 'credentials-mismatch' : 'actor-mismatch',
			};
		}
		return { ok: true, nonce: payload.n, issuedAt: payload.iat, expiresAt: payload.exp };
	}

	async function issue(
		commandName: string,
		input: string,
		who: Binding,
		now: number
	): Promise<TokenPayload> {
		const key = keys[0] as ApprovalKey;
		return {
			c: commandName,
			i: base64url(await digest(key, 'input', input)),
			a: base64url(await digest(key, who.purpose, who.value)),
			iat: now,
			exp: now + ttlMs,
			n: base64url(randomBytes(16)),
		};
	}

	/** The binding of a relayed approval, one per key: a keyed digest of the command, input and actor. */
	async function relayBindings(
		commandName: string,
		input: string,
		actor: string
	): Promise<string[]> {
		const data = `relay\0${canonicalJson([commandName, input, actor])}`;
		return Promise.all(keys.map(async (key) => base64url(await hmac(key, data))));
	}

	/** The MAC of a relayed approval's nonce and expiry, so the elicitation state cannot set them. */
	async function holdMac(
		key: ApprovalKey,
		binding: string,
		nonce: string,
		expiresAt: number
	): Promise<string> {
		return base64url(await hmac(key, `relay-hold\0${canonicalJson([binding, nonce, expiresAt])}`));
	}

	/** Whether an accepted relayed approval was issued by this middleware and is unexpired. */
	async function genuine(
		answer: AcceptedApproval,
		bindings: readonly string[],
		now: number
	): Promise<boolean> {
		const key = keys[bindings.indexOf(answer.binding)];
		if (!key) return false;
		const expected = await holdMac(key, answer.binding, answer.nonce, answer.expiresAt);
		if (!safeEqualText(answer.mac, expected)) return false;
		return now < answer.expiresAt && answer.expiresAt <= now + ttlMs;
	}

	/** Whether an accepted relayed approval is genuine, unexpired and (single-use) unspent. */
	async function relayedApprovalHolds(
		answer: AcceptedApproval,
		bindings: readonly string[],
		now: number
	): Promise<boolean> {
		if (!(await genuine(answer, bindings, now))) return false;
		return spend(answer.nonce, answer.expiresAt, now);
	}

	/** Spend a single-use nonce; `true` when it was fresh (or reuse is allowed). */
	async function spend(nonce: string, expiresAt: number, now: number): Promise<boolean> {
		if (!singleUse) return true;
		// Only an explicit `true` from the store counts as fresh.
		return memoryStore
			? memoryStore.consume(nonce, expiresAt, now)
			: (await options.nonceStore?.consume(nonce, expiresAt)) === true;
	}

	/**
	 * Check server-private relay evidence against this call (`spec/command-metadata.md`, "Relay
	 * evidence", rule 3), in exact order with constant-time comparisons.
	 */
	async function checkRelayEvidence(
		evidence: RelayEvidence,
		commandName: string,
		inputBinding: string,
		actorBinding: string,
		context: CommandContext
	): Promise<ApprovalRejection | undefined> {
		if (!safeEqualText(evidence.command, commandName)) return 'command-mismatch';
		if (!safeEqualText(evidence.inputDigest, await sha256Base64url(inputBinding))) {
			return 'input-mismatch';
		}
		if (!safeEqualText(evidence.actor, actorBinding)) return 'actor-mismatch';
		let creds: string;
		try {
			creds = credentialsBinding(context.credentials as PrincipalCredentials | undefined);
		} catch {
			return 'credentials-mismatch';
		}
		if (!safeEqualText(evidence.credentialsBinding, creds)) return 'credentials-mismatch';
		return undefined;
	}

	/**
	 * Spend a relay decision once as `relay:<decisionId>` for 24 hours regardless of `replay`
	 * (`spec/command-metadata.md`, "Relay evidence", rule 4).
	 */
	async function spendRelayDecision(decisionId: string, now: number): Promise<boolean> {
		if (decisionId.length === 0) return false;
		const key = relayKey(decisionId);
		const expiresAt = now + MAX_TTL_MS;
		return memoryStore
			? memoryStore.consume(key, expiresAt, now)
			: (await options.nonceStore?.consume(key, expiresAt)) === true;
	}

	function summarize(commandName: string, input: unknown, context: CommandContext): string {
		return (
			options.summarize?.(commandName, input, context) ||
			commandFor(commandName, context)?.confirmPrompt ||
			commands.get(commandName)?.confirmPrompt ||
			`Run ${commandName}`
		);
	}

	// What the up-front gate of an afd-batch or afd-pipe needs; the MCP lane brings the gate.
	const upFrontDeps: UpFrontDeps = {
		clock,
		requiresApproval: holds,
		mayRequireApproval: (commandName, context) => policiesFor(commandName, context).some(gates),
		bindings: async (tags, commandName, input, actor) =>
			Promise.all(
				keys.map(async (key, at) =>
					base64url(
						await hmac(key, `relay-step\0${canonicalJson([tags[at], commandName, input, actor])}`)
					)
				)
			),
		callTags: (call) =>
			Promise.all(keys.map(async (key) => base64url(await hmac(key, `relay-call\0${call}`)))),
		genuine,
		spend,
		question: async (bindings, now) => {
			const binding = bindings[0] as string;
			const nonce = base64url(randomBytes(16));
			const expiresAt = now + ttlMs;
			const mac = await holdMac(keys[0] as ApprovalKey, binding, nonce, expiresAt);
			return { binding, bindings, nonce, expiresAt, mac };
		},
		summarize,
	};

	async function sign(payload: TokenPayload): Promise<string> {
		const signingInput = `${TOKEN_PREFIX}.${base64urlText(JSON.stringify(payload))}`;
		return `${signingInput}.${base64url(await hmac(keys[0] as ApprovalKey, signingInput))}`;
	}

	// This approval step, as the admission records name it.
	const self = {};

	const gate: CommandMiddleware = async (commandName, input, context, outerNext) => {
		// Every way this middleware lets a call it may gate through admits this command on the
		// canonical input it decided on, computed before any await, which the engine checks, and
		// takes, before it dispatches a command that its own or its listed policy gates. A call no
		// policy here gates is not admitted: an admission from another approval step stands alone,
		// and a retry placed after that step is still refused.
		const listedGate = gates(commands.get(commandName)?.approval);
		// The command the engine runs, which a middleware before this one may have called it under
		// another name: its listed gate holds at dispatch either way, and a renamed call is refused.
		const live = liveCommand(context);
		if (live && gates(commands.get(live.name)?.approval)) markListedGate(context);
		const mayGate = policiesFor(commandName, context).some(gates);
		const next = async (canonical: string | undefined, admission?: ApprovalAdmission) => {
			if (!mayGate) return outerNext();
			// A held call an approval admitted: tell the host before anything else runs. A refusal
			// throws out of this step, so the call is never admitted (rule 2).
			if (admission && canonical !== undefined && options.onApprovalAccepted) {
				await options.onApprovalAccepted(
					await approvalSummary(commandName, canonical, admission),
					context.dispatchId
				);
			}
			admitApproval(context, {
				step: self,
				commandName,
				canonical,
				input,
				listedGate,
				canonicalize: canonicalOrUndefined,
			});
			return outerNext();
		};
		// An approver client's call (spec/command-metadata.md, "Approval evidence from an approver
		// client"): its token reaches it and is never replaced by an elicitation, its carried
		// evidence is taken by the first command checked (the one the call routes to), once, and
		// its tokens bind its principal binding.
		const approver = approverCall(context);
		const carried = approver ? takeApproverEvidence(approver) : undefined;
		const relays = relayMode === 'mcp-elicitation' && !approver;
		// Claimed only by the command the tool call routes to, once, gated or not, so a command
		// that runs inside another (or after it) cannot turn the tool call into an elicitation.
		const bound = relays ? approvalRelay(context) : undefined;
		const relay = bound?.claim(commandName) ? bound : undefined;
		// A step of an afd-batch or afd-pipe that can ask: the whole call is approved up front.
		const upFront = relays ? upFrontApproval(context) : undefined;
		if (upFront) return upFront.run(upFrontDeps, commandName, input, context, next);
		// Only when a policy may gate the call, and before any await: an ungated call does not need
		// it.
		const decidedOn = mayGate ? canonicalOrUndefined(input) : undefined;
		// Whether the input still has the canonical form decided on, after an await.
		const changed = () => canonicalOrUndefined(input) !== decidedOn;
		// The policy of the command this call runs, and the one the `commands` option lists for it.
		if (!(await holds(commandName, input, context))) return next(decidedOn);

		// No token or relayed approval can bind an input with no canonical form, so nobody is asked.
		if (decidedOn === undefined) return failure(inputNotCanonical(commandName));
		// A policy function that changed the input would show the person one input and bind another.
		if (changed()) return failure(inputChanged(commandName));
		const summary = summarize(commandName, input, context);
		const now = clock.now();
		const inputBinding = decidedOn;
		const actorBinding = actorJson(context.actor);
		const relayedEvidence = relayEvidenceOf(context);
		// Defer approver principalBinding construction until needed so incomplete credentials
		// never preempt relay evidence's ordered mismatch checks (`command` -> `input` -> `actor`
		// -> `credentials`).
		const resolveWho = (): Binding =>
			approver && !relayedEvidence
				? {
						purpose: 'principal',
						value: principalBinding(
							context.actor,
							context.credentials as PrincipalCredentials | undefined
						),
					}
				: { purpose: 'actor', value: actorBinding };

		let rejected: ApprovalRejection | undefined;
		const directExchange = directApprovalExchange(context);
		if (relayedEvidence) {
			// Relay evidence is the only evidence considered when present (rule 2): no token, no
			// in-process exchange and no form answer.
			const mismatch = await checkRelayEvidence(
				relayedEvidence,
				commandName,
				inputBinding,
				actorBinding,
				context
			);
			if (!mismatch) {
				if (await spendRelayDecision(relayedEvidence.decisionId, now)) {
					return next(inputBinding, { via: 'relay', key: relayKey(relayedEvidence.decisionId) });
				}
				rejected = 'already-used';
			} else {
				rejected = mismatch;
			}
		} else {
			const evidence = directExchange
				? takeDirectApproval(context)
				: carried !== undefined
					? carried
					: context.approval;
			if (evidence !== undefined) {
				const verdict = await verify(evidence, commandName, inputBinding, resolveWho(), now);
				if (verdict.ok) {
					if (await spend(verdict.nonce, verdict.expiresAt, now)) {
						return next(inputBinding, {
							via: directExchange ? 'direct' : 'token',
							key: verdict.nonce,
							issuedAt: verdict.issuedAt,
							expiresAt: verdict.expiresAt,
						});
					}
					rejected = 'already-used';
				} else {
					rejected = verdict.reason;
				}
			}
		}

		if (relay && !relayedEvidence) {
			const bindings = await relayBindings(commandName, inputBinding, actorBinding);
			const answer = await relay.answer(bindings);
			if (answer.kind === 'decline') {
				return failure({
					code: ErrorCodes.APPROVAL_REQUIRED,
					message: `The user did not approve ${commandName}`,
					suggestion:
						'Do not run this again without asking the user first; the user chose not to approve it.',
					retryable: false,
					recovery: { kind: 'stop' },
					details: { summary, reason: 'declined' },
				});
			}
			if (answer.kind === 'accept' && (await relayedApprovalHolds(answer, bindings, now))) {
				return next(inputBinding, {
					via: 'elicitation',
					key: answer.nonce,
					expiresAt: answer.expiresAt,
				});
			}
			// An expired, spent or invalid approval is asked again, saying why.
			const binding = bindings[0] as string;
			const nonce = base64url(randomBytes(16));
			const expiresAt = now + ttlMs;
			relay.hold({
				binding,
				bindings,
				nonce,
				expiresAt,
				mac: await holdMac(keys[0] as ApprovalKey, binding, nonce, expiresAt),
				message: relayMessage(
					summary,
					commandName,
					inputBinding,
					answer.kind === 'accept'
						? 'The earlier approval expired or was already used; approve again to run it.'
						: undefined
				),
			});
			// The lane answers with the elicitation instead; this result is never sent.
			return failure({
				code: ErrorCodes.APPROVAL_REQUIRED,
				message: `${commandName} needs approval before it runs`,
				suggestion: `Wait for the user to approve "${summary}" in the client.`,
				retryable: false,
				recovery: { kind: 'external' },
				details: { expiresAt: new Date(expiresAt).toISOString(), summary },
			});
		}

		const payload = await issue(commandName, inputBinding, resolveWho(), now);
		const approvalToken = await sign(payload);
		const approvalId = await approvalIdOf(payload.n);
		const expiresAt = new Date(payload.exp).toISOString();
		// An approver always gets its token (except when relay evidence was what failed); anyone
		// else as the option says.
		const includeToken =
			!directExchange &&
			((!relayedEvidence && !!approver) || (options.includeToken ?? context.interface !== 'mcp'));
		// Checked again after the awaits since the first check, before anyone is told of the call.
		if (changed()) return failure(inputChanged(commandName));
		if (directExchange) {
			holdDirectApproval(context, {
				approvalToken,
				approvalId,
				expiresAt,
				summary,
				...(rejected && { reason: rejected }),
			});
		}

		await options.onApprovalRequired?.({
			command: commandName,
			input,
			...(context.actor && { actor: { ...context.actor } }),
			approvalToken,
			approvalId,
			expiresAt,
			summary,
			...(rejected && { rejected }),
		});

		const why = rejected ? `The approval token was not accepted (${rejected}). ` : '';
		// Addressed to whoever relays the decision: the token is the approval, so the gated
		// caller must not resubmit it on its own, and tool arguments cannot carry it.
		const retry =
			approver && !relayedEvidence
				? `once they approve, the approver retries the same call with the same input and details.approvalToken in _meta["dev.afd/approval"]. The token expires at ${expiresAt}${singleUse ? ' and works once' : ''}.`
				: includeToken
					? `once they approve, the application retries the same call with the same input and details.approvalToken as its approval evidence (tool arguments cannot carry it). The token expires at ${expiresAt}${singleUse ? ' and works once' : ''}.`
					: bound && !relayedEvidence
						? `the client could not be asked from inside afd-batch, afd-pipe or another command. Call ${commandName} on its own so the client can ask the user.`
						: relayMode === 'mcp-elicitation' && context.interface === 'mcp' && !relayedEvidence
							? `the client could not be asked here. Call ${commandName} from an MCP client that supports form elicitation, or the application records the approval and retries.`
							: 'the application retries the same call once it has recorded the approval.';
		return failure({
			code: ErrorCodes.APPROVAL_REQUIRED,
			message: `${commandName} needs approval before it runs`,
			suggestion: `${why}Ask the user to approve "${summary}"; ${retry}`,
			retryable: false,
			// A person approves, so the step is outside the command surface, except where the
			// suggestion tells the caller to reshape the call: call the gated command on its own.
			...(!(bound && !approver && !includeToken) && { recovery: { kind: 'external' } as const }),
			details: {
				...(includeToken && { approvalToken }),
				expiresAt,
				summary,
				...(rejected && { reason: rejected }),
			},
		});
	};
	// Where WebCrypto is missing (a browser page over plain HTTP from a network address), a call
	// this step must sign or check a token for gets an answer an agent can act on (#1699).
	const middleware: CommandMiddleware = async (commandName, input, context, outerNext) => {
		try {
			return await gate(commandName, input, context, outerNext);
		} catch (error) {
			if (error instanceof WebCryptoUnavailableError) return failure(noWebCrypto(commandName));
			throw error;
		}
	};
	markApprovalProcessState(middleware, {
		relay: relayMode === 'mcp-elicitation',
		perProcessNonces: singleUse && !options.nonceStore,
		perProcessRelayNonces: !options.nonceStore,
	});
	return middleware;
}

/** The single-use key of a relay decision (`spec/command-metadata.md`, "Relay evidence", rule 4). */
function relayKey(decisionId: string): string {
	return `relay:${decisionId}`;
}

/** The approval summary's `approvalId` for the evidence whose single-use key is `key`. */
function approvalIdOf(key: string): Promise<string> {
	return sha256Base64url(`approval\0${key}`);
}

/** The approval summary of a call admitted on `admission` (`spec/command-metadata.md`). */
async function approvalSummary(
	command: string,
	canonical: string,
	admission: ApprovalAdmission
): Promise<ApprovalSummary> {
	return {
		via: admission.via,
		command,
		inputDigest: await sha256Base64url(canonical),
		approvalId: await approvalIdOf(admission.key),
		...(admission.issuedAt !== undefined && { issuedAt: admission.issuedAt }),
		...(admission.expiresAt !== undefined && { expiresAt: admission.expiresAt }),
	};
}

/** The approval step needs WebCrypto to sign or check a token, and this page has none. */
function noWebCrypto(command: string): CommandError {
	return {
		code: ErrorCodes.APPROVAL_UNAVAILABLE,
		message: `${command} needs a person's approval, and this app cannot ask for it: WebCrypto (crypto.subtle) is missing, which a browser exposes only on a secure origin`,
		suggestion:
			'Do not retry: serve the app over HTTPS or open it from localhost (to test from another device, use HTTPS with a local certificate or a tunnel), or run it on Node.js 22 or later',
		retryable: false,
		details: { reason: 'no-webcrypto', command },
	};
}

function parsePayload(encoded: string): TokenPayload | undefined {
	const text = decodeBase64urlText(encoded);
	if (text === undefined) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const payload = value as Record<string, unknown>;
	const strings = ['c', 'i', 'a', 'n'].every((field) => typeof payload[field] === 'string');
	const times = ['iat', 'exp'].every((field) => Number.isFinite(payload[field]));
	return strings && times ? (payload as unknown as TokenPayload) : undefined;
}
