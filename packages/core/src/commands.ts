/**
 * @fileoverview Command definition and registry types
 *
 * Commands are the core abstraction in AFD. Every application action
 * is defined as a command with a clear schema.
 */

import { type Actor, withContextDefaults } from './actor.js';
import type { ApprovalPolicy } from './approval.js';
import type { BatchRequest, BatchResult } from './batch.js';
import type { Clock, RandomSource } from './clock.js';
import { type CommandToolMeta, commandToolMeta } from './command-metadata.js';
import {
	AFD_OUTPUT_BUDGET_META_KEY,
	MAX_OUTPUT_BUDGET_BYTES,
	type OutputBudget,
	type OutputBudgetAsk,
	type OutputBudgetReport,
	validateOutputBudget,
} from './output-budget.js';

export {
	AFD_OUTPUT_BUDGET_META_KEY,
	MAX_OUTPUT_BUDGET_BYTES,
	type OutputBudget,
	type OutputBudgetAsk,
	type OutputBudgetReport,
	validateOutputBudget,
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND NAME VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Regex for valid command names: `domain-action` format.
 * At least two segments, all lowercase, separated by hyphens.
 *
 * Valid: `todo-create`, `user-get`, `todo-create-batch`
 * Invalid: `todoCreate`, `TODO-CREATE`, `create`, `todo_create`
 */
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$/;

/**
 * Validate that a command name follows the `domain-action` kebab-case convention.
 *
 * @param name - The command name to validate
 * @returns An object with `valid` and optional `reason` if invalid
 */
export function validateCommandName(name: string): { valid: boolean; reason?: string } {
	if (!name) {
		return { valid: false, reason: 'Command name must not be empty' };
	}
	if (!COMMAND_NAME_PATTERN.test(name)) {
		return {
			valid: false,
			reason: `Command name '${name}' must use kebab-case with at least two segments (e.g., 'domain-action'). Got '${name}'.`,
		};
	}
	return { valid: true };
}

import { appCallGranted, type CallGrant, callNotGranted } from './app-calls.js';
import {
	executeBatch as executeCoreBatch,
	executeStream as executeCoreStream,
	executionFailure,
} from './command-execution.js';
import type { CommandResult } from './result.js';
import { truncateName } from './similarity.js';
import type { StreamChunk, StreamOptions } from './streaming.js';

/**
 * Controls which interfaces a command is exposed to.
 */
export interface ExposeOptions {
	/** Command palette (default: true) */
	palette?: boolean;
	/** External MCP agents (default: false — opt-in for security) */
	mcp?: boolean;
	/** In-app AI assistant (default: true) */
	agent?: boolean;
	/** Terminal/CLI (default: false) */
	cli?: boolean;
	/**
	 * Other apps, each under a host's grant (default: false). The callee's declaration that another
	 * app may call the command; a call with the `apps` interface also needs the registry's
	 * `callGrant` to grant it (`spec/command-metadata.md`, "App-to-app calls").
	 */
	apps?: boolean;
}

/**
 * Frozen to prevent accidental mutation. `apps` is left out: a flag with no value is off, so other
 * apps are opt-in like MCP and the CLI, and a report that spreads these defaults is unchanged.
 */
export const defaultExpose: Readonly<ExposeOptions> = Object.freeze({
	palette: true, // User-facing: on by default
	agent: true, // In-app AI: on by default
	mcp: false, // External agents: opt-in (security)
	cli: false, // Automation: opt-in
});

/**
 * Whether a command is exposed to an interface.
 *
 * Each flag a command's `expose` leaves out falls back to {@link defaultExpose}, so
 * `expose: { mcp: true }` keeps the default agent and palette exposure.
 */
export function isExposedTo(
	command: { expose?: ExposeOptions },
	interfaceType: keyof ExposeOptions
): boolean {
	return (command.expose?.[interfaceType] ?? defaultExpose[interfaceType]) === true;
}

/**
 * JSON Schema 7 subset for command parameter validation.
 *
 * Includes composition keywords (`oneOf`, `anyOf`, `allOf`) needed for
 * discriminated unions, non-discriminated unions, and intersections.
 * These are produced by Zod's `z.toJSONSchema()` with `target: 'draft-7'`,
 * which emits `'integer'` for `z.number().int()`.
 */
export interface JsonSchema {
	type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
	description?: string;
	/** For object schemas, array of required property names */
	required?: string[] | boolean;
	default?: unknown;
	enum?: unknown[];
	items?: JsonSchema;
	properties?: Record<string, JsonSchema>;
	additionalProperties?: boolean | JsonSchema;
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	exclusiveMaximum?: number;
	minLength?: number;
	maxLength?: number;
	minItems?: number;
	maxItems?: number;
	pattern?: string;
	format?: string;
	/** Exactly one schema must match — used for discriminated unions (`z.discriminatedUnion()`) */
	oneOf?: JsonSchema[];
	/** At least one schema must match — used for unions (`z.union()`) and nullable types */
	anyOf?: JsonSchema[];
	/** All schemas must match — used for intersections (`z.intersection()`) */
	allOf?: JsonSchema[];
	/** Schema must not match */
	not?: JsonSchema;
	/** Exact value match — used for discriminator literals (`z.literal()`) */
	const?: unknown;
}

/**
 * Definition for a single command parameter.
 */
export interface CommandParameter {
	/** Parameter name */
	name: string;

	/** JSON Schema type */
	type: JsonSchema['type'];

	/** Human-readable description */
	description: string;

	/** Whether this parameter is required */
	required?: boolean;

	/** Default value if not provided */
	default?: unknown;

	/** For enum types, the allowed values */
	enum?: unknown[];

	/** Full JSON Schema for complex validation */
	schema?: JsonSchema;
}

/**
 * A concrete input example for a command.
 * Used to help agents understand valid input shapes without reverse-engineering JSON Schema.
 */
export interface CommandExample<TInput = unknown> {
	/** Short description of what this example demonstrates */
	title: string;

	/** A valid input payload */
	input: TInput;
}

/**
 * Confirmation mode for a command (`spec/command-metadata.md`, "Host-verified confirmation").
 *
 * - `'host-verified'`: only the host's `HumanRelay` may confirm the command over MCP, regardless
 *   of the server's `confirmations` option (`'off'` included). Form elicitation and
 *   acknowledgements are never advertised or accepted.
 */
export type CommandConfirmationMode = 'host-verified';

/**
 * Whether an MCP `tools/call` to a command may run as a task under the Tasks extension
 * (`io.modelcontextprotocol/tasks`, SEP-2663; `spec/command-metadata.md`, "Tasks").
 *
 * - `'never'` (default): always runs inline.
 * - `'optional'`: runs as a task when a 2026-07-28 request declares the extension, inline otherwise.
 * - `'required'`: runs only as a task; a request without the extension gets JSON-RPC `-32021`.
 */
export type TaskSupport = 'never' | 'optional' | 'required';

/**
 * Full command definition with schema, handler, and metadata.
 *
 * @template TInput - Type of the input parameters
 * @template TOutput - Type of the result data
 *
 * @example
 * ```typescript
 * const createDocument: CommandDefinition<CreateDocInput, Document> = {
 *   name: 'document-create',
 *   description: 'Creates a new document',
 *   category: 'documents',
 *   parameters: [
 *     { name: 'title', type: 'string', description: 'Document title', required: true },
 *     { name: 'content', type: 'string', description: 'Document content' }
 *   ],
 *   returns: {
 *     type: 'object',
 *     description: 'The created document'
 *   },
 *   handler: async (input) => {
 *     // Implementation
 *     return success({ id: '123', title: input.title });
 *   }
 * };
 * ```
 */
export interface CommandDefinition<TInput = unknown, TOutput = unknown> {
	/**
	 * Unique command name using kebab-case.
	 *
	 * Convention: `domain-action` (e.g., 'todo-create', 'user-get', 'todo-create-batch')
	 */
	name: string;

	/**
	 * Human-readable description of what the command does.
	 * This is shown in tool listings and documentation.
	 */
	description: string;

	/**
	 * A short human-readable label, such as "Create a todo". Reported as the MCP tool `title` and
	 * by afd-detail; nothing is derived from the name when it is unset.
	 */
	title?: string;

	/**
	 * Category for grouping related commands.
	 * Used for filtering in `afd tools --category <name>`
	 */
	category?: string;

	/**
	 * Command parameters with types and descriptions.
	 */
	parameters: CommandParameter[];

	/**
	 * Schema describing the return type.
	 */
	returns?: JsonSchema;

	/**
	 * Error codes this command may return.
	 */
	errors?: string[];

	/**
	 * The command implementation.
	 * Returns a CommandResult with data or error.
	 */
	handler: CommandHandler<TInput, TOutput>;

	/**
	 * Command version for tracking changes.
	 */
	version?: string;

	/**
	 * Tags for additional categorization.
	 */
	tags?: string[];

	/** Commands that should be called before this one. Metadata only — not enforced at runtime. */
	requires?: string[];

	/**
	 * Whether this command performs side effects.
	 */
	mutation?: boolean;

	/**
	 * Estimated execution time category.
	 */
	executionTime?: 'instant' | 'fast' | 'slow' | 'long-running';

	/**
	 * Whether this command returns a HandoffResult for protocol handoffs.
	 * When true, the command's data payload will be a HandoffResult
	 * that the client should use to connect to the specified protocol.
	 */
	handoff?: boolean;

	/**
	 * The specific handoff protocol this command uses (if handoff is true).
	 * Used for agent filtering (e.g., find all WebSocket commands).
	 */
	handoffProtocol?: 'websocket' | 'webrtc' | 'sse' | 'http-stream' | string;

	/**
	 * Whether the command takes or returns a secret (a password argument, an issued token). A
	 * journal never records a call to it unless the host also gives the recorder `redact`, which
	 * removes the secret; a `filter` alone does not admit it (`spec/journal.md`).
	 */
	secret?: boolean;

	/**
	 * Whether this command performs destructive or irreversible actions.
	 * When true, frontends SHOULD prompt for user confirmation before
	 * applying the result locally.
	 */
	destructive?: boolean;

	/**
	 * Custom confirmation prompt message for destructive commands.
	 * If not provided, frontends MAY use a generic confirmation message.
	 * @example "Delete 'Buy groceries' permanently?"
	 */
	confirmPrompt?: string;

	/**
	 * Host-verified confirmation mode (`spec/command-metadata.md`, "Host-verified confirmation").
	 * When `'host-verified'`, only the host's `HumanRelay` may confirm the command over MCP,
	 * regardless of the server's `confirmations` option (`'off'` included). Reported in
	 * `_meta.confirmationMode` and `afd-detail`. Refused at registration beside `task: 'optional' | 'required'`.
	 */
	confirmationMode?: CommandConfirmationMode;

	/**
	 * Whether this command can be undone.
	 * Implementation is consumer-specific (e.g., FAST-AF uses `${methodName}Undo()` convention).
	 */
	undoable?: boolean;

	/**
	 * Whether a call needs a human's approval before the handler runs: `'required'`,
	 * `'not-required'` (the default), or a function of the validated input and context.
	 * Enforced by `createApprovalMiddleware`; without it, the server's engines refuse a policy
	 * other than `'not-required'` (`APPROVAL_UNAVAILABLE`). Reported as `_meta.approval`.
	 */
	approval?: ApprovalPolicy<TInput>;

	/**
	 * Which interfaces this command is exposed to.
	 * Defaults to `defaultExpose` if not specified.
	 */
	expose?: ExposeOptions;

	/**
	 * Concrete input examples to help agents construct valid payloads.
	 * Each example is validated against the input schema at define-time.
	 */
	examples?: CommandExample<TInput>[];

	/**
	 * Contexts this command belongs to. When context-based tool scoping is enabled,
	 * only commands matching the active context (or commands without contexts) are visible.
	 */
	contexts?: string[];

	/**
	 * OAuth scopes a caller's token needs to run this command over HTTP on a server configured
	 * with MCP authorization (`spec/authorization.md`, M6), after the server's `requiredScopes`,
	 * compared exactly. A host `ScopeResolver` may decide each call instead. stdio, the CLI,
	 * `DirectClient` and in-process registries ignore it. Reported as `_meta.scopes`.
	 */
	scopes?: string[];

	/**
	 * Extra `_meta` entries emitted on this command's tool, its grouped action entry and
	 * afd-detail (`spec/mcp-resources.md`, T1): reverse-DNS prefixed keys with two or more labels,
	 * outside `dev.afd/`, or the MCP Apps key `ui` (`{ resourceUri: 'ui://...' }`). A server refuses
	 * any other key when it registers the command, so an entry never replaces one the server sets.
	 */
	toolMeta?: Record<string, unknown>;

	/**
	 * Whether an MCP `tools/call` may run as a task (`spec/command-metadata.md`, "Tasks").
	 * Default `'never'`. Refused at registration beside `confirmPrompt`, an `approval` other than
	 * `'not-required'`, or `confirmationMode`. Reported in `_meta.task` and `afd-detail`.
	 */
	task?: TaskSupport;

	/**
	 * Declared output budget in UTF-8 bytes of canonical JSON without `metadata`
	 * (`spec/output-budgets.md`, B1). Validated at definition/registration; reported as
	 * `_meta["dev.afd/outputBudget"]` on command tools and grouped action entries, and as
	 * `outputBudget` in `afd-detail` and `afd-help` (`full`).
	 */
	outputBudget?: OutputBudget;
}

/**
 * Command handler function type.
 */
export type CommandHandler<TInput = unknown, TOutput = unknown> = (
	input: TInput,
	context?: CommandContext
) => Promise<CommandResult<TOutput>>;

/**
 * Context provided to command handlers.
 */
export interface CommandContext {
	/** Unique ID for this command invocation */
	traceId?: string;

	/** Timeout in milliseconds */
	timeout?: number;

	/** Signal for cancellation */
	signal?: AbortSignal;

	/**
	 * The interface invoking this command (for exposure checks). `apps` is an app's call, which only
	 * a host's trusted code names, and which runs only when the registry's `callGrant` grants it.
	 */
	interface?: keyof ExposeOptions;

	/**
	 * Who is calling: a human, an agent, a service, a script or a test.
	 * Filled in by the surface (`DirectClient`: `human`; MCP server: `agent`; testing
	 * package: `test`) unless the caller sets it.
	 */
	actor?: Actor;

	/**
	 * Approval evidence for a command whose approval policy requires it: the
	 * `approvalToken` from an `APPROVAL_REQUIRED` result, set by the surface once a human
	 * approved. Only trusted surface code sets it, never tool arguments.
	 */
	approval?: string;

	/**
	 * Source of the current time. Read time from here instead of `Date.now()` so tests and
	 * replays can control it. The MCP server, `createDirectRegistry()` and the core registry
	 * always set it (to `systemClock` unless overridden); `DirectClient` passes its
	 * configured clock on to the registry.
	 */
	clock?: Clock;

	/**
	 * Source of randomness. Read random numbers from here instead of `Math.random()` so
	 * tests and replays can seed them. Set by the same surfaces as `clock` (to
	 * `systemRandom` unless overridden).
	 */
	random?: RandomSource;

	/**
	 * Report progress while running as an MCP task (`spec/command-metadata.md`, "Tasks").
	 * Updates the task's `statusMessage` and `lastUpdatedAt`; undefined outside a task.
	 */
	reportProgress?: (message: string) => void;

	/**
	 * The call's effective output budget in bytes (`spec/output-budgets.md`, B4): set by the
	 * execution engine before middleware and the handler run (`min(ask, maxBytes)` or
	 * `defaultBytes`), or `undefined` when the command declares no output budget.
	 */
	outputBudget?: number;

	/** Custom context values */
	[key: string]: unknown;
}

/**
 * Middleware function type for intercepting command execution.
 *
 * Middleware wraps command execution in an onion pattern — each middleware
 * calls `next()` to invoke the next layer, and can inspect/modify the
 * result on the way back out.
 */
export type CommandMiddleware = (
	commandName: string,
	input: unknown,
	context: CommandContext,
	next: () => Promise<CommandResult>
) => Promise<CommandResult>;

/**
 * Registry for managing command definitions.
 */
export interface CommandRegistry {
	/**
	 * Register a command.
	 * @throws If a command with the same name already exists
	 */
	register<TInput = unknown, TOutput = unknown>(command: CommandDefinition<TInput, TOutput>): void;

	/**
	 * Get a command by name.
	 * @returns The command definition or undefined if not found
	 */
	get(name: string): CommandDefinition | undefined;

	/**
	 * Check if a command exists.
	 */
	has(name: string): boolean;

	/**
	 * Get all registered commands.
	 */
	list(): CommandDefinition[];

	/**
	 * Get commands by category.
	 */
	listByCategory(category: string): CommandDefinition[];

	/**
	 * Get commands by tags.
	 * @param tags - Array of tags to filter by
	 * @param mode - 'all' requires commands to have ALL tags, 'any' requires at least one tag
	 * @returns Commands matching the tag filter
	 */
	listByTags(tags: string[], mode: 'all' | 'any'): CommandDefinition[];

	/**
	 * Get commands exposed to a specific interface.
	 * @param interfaceType - The interface to filter by (mcp, cli, palette, agent, apps). For `apps`,
	 *   the commands exposed to apps, whatever any caller is granted
	 * @returns Commands exposed to the specified interface
	 */
	listByExposure(interfaceType: keyof ExposeOptions): CommandDefinition[];

	/**
	 * Execute a command by name.
	 */
	execute<TOutput = unknown>(
		name: string,
		input: unknown,
		context?: CommandContext
	): Promise<CommandResult<TOutput>>;

	/**
	 * Execute multiple commands in a single batch.
	 *
	 * Uses partial success semantics - returns results for all commands
	 * even if some fail. Confidence is aggregated from success ratio
	 * and individual command confidence scores.
	 *
	 * The envelope is validated before any command runs (a malformed or empty
	 * batch returns `INVALID_BATCH_REQUEST`), `options.timeout` is enforced as a
	 * deadline at any `parallelism`, and every entry runs through `execute()`
	 * with `context`, so exposure checks apply to each entry.
	 *
	 * @param request - Batch request containing commands and options
	 * @param context - Context passed to every command (e.g. `interface`, `signal`, `traceId`)
	 * @returns BatchResult with all command results and aggregated metrics
	 */
	executeBatch<TOutput = unknown>(
		request: BatchRequest,
		context?: CommandContext
	): Promise<BatchResult<TOutput>>;

	/**
	 * Execute a command and return its result as stream chunks.
	 *
	 * Returns an AsyncGenerator of StreamChunks. The command runs through
	 * `execute()` with `context` (so exposure checks apply) and completes before
	 * any chunk is produced: an array result becomes one data chunk per item,
	 * anything else one data chunk, followed by a complete chunk (or an error
	 * chunk). It does not stream incrementally or emit progress chunks.
	 *
	 * @param name - Command name
	 * @param input - Command input
	 * @param options - Stream options: `signal` cancels the stream, and `timeout` is a deadline for the whole stream (it ends with a `STREAM_TIMEOUT` error chunk)
	 * @param context - Context passed to the command (e.g. `interface`); `options.signal` takes precedence over `context.signal`
	 * @returns AsyncGenerator yielding StreamChunks
	 */
	executeStream<TOutput = unknown>(
		name: string,
		input: unknown,
		options?: StreamOptions,
		context?: CommandContext
	): AsyncGenerator<StreamChunk<TOutput>, void, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRY IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for {@link createCommandRegistry}.
 */
export interface CommandRegistryOptions {
	/**
	 * Include raw exception messages and stack traces in `COMMAND_EXECUTION_ERROR`
	 * results. Default `false`, matching `devMode` in `createMcpServer()`.
	 */
	devMode?: boolean;
	/**
	 * The host's grant check for app-to-app calls: whether the caller in `context` (a host's
	 * declared context field, such as Loam's `caller`) holds a grant naming `command`. A call with
	 * the `apps` interface runs only when the command sets `expose.apps` and this returns `true`;
	 * anything else, including no `callGrant`, is `CALL_NOT_GRANTED`
	 * (`spec/command-metadata.md`, "App-to-app calls").
	 */
	callGrant?: CallGrant;
	/** Maximum commands accepted in a single batch (default: 500). */
	maxBatchSize?: number;
	/** Maximum parallelism accepted in a single batch (default: 16). */
	maxBatchParallelism?: number;
}

/**
 * Create a new command registry.
 *
 * `execute`, `executeBatch` and `executeStream` share one execution path:
 * batch and stream delegate to the core `executeBatch()` / `executeStream()`
 * helpers with `execute()` as the callback, so exposure checks, the batch
 * deadline and error redaction behave the same on every entry point.
 */
export function createCommandRegistry(options: CommandRegistryOptions = {}): CommandRegistry {
	const validatePositiveInt = (value: number | undefined, name: string): void => {
		if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
			throw new RangeError(`${name} must be a positive integer`);
		}
	};
	validatePositiveInt(options.maxBatchSize, 'maxBatchSize');
	validatePositiveInt(options.maxBatchParallelism, 'maxBatchParallelism');
	const commands = new Map<string, CommandDefinition>();
	const devMode = options.devMode === true;

	const registry: CommandRegistry = {
		register(command) {
			if (commands.has(command.name)) {
				throw new Error(`Command '${command.name}' is already registered`);
			}
			if (command.confirmationMode !== undefined && command.confirmationMode !== 'host-verified') {
				throw new Error(`Invalid confirmationMode for '${command.name}'`);
			}
			if (command.task !== undefined) {
				if (
					command.task !== 'never' &&
					command.task !== 'optional' &&
					command.task !== 'required'
				) {
					throw new Error(
						`Command '${command.name}' has invalid task support '${String(command.task)}' (expected 'never', 'optional', or 'required')`
					);
				}
				if (command.task === 'optional' || command.task === 'required') {
					if (
						command.confirmPrompt !== undefined ||
						(command.approval !== undefined && command.approval !== 'not-required') ||
						command.confirmationMode !== undefined
					) {
						throw new Error(
							`Command '${command.name}' cannot declare task: '${command.task}' beside confirmPrompt, an approval policy other than 'not-required', or confirmationMode`
						);
					}
				}
			}
			const entry =
				command.outputBudget !== undefined
					? { ...command, outputBudget: validateOutputBudget(command.outputBudget, command.name) }
					: command;
			commands.set(entry.name, entry as CommandDefinition);
		},

		get(name) {
			return commands.get(name);
		},

		has(name) {
			return commands.has(name);
		},

		list() {
			return Array.from(commands.values());
		},

		listByCategory(category) {
			return Array.from(commands.values()).filter((cmd) => cmd.category === category);
		},

		listByTags(tags, mode) {
			if (tags.length === 0) {
				return [];
			}
			return Array.from(commands.values()).filter((cmd) => {
				const cmdTags = cmd.tags ?? [];
				if (cmdTags.length === 0) {
					return false;
				}
				if (mode === 'all') {
					return tags.every((tag) => cmdTags.includes(tag));
				}
				// mode === 'any'
				return tags.some((tag) => cmdTags.includes(tag));
			});
		},

		listByExposure(interfaceType) {
			return Array.from(commands.values()).filter((cmd) => isExposedTo(cmd, interfaceType));
		},

		async execute<TOutput = unknown>(
			name: string,
			input: unknown,
			context?: CommandContext
		): Promise<CommandResult<TOutput>> {
			const command = commands.get(name);
			// An app's call is checked first, with one answer for a missing, unexposed or ungranted
			// command, so an app learns nothing about commands it may not call.
			if (context?.interface === 'apps') {
				if (!appCallGranted(command, name, context, options.callGrant)) {
					return { success: false, error: callNotGranted() };
				}
			}
			if (!command) {
				return {
					success: false,
					error: {
						code: 'COMMAND_NOT_FOUND',
						message: `Command '${truncateName(String(name))}' not found`,
						suggestion: `Use 'afd tools' to see available commands`,
					},
				};
			}

			// Check exposure if interface context is provided
			if (context?.interface) {
				if (!isExposedTo(command, context.interface)) {
					return {
						success: false,
						error: {
							code: 'COMMAND_NOT_EXPOSED',
							message: `Command '${name}' is not exposed to ${context.interface}`,
							suggestion: `Call it from an interface it is exposed to, or set expose.${context.interface} to true in its definition`,
							retryable: false,
						},
					};
				}
			}

			try {
				const result = await command.handler(input, withContextDefaults(context));
				return result as CommandResult<TOutput>;
			} catch (error) {
				// Raw messages and stacks only in devMode, as in the MCP server.
				return executionFailure(error, devMode);
			}
		},

		async executeBatch<TOutput = unknown>(
			request: BatchRequest,
			context: CommandContext = {}
		): Promise<BatchResult<TOutput>> {
			const result = await executeCoreBatch(
				request,
				(name, input, commandContext) => registry.execute(name, input, commandContext),
				context,
				{
					devMode,
					maxBatchSize: options.maxBatchSize,
					maxBatchParallelism: options.maxBatchParallelism,
				}
			);
			return result as BatchResult<TOutput>;
		},

		executeStream<TOutput = unknown>(
			name: string,
			input: unknown,
			options?: StreamOptions,
			context: CommandContext = {}
		): AsyncGenerator<StreamChunk<TOutput>, void, unknown> {
			const signal = options?.signal ?? context.signal;
			return executeCoreStream<TOutput>(
				name,
				input,
				(commandName, commandInput, commandContext) =>
					registry.execute(commandName, commandInput, commandContext),
				signal ? { ...context, signal } : context,
				{ devMode, timeout: options?.timeout }
			);
		},
	};

	return registry;
}

/**
 * Convert a CommandDefinition to MCP tool format.
 */
export function commandToMcpTool<TInput, TOutput>(
	command: CommandDefinition<TInput, TOutput>
): {
	_meta?: CommandToolMeta;
	name: string;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, JsonSchema>;
		required: string[];
	};
} {
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];

	for (const param of command.parameters) {
		properties[param.name] = param.schema ?? {
			type: param.type,
			description: param.description,
			...(param.default !== undefined && { default: param.default }),
			...(param.enum && { enum: param.enum }),
		};

		if (param.required) {
			required.push(param.name);
		}
	}

	const meta = commandToolMeta(command, command.returns);
	return {
		name: command.name,
		description: command.description,
		...(meta && { _meta: meta }),
		inputSchema: {
			type: 'object',
			properties,
			required,
		},
	};
}

/**
 * Check if a command is exposed to MCP.
 */
export function isMcpExposed(command: Pick<CommandDefinition, 'expose'>): boolean {
	return isExposedTo(command, 'mcp');
}

/**
 * Convert commands to MCP tools, filtering by MCP exposure.
 * Only commands with `expose.mcp === true` will be included.
 */
export function commandsToMcpTools(
	commands: CommandDefinition[]
): ReturnType<typeof commandToMcpTool>[] {
	return commands.filter(isMcpExposed).map(commandToMcpTool);
}
