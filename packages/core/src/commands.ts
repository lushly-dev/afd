// afd-override: max-lines=900 — foundational types file: CommandDefinition, CommandResult, registry, middleware, expose, handoff all cohesive
/**
 * @fileoverview Command definition and registry types
 *
 * Commands are the core abstraction in AFD. Every application action
 * is defined as a command with a clear schema.
 */

import type { BatchRequest, BatchResult } from './batch.js';

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
}

/** Frozen to prevent accidental mutation */
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
	 * Whether this command can be undone.
	 * Implementation is consumer-specific (e.g., FAST-AF uses `${methodName}Undo()` convention).
	 */
	undoable?: boolean;

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

	/** The interface invoking this command (for exposure checks) */
	interface?: keyof ExposeOptions;

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
	 * @param interfaceType - The interface to filter by (mcp, cli, palette, agent)
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
	 * Execute a command that yields streaming results.
	 *
	 * Returns an AsyncGenerator that yields StreamChunks (progress, data,
	 * complete, or error). Use for long-running operations or large results.
	 * The command runs through `execute()` with `context`, so exposure checks
	 * apply.
	 *
	 * @param name - Command name
	 * @param input - Command input
	 * @param options - Stream options including AbortSignal for cancellation
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
	const commands = new Map<string, CommandDefinition>();
	const devMode = options.devMode === true;

	const registry: CommandRegistry = {
		register(command) {
			if (commands.has(command.name)) {
				throw new Error(`Command '${command.name}' is already registered`);
			}
			commands.set(command.name, command as CommandDefinition);
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
				const result = await command.handler(input, context);
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
				{ devMode }
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
				{ devMode }
			);
		},
	};

	return registry;
}

/**
 * Convert a CommandDefinition to MCP tool format.
 */
export function commandToMcpTool(command: CommandDefinition): {
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

	return {
		name: command.name,
		description: command.description,
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
