/**
 * @fileoverview The command definition every path ends in, with no JSON Schema conversion.
 *
 * Module-graph rule: nothing here, and nothing `createDirectRegistry` or `createJournalMiddleware`
 * reach, imports `zod` at run time, only `zod/v4/core`, so a host on Zod Mini loads neither classic
 * Zod nor `toJSONSchema`. `entry-points.test.ts` enforces it. `defineCommand`, in `schema.ts`, adds
 * the conversion for everyone else.
 */

import type {
	ApprovalPolicy,
	CommandContext,
	CommandDefinition,
	CommandExample,
	CommandParameter,
	CommandResult,
	ExposeOptions,
	JsonSchema,
} from '@lushly-dev/afd-core';
import { validateCommandName } from '@lushly-dev/afd-core/commands';
import type { ZodType } from 'zod';
import type { $ZodType, input, output } from 'zod/v4/core';
import { validateInput } from './validation.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for defining a command with Zod schema.
 */
export interface ZodCommandOptions<TInput extends $ZodType, TOutput> {
	/** Unique command name in kebab-case (e.g., 'todo-create') */
	name: string;

	/** Human-readable description of what the command does */
	description: string;

	/** Zod schema for input validation: classic or Zod Mini */
	input: TInput;

	/**
	 * Optional Zod schema describing the command's output data shape.
	 * Used for agent introspection — not validated at runtime.
	 * Describes the shape of `CommandResult.data`, not the full envelope.
	 */
	output?: $ZodType<TOutput>;

	/** Command handler function */
	handler: (input: output<TInput>, context: CommandContext) => Promise<CommandResult<TOutput>>;

	/** A short human-readable label, reported as the MCP tool `title` and by afd-detail */
	title?: string;

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

	/**
	 * Whether this command can be undone.
	 * Implementation is consumer-specific; AFD only carries the flag.
	 */
	undoable?: boolean;

	/**
	 * Whether a call needs a human's approval before the handler runs: `'required'`,
	 * `'not-required'` (the default), or a function of the validated input and context.
	 * Enforced by `createApprovalMiddleware`; reported as `_meta.approval`.
	 */
	approval?: ApprovalPolicy<output<TInput>>;

	/**
	 * Which interfaces this command is exposed to.
	 * Controls visibility in command palette, MCP, agent, and CLI surfaces.
	 * Defaults to `defaultExpose` if not specified.
	 */
	expose?: ExposeOptions;

	/**
	 * Concrete input examples to help agents construct valid payloads.
	 * Each example is validated against the input schema at define-time.
	 */
	examples?: CommandExample<input<TInput>>[];

	/**
	 * Contexts this command belongs to. When context-based tool scoping is enabled,
	 * only commands matching the active context (or commands without contexts) are visible.
	 */
	contexts?: string[];

	/**
	 * OAuth scopes a caller's token needs to run this command over HTTP on a server with MCP
	 * authorization (`spec/authorization.md`, M6), after the server's `requiredScopes`, compared
	 * exactly; a host `ScopeResolver` may decide instead. Ignored in process. Reported as
	 * `_meta.scopes` and by afd-detail.
	 */
	scopes?: string[];

	/**
	 * Extra `_meta` entries for this command's tool, its grouped action entry and afd-detail
	 * (`spec/mcp-resources.md`, T1). Keys are reverse-DNS prefixed with two or more labels, outside
	 * `dev.afd/` and the prefixes MCP reserves (`dev.umbel/origin`), or exactly `ui`, the MCP Apps
	 * key (`{ resourceUri: 'ui://app/view.html' }`). An MCP server refuses any other key when it
	 * registers the command, so an entry never replaces one the server sets. (`defineCommand` and
	 * the in-process registry do not check, to keep the `/direct` entry within its size budget.)
	 */
	toolMeta?: Record<string, unknown>;

	/**
	 * The input schema shown on every surface (tool `inputSchema`, afd-detail, afd-schema,
	 * afd-docs), in place of the one generated from `input`. `input` still validates every call.
	 * It must be a JSON object whose `type` is `"object"`; nothing else in it is checked. Keeping
	 * `input` no wider than this schema is the caller's duty (`spec/mcp-resources.md`, V1).
	 */
	advertisedInputSchema?: JsonSchema;
}

/**
 * A command definition that includes Zod schema for runtime validation.
 */
export interface ZodCommandDefinition<TInput extends $ZodType = ZodType, TOutput = unknown> {
	/** Unique command name */
	name: string;

	/** Human-readable description */
	description: string;

	/** Zod schema for input validation */
	inputSchema: TInput;

	/** JSON Schema shown on every surface (for MCP tools): the advertised schema when one was given */
	jsonSchema: JsonSchema;

	/** Command handler */
	handler: (input: output<TInput>, context: CommandContext) => Promise<CommandResult<TOutput>>;

	/** Display label (MCP tool `title`) */
	title?: string;

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

	/** Whether this command can be undone */
	undoable?: boolean;

	/** Pre-execution approval policy (enforced by `createApprovalMiddleware`) */
	approval?: ApprovalPolicy<output<TInput>>;

	/**
	 * Which interfaces this command is exposed to.
	 * Controls visibility in command palette, MCP, agent, and CLI surfaces.
	 */
	expose?: ExposeOptions;

	/** Concrete input examples validated against the input schema */
	examples?: CommandExample<input<TInput>>[];

	/** Zod schema for output validation (optional) */
	outputSchema?: $ZodType;

	/** JSON Schema for the output data shape */
	outputJsonSchema?: JsonSchema;

	/** Contexts this command belongs to */
	contexts?: string[];

	/** OAuth scopes a caller's token needs over authorized HTTP (`spec/authorization.md`, M6) */
	scopes?: string[];

	/** Extra `_meta` entries for this command's tool (`spec/mcp-resources.md`, T1) */
	toolMeta?: Record<string, unknown>;

	/**
	 * Convert to standard CommandDefinition format.
	 */
	toCommandDefinition(): CommandDefinition<output<TInput>, TOutput>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Define a command whose JSON Schema you already have, so nothing converts it at run time. The
 * lean path: it takes a classic or a Zod Mini schema, and a host that defines every command this
 * way bundles neither classic Zod nor `toJSONSchema`.
 *
 * `jsonSchema` is what every surface shows, unless `advertisedInputSchema` replaces it, and `input`
 * validates every call. Nothing compares the two, so hold them equal in a test, against
 * `zodToJsonSchema(schema)`. `output` is not converted either: pass `outputJsonSchema` to advertise it.
 *
 * @example
 * ```typescript
 * import * as z from 'zod/mini';
 * import { defineCommandWithSchema, success } from '@lushly-dev/afd-server/define';
 *
 * const panelOpen = defineCommandWithSchema({
 *   name: 'panel-open',
 *   description: 'Open a panel',
 *   input: z.object({ id: z.string() }),
 *   jsonSchema: {
 *     type: 'object',
 *     properties: { id: { type: 'string' } },
 *     required: ['id'],
 *   },
 *   async handler(input) {
 *     return success({ id: input.id, open: true });
 *   },
 * });
 * ```
 */
export function defineCommandWithSchema<TInput extends $ZodType, TOutput>(
	options: ZodCommandOptions<TInput, TOutput> & {
		/** The input's JSON Schema, shown on every surface */
		jsonSchema: JsonSchema;
		/** The output's JSON Schema, reported wherever a command's output is described */
		outputJsonSchema?: JsonSchema;
	}
): ZodCommandDefinition<TInput, TOutput> {
	const nameCheck = validateCommandName(options.name);
	if (!nameCheck.valid) {
		console.warn(`[AFD] ${nameCheck.reason}`);
	}

	const { advertisedInputSchema, outputJsonSchema } = options;
	if (
		advertisedInputSchema !== undefined &&
		!(isJsonObject(advertisedInputSchema) && advertisedInputSchema.type === 'object')
	) {
		throw new Error(
			`command "${options.name}": advertisedInputSchema must be a JSON Schema object whose type is "object"`
		);
	}
	if (!isJsonObject(options.jsonSchema)) {
		throw new Error(`command "${options.name}": jsonSchema must be an object`);
	}

	// An advertised schema replaces the given one on every surface; the Zod schema still validates.
	const jsonSchema = advertisedInputSchema ?? options.jsonSchema;

	// Build tags with automatic handoff tags if handoff is enabled
	const tags = buildHandoffTags(options.tags, options.handoff, options.handoffProtocol);

	// Validate examples against input schema at define-time
	if (options.examples) {
		for (const example of options.examples) {
			const parsed = validateInput(options.input, example.input);
			if (!parsed.success) {
				const issues = parsed.errors.map((e) => `${e.path}: ${e.message}`).join(', ');
				throw new Error(
					`Example "${example.title}" for command "${options.name}" fails schema validation: ${issues}`
				);
			}
		}
	}

	const { name, description, handler, examples, contexts, toolMeta } = options;
	const metadata = {
		title: options.title,
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
		undoable: options.undoable,
		approval: options.approval,
		expose: options.expose,
		// Only when set, so a command without scopes keeps the keys it always had.
		...(options.scopes && { scopes: options.scopes }),
	};

	return {
		name,
		description,
		inputSchema: options.input,
		jsonSchema,
		handler,
		...metadata,
		examples,
		outputSchema: options.output,
		outputJsonSchema,
		contexts,
		toolMeta,

		toCommandDefinition(): CommandDefinition<output<TInput>, TOutput> {
			return {
				name,
				description,
				...metadata,
				// Examples are raw inputs (before defaults and transforms); core types them by the
				// handler input, which differs only for schemas with defaults or transforms.
				examples: examples as CommandExample<output<TInput>>[] | undefined,
				contexts,
				toolMeta,
				parameters: jsonSchemaToParameters(jsonSchema),
				returns: outputJsonSchema,
				handler: handler as (
					input: unknown,
					context?: CommandContext
				) => Promise<CommandResult<TOutput>>,
			};
		},
	};
}

function isJsonObject(value: unknown): value is JsonSchema {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
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
 * Convert JSON Schema to CommandParameter array for @lushly-dev/afd-core compatibility.
 */
export function jsonSchemaToParameters(schema: JsonSchema): CommandParameter[] {
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
