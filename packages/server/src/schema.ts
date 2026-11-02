/**
 * @fileoverview Zod-based command definition helpers
 *
 * This module provides utilities for defining commands using Zod schemas,
 * with automatic JSON Schema generation for MCP tool definitions.
 */

import type { JsonSchema } from '@lushly-dev/afd-core';
import type { ZodObject, ZodRawShape, ZodType } from 'zod';
import { $ZodObject, type $ZodType } from 'zod/v4/core';
import {
	defineCommandWithSchema,
	type ZodCommandDefinition,
	type ZodCommandOptions,
} from './define-core.js';
import { zodToJsonSchema } from './json-schema.js';

export {
	defineCommandWithSchema,
	jsonSchemaToParameters,
	type ZodCommandDefinition,
	type ZodCommandOptions,
} from './define-core.js';
export { type ZodToJsonSchemaOptions, zodToJsonSchema } from './json-schema.js';

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
export function defineCommand<TInput extends ZodType, TOutput>(
	options: ZodCommandOptions<TInput, TOutput>
): ZodCommandDefinition<TInput, TOutput> {
	// Input schemas describe what a caller may send (defaults optional, transforms by their
	// input type); output schemas describe what the handler returns. An advertised schema is not
	// converted: it replaces the generated one on every surface.
	const jsonSchema: JsonSchema =
		options.advertisedInputSchema ?? zodToJsonSchema(options.input, { io: 'input' });
	const outputJsonSchema = options.output
		? zodToJsonSchema(options.output, { io: 'output' })
		: undefined;

	return defineCommandWithSchema({ ...options, jsonSchema, outputJsonSchema });
}

/**
 * Get the field names a caller must provide for a Zod object schema.
 * Fields with `.default()` or `.optional()` are not required.
 */
export function getRequiredFields(schema: $ZodType): string[] {
	const jsonSchema = zodToJsonSchema(schema, { io: 'input' });
	// Handle required - it might be an array or undefined
	return Array.isArray(jsonSchema.required) ? jsonSchema.required : [];
}

/**
 * Check if a Zod schema represents an object type.
 */
export function isObjectSchema(schema: ZodType): schema is ZodObject<ZodRawShape> {
	return schema instanceof $ZodObject;
}
