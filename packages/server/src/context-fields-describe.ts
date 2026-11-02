/**
 * @fileoverview Declared context fields as discovery describes them. Apart from `context-fields.ts`,
 * since this is what needs `toJSONSchema`: a registry validates a field and never converts it, and
 * only `createDirectToolSurface` and the servers list one.
 */

import type { JsonSchema } from '@lushly-dev/afd-core';
import type { ContextField } from './context-fields.js';
import { zodToJsonSchema } from './json-schema.js';

/** A declared field as discovery describes it, with its schema as JSON Schema. */
export interface DescribedContextField {
	name: string;
	meta: string;
	schema: JsonSchema;
	required: boolean;
	journal: boolean;
}

/** The declared fields as `server/discover` and `afd-help` list them. */
export function describeContextFields(fields: readonly ContextField[]): DescribedContextField[] {
	return fields.map((field) => ({
		name: field.name,
		meta: field.meta,
		schema: zodToJsonSchema(field.schema),
		required: field.required === true,
		journal: field.journal === true,
	}));
}
