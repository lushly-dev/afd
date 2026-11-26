/**
 * @fileoverview Host-verified confirmation (`spec/command-metadata.md`, "Host-verified
 * confirmation" and "Relay evidence"): the {@link HumanRelay} a host installs with
 * `createMcpServer({ humanRelay })` or `createMcpHandler({ humanRelay })`, `inputDigest`, and the
 * gate that enforces it on every MCP and HTTP surface regardless of `confirmations`.
 *
 * Node-only (uses `node:crypto` and `@modelcontextprotocol/server`); never imported by `/direct`
 * or `/define`.
 */

import { createHash } from 'node:crypto';
import type { Actor, Clock, CommandContext, CommandError } from '@lushly-dev/afd-core';
import { ErrorCodes, systemClock } from '@lushly-dev/afd-core';
import { inputRequired, ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';
import { actorJson, canonicalJson } from './approval-crypto.js';
import { withoutApprovalRelay } from './approval-relay.js';
import type { ConfirmationStep, HumanRelayGate, HumanRelayOutcome } from './confirmations.js';
import { applyContextFields, type ContextField, RESERVED_CONTEXT_NAMES } from './context-fields.js';
import { hostState, withHostState } from './host-state.js';
import type { Credentials } from './mcp-auth-rules.js';
import {
	credentialsBinding,
	type PrincipalCredentials,
	principalBinding,
} from './principal-binding.js';
import {
	attachRelayDispatchAdmission,
	attachRelayEvidence,
	attachRelayValidatedInput,
	type RelayEvidence,
} from './relay-evidence.js';
import type { ZodCommandDefinition } from './schema.js';
import { scopeViewOf } from './scope-view.js';
import {
	type EnhancedValidationResult,
	formatEnhancedValidationError,
	validateInputEnhanced,
} from './validation.js';

/** The `inputRequests` key of the URL-mode elicitation a {@link HumanRelay} prompt becomes. */
export const RELAY_INPUT_KEY = 'relay';

/** What an MCP lane carries for host-verified confirmation (`spec/command-metadata.md`). */
export interface HumanRelayChannel {
	readonly modern: boolean;
	readonly clientCapabilities?: Record<string, unknown>;
	readonly requestState?: string;
	readonly relayAction?: 'accept' | 'decline' | 'cancel';
}

/** Return a copy of `context` carrying the lane's host-verified relay channel. */
export function bindHumanRelayChannel(
	context: CommandContext,
	channel: HumanRelayChannel
): CommandContext {
	return withHostState(context, { humanRelayChannel: channel });
}

/** The host-verified relay channel bound to `context`, if any. */
export function humanRelayChannel(
	context: CommandContext | undefined
): HumanRelayChannel | undefined {
	return hostState(context).humanRelayChannel;
}

/**
 * Compute the relay input digest (`spec/command-metadata.md`, "Host-verified confirmation",
 * step 2): unpadded base64url SHA-256 of the canonical JSON (`spec/command-metadata.md`,
 * "Approvals", rule 3) of `input`. `spec/authorization.json` (`inputDigests`) pins it.
 *
 * @throws TypeError when `input` has no exact canonical JSON form (e.g. `bigint`, non-finite
 *   number, cycle, `Map`, `Set`, class instance)
 */
export function inputDigest(input: unknown): string {
	return createHash('sha256').update(canonicalJson(input), 'utf8').digest('base64url');
}

function canonicalOrUndefined(value: unknown): string | undefined {
	try {
		return canonicalJson(value);
	} catch {
		return undefined;
	}
}

/** One call a {@link HumanRelay} is asked about. */
export interface RelayCall {
	/** The command's name. */
	readonly command: string;
	/** {@link inputDigest} of the validated input (defaults applied): what the person decides on. */
	readonly inputDigest: string;
	/** The actor the command runs with (after `createContext` and verified credentials). */
	readonly actor?: Actor;
	/** The call's verified credentials, on an authorized server (or from `createContext`). */
	readonly credentials?: Credentials | PrincipalCredentials;
	/** The client capabilities declared on the request. */
	readonly clientCapabilities?: Record<string, unknown>;
	/** The validated input that {@link inputDigest} names, so the host can show it to the person. */
	readonly input: unknown;
	/**
	 * The context the command would run with: after `createContext` and declared context fields,
	 * with verified credentials and actor. Relay evidence is never on it.
	 */
	readonly context: CommandContext;
	/**
	 * The call's principal binding (`spec/authorization.md`, M8), which the relay's state must
	 * bind.
	 */
	principalBinding(): string;
	/**
	 * Whether the client declared URL-mode elicitation, without which the server never sends the
	 * relay's prompt.
	 */
	supportsUrlElicitation(): boolean;
}

/** What the person is asked to open, and the state that names the pending decision. */
export interface RelayPrompt {
	/** An absolute `https` URL that holds no identity and is not pre-authenticated. */
	url: string;
	/** The elicitation's message: ids, never content. */
	message: string;
	/** The `requestState`: integrity-protected by the relay (expires within 24 hours). */
	state: string;
}

/** Result of {@link HumanRelay.begin}: a prompt to send, or a refusal error. */
export type RelayBeginResult =
	| { ok: true; prompt: RelayPrompt }
	| { ok: false; error: CommandError };

/** What {@link HumanRelay.resume} found for the pending decision. */
export type RelayOutcome =
	| { kind: 'approved'; decisionId: string }
	| { kind: 'declined' }
	| { kind: 'pending'; prompt: RelayPrompt }
	| { kind: 'invalid' };

/**
 * The host's way to prove that a person decided a call to a host-verified command
 * (`spec/command-metadata.md`, "Host-verified confirmation").
 *
 * A relay guarantees:
 * - Its `state` is integrity-protected, expires within 24 hours, and binds the decision, the
 *   command, `inputDigest` and `call.principalBinding()` (M8). `resume` returns
 *   `{ kind: 'invalid' }` for a state that does not verify, has expired, or names another
 *   command, input or principal.
 * - `{ kind: 'approved', decisionId }` is returned at most once per decision, atomically, with
 *   a non-empty `decisionId`, and only for a decision the person made after `begin`.
 * - Its `url` is an absolute `https` URL holding no identity and not pre-authenticated.
 */
export interface HumanRelay {
	/** Start a decision for `call`, or refuse it with a `CommandError`. */
	begin(call: RelayCall): Promise<RelayBeginResult> | RelayBeginResult;
	/** Check what became of the decision `state` names for `call`. */
	resume(state: string, call: RelayCall): Promise<RelayOutcome> | RelayOutcome;
	/**
	 * Optional host-owned context fields for an approved call, merged onto the call's context
	 * before middleware and the handler run (replacing any request-supplied field of the same
	 * name, never reserved AFD keys). Not evidence: stays on context across nested in-process
	 * calls.
	 */
	approvedContext?(
		decisionId: string,
		call: RelayCall
	): Promise<Record<string, unknown>> | Record<string, unknown>;
}

/** Reserved context keys that `approvedContext` must never replace. */
const RESERVED_APPROVED_KEYS = new Set([
	...RESERVED_CONTEXT_NAMES,
	'reportProgress',
	'__proto__',
	'constructor',
	'prototype',
]);

const MAX_PENDING_INPUTS = 4096;
const MAX_PENDING_INPUT_CHARS = 32_768;
const PENDING_INPUT_TTL_MS = 24 * 60 * 60_000;

interface PendingInput {
	command: string;
	rawCanonical: string;
	principal: string;
	canonical: string;
	expiresAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether declared client capabilities include URL-mode elicitation (`elicitation.url`).
 * `elicitation: {}` (form only) and `elicitation: { form: {} }` return `false`.
 */
export function allowsUrlElicitation(capabilities: unknown): boolean {
	if (!isRecord(capabilities)) return false;
	const elicitation = capabilities.elicitation;
	if (!isRecord(elicitation)) return false;
	return isRecord(elicitation.url);
}

/**
 * Whether `url` is an absolute `https` URL with a host, no user information, and no whitespace
 * or control character.
 */
export function isRelayUrl(url: unknown): url is string {
	if (typeof url !== 'string' || url.length <= 8) return false;
	if (!url.slice(0, 8).toLowerCase().startsWith('https://')) return false;
	for (let i = 0; i < url.length; i++) {
		const code = url.charCodeAt(i);
		if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
		if (/\s/.test(url[i] ?? '')) return false;
	}
	const rest = url.slice(8);
	const authority = rest.split(/[/?#]/, 1)[0] ?? '';
	if (authority.length === 0 || authority.includes('@')) return false;
	try {
		const parsed = new URL(url);
		return (
			parsed.protocol === 'https:' &&
			parsed.hostname.length > 0 &&
			parsed.username === '' &&
			parsed.password === ''
		);
	} catch {
		return false;
	}
}

function quoted(names: readonly string[]): string {
	return names.map((name) => `'${name}'`).join(', ');
}

function requiredError(names: readonly string[], suggestion: string): CommandError {
	return {
		code: ErrorCodes.CONFIRMATION_REQUIRED,
		message:
			names.length === 1
				? `'${names[0]}' needs a person's confirmation through the host`
				: `${quoted(names)} need a person's confirmation through the host`,
		suggestion,
		retryable: false,
		details: { commands: [...names] },
		// A person confirms through the host (`spec/recovery.md`, "Engine errors").
		recovery: { kind: 'external' },
	};
}

function declinedError(names: readonly string[]): CommandError {
	return {
		code: ErrorCodes.CONFIRMATION_DECLINED,
		message: `The user did not confirm ${quoted(names)}`,
		suggestion:
			'Do not run this again without asking the user first; the user chose not to proceed.',
		retryable: false,
		details: { commands: [...names] },
		recovery: { kind: 'stop' },
	};
}

/**
 * Refusal for a host-verified command the server cannot relay: no relay is installed, or the call
 * is a batch/pipeline step, a 2025-era request, or an HTTP `/rpc`, `/batch` or `/stream` route.
 */
export function hostVerifiedUnrelayable(names: readonly string[], hasRelay: boolean): CommandError {
	const suggestion = !hasRelay
		? `This server cannot confirm ${quoted(names)} over MCP: only the host can, and it has no way to ask the person here. Do not retry; ask the user to run it through the application.`
		: `Call ${quoted(names)} on its own (its own tool, a grouped tool or afd-call) from an MCP 2026-07-28 client, so the host can ask the person.`;
	return requiredError(names, suggestion);
}

function relayInternalError(): ProtocolError {
	return new ProtocolError(ProtocolErrorCode.InternalError, 'Internal error');
}

function filterApprovedExtra(extra: unknown): Record<string, unknown> {
	if (extra === undefined) return {};
	if (!isRecord(extra)) throw relayInternalError();
	const filtered: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(extra)) {
		if (!RESERVED_APPROVED_KEYS.has(key)) filtered[key] = value;
	}
	return filtered;
}

function stateKey(state: string): string {
	return createHash('sha256').update(state, 'utf8').digest('base64url');
}

export interface HumanRelayGateOptions {
	relay?: HumanRelay;
	commands: readonly ZodCommandDefinition[];
	actor: Actor;
	devMode: boolean;
	contextFields?: readonly ContextField[];
	clock?: Clock;
	maxValidationIssues?: number;
	onError?: (error: Error) => void;
}

/**
 * Create the host-verified confirmation gate wired into `createToolRouter` on MCP servers.
 * Enforced on every MCP surface regardless of `confirmations` (`'off'` included).
 */
export function createHumanRelayGate(options: HumanRelayGateOptions): HumanRelayGate {
	const {
		relay,
		actor: defaultActor,
		devMode,
		contextFields,
		clock = systemClock,
		maxValidationIssues,
		onError,
	} = options;
	const hostVerifiedNames = new Set(
		options.commands
			.filter((command) => command.confirmationMode === 'host-verified')
			.map((command) => command.name)
	);
	// Keeps the initial validated input across `begin` -> `resume` when a Zod schema computes a
	// dynamic default (e.g. a generated id or timestamp), without altering the relay's `state` on
	// the wire. Re-validated through the command's schema on retry (#1414 semantics).
	const pendingInputs = new Map<string, PendingInput>();

	function prunePending(now: number): void {
		for (const [key, entry] of pendingInputs) {
			if (entry.expiresAt <= now) pendingInputs.delete(key);
		}
		while (pendingInputs.size >= MAX_PENDING_INPUTS) {
			const oldest = pendingInputs.keys().next().value;
			if (oldest === undefined) break;
			pendingInputs.delete(oldest);
		}
	}

	function rememberPending(
		state: string,
		command: string,
		rawCanonical: string | undefined,
		principal: string,
		canonical: string
	): void {
		if (rawCanonical === undefined || canonical.length > MAX_PENDING_INPUT_CHARS) return;
		const now = clock.now();
		prunePending(now);
		pendingInputs.set(stateKey(state), {
			command,
			rawCanonical,
			principal,
			canonical,
			expiresAt: now + PENDING_INPUT_TTL_MS,
		});
	}

	function readPending(
		state: string,
		command: ZodCommandDefinition,
		rawCanonical: string | undefined,
		principal: string
	): EnhancedValidationResult<unknown> | undefined {
		if (rawCanonical === undefined) return undefined;
		const key = stateKey(state);
		const entry = pendingInputs.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= clock.now()) {
			pendingInputs.delete(key);
			return undefined;
		}
		if (
			entry.command !== command.name ||
			entry.rawCanonical !== rawCanonical ||
			entry.principal !== principal
		) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(entry.canonical) as unknown;
			const rechecked = validateInputEnhanced(command.inputSchema, parsed, maxValidationIssues);
			if (rechecked.success && canonicalOrUndefined(rechecked.data) === entry.canonical) {
				return rechecked;
			}
		} catch {
			// Fall back to validating the raw request input as sent.
		}
		return undefined;
	}

	function forgetPendingIfMatching(
		state: string | undefined,
		command: string,
		rawCanonical: string | undefined,
		principal: string
	): void {
		if (!state || rawCanonical === undefined) return;
		const key = stateKey(state);
		const entry = pendingInputs.get(key);
		if (
			entry &&
			entry.command === command &&
			entry.rawCanonical === rawCanonical &&
			entry.principal === principal
		) {
			pendingInputs.delete(key);
		}
	}

	function present(
		commandName: string,
		capabilities: Record<string, unknown> | undefined,
		prompt: RelayPrompt,
		rawCanonical: string | undefined,
		principal: string,
		validatedCanonical: string
	): HumanRelayOutcome {
		if (!allowsUrlElicitation(capabilities)) {
			return {
				kind: 'error',
				error: requiredError(
					[commandName],
					`Use an MCP client that supports URL-mode elicitation: only a person, through the link the host sends, can confirm '${commandName}'.`
				),
			};
		}
		if (
			!isRecord(prompt) ||
			!isRelayUrl(prompt.url) ||
			typeof prompt.message !== 'string' ||
			typeof prompt.state !== 'string' ||
			prompt.state.length === 0
		) {
			throw relayInternalError();
		}
		rememberPending(prompt.state, commandName, rawCanonical, principal, validatedCanonical);
		// One id per URL, so a pending decision keeps one id.
		const elicitationId = createHash('sha256').update(prompt.url, 'utf8').digest('base64url');
		return {
			kind: 'input-required',
			result: inputRequired({
				inputRequests: {
					[RELAY_INPUT_KEY]: {
						method: 'elicitation/create',
						params: {
							mode: 'url',
							message: prompt.message,
							url: prompt.url,
							elicitationId,
						},
					},
				},
				requestState: prompt.state,
			}),
		};
	}

	return {
		refuseSteps(steps: readonly ConfirmationStep[]): CommandError | undefined {
			const names: string[] = [];
			for (const step of steps) {
				if (hostVerifiedNames.has(step.command) && !names.includes(step.command)) {
					names.push(step.command);
				}
			}
			return names.length > 0 ? hostVerifiedUnrelayable(names, Boolean(relay)) : undefined;
		},

		async check(
			command: ZodCommandDefinition,
			input: unknown,
			callContext: CommandContext
		): Promise<HumanRelayOutcome> {
			const name = command.name;
			if (!relay) {
				return { kind: 'error', error: hostVerifiedUnrelayable([name], false) };
			}
			const channel = humanRelayChannel(callContext);
			if (!channel?.modern) {
				return { kind: 'error', error: hostVerifiedUnrelayable([name], true) };
			}

			// M8: credentials that cannot be bound never reach the relay, on first call or retry.
			const actor = (callContext.actor ?? defaultActor) as Actor | undefined;
			const credentials = callContext.credentials as Credentials | PrincipalCredentials | undefined;
			let credsBinding: string;
			let boundPrincipal: string;
			try {
				credsBinding = credentialsBinding(credentials);
				boundPrincipal = principalBinding(actor, credentials);
			} catch {
				throw relayInternalError();
			}

			// Step 2: validate first, as the execution engine will, so the person decides on
			// exactly what will run. On an `accept` retry for the same raw input, command and
			// principal, reuse the initial validated input if it still validates to the same
			// canonical JSON (so dynamic Zod defaults stay bound across `begin` -> `resume`).
			const rawCanonical = canonicalOrUndefined(input);
			const pendingValidation =
				channel.relayAction === 'accept' && channel.requestState
					? readPending(channel.requestState, command, rawCanonical, boundPrincipal)
					: undefined;
			let validation: EnhancedValidationResult<unknown> | undefined = pendingValidation;
			if (!validation) {
				try {
					validation = validateInputEnhanced(command.inputSchema, input, maxValidationIssues);
				} catch (err) {
					const error = err instanceof Error ? err : new Error(String(err));
					try {
						onError?.(error);
					} catch {}
					return {
						kind: 'error',
						error: {
							code: ErrorCodes.VALIDATION_ERROR,
							message: 'Input validation failed',
							suggestion: devMode
								? `Input validation threw: ${error.message}`
								: `Check the input against the input schema of '${name}' (afd-detail returns it) and retry`,
						},
					};
				}
			}
			if (!validation.success) {
				return {
					kind: 'error',
					error: {
						code: ErrorCodes.VALIDATION_ERROR,
						message: 'Input validation failed',
						suggestion: formatEnhancedValidationError(validation.errors, {
							expectedFields: validation.expectedFields,
							unexpectedFields: validation.unexpectedFields,
							missingFields: validation.missingFields,
							truncated: validation.truncated,
							limit: validation.limit,
						}),
						details: {
							errors: validation.errors,
							expectedFields: validation.expectedFields,
							unexpectedFields: validation.unexpectedFields,
							missingFields: validation.missingFields,
							...(validation.truncated
								? {
										truncated: true,
										limit: validation.limit,
										totalErrors: validation.totalErrors,
									}
								: {}),
						},
					},
				};
			}

			// Re-check scopes on the validated input (M6) before asking anyone.
			const view = scopeViewOf(callContext);
			const scopeDecision = view?.decideExecution(name, validation.data);
			if (view && scopeDecision && scopeDecision !== 'proceed') {
				return { kind: 'error', error: view.insufficientScope(scopeDecision.forbidden) };
			}

			let validatedCanonical: string;
			let digest: string;
			try {
				validatedCanonical = canonicalJson(validation.data);
				digest = createHash('sha256').update(validatedCanonical, 'utf8').digest('base64url');
			} catch (err) {
				return {
					kind: 'error',
					error: {
						code: ErrorCodes.VALIDATION_ERROR,
						message: err instanceof Error ? err.message : 'Input has no canonical JSON form',
						suggestion: 'Pass plain JSON input: integers within ±2^53',
						retryable: false,
					},
				};
			}

			const capabilities = channel.clientCapabilities;
			const relayContext: CommandContext = {
				...withoutApprovalRelay(callContext),
				...(actor ? { actor: { ...actor } } : {}),
			};
			// Validate declared context fields before asking a person, so `call.context` matches
			// what the command runs with and invalid `_meta` context fields fail fast.
			if (contextFields?.length) {
				const invalidField = applyContextFields(contextFields, relayContext, name, {
					devMode,
					// Guarded here: a hook that throws or rejects must not change the answer.
					onError: (error) => {
						try {
							const returned: unknown = onError?.(
								error instanceof Error ? error : new Error(String(error))
							);
							if (returned instanceof Promise) returned.catch(() => {});
						} catch {}
					},
				});
				if (invalidField?.error) {
					return { kind: 'error', error: invalidField.error };
				}
			}

			const call: RelayCall = {
				command: name,
				inputDigest: digest,
				...(actor ? { actor: { ...actor } } : {}),
				...(credentials !== undefined ? { credentials } : {}),
				...(capabilities !== undefined ? { clientCapabilities: capabilities } : {}),
				input: validation.data,
				context: relayContext,
				principalBinding: () => boundPrincipal,
				supportsUrlElicitation: () => allowsUrlElicitation(capabilities),
			};

			// Step 4: retry carrying inputResponses.relay and requestState.
			if (channel.relayAction && channel.requestState) {
				if (channel.relayAction === 'decline' || channel.relayAction === 'cancel') {
					forgetPendingIfMatching(channel.requestState, name, rawCanonical, boundPrincipal);
					return { kind: 'error', error: declinedError([name]) };
				}
				if (channel.relayAction === 'accept') {
					const outcome = await relay.resume(channel.requestState, call);
					if (!isRecord(outcome) || typeof outcome.kind !== 'string') {
						throw relayInternalError();
					}
					switch (outcome.kind) {
						case 'approved': {
							if (typeof outcome.decisionId !== 'string' || outcome.decisionId.length === 0) {
								throw relayInternalError();
							}
							forgetPendingIfMatching(channel.requestState, name, rawCanonical, boundPrincipal);
							const extra = relay.approvedContext
								? filterApprovedExtra(await relay.approvedContext(outcome.decisionId, call))
								: {};
							const evidence: RelayEvidence = {
								command: name,
								inputDigest: digest,
								actor: actorJson(actor),
								credentialsBinding: credsBinding,
								decisionId: outcome.decisionId,
							};
							// Build execution context: strip form-mode approval relay, merge host-owned
							// approvedContext fields, attach private relay evidence, validated input,
							// and one-shot host-verified dispatch admission (off-object WeakMap).
							const execContext: CommandContext = {
								...withoutApprovalRelay(callContext),
								...extra,
							};
							attachRelayEvidence(execContext, evidence);
							attachRelayValidatedInput(execContext, name, validation.data);
							attachRelayDispatchAdmission(execContext, {
								command: name,
								canonical: validatedCanonical,
								canonicalize: canonicalOrUndefined,
							});
							return { kind: 'proceed', context: execContext };
						}
						case 'declined':
							forgetPendingIfMatching(channel.requestState, name, rawCanonical, boundPrincipal);
							return { kind: 'error', error: declinedError([name]) };
						case 'pending':
							if (outcome.prompt?.state !== channel.requestState) {
								forgetPendingIfMatching(channel.requestState, name, rawCanonical, boundPrincipal);
							}
							return present(
								name,
								capabilities,
								outcome.prompt,
								rawCanonical,
								boundPrincipal,
								validatedCanonical
							);
						case 'invalid':
							if (pendingValidation) {
								forgetPendingIfMatching(channel.requestState, name, rawCanonical, boundPrincipal);
							}
							// State is not an answer: begin again (step 3).
							break;
						default:
							throw relayInternalError();
					}
				}
			}

			// Step 3: begin.
			const begun = await relay.begin(call);
			if (!isRecord(begun) || typeof begun.ok !== 'boolean') {
				throw relayInternalError();
			}
			if (!begun.ok) {
				if (
					!isRecord(begun.error) ||
					typeof begun.error.code !== 'string' ||
					typeof begun.error.message !== 'string'
				) {
					throw relayInternalError();
				}
				return { kind: 'error', error: begun.error };
			}
			return present(
				name,
				capabilities,
				begun.prompt,
				rawCanonical,
				boundPrincipal,
				validatedCanonical
			);
		},
	};
}
