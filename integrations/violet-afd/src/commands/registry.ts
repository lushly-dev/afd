import type { Database, ResolutionCache } from '@lushly-dev/violet-core';
import type { z } from 'zod';
import type { CommandResult } from '../types/command-result.js';
import { type JsonSchema, toJsonSchema } from './json-schema.js';

/**
 * Command definition with typed input/output schemas
 *
 * TSchema: The Zod schema type
 * TOutput: The output type returned by the handler
 *
 * This uses Zod's built-in type inference to properly handle input vs output types:
 * - z.input<TSchema>: What callers provide (with optional fields)
 * - z.output<TSchema>: What handlers receive (after defaults applied)
 */
export interface CommandDefinition<TSchema extends z.ZodType, TOutput> {
	/** Unique command name (e.g., 'node.create') */
	name: string;

	/** Human-readable description */
	description: string;

	/** Category for grouping commands */
	category:
		| 'node'
		| 'token'
		| 'export'
		| 'import'
		| 'analyze'
		| 'constraint'
		| 'system'
		| 'webhook'
		| 'audit'
		| 'specimen';

	/** Zod schema for input validation */
	inputSchema: TSchema;

	/** Zod schema for output type (for documentation) */
	outputSchema: z.ZodType<TOutput, z.ZodTypeDef, unknown>;

	/**
	 * The command handler
	 * - Accepts z.input<TSchema> (what callers provide - optional fields allowed)
	 * - Internally parses to z.output<TSchema> (with defaults applied)
	 */
	handler: (input: z.input<TSchema>, context: CommandContext) => Promise<CommandResult<TOutput>>;

	/** Examples for documentation - uses input type (optional fields allowed) */
	examples?: Array<{
		description: string;
		input: z.input<TSchema>;
	}>;
}

/**
 * Context passed to command handlers
 */
export interface CommandContext {
	/** Database instance */
	db: Database;

	/** Current actor (user/system) */
	actor?: string;

	/** Trace ID for logging */
	traceId?: string;

	/**
	 * Store reads and resolved chains shared by the resolutions of one read-only
	 * command execution. Set by withResolutionCache on a context made for that
	 * execution; never set it on a context that outlives it or sees writes.
	 */
	resolutionCache?: ResolutionCache;
}

/**
 * Database interface (implemented by storage layer). Native: @lushly-dev/violet-core.
 */
export type { Database } from '@lushly-dev/violet-core';

/**
 * Command Registry
 *
 * Central registry for all Violet commands. Supports:
 * - Auto-discovery of commands
 * - Schema-based validation
 * - Help/documentation generation
 */
export class CommandRegistry {
	private commands = new Map<string, CommandDefinition<z.ZodType, unknown>>();

	/**
	 * Register a command
	 */
	register<TSchema extends z.ZodType, TOutput>(command: CommandDefinition<TSchema, TOutput>): void {
		if (this.commands.has(command.name)) {
			throw new Error(`Command '${command.name}' is already registered`);
		}
		this.commands.set(command.name, command as unknown as CommandDefinition<z.ZodType, unknown>);
	}

	/**
	 * Get a command by name
	 */
	get<TSchema extends z.ZodType, TOutput>(
		name: string,
	): CommandDefinition<TSchema, TOutput> | undefined {
		return this.commands.get(name) as CommandDefinition<TSchema, TOutput> | undefined;
	}

	/**
	 * List all registered commands
	 */
	list(): Array<{ name: string; description: string; category: string }> {
		return Array.from(this.commands.values()).map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
			category: cmd.category,
		}));
	}

	/**
	 * List commands by category
	 */
	listByCategory(category: string): Array<{ name: string; description: string }> {
		return Array.from(this.commands.values())
			.filter((cmd) => cmd.category === category)
			.map((cmd) => ({
				name: cmd.name,
				description: cmd.description,
			}));
	}

	/**
	 * Get input schema for a command (for documentation/validation)
	 */
	getInputSchema(name: string): z.ZodType | undefined {
		return this.commands.get(name)?.inputSchema;
	}

	/**
	 * Get a command's input schema as JSON Schema (the form MCP, the CLI and
	 * the generated docs show), or undefined for an unknown command
	 */
	getInputJsonSchema(name: string): JsonSchema | undefined {
		const schema = this.commands.get(name)?.inputSchema;
		return schema ? toJsonSchema(schema) : undefined;
	}

	/**
	 * Execute a command with validation
	 */
	async execute<TInput, TOutput>(
		name: string,
		input: TInput,
		context: CommandContext,
	): Promise<CommandResult<TOutput>> {
		const command = this.commands.get(name);

		if (!command) {
			return {
				success: false,
				error: {
					code: 'COMMAND_NOT_FOUND',
					message: `Command '${name}' not found`,
					suggestion: `Use 'violet --help' to see available commands`,
				},
			};
		}

		// Validate input
		const validation = command.inputSchema.safeParse(input);
		if (!validation.success) {
			return {
				success: false,
				error: {
					code: 'VALIDATION_ERROR',
					message: `Invalid input: ${validation.error.message}`,
					suggestion: `Check the command schema with 'violet call ${name} --schema'`,
				},
			};
		}

		// Execute handler
		const startTime = Date.now();
		try {
			const result = await command.handler(validation.data, context);
			return {
				...result,
				metadata: {
					...result.metadata,
					executionTimeMs: Date.now() - startTime,
					traceId: context.traceId,
				},
			} as CommandResult<TOutput>;
		} catch (error) {
			return {
				success: false,
				error: {
					code: 'INTERNAL_ERROR',
					message: error instanceof Error ? error.message : 'Unknown error',
					retryable: false,
				},
				metadata: {
					executionTimeMs: Date.now() - startTime,
					traceId: context.traceId,
				},
			};
		}
	}

	/**
	 * Generate documentation for all commands
	 */
	generateDocs(): string {
		const categories = new Map<string, Array<{ name: string; description: string }>>();

		for (const cmd of this.commands.values()) {
			const category = categories.get(cmd.category) || [];
			category.push({ name: cmd.name, description: cmd.description });
			categories.set(cmd.category, category);
		}

		let docs = '# Violet Design Commands\n\n';

		for (const [category, commands] of categories) {
			docs += `## ${category}\n\n`;
			for (const cmd of commands) {
				docs += `### \`${cmd.name}\`\n\n${cmd.description}\n\n`;
			}
		}

		return docs;
	}
}

/**
 * Global command registry instance
 */
export const registry = new CommandRegistry();
