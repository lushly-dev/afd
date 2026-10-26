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
 * input (such as a record ID) nor the actor ID. Every comparison is constant-time.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
	Actor,
	ApprovalDecision,
	ApprovalPolicy,
	Clock,
	CommandContext,
	CommandMiddleware,
} from '@lushly-dev/afd-core';
import { ErrorCodes, failure, systemClock } from '@lushly-dev/afd-core';

const TOKEN_PREFIX = 'afdap1';
const MIN_SECRET_BYTES = 32;
const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_TTL_MS = 24 * 60 * 60_000;
/** Longer evidence is rejected unread, so a caller cannot make the server hash megabytes. */
const MAX_TOKEN_LENGTH = 1024;

/** An HMAC key: a string (UTF-8) or raw bytes, at least 32 bytes long. */
export type ApprovalSecret = string | Uint8Array;

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
	 * Whether the `APPROVAL_REQUIRED` result carries `details.approvalToken`. Default: `true`,
	 * which is safe only while the gated caller cannot set `context.approval` itself (true of MCP
	 * tool calls, whose arguments never reach the context). Set `false` when the caller must not
	 * hold the token, and deliver it to the approving human through `onApprovalRequired`.
	 */
	includeToken?: boolean;

	/** Called for every held call, before the result is returned, for example to notify a human. */
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
	const includeToken = options.includeToken !== false;

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

	function verify(
		evidence: unknown,
		commandName: string,
		input: string,
		actor: string,
		now: number
	): Verdict {
		if (typeof evidence !== 'string' || evidence.length > MAX_TOKEN_LENGTH) {
			return { ok: false, reason: 'malformed' };
		}
		const parts = evidence.split('.');
		if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return { ok: false, reason: 'malformed' };
		const [, encodedPayload = '', encodedMac = ''] = parts;
		const signingInput = `${TOKEN_PREFIX}.${encodedPayload}`;
		// Compare the encoded MACs, so that a token has exactly one valid spelling (base64url
		// decoding ignores padding bits and stray characters). The key that signed the token
		// also keyed its digests.
		const mac = Buffer.from(encodedMac);
		const key = keys.find((candidate) =>
			safeEqual(mac, Buffer.from(hmac(candidate, signingInput).toString('base64url')))
		);
		if (!key) return { ok: false, reason: 'invalid-signature' };

		const payload = parsePayload(encodedPayload);
		if (!payload) return { ok: false, reason: 'malformed' };
		if (now >= payload.exp) return { ok: false, reason: 'expired' };
		if (!safeEqual(Buffer.from(payload.c), Buffer.from(commandName))) {
			return { ok: false, reason: 'command-mismatch' };
		}
		if (!safeEqual(Buffer.from(payload.i, 'base64url'), digest(key, 'input', input))) {
			return { ok: false, reason: 'input-mismatch' };
		}
		if (!safeEqual(Buffer.from(payload.a, 'base64url'), digest(key, 'actor', actor))) {
			return { ok: false, reason: 'actor-mismatch' };
		}
		return { ok: true, nonce: payload.n, expiresAt: payload.exp };
	}

	function issue(commandName: string, input: string, actor: string, now: number): TokenPayload {
		const key = keys[0] as Buffer;
		return {
			c: commandName,
			i: digest(key, 'input', input).toString('base64url'),
			a: digest(key, 'actor', actor).toString('base64url'),
			iat: now,
			exp: now + ttlMs,
			n: randomBytes(16).toString('base64url'),
		};
	}

	function sign(payload: TokenPayload): string {
		const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
		const signingInput = `${TOKEN_PREFIX}.${encodedPayload}`;
		return `${signingInput}.${hmac(keys[0] as Buffer, signingInput).toString('base64url')}`;
	}

	return async (commandName, input, context, next) => {
		const command = commands.get(commandName);
		if (!(await requiresApproval(command, input, context))) return next();

		const now = clock.now();
		const inputBinding = canonicalJson(input);
		const actorBinding = actorJson(context.actor);

		let rejected: ApprovalRejection | undefined;
		if (context.approval !== undefined) {
			const verdict = verify(context.approval, commandName, inputBinding, actorBinding, now);
			if (verdict.ok) {
				// Only an explicit `true` from the store counts as fresh.
				const fresh =
					!singleUse ||
					(memoryStore
						? memoryStore.consume(verdict.nonce, verdict.expiresAt, now)
						: (await options.nonceStore?.consume(verdict.nonce, verdict.expiresAt)) === true);
				if (fresh) return next();
				rejected = 'already-used';
			} else {
				rejected = verdict.reason;
			}
		}

		const payload = issue(commandName, inputBinding, actorBinding, now);
		const approvalToken = sign(payload);
		const expiresAt = new Date(payload.exp).toISOString();
		const summary =
			options.summarize?.(commandName, input, context) ||
			command?.confirmPrompt ||
			`Run ${commandName}`;

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

/**
 * Stable JSON for binding a token to an input: object keys sorted at every depth, otherwise the
 * `JSON.stringify` rules (`toJSON` is honoured, so a `Date` is its ISO string; `undefined`
 * members are dropped, and `undefined` in an array is `null`).
 *
 * It fails closed rather than collide: only plain objects, arrays, strings, finite numbers,
 * booleans, `null` and values with `toJSON` are accepted. A `bigint`, a non-finite number, a
 * cycle, or an object of any other kind (`Map`, `Set`, `RegExp`, typed arrays, class
 * instances) throws, so a call whose validated input holds one cannot be approved.
 *
 * @throws TypeError for a value it cannot encode without ambiguity
 */
export function canonicalJson(value: unknown): string {
	const ancestors = new Set<object>();

	function encode(raw: unknown): string | undefined {
		let value = raw;
		if (value !== null && typeof value === 'object' && 'toJSON' in value) {
			const toJSON = (value as { toJSON: unknown }).toJSON;
			if (typeof toJSON === 'function') value = toJSON.call(value);
		}
		switch (typeof value) {
			case 'string':
			case 'boolean':
				return JSON.stringify(value);
			case 'number':
				if (!Number.isFinite(value)) {
					throw new TypeError('Cannot bind an approval to a non-finite number');
				}
				return JSON.stringify(value);
			case 'bigint':
				throw new TypeError('Cannot bind an approval to a bigint');
			case 'undefined':
			case 'function':
			case 'symbol':
				return undefined;
		}
		if (value === null) return 'null';

		const object = value as object;
		if (ancestors.has(object)) throw new TypeError('Cannot bind an approval to a cyclic input');
		ancestors.add(object);
		try {
			if (Array.isArray(object)) {
				return `[${object.map((item) => encode(item) ?? 'null').join(',')}]`;
			}
			const prototype = Object.getPrototypeOf(object);
			if (prototype !== Object.prototype && prototype !== null) {
				const kind = object.constructor?.name ?? 'object';
				throw new TypeError(`Cannot bind an approval to a ${kind}: use plain JSON input`);
			}
			const members: string[] = [];
			for (const key of Object.keys(object).sort()) {
				const member = encode((object as Record<string, unknown>)[key]);
				if (member !== undefined) members.push(`${JSON.stringify(key)}:${member}`);
			}
			return `{${members.join(',')}}`;
		} finally {
			ancestors.delete(object);
		}
	}

	return encode(value) ?? 'null';
}

/** The actor fields a token is bound to. `label` is display text, so it is left out. */
function actorJson(actor: Actor | undefined): string {
	if (!actor) return 'null';
	return canonicalJson({ kind: actor.kind, id: actor.id, onBehalfOf: actor.onBehalfOf });
}

function toKeys(secret: ApprovalMiddlewareOptions['secret'] | undefined): Buffer[] {
	const secrets: readonly unknown[] = Array.isArray(secret) ? secret : [secret];
	if (secrets.length === 0) throw new TypeError('Approval secret is required');
	return secrets.map((candidate) => {
		if (typeof candidate !== 'string' && !(candidate instanceof Uint8Array)) {
			throw new TypeError('Approval secret is required: pass a string or Uint8Array');
		}
		const key = Buffer.from(candidate);
		if (key.length < MIN_SECRET_BYTES) {
			throw new TypeError(`Approval secret must be at least ${MIN_SECRET_BYTES} bytes`);
		}
		return key;
	});
}

function hmac(key: Buffer, data: string): Buffer {
	return createHmac('sha256', key).update(data).digest();
}

/** A keyed digest; `purpose` keeps an input digest from ever matching an actor digest. */
function digest(key: Buffer, purpose: 'input' | 'actor', value: string): Buffer {
	return hmac(key, `${purpose}\0${value}`);
}

/** Constant-time equality. Lengths are not secret (every digest here is 32 bytes). */
function safeEqual(a: Buffer, b: Buffer): boolean {
	return a.length === b.length && timingSafeEqual(a, b);
}

function parsePayload(encoded: string): TokenPayload | undefined {
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
	} catch {
		return undefined;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const payload = value as Record<string, unknown>;
	const strings = ['c', 'i', 'a', 'n'].every((field) => typeof payload[field] === 'string');
	const times = ['iat', 'exp'].every((field) => Number.isFinite(payload[field]));
	return strings && times ? (payload as unknown as TokenPayload) : undefined;
}

/** In-memory single-use nonces, forgotten once their token has expired. */
function createMemoryNonceStore() {
	const used = new Map<string, number>();
	return {
		consume(nonce: string, expiresAt: number, now: number): boolean {
			for (const [spent, until] of used) {
				if (until <= now) used.delete(spent);
			}
			if (used.has(nonce)) return false;
			used.set(nonce, expiresAt);
			return true;
		},
	};
}
