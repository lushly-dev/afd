/**
 * @fileoverview Tool input validation for the testing MCP tools
 *
 * Checks tool arguments against the subset of JSON Schema the tool
 * definitions use: `type` (string, number, integer, boolean, array),
 * `items`, `enum`, `minimum`, `maximum`, `required` and
 * `additionalProperties: false`.
 */

import type { McpTool } from './tool-schemas.js';

interface PropertySchema {
	type?: string;
	enum?: unknown[];
	items?: unknown;
	minimum?: number;
	maximum?: number;
}

function isPropertySchema(value: unknown): value is PropertySchema {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeProblem(value: unknown, type: string | undefined): string | undefined {
	switch (type) {
		case 'string':
			return typeof value === 'string' ? undefined : 'must be a string';
		case 'boolean':
			return typeof value === 'boolean' ? undefined : 'must be true or false';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value) ? undefined : 'must be a number';
		case 'integer':
			return Number.isInteger(value) ? undefined : 'must be an integer';
		case 'array':
			return Array.isArray(value) ? undefined : 'must be an array';
		default:
			return undefined;
	}
}

function checkValue(value: unknown, schema: PropertySchema, path: string, errors: string[]): void {
	const problem = typeProblem(value, schema.type);
	if (problem) {
		errors.push(`'${path}' ${problem}`);
		return;
	}
	if (schema.enum && !schema.enum.includes(value)) {
		errors.push(
			`'${path}' must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`
		);
	}
	if (typeof value === 'number') {
		if (schema.minimum !== undefined && value < schema.minimum) {
			errors.push(`'${path}' must be at least ${schema.minimum}`);
		}
		if (schema.maximum !== undefined && value > schema.maximum) {
			errors.push(`'${path}' must be at most ${schema.maximum}`);
		}
	}
	if (Array.isArray(value) && isPropertySchema(schema.items)) {
		const items = schema.items;
		value.forEach((item, index) => {
			checkValue(item, items, `${path}[${index}]`, errors);
		});
	}
}

/**
 * Validate tool arguments against a tool's input schema.
 *
 * `undefined` and `null` arguments are treated as `{}`.
 */
export function validateToolInput(
	schema: McpTool['inputSchema'],
	input: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] } {
	const args = input ?? {};
	if (typeof args !== 'object' || Array.isArray(args)) {
		return { ok: false, errors: ['Input must be an object'] };
	}

	const value = args as Record<string, unknown>;
	const errors: string[] = [];

	for (const field of schema.required ?? []) {
		if (value[field] === undefined) {
			errors.push(`Missing required field '${field}'`);
		}
	}

	for (const [key, fieldValue] of Object.entries(value)) {
		const property = schema.properties[key];
		if (!isPropertySchema(property)) {
			if (schema.additionalProperties === false) {
				errors.push(`Unknown field '${key}'`);
			}
			continue;
		}
		if (fieldValue !== undefined) {
			checkValue(fieldValue, property, key, errors);
		}
	}

	return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
