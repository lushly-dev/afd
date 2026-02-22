/**
 * @fileoverview Zod-based command definition helpers
 *
 * This module provides utilities for defining commands using Zod schemas,
 * with automatic JSON Schema generation for MCP tool definitions.
 */

import type {
	CommandContext,
	CommandDefinition,
	CommandParameter,
	CommandResult,
	JsonSchema,
} from '@lushly-dev/afd-core';
import { validateCommandName } from '@lushly-dev/afd-core';
import { type ZodType, type ZodTypeDef, z } from 'zod';
import { zodToJsonSchema as zodToJson } from 'zod-to-json-schema';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for defining a command with Zod schema.
 */
export interface ZodCommandOptions<TInput extends ZodType<unknown, ZodTypeDef, unknown>, TOutput> {
	/** Unique command name in kebab-case (e.g., 'todo-create') */
	name: string;

	/** Human-readable description of what the command does */
	description: string;

	/** Zod schema for input validation */
	input: TInput;

	/** Command handler function */
	handler: (input: z.infer<TInput>, context: CommandContext) => Promise<CommandResult<TOutput>>;

	/** Category for grouping related commands */
	category?: string;

	/** Whether this command performs side effects */
	mutation?: boolean;

	/** Command version for tracking changes */
	version?: string;

	/** Tags for additional categorization */
	tags?: string[];

	/** Commands that should be called before this one. Metadata only — not enforced at runtime. */
	requires?: string[];

	/** Estimated execution time category */
	executionTime?: 'instant' | 'fast' | 'slow' | 'long-running';

	/** Error codes this command may return */
	errors?: string[];

	/**
	 * Whether this command returns a HandoffResult for protocol handoffs.
	 * When true, the command will automatically be tagged with 'handoff'.
	 */
	handoff?: boolean;

	/**
	 * The specific handoff protocol this command uses (if handoff is true).
	 * When specified, the command will also be tagged with 'handoff:{protocol}'.
	 */
	handoffProtocol?: 'websocket' | 'webrtc' | 'sse' | 'http-stream' | string;

	/**
	 * Whether this command performs destructive/irreversible actions.
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
}

/**
 * A command definition that includes Zod schema for runtime validation.
 */
export interface ZodCommandDefinition<
	TInput extends ZodType<unknown, ZodTypeDef, unknown> = ZodType,
	TOutput = unknown,
> {
	/** Unique command name */
	name: string;

	/** Human-readable description */
	description: string;

	/** Zod schema for input validation */
	inputSchema: TInput;

	/** JSON Schema representation (for MCP tools) */
	jsonSchema: JsonSchema;

	/** Command handler */
	handler: (input: z.infer<TInput>, context: CommandContext) => Promise<CommandResult<TOutput>>;

	/** Category for grouping */
	category?: string;

	/** Whether this is a mutation */
	mutation?: boolean;

	/** Command version */
	version?: string;

	/** Tags for categorization */
	tags?: string[];

	/** Commands that should be called before this one. Metadata only — not enforced at runtime. */
	requires?: string[];

	/** Execution time category */
	executionTime?: 'instant' | 'fast' | 'slow' | 'long-running';

	/** Possible error codes */
	errors?: string[];

	/** Whether this command returns a HandoffResult */
	handoff?: boolean;

	/** The specific handoff protocol this command uses */
	handoffProtocol?: 'websocket' | 'webrtc' | 'sse' | 'http-stream' | string;

	/** Whether this command is destructive (triggers confirmation UI) */
	destructive?: boolean;

	/** Custom confirmation prompt message */
	confirmPrompt?: string;

	/**
	 * Convert to standard CommandDefinition format.
	 */
	toCommandDefinition(): CommandDefinition<z.infer<TInput>, TOutput>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Define a command with Zod schema for type-safe input validation.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { defineCommand, success } from '@lushly-dev/afd-server';
 *
 * const createTodo = defineCommand({
 *   name: 'todo-create',
 *   description: 'Create a new todo item',
 *   category: 'todo',
 *   mutation: true,
 *   input: z.object({
 *     title: z.string().min(1).max(200),
 *     priority: z.enum(['low', 'medium', 'high']).default('medium'),
 *   }),
 *   async handler(input) {
 *     const todo = await createInDb(input);
 *     return success(todo);
 *   },
 * });
 * ```
 */
export function defineCommand<TInput extends ZodType<unknown, ZodTypeDef, unknown>, TOutput>(
	options: ZodCommandOptions<TInput, TOutput>
): ZodCommandDefinition<TInput, TOutput> {
	const nameCheck = validateCommandName(options.name);
	if (!nameCheck.valid) {
		console.warn(`[AFD] ${nameCheck.reason}`);
	}

	const jsonSchema = zodToJsonSchema(options.input);

	// Build tags with automatic handoff tags if handoff is enabled
	const tags = buildHandoffTags(options.tags, options.handoff, options.handoffProtocol);

	return {
		name: options.name,
		description: options.description,
		inputSchema: options.input,
		jsonSchema,
		handler: options.handler,
		category: options.category,
		mutation: options.mutation,
		version: options.version,
		tags,
		requires: options.requires,
		executionTime: options.executionTime,
		errors: options.errors,
		handoff: options.handoff,
		handoffProtocol: options.handoffProtocol,
		destructive: options.destructive,
		confirmPrompt: options.confirmPrompt,

		toCommandDefinition(): CommandDefinition<z.infer<TInput>, TOutput> {
			return {
				name: options.name,
				description: options.description,
				category: options.category,
				mutation: options.mutation,
				version: options.version,
				tags,
				requires: options.requires,
				executionTime: options.executionTime,
				errors: options.errors,
				handoff: options.handoff,
				handoffProtocol: options.handoffProtocol,
				parameters: jsonSchemaToParameters(jsonSchema),
				returns: { type: 'object', description: 'Command result' },
				handler: options.handler as (
					input: unknown,
					context?: CommandContext
				) => Promise<CommandResult<TOutput>>,
			};
		},
	};
}

/**
 * Build tags array with automatic handoff tags if handoff is enabled.
 * Adds 'handoff' tag and optionally 'handoff:{protocol}' tag.
 */
function buildHandoffTags(
	existingTags?: string[],
	handoff?: boolean,
	handoffProtocol?: string
): string[] | undefined {
	if (!handoff) {
		return existingTags;
	}

	const tags = new Set(existingTags ?? []);
	tags.add('handoff');

	if (handoffProtocol) {
		tags.add(`handoff:${handoffProtocol}`);
	}

	return Array.from(tags);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA CONVERSION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert a Zod schema to JSON Schema format.
 *
 * @param schema - Zod schema to convert
 * @returns JSON Schema representation
 */
export function zodToJsonSchema(schema: ZodType): JsonSchema {
	const result = zodToJson(schema, {
		$refStrategy: 'none',
		target: 'jsonSchema7',
	});

	// The library returns a full JSON Schema document, extract the relevant part
	if (typeof result === 'object' && result !== null) {
		// Remove $schema if present
		const { $schema, ...rest } = result as Record<string, unknown>;
		// SAFETY: zod-to-json-schema returns a valid JSON Schema object; after removing $schema,
		// the remaining properties conform to JsonSchema but TypeScript can't infer that from Record<string, unknown>.
		const jsonSchema = rest as unknown as JsonSchema;
		if (!jsonSchema.type) {
			// Default to object if type is not present
			return { type: 'object', ...rest } as JsonSchema;
		}
		return jsonSchema;
	}

	return { type: 'object' } as JsonSchema;
}

/**
 * Convert JSON Schema to CommandParameter array for @lushly-dev/afd-core compatibility.
 */
function jsonSchemaToParameters(schema: JsonSchema): CommandParameter[] {
	const parameters: CommandParameter[] = [];

	if (schema.type === 'object' && schema.properties) {
		// Handle required - it might be an array or undefined
		const requiredFields = Array.isArray(schema.required) ? schema.required : [];

		for (const [name, propSchema] of Object.entries(schema.properties)) {
			const prop = propSchema as JsonSchema;
			parameters.push({
				name,
				type: prop.type ?? 'string',
				description: prop.description ?? `Parameter: ${name}`,
				required: requiredFields.includes(name),
				default: prop.default,
				enum: prop.enum,
				schema: prop,
			});
		}
	}

	return parameters;
}

/**
 * Get required field names from a Zod object schema.
 */
export function getRequiredFields(schema: ZodType): string[] {
	const jsonSchema = zodToJsonSchema(schema);
	// Handle required - it might be an array or undefined
	return Array.isArray(jsonSchema.required) ? jsonSchema.required : [];
}

/**
 * Check if a Zod schema represents an object type.
 */
export function isObjectSchema(schema: ZodType): schema is z.ZodObject<z.ZodRawShape> {
	return schema instanceof z.ZodObject;
}
