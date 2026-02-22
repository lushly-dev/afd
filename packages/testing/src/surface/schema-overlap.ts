/**
 * @fileoverview Schema overlap detection for command input schemas.
 *
 * Compares top-level JSON Schema properties between command pairs to detect
 * redundant or highly similar input shapes.
 */

import type { CommandParameter, JsonSchema } from '@lushly-dev/afd-core';
import type { SchemaOverlapResult } from './types.js';

/**
 * Compare two JSON Schemas for top-level field overlap.
 *
 * Only considers top-level properties — deep nesting is not compared.
 */
export function compareSchemas(
	schemaA: JsonSchema,
	schemaB: JsonSchema
): Omit<SchemaOverlapResult, 'commandA' | 'commandB'> {
	const fieldsA = new Set(Object.keys(schemaA.properties ?? {}));
	const fieldsB = new Set(Object.keys(schemaB.properties ?? {}));

	const sharedFields = [...fieldsA].filter((f) => fieldsB.has(f));
	const uniqueToA = [...fieldsA].filter((f) => !fieldsB.has(f));
	const uniqueToB = [...fieldsB].filter((f) => !fieldsA.has(f));

	const unionSize = new Set([...fieldsA, ...fieldsB]).size;
	const overlapRatio = unionSize === 0 ? 0 : sharedFields.length / unionSize;

	const typesCompatible = sharedFields.every((field) => {
		const typeA = (schemaA.properties?.[field] as JsonSchema | undefined)?.type;
		const typeB = (schemaB.properties?.[field] as JsonSchema | undefined)?.type;
		return typeA === typeB;
	});

	return {
		sharedFields,
		uniqueToA,
		uniqueToB,
		overlapRatio,
		typesCompatible,
	};
}

/**
 * Convert `CommandParameter[]` from `@lushly-dev/afd-core` to a flat `JsonSchema`.
 *
 * Used internally when `CommandDefinition[]` is passed to `validateCommandSurface()`.
 */
export function commandParametersToJsonSchema(params: CommandParameter[]): JsonSchema {
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];

	for (const param of params) {
		properties[param.name] = {
			type: param.type,
			description: param.description,
		};
		if (param.required) {
			required.push(param.name);
		}
	}

	return {
		type: 'object',
		properties,
		...(required.length > 0 ? { required } : {}),
	} as JsonSchema;
}
