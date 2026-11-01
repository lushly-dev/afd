/**
 * @fileoverview Direct Transport for zero-overhead in-process command execution
 *
 * This transport enables co-located agents to execute commands directly
 * without any transport overhead (no JSON-RPC, no IPC, no network).
 *
 * @example
 * ```typescript
 * import { createDirectClient } from '@lushly-dev/afd-client';
 * import { createDirectRegistry } from '@lushly-dev/afd-server';
 * import { commands } from '@my-app/commands';
 *
 * // Zod validation, middleware and expose.agent checks, in process
 * const client = createDirectClient(createDirectRegistry(commands));
 * const result = await client.call('todo-create', { title: 'Fast!' }, { timeout: 5000 });
 * ```
 */

import type {
	CommandContext,
	CommandMiddleware,
	CommandResult,
	HandoffResult,
	McpTool,
	PipelineRequest,
	PipelineResult,
	PipelineStep,
} from '@lushly-dev/afd-core';
import {
	executePipeline,
	executionFailure,
	failure,
	truncateName,
	validationError,
} from '@lushly-dev/afd-core';
import { commandNotAllowed, directAllows } from '@lushly-dev/afd-core/internal/direct-allow';
import {
	createDirectApprovalExchange,
	publicDirectContext,
} from '@lushly-dev/afd-core/internal/direct-approval';
import { askForApproval, publicApprovalResult } from './direct-approval.js';
import { runWithTimeout } from './direct-timeout.js';
import { validateInput } from './direct-validation.js';
import type {
	HandoffConnection,
	HandoffConnectionOptions,
	ReconnectingHandoffConnection,
	ReconnectionOptions,
} from './handoff.js';
import { connectHandoff, createReconnectingHandoff } from './handoff.js';
import type { UnknownToolError } from './unknown-tool.js';
import { unknownToolFailure } from './unknown-tool.js';

// Re-export extracted modules for backward compatibility
export { DirectTransport } from './direct-transport.js';
export type { CommandDefinition, CommandParameter } from './direct-validation.js';
export { isUnknownToolError, type UnknownToolError } from './unknown-tool.js';

// Option, context and registry types live in direct-types.ts
import type {
	DirectCallContext,
	DirectClientOptions,
	DirectExecuteOptions,
	DirectListToolsOptions,
	DirectRegistry,
} from './direct-types.js';

export type {
	DirectApprovalHook,
	DirectApprovalRequest,
	DirectCallContext,
	DirectClientOptions,
	DirectExecuteOptions,
	DirectListToolsOptions,
	DirectRegistry,
} from './direct-types.js';

/**
 * Generate a unique trace ID.
 */
function generateTraceId(): string {
	return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * DirectClient for zero-overhead in-process command execution.
 *
 * Use this when you don't need the full McpClient features like
 * reconnection, events, etc. This provides the minimal API for
 * command execution with optional validation and context propagation.
 *
 * @example
 * ```typescript
 * import { isSuccess } from '@lushly-dev/afd-core';
 * import { createDirectClient, isUnknownToolError } from '@lushly-dev/afd-client';
 * import { createDirectRegistry } from '@lushly-dev/afd-server';
 * import { commands } from '@my-app/commands';
 *
 * const client = createDirectClient(createDirectRegistry(commands));
 *
 * // Type-safe command execution
 * const result = await client.call<Todo>('todo-create', { title: 'Test' });
 *
 * if (isUnknownToolError(result)) {
 *   console.log(result.data?.hint); // e.g. "Did you mean 'todo-create'?"
 * } else if (isSuccess(result)) {
 *   console.log(result.data.id); // result is CommandResult<Todo>
 * }
 * ```
 *
 * @example With context propagation
 * ```typescript
 * const client = createDirectClient(registry, {
 *   source: 'my-agent',
 *   debug: true,
 * });
 *
 * // Context is propagated to command handlers
 * const result = await client.call('command', args, { traceId: 'custom-trace' });
 * ```
 */
export class DirectClient {
	private readonly options: Required<
		Omit<
			DirectClientOptions,
			'source' | 'middleware' | 'allow' | 'clock' | 'random' | 'onApprovalNeeded'
		>
	> &
		Pick<DirectClientOptions, 'source' | 'allow' | 'clock' | 'random' | 'onApprovalNeeded'> & {
			middleware: CommandMiddleware[];
		};

	/** The `allow` call option the registry gets: the client's own check, or none without `allow`. */
	private readonly registryAllow: ((command: string) => boolean) | undefined;

	constructor(
		private readonly registry: DirectRegistry,
		options: DirectClientOptions = {}
	) {
		this.options = {
			source: options.source,
			debug: options.debug ?? false,
			validateInputs: options.validateInputs ?? true,
			middleware: options.middleware ?? [],
			allow: options.allow,
			actor: options.actor ?? { kind: 'human' },
			clock: options.clock,
			random: options.random,
			onApprovalNeeded: options.onApprovalNeeded,
		};
		this.registryAllow = options.allow ? (command) => this.isAllowed(command) : undefined;
	}

	/** Whether the `allow` option lets this client call a command. A throwing predicate denies. */
	private isAllowed(name: string): boolean {
		return !this.options.allow || directAllows(this.options.allow, name);
	}

	/**
	 * Call a command and return a CommandResult.
	 *
	 * This is the most efficient path - direct registry access
	 * with zero transport overhead.
	 *
	 * @param name - Command name
	 * @param args - Command arguments
	 * @param context - Optional context for tracing/cancellation
	 * @returns Command result
	 */
	async call<T = unknown>(
		name: string,
		args?: Record<string, unknown>,
		context?: DirectCallContext
	): Promise<CommandResult<T> | CommandResult<UnknownToolError>> {
		const startTime = this.options.debug ? performance.now() : 0;
		const traceId = context?.traceId ?? generateTraceId();

		this.debug(`[${traceId}] Calling ${name}`, args);

		if (!this.isAllowed(name)) {
			this.debug(`[${traceId}] Not allowed: ${name}`);
			return failure<T>(commandNotAllowed(name));
		}

		// Check if the command exists - return structured error if not
		if (!this.registry.hasCommand(name)) {
			this.debug(`[${traceId}] Unknown command: ${name}`);
			// The UnknownToolError is the data, so agents get structured recovery information.
			return unknownToolFailure(name, this.listCommandNames());
		}

		// Input validation (if registry supports getCommand)
		if (this.options.validateInputs && this.registry.getCommand) {
			const command = this.registry.getCommand(name);
			if (command) {
				const issues = validateInput(args, command.parameters);
				if (issues) {
					this.debug(`[${traceId}] Validation failed:`, issues);

					return failure(
						validationError(
							`Invalid input for '${name}': ${issues.map((i) => i.message).join('; ')}`,
							{ issues }
						)
					) as CommandResult<T>;
				}
			}
		}

		// The active context and the allow check are registry call options, never command-context
		// values, so a handler cannot read or set them. Every attempt (the approval retry too)
		// passes them; the registry applies allow to each command a meta-tool or grouped tool runs.
		// Without either, the registry is called exactly as before, with no options.
		const { activeContext, ...callContext } = context ?? {};
		const allow = this.registryAllow;
		const executeOptions: DirectExecuteOptions | undefined =
			activeContext === undefined && !allow
				? undefined
				: { ...(activeContext !== undefined && { activeContext }), ...(allow && { allow }) };

		// Build command context. The call's actor, clock and random win over the client's.
		// Clock and random are only set when configured, so a registry's own defaults
		// (createDirectRegistry) still apply.
		const actor = context?.actor ?? this.options.actor;
		const commandContext: CommandContext = {
			traceId,
			...publicDirectContext(callContext),
			actor,
		};
		const clock = context?.clock ?? this.options.clock;
		if (clock) commandContext.clock = clock;
		const random = context?.random ?? this.options.random;
		if (random) commandContext.random = random;

		// Add source if configured
		if (this.options.source) {
			commandContext.source = this.options.source;
		}

		// Execute the command (with middleware if configured), enforcing context.timeout per
		// attempt. Each attempt gets its own copy of the context, so middleware that changes it
		// (such as auth refining the actor) starts from the same state on the approval retry.
		const exchange = createDirectApprovalExchange();
		const attempt = () => {
			const attemptContext = exchange.bind({
				...commandContext,
				actor: { ...actor },
			});
			return runWithTimeout<T>(name, context?.timeout, context?.signal, (signal) => {
				if (signal) attemptContext.signal = signal;
				return this.execute<T>(name, args, attemptContext, executeOptions);
			});
		};
		try {
			let result = await attempt();

			// A call held for approval: ask the hook, and on a yes retry once with the token.
			const hook = this.options.onApprovalNeeded;
			const held =
				!result.success && result.error?.code === 'APPROVAL_REQUIRED'
					? exchange.pending()
					: undefined;
			if (hook && held) {
				this.debug(`[${traceId}] Approval needed for ${name}`);
				const approved = await askForApproval(hook, {
					command: name,
					input: { ...args },
					summary: held.summary,
					expiresAt: held.expiresAt,
					actor: { ...actor },
					...(held.reason && { reason: held.reason }),
					...(context?.signal && { signal: context.signal }),
				});
				// A call cancelled as the hook answered is not retried.
				if (approved && !context?.signal?.aborted) {
					this.debug(`[${traceId}] Approved; retrying ${name}`);
					exchange.approve();
					result = await attempt();
				}
			}

			if (this.options.debug) {
				const duration = performance.now() - startTime;
				this.debug(`[${traceId}] Completed in ${duration.toFixed(3)}ms`, {
					success: result.success,
				});
			}

			return publicApprovalResult(result);
		} finally {
			exchange.dispose();
		}
	}

	/**
	 * Run the registry through the client middleware (none: the zero-overhead path). A registry,
	 * handler or middleware that throws gives a `COMMAND_EXECUTION_ERROR` failure (without the
	 * exception text), as `createDirectRegistry()` and the MCP server do, instead of a rejection.
	 */
	private async execute<T>(
		name: string,
		args: Record<string, unknown> | undefined,
		commandContext: CommandContext,
		executeOptions?: DirectExecuteOptions
	): Promise<CommandResult<T>> {
		let next: () => Promise<CommandResult> = () =>
			executeOptions
				? this.registry.execute<T>(name, args, commandContext, executeOptions)
				: this.registry.execute<T>(name, args, commandContext);
		for (let i = this.options.middleware.length - 1; i >= 0; i--) {
			const mw = this.options.middleware[i];
			if (!mw) continue;
			const currentNext = next;
			next = () => mw(name, args ?? {}, commandContext, currentNext);
		}
		try {
			return (await next()) as CommandResult<T>;
		} catch (error) {
			this.debug(`Command '${truncateName(name)}' threw:`, error);
			return executionFailure(error);
		}
	}

	/**
	 * List available commands (those the `allow` option permits).
	 */
	listCommands(): Array<{ name: string; description: string }> {
		return this.registry.listCommands().filter((command) => this.isAllowed(command.name));
	}

	/**
	 * List the MCP tools the registry offers (those the `allow` option permits), as an AFD server
	 * with the same commands, contexts and strategy lists them: forwarded to `registry.listTools`,
	 * which `createDirectRegistry(commands, { tools: createDirectToolSurface() })` provides.
	 *
	 * With `allow`, the client passes its check to the registry, so a grouped tool lists only the
	 * actions it permits, and filters the tool names, as `call()` checks them, so the client never
	 * lists a tool it would refuse to call. Through an allowed meta-tool (`afd-call`, `afd-batch`,
	 * `afd-pipe`) or grouped tool, a `createDirectRegistry()` registry runs only the commands
	 * `allow` permits.
	 *
	 * @param options - The strategy (default: the surface's) and the AFD context to list in
	 * @throws TypeError when the registry cannot list tools; RangeError (from the registry) for
	 *   an unknown context
	 */
	listTools(options?: DirectListToolsOptions): McpTool[] {
		if (!this.registry.listTools) {
			throw new TypeError(
				"This client's registry cannot list tools: create it with createDirectRegistry(commands, { tools: createDirectToolSurface() }) from @lushly-dev/afd-server"
			);
		}
		const allow = this.registryAllow;
		const tools = allow
			? this.registry.listTools({ ...options, allow })
			: this.registry.listTools(options);
		return tools.filter((tool) => this.isAllowed(tool.name));
	}

	/**
	 * List command names (those the `allow` option permits).
	 */
	listCommandNames(): string[] {
		return this.registry.listCommandNames().filter((name) => this.isAllowed(name));
	}

	/**
	 * Check if a command exists and the `allow` option permits it.
	 */
	hasCommand(name: string): boolean {
		return this.isAllowed(name) && this.registry.hasCommand(name);
	}

	/**
	 * Get the source identifier for this client.
	 */
	getSource(): string | undefined {
		return this.options.source;
	}

	/**
	 * Connect to a handoff endpoint using the appropriate protocol handler.
	 *
	 * @param handoff - The handoff result from a command
	 * @param options - Connection options and callbacks
	 * @returns A promise that resolves to a HandoffConnection
	 * @throws Error if no handler is registered for the protocol
	 */
	async connectHandoff(
		handoff: HandoffResult,
		options: HandoffConnectionOptions = {}
	): Promise<HandoffConnection> {
		return connectHandoff(handoff, options);
	}

	/**
	 * Create a reconnecting handoff connection with automatic retry logic.
	 *
	 * @param handoff - The initial handoff result
	 * @param options - Reconnection options and callbacks
	 * @returns A promise that resolves to a ReconnectingHandoffConnection
	 */
	async createReconnectingHandoff(
		handoff: HandoffResult,
		options: ReconnectionOptions = {}
	): Promise<ReconnectingHandoffConnection> {
		return createReconnectingHandoff(this, handoff, options);
	}

	/**
	 * Execute a pipeline of commands, chaining outputs to inputs.
	 *
	 * Pipelines allow declarative composition of commands where the output
	 * of one step flows into the next. Supports variable resolution
	 * ($prev, $first, $steps[n], $steps.alias, $input), conditional execution,
	 * and aggregated metadata (confidence, reasoning, warnings). Resolution follows
	 * `spec/pipeline-variables.md`: other `$` strings are literals, `$$` escapes a
	 * literal `$`, and unresolved references are omitted (or `null` in arrays).
	 *
	 * **Behavior change:** `$input` resolves to the request's own `input` field.
	 * It used to resolve to `context`, so a step could copy trace IDs, auth or any
	 * custom call-context value into a command input. `context` still reaches every
	 * command's context, but no reference can read it. Pass pipeline data as
	 * `pipe({ input, steps })` instead.
	 *
	 * Each step's data is copied as it is recorded and as it is resolved, so a
	 * handler that mutates its input cannot change another step's data.
	 *
	 * @param request - Pipeline request (with optional `input`) or array of steps
	 * @param context - Optional call context passed to each command; not visible to `$input`
	 * @returns Pipeline result with final data and aggregated metadata
	 *
	 * @example Basic pipeline
	 * ```typescript
	 * const result = await client.pipe([
	 *   { command: 'user-get', input: { id: 123 }, as: 'user' },
	 *   { command: 'order-list', input: { userId: '$prev.id' } },
	 *   { command: 'order-total', input: { orders: '$prev' } }
	 * ]);
	 *
	 * console.log(result.data); // Total from last step
	 * console.log(result.metadata.confidence); // Minimum confidence across steps
	 * ```
	 *
	 * @example Conditional execution
	 * ```typescript
	 * const result = await client.pipe([
	 *   { command: 'user-get', input: { id: 123 }, as: 'user' },
	 *   {
	 *     command: 'premium-features',
	 *     input: { userId: '$steps.user.id' },
	 *     when: { $eq: ['$steps.user.tier', 'premium'] }
	 *   }
	 * ]);
	 * ```
	 *
	 * @example Pipeline input
	 * ```typescript
	 * const result = await client.pipe({
	 *   input: { userId: 123 },
	 *   steps: [{ command: 'order-list', input: { userId: '$input.userId' } }],
	 * });
	 * ```
	 */
	async pipe<T = unknown>(
		request: PipelineRequest | PipelineStep[],
		context?: DirectCallContext
	): Promise<PipelineResult<T>> {
		const traceId = context?.traceId ?? generateTraceId();
		const pipelineRequest: PipelineRequest = Array.isArray(request) ? { steps: request } : request;
		this.debug(`[${traceId}] Starting pipeline`);
		let stepIndex = 0;
		return executePipeline(
			pipelineRequest,
			(command, input, commandContext) =>
				this.call(command, input as Record<string, unknown>, {
					...context,
					...commandContext,
					traceId: `${traceId}-step-${stepIndex++}`,
				}) as Promise<CommandResult>,
			{ ...context, traceId }
		) as Promise<PipelineResult<T>>;
	}

	/**
	 * Debug logging helper.
	 */
	private debug(message: string, data?: unknown): void {
		if (this.options.debug) {
			console.log(`[DirectClient] ${message}`, data ?? '');
		}
	}
}

/**
 * Create a new DirectClient for zero-overhead command execution.
 *
 * This is the recommended way to create a DirectClient. It provides
 * the same API as McpClient.call() but with ~100x faster execution
 * for co-located modules.
 *
 * @param registry - The command registry to execute against
 * @param options - Optional configuration for validation, context, and debugging
 * @returns A new DirectClient instance
 *
 * @example
 * ```typescript
 * import { createDirectClient } from '@lushly-dev/afd-client';
 * import { createDirectRegistry } from '@lushly-dev/afd-server';
 * import { commands } from './commands';
 *
 * const client = createDirectClient(createDirectRegistry(commands), {
 *   source: 'garden-api',
 *   allow: (name) => name.startsWith('plant-'),
 * });
 * const result = await client.call('plant-get', { id: 'tomato-123' });
 * // ~0.03-0.1ms latency vs ~2-10ms for MCP
 * ```
 */
export function createDirectClient(
	registry: DirectRegistry,
	options?: DirectClientOptions
): DirectClient {
	return new DirectClient(registry, options);
}
