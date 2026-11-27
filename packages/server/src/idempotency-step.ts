/**
 * @fileoverview The engine's idempotency step (`spec/idempotency.md`, S1 to S13): answers a repeat
 * of a call to a `keyed` command from a store, between the approval admission check and the
 * handler (`spec/dispatch.md`, "The idempotency step").
 *
 * The engine (`execution.ts`) asks the step at three points: before input validation, whether it
 * can tell this caller apart (S3); after the declared context fields, the call's digest (S4); and
 * in the innermost link, the call's scope under the principal middleware left, what to do for the
 * call (S5) and, once the handler returns, how to settle (S6). Loads no Node.js built-in: the
 * digest is WebCrypto's.
 */

import type {
	Actor,
	Clock,
	CommandContext,
	CommandError,
	CommandResult,
} from '@lushly-dev/afd-core';
import { AFD_IDEMPOTENCY_KEY_META_KEY, systemClock, truncateName } from '@lushly-dev/afd-core';
import { canonicalJson } from '@lushly-dev/afd-core/internal/canonical-json';
import { hostState } from './host-state.js';
import {
	type IdempotencyRecord,
	type IdempotencyStore,
	InMemoryIdempotencyStore,
} from './idempotency-store.js';
import { type PrincipalCredentials, principalBinding } from './principal-binding.js';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url SHA-256 of the UTF-8 bytes of `text`, on WebCrypto. */
async function sha256Base64url(text: string): Promise<string> {
	const bytes = new Uint8Array(
		await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
	);
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 6) {
			bits -= 6;
			out += BASE64URL[(value >> bits) & 63];
		}
	}
	if (bits > 0) out += BASE64URL[(value << (6 - bits)) & 63];
	return out;
}

/** The default time the store remembers a key: one day (S8). */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 86_400_000;
/** The default time a reservation stays live past the call's deadline (S7). */
export const DEFAULT_IDEMPOTENCY_LEASE_MS = 60_000;

/** The `idempotency` option of a server or direct registry (`spec/idempotency.md`, S1 to S13). */
export interface IdempotencyOptions {
	/**
	 * Where keys and results are kept (S12). Default: an {@link InMemoryIdempotencyStore}, for this
	 * process only, which a restart forgets (S13). A host with several processes behind one address
	 * gives them one shared store or leaves the step off.
	 */
	store?: IdempotencyStore;
	/**
	 * How long a stored result, or a reservation never settled, answers repeats, from the time the
	 * key was reserved (S8). Default `86400000` (one day). Must be greater than the server's default
	 * deadline plus `leaseMs`.
	 */
	ttlMs?: number;
	/**
	 * How long a reservation still unsettled stays live past the call's deadline, or past the
	 * reservation where the call has none (S7). Default `60000`. A host whose handlers run longer
	 * than that without a deadline sets it to cover them.
	 */
	leaseMs?: number;
	/**
	 * Security declaration: the server's `createContext` hook identifies every HTTP caller with a
	 * distinct actor, so the step may act on HTTP calls without `auth` (S3), as `taskOptions`'
	 * declaration of the same name does for tasks. Counted only when `createContext` is set.
	 */
	callersIdentifiedByHook?: boolean;
}

/** Who a lane says the caller is, for S3. Bound to the call's host state by the lanes. */
export type IdempotencyCaller =
	/** An HTTP request: `identified` when the server can tell its callers apart. */
	| { readonly kind: 'http'; readonly identified: boolean }
	/**
	 * A caller told apart only by its connection (stdio), with neither an actor nor credentials of
	 * its own: its keys are its connection's alone.
	 */
	| { readonly kind: 'connection'; readonly connection: object };

/** The `idempotency` option with its defaults applied and checked. */
export interface ResolvedIdempotency {
	readonly store: IdempotencyStore;
	readonly ttlMs: number;
	readonly leaseMs: number;
	readonly callersIdentifiedByHook: boolean;
}

function checkDuration(value: unknown, name: string, fallback: number): number {
	if (value === undefined) return fallback;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`idempotency.${name} must be a positive integer of milliseconds`);
	}
	return value;
}

/**
 * Apply the defaults of `options` and check S8: `ttlMs` must be greater than the default deadline
 * plus `leaseMs`, or a key could become new while the engine still waits for its first handler.
 *
 * @param defaultTimeoutMs - the server's default deadline, or `null` for none
 * @throws RangeError for a configuration S8 refuses
 */
export function resolveIdempotencyOptions(
	options: IdempotencyOptions,
	defaultTimeoutMs: number | null
): ResolvedIdempotency {
	if (!options || typeof options !== 'object') {
		throw new TypeError('idempotency must be an object of { store, ttlMs, leaseMs }');
	}
	const ttlMs = checkDuration(options.ttlMs, 'ttlMs', DEFAULT_IDEMPOTENCY_TTL_MS);
	const leaseMs = checkDuration(options.leaseMs, 'leaseMs', DEFAULT_IDEMPOTENCY_LEASE_MS);
	const deadline = defaultTimeoutMs ?? 0;
	if (ttlMs <= deadline + leaseMs) {
		throw new RangeError(
			`idempotency.ttlMs (${ttlMs}) must be greater than the default deadline (${deadline}) plus leaseMs (${leaseMs}), or a key could become new while its first call still runs`
		);
	}
	const store = options.store ?? new InMemoryIdempotencyStore();
	for (const method of ['reserve', 'complete', 'release', 'get'] as const) {
		if (typeof (store as unknown as Record<string, unknown>)[method] !== 'function') {
			throw new TypeError(`idempotency.store must have a ${method} method`);
		}
	}
	return {
		store,
		ttlMs,
		leaseMs,
		callersIdentifiedByHook: options.callersIdentifiedByHook === true,
	};
}

/** What the engine prepared for a call the step acts on, before its middleware runs (S4). */
export interface IdempotencyCall {
	readonly command: string;
	readonly key: string;
	/** The call's digest (S4). */
	readonly digest: string;
	/** The call's own deadline in milliseconds, as the engine enforces it, or `undefined` for none. */
	readonly timeoutMs: number | undefined;
}

/** A call as the store sees it: its scope (K5), digest and the times its lease counts from. */
export interface ScopedIdempotencyCall {
	readonly scope: string;
	readonly digest: string;
	/** When the call's deadline started counting, on the step's clock. */
	readonly startedAt: number;
	/** The call's deadline, on the step's clock, or `undefined` for none. */
	readonly deadline: number | undefined;
}

/** What the step decided before the handler: run it under `reservation`, or answer `result`. */
export type IdempotencyBegin =
	| { readonly kind: 'run'; readonly reservation: string }
	| { readonly kind: 'answer'; readonly result: CommandResult };

/** The step, built once per server or registry and shared by its engines. */
export interface IdempotencyStep {
	readonly options: ResolvedIdempotency;
	/** The step's clock: the server's, never one the caller can supply (S8). */
	readonly clock: Clock;
	/**
	 * Whether the step may act on a call from the caller of `context` (S3): the scope's principal
	 * part, or the refusal. `internal` is M8's internal error, for credentials it cannot bind.
	 */
	principal(
		context: CommandContext
	):
		| { kind: 'ok'; principal: string }
		| { kind: 'refused'; error: CommandError }
		| { kind: 'internal' };
	/** The scope of `principal`, `command` and `key` (K5). */
	scope(principal: string, command: string, key: string): string;
	/**
	 * The digest of the call (S4): of its declared context fields and validated input, or
	 * `undefined` when the input has no canonical form.
	 * @throws when the platform has no WebCrypto
	 */
	digest(fields: Record<string, unknown>, input: unknown): Promise<string | undefined>;
	/** Decide the call (S5). */
	begin(call: ScopedIdempotencyCall): Promise<IdempotencyBegin>;
	/** Settle the reservation from the handler's result (S6), or as never settled when it threw. */
	settle(
		call: ScopedIdempotencyCall,
		reservation: string,
		outcome: { kind: 'result'; result: CommandResult } | { kind: 'threw' }
	): Promise<void>;
	/** Release a reservation whose handler never ran (S5). */
	release(call: ScopedIdempotencyCall, reservation: string): Promise<void>;
	/**
	 * The call the step acts on (S4), before middleware runs, or its refusal: an input with no
	 * canonical form, or a platform without WebCrypto. Never throws.
	 */
	prepare(args: {
		command: string;
		key: string;
		/** The names of the declared context fields. */
		fields: readonly string[];
		/** The validated input. */
		input: unknown;
		context: CommandContext;
		defaultTimeoutMs: number | null | undefined;
	}): Promise<{ kind: 'call'; call: IdempotencyCall } | { kind: 'refused'; error: CommandError }>;
	/**
	 * Run the innermost link (S1, S5, S6): for `call`, answer from the store, or reserve its key,
	 * check cancellation again, run `handler` and settle. The scope is bound here, to the principal
	 * the context holds after middleware ran (an auth middleware may set the actor), and the lease
	 * counts from `startedAt`, when the engine started the call's chain and its deadline. Without
	 * `call` (the step does not act), run `handler`. Either way a handler's own `idempotentReplay`
	 * is removed (S9).
	 */
	run(
		call: IdempotencyCall | undefined,
		args: {
			context: CommandContext;
			commandName: string;
			startedAt: number;
			handler: () => Promise<CommandResult>;
			/** Called once the key is reserved (R3). */
			onReserved: () => void;
			/** Where a store's failure to settle goes; the handler's result still stands. */
			reportError: (error: unknown) => void;
		}
	): Promise<CommandResult>;
	/** M8's internal error, for credentials the step cannot bind (S3). */
	internalError(): CommandError;
}

/** The credentials a call's principal binding takes, read by the host. */
export type CredentialsOf = (context: CommandContext) => unknown;

/** What {@link createIdempotencyStep} takes besides the options. */
export interface IdempotencyStepDeps {
	/**
	 * The step's clock: the server's or registry's own, never one a caller supplies (S8). Default
	 * `systemClock`. Give a direct registry's step the registry's `clock`.
	 */
	clock?: Clock;
	/**
	 * The deadline a call without its own `timeout` gets, which S8 checks `ttlMs` against. Default
	 * `null`: none, as on a direct registry. The MCP server passes its `defaultTimeoutMs`.
	 */
	defaultTimeoutMs?: number | null;
	/** The credentials a call's principal binding takes. Default: `context.credentials`. */
	credentialsOf?: CredentialsOf;
}

/**
 * Build the idempotency step (`spec/idempotency.md`, S1 to S13). The MCP server builds its own
 * from its `idempotency` option. A direct registry takes one built here, so a host that does not
 * use the step does not bundle it:
 *
 * ```ts
 * createDirectRegistry(commands, {
 *   clock,
 *   idempotency: createIdempotencyStep({ ttlMs: 3_600_000 }, { clock }),
 * });
 * ```
 *
 * @throws RangeError for a configuration S8 refuses
 */
export function createIdempotencyStep(
	given: IdempotencyOptions = {},
	deps: IdempotencyStepDeps = {}
): IdempotencyStep {
	const options = resolveIdempotencyOptions(given, deps.defaultTimeoutMs ?? null);
	const clock = deps.clock ?? systemClock;
	const credentialsOf = deps.credentialsOf ?? ((context: CommandContext) => context.credentials);
	/** A random id per connection, so two connections sharing a store never share a key. */
	const connections = new WeakMap<object, string>();
	let connectionCount = 0;
	const connectionId = (connection: object): string => {
		let id = connections.get(connection);
		if (id === undefined) {
			connectionCount += 1;
			const random =
				typeof globalThis.crypto?.randomUUID === 'function'
					? globalThis.crypto.randomUUID()
					: Math.random().toString(36).slice(2);
			id = `${connectionCount}-${random}`;
			connections.set(connection, id);
		}
		return id;
	};
	const store = options.store;

	return {
		options,
		clock,
		principal(context) {
			const caller = hostState(context).idempotencyCaller;
			if (caller?.kind === 'http' && !caller.identified) {
				return { kind: 'refused', error: unidentifiedCallersError() };
			}
			if (caller?.kind === 'connection') {
				return {
					kind: 'ok',
					principal: canonicalJson({ connection: connectionId(caller.connection) }),
				};
			}
			try {
				return {
					kind: 'ok',
					principal: principalBinding(
						context.actor as Actor | undefined,
						credentialsOf(context) as PrincipalCredentials | undefined
					),
				};
			} catch {
				return { kind: 'internal' };
			}
		},
		scope(principal, command, key) {
			return canonicalJson({ command, key, principal });
		},
		async digest(fields, input) {
			let canonical: string;
			try {
				canonical = canonicalJson({ context: fields, input });
			} catch {
				return undefined;
			}
			return sha256Base64url(canonical);
		},
		async begin(call) {
			const now = clock.now();
			const outcome = await store.reserve(
				call.scope,
				{
					digest: call.digest,
					reservedAt: now,
					expiresAt: now + options.ttlMs,
					leaseEndsAt: (call.deadline ?? now) + options.leaseMs,
				},
				now
			);
			if (outcome.reserved) return { kind: 'run', reservation: outcome.reservation };
			return { kind: 'answer', result: answerFor(outcome.record, call.digest, now) };
		},
		async settle(call, reservation, outcome) {
			if (outcome.kind === 'threw') {
				await store.complete(call.scope, reservation, { kind: 'unknown' });
				return;
			}
			const { result } = outcome;
			const error = result.success ? undefined : result.error;
			if (error?.code === 'TIMEOUT') {
				// "May still have run" (spec/error-codes.md): nobody can say.
				await store.complete(call.scope, reservation, { kind: 'unknown' });
			} else if (error?.retryable === true) {
				// A keyed command that returns a retryable failure promises nothing was applied.
				await store.release(call.scope, reservation);
			} else {
				await store.complete(call.scope, reservation, {
					kind: 'result',
					result: withoutReplayMarker(result),
				});
			}
		},
		async release(call, reservation) {
			await store.release(call.scope, reservation);
		},
		async prepare(args) {
			const fields: Record<string, unknown> = {};
			for (const name of args.fields) {
				const value = (args.context as Record<string, unknown>)[name];
				if (value !== undefined && value !== null) fields[name] = value;
			}
			let digest: string | undefined;
			try {
				digest = await this.digest(fields, args.input);
			} catch {
				// The digest needs WebCrypto, which a browser page on an insecure origin lacks.
				return { kind: 'refused', error: noWebCryptoError() };
			}
			if (digest === undefined) {
				return { kind: 'refused', error: inputNotCanonicalError(args.command) };
			}
			const { timeout } = args.context;
			const effective = timeout === undefined ? args.defaultTimeoutMs : timeout;
			return {
				kind: 'call',
				call: {
					command: args.command,
					key: args.key,
					digest,
					// As `withCommandTimeout` enforces it: only a positive, finite deadline counts.
					timeoutMs:
						typeof effective === 'number' && Number.isFinite(effective) && effective > 0
							? effective
							: undefined,
				},
			};
		},
		async run(prepared, { context, commandName, startedAt, handler, onReserved, reportError }) {
			if (!prepared) return withoutReplayMarker(await handler());
			// The scope of the principal as middleware left it (S3, K5): an auth middleware may have
			// set the actor. A caller refused before middleware ran never reaches here.
			const decided = this.principal(context);
			if (decided.kind === 'refused') return { success: false, error: decided.error };
			if (decided.kind === 'internal') return { success: false, error: internalPrincipalError() };
			const call: ScopedIdempotencyCall = {
				scope: this.scope(decided.principal, prepared.command, prepared.key),
				digest: prepared.digest,
				startedAt,
				deadline: prepared.timeoutMs === undefined ? undefined : startedAt + prepared.timeoutMs,
			};
			const begun = await this.begin(call);
			if (begun.kind === 'answer') return begun.result;
			const { reservation } = begun;
			onReserved();
			// The cancellation check again, now the key is held (S5): nothing ran, so nothing is kept.
			if (context.signal?.aborted) {
				await this.release(call, reservation);
				return { success: false, error: cancelledBeforeStartError(commandName) };
			}
			let result: CommandResult;
			try {
				result = withoutReplayMarker(await handler());
			} catch (error) {
				try {
					await this.settle(call, reservation, { kind: 'threw' });
				} catch (storeError) {
					reportError(storeError);
				}
				throw error;
			}
			try {
				await this.settle(call, reservation, { kind: 'result', result });
			} catch (storeError) {
				// The handler's result stands: a store that failed to keep it leaves the reservation to
				// its lease (S7), after which a repeat is told the outcome is unknown.
				reportError(storeError);
			}
			return result;
		},
		internalError: internalPrincipalError,
	};
}

/** The answer for a call whose scope `record` holds (S5). */
function answerFor(record: IdempotencyRecord, digest: string, now: number): CommandResult {
	if (record.digest !== digest) return { success: false, error: keyReusedError() };
	if (record.state === 'stored' && record.result) {
		return {
			...record.result,
			metadata: { ...record.result.metadata, idempotentReplay: true },
		};
	}
	if (record.state === 'reserved' && now <= record.leaseEndsAt) {
		return { success: false, error: inProgressError() };
	}
	return { success: false, error: outcomeUnknownError() };
}

/** `result` without a handler-supplied `metadata.idempotentReplay`, which is the engine's (S9). */
export function withoutReplayMarker(result: CommandResult): CommandResult {
	if (!result.metadata || !Object.hasOwn(result.metadata, 'idempotentReplay')) return result;
	const { idempotentReplay: _dropped, ...metadata } = result.metadata;
	return { ...result, metadata };
}

/** `IDEMPOTENCY_KEY_REUSED` (S5). */
export function keyReusedError(): CommandError {
	return {
		code: 'IDEMPOTENCY_KEY_REUSED',
		message: 'This idempotency key is already held for a call with another input',
		suggestion:
			'Use a new idempotency key for a different call. Reuse a key only to repeat the same call with the same input.',
		retryable: false,
		recovery: { kind: 'stop' },
		details: { meta: AFD_IDEMPOTENCY_KEY_META_KEY },
	};
}

/** `IDEMPOTENCY_IN_PROGRESS` (S5). */
export function inProgressError(): CommandError {
	return {
		code: 'IDEMPOTENCY_IN_PROGRESS',
		message: 'An earlier call with this idempotency key and input is still running',
		suggestion:
			'Repeat the call shortly with the same idempotency key: it then gets the earlier call’s result.',
		retryable: true,
		recovery: { kind: 'retry', afterMs: 1000 },
		details: { meta: AFD_IDEMPOTENCY_KEY_META_KEY },
	};
}

/** `OUTCOME_UNKNOWN` from the step (S6, S7). */
export function outcomeUnknownError(): CommandError {
	return {
		code: 'OUTCOME_UNKNOWN',
		message:
			'An earlier call with this idempotency key and input started, and nobody can say whether it was applied',
		suggestion:
			'Check whether the change was made. If the call is still wanted, send it with a new idempotency key.',
		retryable: false,
		recovery: { kind: 'external' },
		details: { meta: AFD_IDEMPOTENCY_KEY_META_KEY },
	};
}

/** What the engine's cancellation check returns before a handler starts (`command-timeout.ts`). */
function cancelledBeforeStartError(name: string): CommandError {
	return {
		code: 'COMMAND_CANCELLED',
		message: `Command '${truncateName(name)}' was cancelled before it started`,
		suggestion: 'Retry with a fresh signal if the command is still needed.',
		retryable: false,
	};
}

/** S3's refusal of a caller the server cannot tell apart. */
export function unidentifiedCallersError(): CommandError {
	return {
		code: 'UNAUTHORIZED',
		message:
			'This server cannot tell its callers apart, so it does not answer repeats from its idempotency store',
		suggestion:
			"Nothing ran. Call again without the idempotency key, or the server's operator configures authorization, or declares that the server's context hook identifies every caller (idempotency.callersIdentifiedByHook).",
		retryable: false,
	};
}

/** The refusal of a keyed call on a platform without WebCrypto, which the digest needs (S4). */
export function noWebCryptoError(): CommandError {
	return {
		code: 'INTERNAL_ERROR',
		message: 'This platform has no WebCrypto, which the idempotency step needs',
		suggestion:
			'Nothing ran. Call without an idempotency key, or the operator serves the app over HTTPS or from localhost, where browsers provide WebCrypto.',
		retryable: false,
		details: { meta: AFD_IDEMPOTENCY_KEY_META_KEY, reason: 'no-webcrypto' },
	};
}

/** M8's internal error, whose message names no one (S3). */
export function internalPrincipalError(): CommandError {
	return {
		code: 'INTERNAL_ERROR',
		message: 'Internal error',
		suggestion: 'Nothing ran. Tell the server’s operator; calling again will not help.',
		retryable: false,
	};
}

/** `VALIDATION_ERROR` for an input with no canonical form, which a key cannot cover (S4). */
export function inputNotCanonicalError(commandName: string): CommandError {
	return {
		code: 'VALIDATION_ERROR',
		message: `The input of '${truncateName(commandName)}' has no canonical JSON form, so an idempotency key cannot cover it`,
		suggestion:
			'Send plain JSON input (no bigint, Map, Set, class instance or non-finite number), or call without an idempotency key.',
		retryable: false,
		details: { meta: AFD_IDEMPOTENCY_KEY_META_KEY, reason: 'input-not-canonical' },
	};
}
