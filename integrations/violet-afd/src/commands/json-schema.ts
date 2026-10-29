/**
 * @module commands/json-schema
 * The one Zod-to-JSON-Schema conversion for command schemas. MCP tool
 * definitions, `violet call --schema`, `violet commands --json` and
 * `docs.generate` all use it, so they always describe a command the same way.
 */

import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export type JsonSchema = Record<string, unknown>;

/** Convert a Zod schema to an inline (no `$ref`) draft-07 JSON Schema. */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
	return zodToJsonSchema(schema, {
		target: 'jsonSchema7',
		$refStrategy: 'none',
	}) as JsonSchema;
}
