/**
 * @fileoverview Zod schema to JSON Schema. Its own module, since `toJSONSchema` is half of what a
 * browser bundle can save: only `defineCommand` and discovery reach it.
 */

import type { JsonSchema } from '@lushly-dev/afd-core';
import { type $ZodType, toJSONSchema } from 'zod/v4/core';

/**
 * Options for {@link zodToJsonSchema}.
 */
export interface ZodToJsonSchemaOptions {
	/**
	 * Which side of the schema to describe.
	 *
	 * - `'input'` (default): what a caller may send. Fields with `.default()` are
	 *   optional, and `.transform()`/`.pipe()` are described by their input type.
	 *   Use this for command inputs and MCP tool `inputSchema`s.
	 * - `'output'`: what parsing produces. Defaulted fields are required, and a
	 *   `.transform()` cannot be represented (Zod throws). Use this for output schemas.
	 */
	io?: 'input' | 'output';
}

/**
 * Convert a Zod schema to JSON Schema (draft-7).
 *
 * @param schema - Zod schema to convert
 * @param options - Conversion options; `io` defaults to `'input'`
 * @returns JSON Schema representation
 */
export function zodToJsonSchema(
	schema: $ZodType,
	options: ZodToJsonSchemaOptions = {}
): JsonSchema {
	const result = toJSONSchema(schema, { target: 'draft-7', io: options.io ?? 'input' });

	if (typeof result === 'object' && result !== null) {
		const { $schema, ...rest } = result as Record<string, unknown>;
		const jsonSchema = rest as unknown as JsonSchema;
		if (!jsonSchema.type) {
			return { type: 'object', ...rest } as JsonSchema;
		}
		return jsonSchema;
	}

	return { type: 'object' } as JsonSchema;
}
