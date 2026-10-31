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
	CommandMiddleware,
} from '@lushly-dev/afd-core';
import { ErrorCodes, failure, systemClock } from '@lushly-dev/afd-core';
import {
	directApprovalExchange,
	holdDirectApproval,
	takeDirectApproval,
} from '@lushly-dev/afd-core/internal/direct-approval';
import {
	type ApprovalKey,
	type ApprovalSecret,
	actorJson,
	base64url,
	base64urlText,
	canonicalJson,
	createMemoryNonceStore,
	decodeBase64urlText,
	digest,
	hmac,
	randomBytes,
	safeEqualText,
	toKeys,
} from './approval-crypto.js';
import { type ApprovalAnswer, approvalRelay, relayMessage } from './approval-relay.js';

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
	/** ISO 8601 expiry of `approvalToken`. */
	expiresAt: string;
	summary: string;
	/** Set when the call carried a token that was rejected. */
	rejected?: ApprovalRejection;
}

/** Options for {@link createApprovalMiddleware}. */
export interface ApprovalMiddlewareOptions {
	/**
	 * The HMAC key, or several during a key rotation: the first signs, any of them verifies.
	 * Required, with no default; each key must be at least 32 bytes. Keep it out of source.
	 */
	secret: ApprovalSecret | readonly ApprovalSecret[];

	/**
	 * The commands to gate: pass the same list given to `createMcpServer` or
	 * `createDirectRegistry`. A command that is not in this list is never held, whatever its
	 * `approval` policy says.
	 */
	commands: Iterable<ApprovalCommand>;

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
	 * path. Calls that cannot elicit (no capability, a 2025-era HTTP request, an `afd-batch` or
	 * `afd-pipe` step) still fail with `APPROVAL_REQUIRED`.
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
	 * Source of time for issuing and expiring tokens and for forgetting spent nonces. Default:
	 * the system clock. `context.clock` is never used: a caller can set it, and this is
	 * security time.
	 */
	clock?: Clock;
}

type Verdict =
	| { ok: true; nonce: string; expiresAt: number }
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
 * @example
 * ```typescript
 * const commands = [todoDelete, todoList];
 * const server = createMcpServer({
 *   name: 'todo',
 *   version: '1.0.0',
 *   commands,
 *   middleware: [
 *     createApprovalMiddleware({ secret: process.env.AFD_APPROVAL_SECRET!, commands }),
 *   ],
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
	for (const command of options.commands) {
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

	async function requiresApproval(
		command: ApprovalCommand | undefined,
		input: unknown,
		context: CommandContext
	): Promise<boolean> {
		const policy = command?.approval;
		if (policy === undefined || policy === 'not-required') return false;
		if (policy === 'required') return true;
		const decide = policy as (
			input: unknown,
			context: CommandContext
		) => ApprovalDecision | Promise<ApprovalDecision>;
		// Fail closed: anything but an explicit 'not-required' holds the call.
		return (await decide(input, context)) !== 'not-required';
	}

	async function verify(
		evidence: unknown,
		commandName: string,
		input: string,
		actor: string,
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
		if (!safeEqualText(payload.a, base64url(await digest(key, 'actor', actor)))) {
			return { ok: false, reason: 'actor-mismatch' };
		}
		return { ok: true, nonce: payload.n, expiresAt: payload.exp };
	}

	async function issue(
		commandName: string,
		input: string,
		actor: string,
		now: number
	): Promise<TokenPayload> {
		const key = keys[0] as ApprovalKey;
		return {
			c: commandName,
			i: base64url(await digest(key, 'input', input)),
			a: base64url(await digest(key, 'actor', actor)),
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

	/** Whether an accepted relayed approval is genuine, unexpired and (single-use) unspent. */
	async function relayedApprovalHolds(
		answer: Extract<ApprovalAnswer, { kind: 'accept' }>,
		bindings: readonly string[],
		now: number
	): Promise<boolean> {
		const key = keys[bindings.indexOf(answer.binding)];
		if (!key) return false;
		const expected = await holdMac(key, answer.binding, answer.nonce, answer.expiresAt);
		if (!safeEqualText(answer.mac, expected)) return false;
		if (now >= answer.expiresAt || answer.expiresAt > now + ttlMs) return false;
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

	async function sign(payload: TokenPayload): Promise<string> {
		const signingInput = `${TOKEN_PREFIX}.${base64urlText(JSON.stringify(payload))}`;
		return `${signingInput}.${base64url(await hmac(keys[0] as ApprovalKey, signingInput))}`;
	}

	return async (commandName, input, context, next) => {
		// Claimed only by the command the tool call routes to, once, gated or not, so a command
		// that runs inside another (or after it) cannot turn the tool call into an elicitation.
		const bound = relayMode === 'mcp-elicitation' ? approvalRelay(context) : undefined;
		const relay = bound?.claim(commandName) ? bound : undefined;
		const command = commands.get(commandName);
		if (!(await requiresApproval(command, input, context))) return next();

		const now = clock.now();
		const inputBinding = canonicalJson(input);
		const actorBinding = actorJson(context.actor);

		let rejected: ApprovalRejection | undefined;
		const directExchange = directApprovalExchange(context);
		const evidence = directExchange ? takeDirectApproval(context) : context.approval;
		if (evidence !== undefined) {
			const verdict = await verify(evidence, commandName, inputBinding, actorBinding, now);
			if (verdict.ok) {
				if (await spend(verdict.nonce, verdict.expiresAt, now)) return next();
				rejected = 'already-used';
			} else {
				rejected = verdict.reason;
			}
		}

		const summary =
			options.summarize?.(commandName, input, context) ||
			command?.confirmPrompt ||
			`Run ${commandName}`;

		if (relay) {
			const bindings = await relayBindings(commandName, inputBinding, actorBinding);
			const answer = await relay.answer(bindings);
			if (answer.kind === 'decline') {
				return failure({
					code: ErrorCodes.APPROVAL_REQUIRED,
					message: `The user did not approve ${commandName}`,
					suggestion:
						'Do not run this again without asking the user first; the user chose not to approve it.',
					retryable: false,
					details: { summary, reason: 'declined' },
				});
			}
			if (answer.kind === 'accept' && (await relayedApprovalHolds(answer, bindings, now))) {
				return next();
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
				details: { expiresAt: new Date(expiresAt).toISOString(), summary },
			});
		}

		const payload = await issue(commandName, inputBinding, actorBinding, now);
		const approvalToken = await sign(payload);
		const expiresAt = new Date(payload.exp).toISOString();
		const includeToken = !directExchange && (options.includeToken ?? context.interface !== 'mcp');
		if (directExchange) {
			holdDirectApproval(context, {
				approvalToken,
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
			expiresAt,
			summary,
			...(rejected && { rejected }),
		});

		const why = rejected ? `The approval token was not accepted (${rejected}). ` : '';
		// Addressed to whoever relays the decision: the token is the approval, so the gated
		// caller must not resubmit it on its own, and tool arguments cannot carry it.
		const retry = includeToken
			? `once they approve, the application retries the same call with the same input and details.approvalToken as its approval evidence (tool arguments cannot carry it). The token expires at ${expiresAt}${singleUse ? ' and works once' : ''}.`
			: bound
				? `the client could not be asked from inside afd-batch, afd-pipe or another command. Call ${commandName} on its own so the client can ask the user.`
				: relayMode === 'mcp-elicitation' && context.interface === 'mcp'
					? `the client could not be asked here. Call ${commandName} from an MCP client that supports form elicitation, or the application records the approval and retries.`
					: 'the application retries the same call once it has recorded the approval.';
		return failure({
			code: ErrorCodes.APPROVAL_REQUIRED,
			message: `${commandName} needs approval before it runs`,
			suggestion: `${why}Ask the user to approve "${summary}"; ${retry}`,
			retryable: false,
			details: {
				...(includeToken && { approvalToken }),
				expiresAt,
				summary,
				...(rejected && { reason: rejected }),
			},
		});
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
