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
	 *
	 * The client also passes it to the registry as the `allow` call option, on every attempt and
	 * every `pipe()` step. With a registry tool surface, `allow` checks tool names, and
	 * `createDirectRegistry()` checks it again on every command a tool runs: the `afd-call` target,
	 * each `afd-batch` item, each `afd-pipe` step and a grouped tool's action. A refused command
	 * fails with `COMMAND_NOT_ALLOWED`, and `afd-discover`, `afd-detail` and `listTools()` leave
	 * it out. A hand-written registry whose `execute` ignores call options checks names only.
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
	 * Ask a human whether a call held by `createApprovalMiddleware` may run. On explicit
	 * `true`, retry once with the same input and actor using a private credential exchange.
	 * Approval credentials never appear in public results or `context.approval`. Public
	 * `call`/`pipe` contexts cannot supply approval evidence. Custom registries must support
	 * the exchange; a legacy token-in-result registry is held without prompting.
	 *
	 * The hook is trusted application code and never sees the credential. On denial, a hook
	 * error or no hook, return a token-free `APPROVAL_REQUIRED` result. `context.timeout`
	 * bounds each attempt, not the wait: close the prompt when `request.signal` aborts.
	 * Cancellation during the wait denies the call. An expired retry is held again with
	 * `details.reason: 'expired'`; the client never retries more than once.
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
	 * The AFD context this call runs in, one of the registry's `contexts`. It is passed to the
	 * registry as the `activeContext` call option, beside the command context, so handlers never
	 * see it; `pipe()` passes it with every step, and an approval retry runs in it too. A
	 * `createDirectRegistry()` registry refuses an unknown name with `CONTEXT_NOT_FOUND` and a
	 * command outside the context with `COMMAND_NOT_IN_CONTEXT`. A registry whose `execute` takes
	 * no call options ignores it: contexts scope what an agent sees, they are not a security
	 * boundary.
	 */
	activeContext?: string;

	/**
	 * Additional custom context values. `approval` is reserved and stripped at runtime.
	 */
	[key: string]: unknown;
}

/** Options of one registry call, passed beside the command context (`DirectRegistry.execute`). */
export interface DirectExecuteOptions {
	/** The AFD context the call runs in; see {@link DirectCallContext.activeContext}. */
	activeContext?: string;

	/**
	 * The client's `allow` check, as a trusted in-process predicate (a throw denies), set only
	 * when the client has `allow`. A registry applies it to every command the call runs, including
	 * those a meta-tool or grouped tool reaches, and refuses the rest with `COMMAND_NOT_ALLOWED`.
	 */
	allow?: (command: string) => boolean;
}

/** Options of `DirectRegistry.listTools` and `DirectClient.listTools`. */
export interface DirectListToolsOptions {
	/** The MCP tool strategy to list by. Default: the registry's tool surface's. */
	strategy?: 'individual' | 'grouped' | 'lazy' | 'hybrid';
	/** The AFD context to list in. Default: none. */
	activeContext?: string;
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
	 * @param options - Call options passed beside the context: the active AFD context and the
	 *   client's `allow` check. A registry that does not scope by context or route tools may
	 *   ignore them
	 * @returns Command result
	 */
	execute<T>(
		name: string,
		input?: unknown,
		context?: CommandContext,
		options?: DirectExecuteOptions
	): Promise<CommandResult<T>>;

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
			/** Display label, when the command sets one. */
			title?: string;
			description: string;
			/** JSON Schema advertised by validating registries; optional for legacy registries. */
			inputSchema?: JsonSchema;
		}
	>;

	/**
	 * Check if a command exists. A registry with a tool surface also answers `true` for the tool
	 * names it routes (the meta-tools, and grouped tools under the grouped strategy).
	 */
	hasCommand(name: string): boolean;

	/**
	 * The MCP tools an AFD server with the same commands would list (optional).
	 * `createDirectRegistry(commands, { tools: createDirectToolSurface() })` provides it. With
	 * `allow`, it leaves out the commands and tool names the predicate rejects.
	 */
	listTools?(options?: DirectListToolsOptions & Pick<DirectExecuteOptions, 'allow'>): McpTool[];

	/**
	 * Get command definition for validation (optional).
	 * If provided, enables input validation.
	 */
	getCommand?(name: string): CommandDefinition | undefined;
}
