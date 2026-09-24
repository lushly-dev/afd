/**
 * @fileoverview Built-in meta-tools (afd-call, afd-batch, afd-pipe, afd-discover,
 * afd-detail): Zod argument schemas, argument validation, and the MCP tool
 * definitions generated from those schemas, so what is advertised in `tools/list`
 * is exactly what the router validates.
 */

import type { CommandError, CommandExample, CommandResult, JsonSchema } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-core';
import { z } from 'zod';
import { zodToJsonSchema } from './schema.js';
import type { ValidationError } from './validation.js';
import { formatEnhancedValidationError, validateInputEnhanced } from './validation.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ARGUMENT SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

const nonBlankString = z
	.string()
	.refine((value) => value.trim().length > 0, { message: 'Must be a nonblank string' });

/**
 * A command input. Each command validates its own input, so any value is accepted
 * here and advertised as an object (MCP tool arguments are always objects).
 */
const commandInput = (description: string) =>
	z.unknown().optional().meta({ type: 'object', description });

export const callArgsSchema = z.object({
	command: z.string().min(1).describe('Command name to invoke'),
	input: commandInput("Command input (validated against the command's own schema at runtime)"),
});

export const batchArgsSchema = z.object({
	commands: z
		.array(
			z.object({
				id: z.string().optional().describe('Optional client-provided ID for correlating results'),
				command: nonBlankString.describe('The command name to execute'),
				input: commandInput('Input parameters for the command'),
			})
		)
		.describe('Array of commands to execute'),
	options: z
		.object({
			stopOnError: z.boolean().optional().describe('Stop execution on first error'),
			timeout: z.number().min(0).optional().describe('Timeout in milliseconds for entire batch'),
			parallelism: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('Maximum commands to run concurrently (default 1)'),
		})
		.optional()
		.describe('Batch execution options'),
});

export const pipeArgsSchema = z.object({
	input: z
		.unknown()
		.optional()
		.describe(
			'Optional pipeline input (any JSON value), available to steps as $input and $input.<path>'
		),
	steps: z
		.array(
			z.object({
				command: nonBlankString.describe('Command name to execute'),
				input: z
					.record(z.string(), z.unknown())
					.optional()
					.describe(
						'Input parameters. A string value that is exactly $prev, $first, $steps[n], $steps.alias or $input, optionally followed by .path (e.g. $prev.items[0].id), is replaced by that data; unresolved references are omitted. Other strings are literals; start one with $$ to send a literal $ (e.g. $$prev).'
					),
				as: z.string().optional().describe("Optional alias for referencing this step's output"),
				when: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Optional condition for running this step (e.g., { $exists: '$prev.id' })"),
			})
		)
		.describe('Ordered list of pipeline steps to execute'),
	options: z
		.object({
			continueOnFailure: z.boolean().optional().describe('Continue on failure or stop immediately'),
			timeoutMs: z
				.number()
				.min(0)
				.optional()
				.describe('Timeout for entire pipeline in milliseconds'),
		})
		.optional()
		.describe('Pipeline execution options'),
});

export const discoverArgsSchema = z.object({
	category: z.string().optional().describe('Filter commands by category'),
	tag: z
		.union([z.string(), z.array(z.string())], {
			error: 'Expected a tag (string) or an array of tags',
		})
		.optional()
		.describe('Filter by tag(s). String for single, array for multiple.'),
	tagMode: z.enum(['all', 'any']).optional().describe('Tag matching mode (default: any)'),
	search: z.string().optional().describe('Text search across names and descriptions'),
	includeMutation: z.boolean().optional().describe('Include mutation classification'),
	limit: z.number().optional().describe('Max results (1-200, default 50)'),
	offset: z.number().optional().describe('Results to skip for pagination'),
});

export const detailArgsSchema = z.object({
	command: z
		.union([z.string(), z.array(z.string())], {
			error: 'Expected a command name (string) or an array of command names',
		})
		.describe(
			'Command name or names (exact match, kebab-case). String or array of strings (max 10).'
		),
});

export type DiscoverInput = z.infer<typeof discoverArgsSchema>;
export type DetailInput = z.infer<typeof detailArgsSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

type MetaArgsCheck<T> =
	| { success: true; data: T }
	| { success: false; errors: ValidationError[]; suggestion: string };

/**
 * Validate meta-tool arguments against their schema. Missing arguments are `{}`.
 */
export function checkMetaArgs<T>(schema: z.ZodType<T>, args: unknown): MetaArgsCheck<T> {
	const validation = validateInputEnhanced(schema, args ?? {});
	if (validation.success) return { success: true, data: validation.data as T };
	return {
		success: false,
		errors: validation.errors,
		// Unknown keys are ignored rather than rejected, so they are not reported.
		suggestion: formatEnhancedValidationError(validation.errors, {
			missingFields: validation.missingFields,
			expectedFields: validation.expectedFields,
		}),
	};
}

/**
 * Validate the arguments of afd-call, afd-discover or afd-detail. Top-level `null`
 * values count as omitted, since agents often send `null` for optional fields.
 * Invalid arguments become a `VALIDATION_ERROR` result instead of a thrown error.
 */
export function parseMetaArgs<T>(
	toolName: string,
	schema: z.ZodType<T>,
	args: unknown,
	usage: string
): { success: true; data: T } | { success: false; result: CommandResult } {
	const check = checkMetaArgs(schema, withoutNulls(args));
	if (check.success) return check;
	const error: CommandError = {
		code: 'VALIDATION_ERROR',
		message: `Invalid ${toolName} arguments`,
		suggestion: `${check.suggestion}. ${usage}`,
		details: { errors: check.errors },
	};
	return { success: false, result: failure(error) };
}

function withoutNulls(args: unknown): unknown {
	if (typeof args !== 'object' || args === null || Array.isArray(args)) return args;
	return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null));
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** A tool's `inputSchema`: a JSON Schema object. */
export type ToolInputSchema = { type: 'object'; [key: string]: unknown };

/** Per-command `_meta` fields; each is present only when the command sets it. */
export type CommandToolMeta = {
	category?: string;
	requires?: string[];
	mutation?: boolean;
	destructive?: boolean;
	examples?: CommandExample[];
	outputSchema?: JsonSchema;
	contexts?: string[];
};

/** One action of a grouped tool, as listed in its `_meta.actions`. */
export type GroupedToolAction = CommandToolMeta & {
	/** Value of the grouped tool's `action` argument */
	action: string;
	/** Full command name (usable with afd-call and afd-detail) */
	command: string;
	description: string;
	/** Schema of the grouped tool's `params` argument for this action */
	inputSchema: ToolInputSchema;
};

/** An MCP tool as listed by `tools/list`. */
export type McpToolDefinition = {
	name: string;
	description: string;
	inputSchema: ToolInputSchema;
	_meta?: CommandToolMeta & { actions?: GroupedToolAction[] };
};

function metaTool(name: string, description: string, schema: z.ZodType): McpToolDefinition {
	const { type: _type, ...rest } = zodToJsonSchema(schema, { io: 'input' });
	return { name, description, inputSchema: { type: 'object', ...rest } };
}

export const callTool = metaTool(
	'afd-call',
	'Invoke any command by name with runtime input validation. Works in all server strategies.',
	callArgsSchema
);

export const batchTool = metaTool(
	'afd-batch',
	'Execute multiple commands in a single batch request with partial success semantics',
	batchArgsSchema
);

export const pipeTool = metaTool(
	'afd-pipe',
	'Execute a pipeline of chained commands where the output of one becomes the input of the next',
	pipeArgsSchema
);

export const discoverTool = metaTool(
	'afd-discover',
	'List available commands with optional filtering by category, tag, or search text. Returns compact summaries.',
	discoverArgsSchema
);

export const detailTool = metaTool(
	'afd-detail',
	'Get the full input schema and metadata for one or more commands by name.',
	detailArgsSchema
);

/** Tool names handled by the router before any command lookup. */
export const META_TOOL_NAMES: readonly string[] = [
	callTool.name,
	batchTool.name,
	pipeTool.name,
	discoverTool.name,
	detailTool.name,
];
