/**
 * @fileoverview Public option, context and registry types for DirectClient and DirectTransport.
 */

import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
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
}

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
	listCommands(): Array<{ name: string; description: string }>;

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
