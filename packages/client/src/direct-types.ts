/**
 * @fileoverview Public option, context and registry types for DirectClient and DirectTransport.
 */

import type {
	Actor,
	Clock,
	CommandContext,
	CommandMiddleware,
	CommandResult,
	JsonSchema,
	McpTool,
	RandomSource,
} from '@lushly-dev/afd-core';
import type { CommandDefinition } from './direct-validation.js';

// ═══════════════════════════════════════════════════════════════════════════
// DIRECT CLIENT OPTIONS AND CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for creating a DirectClient.
 */
export interface DirectClientOptions {
	/**
	 * Source identifier for this client (e.g., 'my-agent', 'api-server').
	 * Propagated to command handlers via context.
	 */
	source?: string;

	/**
	 * Enable debug logging.
	 */
	debug?: boolean;

	/**
	 * Whether to validate inputs against command schemas.
	 * Default: true
	 */
	validateInputs?: boolean;

	/**
	 * Middleware to run before command execution.
	 * Executes in onion pattern (same as server middleware).
	 * When empty or omitted, the zero-overhead path is preserved.
	 */
	middleware?: CommandMiddleware[];

	/**
	 * Restrict the commands this client may call. When it returns `false` (or
	 * throws), `call()` and `pipe()` return a `COMMAND_NOT_ALLOWED` failure
	 * without reaching the registry, and `listCommands()`, `listCommandNames()`
	 * and `hasCommand()` leave the command out.
	 *
	 * This narrows what the registry offers; it does not replace exposure
	 * checks. Pair it with `createDirectRegistry()` from `@lushly-dev/afd-server`,
	 * which validates input and honours `expose.agent`.
	 */
	allow?: (commandName: string) => boolean;

	/**
	 * Who calls commands through this client, as `context.actor`. A call's own
	 * `context.actor` wins. Default: `{ kind: 'human' }`; set `{ kind: 'agent' }` (with a
	 * `label`, and `onBehalfOf` for the user) when an in-app assistant drives the client.
	 */
	actor?: Actor;

	/**
	 * `context.clock` for calls that set none. Pass `fixedClock()` in tests. When omitted,
	 * the registry's own default applies (`createDirectRegistry()`: `systemClock`).
	 */
	clock?: Clock;

	/**
	 * `context.random` for calls that set none. Pass `seededRandom()` in tests. When omitted,
	 * the registry's own default applies (`createDirectRegistry()`: `systemRandom`).
	 */
	random?: RandomSource;

	/**
	 * Ask a human whether a call held with `APPROVAL_REQUIRED` (by `createApprovalMiddleware`)
	 * may run. On `true`, the client retries the same call once, with the same input and actor
	 * and `context.approval` set to the result's `details.approvalToken`, and returns the
	 * retry's result. On `false`, any other value, or a hook that throws, the original
	 * `APPROVAL_REQUIRED` result is returned unchanged. Without the hook, or when the result
	 * carries no `details.approvalToken`, the result is returned unchanged.
	 *
	 * The hook is trusted application code. It never sees the token, and the token never goes
	 * into command input. `context.timeout` bounds each attempt, not the wait for the human: use
	 * `request.signal`, which aborts with the call's signal, to close the prompt. A call whose
	 * signal aborts during the wait counts as not approved. The token has a server-side expiry:
	 * once it passes, the retry is held again (`details.reason: 'expired'`) and returned as is.
	 * The client never retries more than once.
	 *
	 * In `pipe()`, each gated step asks when it is reached, with its resolved input; a denied
	 * step fails like any other. A pipeline's `timeoutMs` includes the time spent waiting.
	 */
	onApprovalNeeded?: DirectApprovalHook;
}

/** A call held for approval, as passed to `onApprovalNeeded`. */
export interface DirectApprovalRequest {
	/** The command that needs approval. */
	command: string;
	/** A shallow copy of the call's arguments; the retry sends the originals, so do not change them. */
	input: Record<string, unknown>;
	/** The text to show the human, from `details.summary` (empty when it is missing). */
	summary: string;
	/** ISO 8601 time the approval token expires, from `details.expiresAt` (empty when it is missing). */
	expiresAt: string;
	/** Who made the call. */
	actor?: Actor;
	/** Why a token the call already carried was not accepted, from `details.reason`. */
	reason?: string;
	/** The call's signal, which aborts when the caller cancels the call. */
	signal?: AbortSignal;
}

/** Decides whether a held call may run: resolve `true` to approve. */
export type DirectApprovalHook = (request: DirectApprovalRequest) => boolean | Promise<boolean>;

/**
 * Context options for individual command calls.
 */
export interface DirectCallContext {
	/**
	 * Trace ID for this command invocation.
	 * If not provided, one will be auto-generated.
	 */
	traceId?: string;

	/**
	 * Timeout in milliseconds for this call (per step for `pipe()`).
	 *
	 * When it passes, the signal given to the command aborts and the call
	 * resolves to a `TIMEOUT` failure, even if the command ignores the signal.
	 * Values that are not positive finite numbers are ignored.
	 */
	timeout?: number;

	/**
	 * Signal for cancellation.
	 */
	signal?: AbortSignal;

	/** Who makes this call; overrides the client's `actor`. */
	actor?: Actor;

	/** Clock for this call; overrides the client's `clock`. */
	clock?: Clock;

	/** Random source for this call; overrides the client's `random`. */
	random?: RandomSource;

	/**
	 * Additional custom context values.
	 */
	[key: string]: unknown;
}

/**
 * Interface for command registries that support direct execution.
 *
 * Prefer `createDirectRegistry(commands)` from `@lushly-dev/afd-server`: it
 * validates input with each command's Zod schema, runs middleware and only
 * offers commands exposed to agents. A hand-written registry that calls
 * `command.handler(input)` skips all of that.
 */
export interface DirectRegistry {
	/**
	 * Execute a command directly.
	 * @param name - Command name
	 * @param input - Command input
	 * @param context - Optional command context for tracing/cancellation
	 * @returns Command result
	 */
	execute<T>(name: string, input?: unknown, context?: CommandContext): Promise<CommandResult<T>>;

	/**
	 * List available command names.
	 */
	listCommandNames(): string[];

	/**
	 * List commands with metadata.
	 */
	listCommands(): Array<
		NonNullable<McpTool['_meta']> & {
			name: string;
			description: string;
			/** JSON Schema advertised by validating registries; optional for legacy registries. */
			inputSchema?: JsonSchema;
		}
	>;

	/**
	 * Check if a command exists.
	 */
	hasCommand(name: string): boolean;

	/**
	 * Get command definition for validation (optional).
	 * If provided, enables input validation.
	 */
	getCommand?(name: string): CommandDefinition | undefined;
}
