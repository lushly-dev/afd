/**
 * @module commands/json-schema
 * The one Zod-to-JSON-Schema conversion for command schemas. MCP tool
 * definitions, `violet call --schema`, `violet commands --json` and
 * `docs.generate` all use it, so they always describe a command the same way.
 */

import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

const ANY_VALUE = new Set(['any', 'unknown']);

/**
 * Convert a Zod schema to an inline (no `$ref`) draft-07 JSON Schema of what
 * callers may send: fields with defaults are optional.
 *
 * Two adjustments keep the schemas what zod-to-json-schema produced under Zod 3:
 * - Zod strips unknown keys from an object, and its input-side JSON Schema leaves
 *   such objects open; they are closed (`additionalProperties: false`), so
 *   callers are told not to send keys that would be dropped.
 * - A bare `z.any()` or `z.unknown()` field is not listed as required: Zod 3
 *   treated its key as optional, and JSON drops a key whose value is undefined.
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
	return z.toJSONSchema(schema, {
		target: 'draft-07',
		io: 'input',
		unrepresentable: 'any',
		override: ({ zodSchema, jsonSchema }) => {
			const def = zodSchema._zod.def;
			if (def.type !== 'object') return;
			if (!def.catchall && jsonSchema.additionalProperties === undefined)
				jsonSchema.additionalProperties = false;
			if (!jsonSchema.required) return;
			const required = jsonSchema.required.filter(
				(key) => !ANY_VALUE.has(def.shape[key]?._zod.def.type ?? ''),
			);
			if (required.length > 0) jsonSchema.required = required;
			else delete jsonSchema.required;
		},
	}) as JsonSchema;
}
