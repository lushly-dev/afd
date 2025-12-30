/**
 * @fileoverview Command definition and registry types
 *
 * Commands are the core abstraction in AFD. Every application action
 * is defined as a command with a clear schema.
 */

import type { CommandError } from './errors.js';
import type { CommandResult } from './result.js';

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
	register<TInput = unknown, TOutput = unknown>(
		command: CommandDefinition<TInput, TOutput>
	): void;

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
	 * Execute a command by name.
	 */
	execute<TOutput = unknown>(
		name: string,
		input: unknown,
		context?: CommandContext
	): Promise<CommandResult<TOutput>>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRY IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new command registry.
 */
export function createCommandRegistry(): CommandRegistry {
	const commands = new Map<string, CommandDefinition>();

	return {
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

		async execute<TOutput = unknown>(name: string, input: unknown, context?: CommandContext): Promise<CommandResult<TOutput>> {
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
	};
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
