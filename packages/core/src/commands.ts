/**
 * @fileoverview Command definition and registry types
 *
 * Commands are the core abstraction in AFD. Every application action
 * is defined as a command with a clear schema.
 */

import type {
	BatchCommand,
	BatchCommandResult,
	BatchRequest,
	BatchResult,
	BatchTiming,
} from './batch.js';
import { createBatchResult, createFailedBatchResult } from './batch.js';
import type { CommandResult } from './result.js';
import type { StreamChunk, StreamOptions } from './streaming.js';
import { createCompleteChunk, createErrorChunk } from './streaming.js';

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
 * JSON Schema subset for command parameter validation.
 */
export interface JsonSchema {
	type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
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
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	format?: string;
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
 * Full command definition with schema, handler, and metadata.
 *
 * @template TInput - Type of the input parameters
 * @template TOutput - Type of the result data
 *
 * @example
 * ```typescript
 * const createDocument: CommandDefinition<CreateDocInput, Document> = {
 *   name: 'document.create',
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
	 * Unique command name using dot notation.
	 *
	 * Convention: `category.action` (e.g., 'document.create', 'user.update')
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
	 * @param request - Batch request containing commands and options
	 * @returns BatchResult with all command results and aggregated metrics
	 */
	executeBatch<TOutput = unknown>(request: BatchRequest): Promise<BatchResult<TOutput>>;

	/**
	 * Execute a command that yields streaming results.
	 *
	 * Returns an AsyncGenerator that yields StreamChunks (progress, data,
	 * complete, or error). Use for long-running operations or large results.
	 *
	 * @param name - Command name
	 * @param input - Command input
	 * @param options - Stream options including AbortSignal for cancellation
	 * @returns AsyncGenerator yielding StreamChunks
	 */
	executeStream<TOutput = unknown>(
		name: string,
		input: unknown,
		options?: StreamOptions
	): AsyncGenerator<StreamChunk<TOutput>, void, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRY IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new command registry.
 */
export function createCommandRegistry(): CommandRegistry {
	const commands = new Map<string, CommandDefinition>();

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
			return Array.from(commands.values()).filter((cmd) => {
				const expose = cmd.expose ?? defaultExpose;
				return expose[interfaceType] === true;
			});
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
						message: `Command '${name}' not found`,
						suggestion: `Use 'afd tools' to see available commands`,
					},
				};
			}

			// Check exposure if interface context is provided
			if (context?.interface) {
				const expose = command.expose ?? defaultExpose;
				if (!expose[context.interface]) {
					return {
						success: false,
						error: {
							code: 'COMMAND_NOT_EXPOSED',
							message: `Command '${name}' is not exposed to ${context.interface}`,
							retryable: false,
						},
					};
				}
			}

			try {
				const result = await command.handler(input, context);
				return result as CommandResult<TOutput>;
			} catch (error) {
				return {
					success: false,
					error: {
						code: 'COMMAND_EXECUTION_ERROR',
						message: error instanceof Error ? error.message : String(error),
						suggestion: 'Check the input parameters and try again',
						details: {
							command: name,
							error: error instanceof Error ? error.stack : undefined,
						},
					},
				};
			}
		},

		async executeBatch<TOutput = unknown>(request: BatchRequest): Promise<BatchResult<TOutput>> {
			const startedAt = new Date().toISOString();
			const startTime = performance.now();

			// Validate request
			if (!request.commands || request.commands.length === 0) {
				return createFailedBatchResult(
					{
						code: 'INVALID_BATCH_REQUEST',
						message: 'Batch request must contain at least one command',
						suggestion: 'Provide an array of commands to execute',
					},
					{ startedAt }
				) as BatchResult<TOutput>;
			}

			const options = request.options ?? {};
			const results: BatchCommandResult<TOutput>[] = [];
			let stopped = false;

			// Execute commands sequentially (or with parallelism if specified)
			const parallelism = options.parallelism ?? 1;

			if (parallelism === 1) {
				// Sequential execution
				for (let i = 0; i < request.commands.length; i++) {
					const cmd = request.commands[i];
					if (!cmd) continue;

					if (stopped) {
						// Mark remaining as skipped
						results.push({
							id: cmd.id ?? `cmd-${i}`,
							index: i,
							command: cmd.command,
							result: {
								success: false,
								error: {
									code: 'COMMAND_SKIPPED',
									message: 'Command skipped due to previous error (stopOnError enabled)',
								},
							},
							durationMs: 0,
						});
						continue;
					}

					const cmdStartTime = performance.now();

					const result = await registry.execute<TOutput>(cmd.command, cmd.input);

					const cmdDuration = performance.now() - cmdStartTime;

					results.push({
						id: cmd.id ?? `cmd-${i}`,
						index: i,
						command: cmd.command,
						result,
						durationMs: Math.round(cmdDuration * 100) / 100,
					});

					if (!result.success && options.stopOnError) {
						stopped = true;
					}

					// Check timeout
					if (options.timeout && performance.now() - startTime > options.timeout) {
						// Mark remaining as skipped due to timeout
						for (let j = i + 1; j < request.commands.length; j++) {
							const remainingCmd = request.commands[j];
							if (!remainingCmd) continue;
							results.push({
								id: remainingCmd.id ?? `cmd-${j}`,
								index: j,
								command: remainingCmd.command,
								result: {
									success: false,
									error: {
										code: 'BATCH_TIMEOUT',
										message: `Batch timeout exceeded (${options.timeout}ms)`,
										retryable: true,
									},
								},
								durationMs: 0,
							});
						}
						break;
					}
				}
			} else {
				// Parallel execution with limited concurrency
				const executeCommand = async (
					cmd: BatchCommand,
					index: number
				): Promise<BatchCommandResult<TOutput>> => {
					const cmdStartTime = performance.now();
					const result = await registry.execute<TOutput>(cmd.command, cmd.input);
					const cmdDuration = performance.now() - cmdStartTime;

					return {
						id: cmd.id ?? `cmd-${index}`,
						index,
						command: cmd.command,
						result,
						durationMs: Math.round(cmdDuration * 100) / 100,
					};
				};

				// Process in batches of `parallelism` size
				for (let i = 0; i < request.commands.length; i += parallelism) {
					const batch = request.commands.slice(i, i + parallelism);
					const batchResults = await Promise.all(
						batch.map((cmd, batchIndex) => executeCommand(cmd, i + batchIndex))
					);
					results.push(...batchResults);

					// Check for stopOnError
					if (options.stopOnError && batchResults.some((r) => !r.result.success)) {
						stopped = true;
						// Mark remaining as skipped
						for (let j = i + parallelism; j < request.commands.length; j++) {
							const remainingCmd = request.commands[j];
							if (!remainingCmd) continue;
							results.push({
								id: remainingCmd.id ?? `cmd-${j}`,
								index: j,
								command: remainingCmd.command,
								result: {
									success: false,
									error: {
										code: 'COMMAND_SKIPPED',
										message: 'Command skipped due to previous error (stopOnError enabled)',
									},
								},
								durationMs: 0,
							});
						}
						break;
					}
				}
			}

			const completedAt = new Date().toISOString();
			const totalMs = performance.now() - startTime;

			const timing: BatchTiming = {
				totalMs: Math.round(totalMs * 100) / 100,
				averageMs: results.length > 0 ? Math.round((totalMs / results.length) * 100) / 100 : 0,
				startedAt,
				completedAt,
			};

			return createBatchResult(results, timing, {
				traceId: `batch-${Date.now()}`,
			});
		},

		async *executeStream<TOutput = unknown>(
			name: string,
			input: unknown,
			options?: StreamOptions
		): AsyncGenerator<StreamChunk<TOutput>, void, unknown> {
			const startTime = performance.now();
			let chunksEmitted = 0;

			// Check for abort before starting
			if (options?.signal?.aborted) {
				yield createErrorChunk(
					{
						code: 'STREAM_ABORTED',
						message: 'Stream was aborted before starting',
						retryable: true,
					},
					0,
					true
				);
				return;
			}

			// Set up abort handler
			let aborted = false;
			const abortHandler = () => {
				aborted = true;
			};
			options?.signal?.addEventListener('abort', abortHandler);

			try {
				// Execute the command
				const result = await registry.execute<TOutput>(name, input, {
					signal: options?.signal,
				});

				// Check if aborted during execution
				if (aborted) {
					yield createErrorChunk(
						{
							code: 'STREAM_ABORTED',
							message: 'Stream was aborted during execution',
							retryable: true,
						},
						chunksEmitted,
						true
					);
					return;
				}

				if (!result.success) {
					yield createErrorChunk(
						result.error ?? {
							code: 'COMMAND_FAILED',
							message: 'Command execution failed',
						},
						chunksEmitted,
						result.error?.retryable ?? false
					);
					return;
				}

				// For non-streamable commands, emit the result as a single data chunk
				// followed by completion
				const data = result.data;

				// If result is an array, emit each item as a chunk
				if (Array.isArray(data)) {
					for (let i = 0; i < data.length; i++) {
						if (aborted) {
							yield createErrorChunk(
								{
									code: 'STREAM_ABORTED',
									message: 'Stream was aborted',
									retryable: true,
								},
								chunksEmitted,
								true,
								chunksEmitted
							);
							return;
						}

						yield {
							type: 'data',
							data: data[i] as TOutput,
							index: i,
							isLast: i === data.length - 1,
						};
						chunksEmitted++;
					}
				} else {
					// Single result
					yield {
						type: 'data',
						data: data as TOutput,
						index: 0,
						isLast: true,
					};
					chunksEmitted++;
				}

				// Emit completion
				const totalDurationMs = performance.now() - startTime;
				yield createCompleteChunk<TOutput>(chunksEmitted, totalDurationMs, {
					confidence: result.confidence,
					reasoning: result.reasoning,
					metadata: result.metadata,
				});
			} catch (error) {
				yield createErrorChunk(
					{
						code: 'STREAM_ERROR',
						message: error instanceof Error ? error.message : String(error),
						retryable: true,
					},
					chunksEmitted,
					true
				);
			} finally {
				options?.signal?.removeEventListener('abort', abortHandler);
			}
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
export function isMcpExposed(command: CommandDefinition): boolean {
	const expose = command.expose ?? defaultExpose;
	return expose.mcp === true;
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
