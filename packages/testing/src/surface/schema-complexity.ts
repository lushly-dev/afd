/**
 * @fileoverview Schema complexity scoring for command input schemas.
 *
 * Scores how complex a JSON Schema is for an agent to satisfy correctly.
 * Higher scores indicate schemas that are more likely to cause agent input errors.
 */

import type { JsonSchema } from '@lushly-dev/afd-core';
import type { ComplexityBreakdown, ComplexityResult } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extends core `JsonSchema` with `type` optional (for composition-only nodes
 * like bare `oneOf`/`anyOf` wrappers) and recursive self-references.
 */
interface JsonSchemaNode
	extends Omit<JsonSchema, 'type' | 'required' | 'properties' | 'items' | 'oneOf' | 'anyOf' | 'allOf' | 'not'> {
	type?: string;
	required?: string[];
	properties?: Record<string, JsonSchemaNode>;
	items?: JsonSchemaNode;
	oneOf?: JsonSchemaNode[];
	anyOf?: JsonSchemaNode[];
	allOf?: JsonSchemaNode[];
	not?: JsonSchemaNode;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect `anyOf: [T, { type: 'null' }]` patterns from `z.nullable()`.
 * These should not count as unions — they're just nullable wrappers.
 */
function isNullableWrapper(variants: JsonSchemaNode[]): boolean {
	if (variants.length !== 2) return false;
	const hasNull = variants.some(
		(v) => v.type === 'null' || (typeof v === 'object' && 'type' in v && v.type === 'null')
	);
	return hasNull;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WALKER STATE
// ═══════════════════════════════════════════════════════════════════════════════

interface WalkerState {
	fieldNames: Set<string>;
	maxDepth: number;
	unions: number;
	intersections: number;
	enums: number;
	patterns: number;
	bounds: number;
	optionalCount: number;
	totalFieldCount: number;
}

function createState(): WalkerState {
	return {
		fieldNames: new Set(),
		maxDepth: 0,
		unions: 0,
		intersections: 0,
		enums: 0,
		patterns: 0,
		bounds: 0,
		optionalCount: 0,
		totalFieldCount: 0,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECURSIVE WALKER
// ═══════════════════════════════════════════════════════════════════════════════

function walk(node: JsonSchemaNode, state: WalkerState, depth: number): void {
	// Union: oneOf / anyOf
	if (node.oneOf) {
		if (!isNullableWrapper(node.oneOf)) {
			state.unions++;
		}
		for (const variant of node.oneOf) {
			walk(variant, state, depth);
		}
	}

	if (node.anyOf) {
		if (!isNullableWrapper(node.anyOf)) {
			state.unions++;
		} else {
			// Nullable wrapper — walk the non-null variant only
			for (const variant of node.anyOf) {
				if (variant.type !== 'null') {
					walk(variant, state, depth);
				}
			}
			return;
		}
		for (const variant of node.anyOf) {
			walk(variant, state, depth);
		}
	}

	// Intersection: allOf
	if (node.allOf) {
		state.intersections++;
		for (const variant of node.allOf) {
			walk(variant, state, depth);
		}
	}

	// Object
	if (node.type === 'object' && node.properties) {
		const objectDepth = depth + 1;
		if (objectDepth > state.maxDepth) {
			state.maxDepth = objectDepth;
		}

		const requiredSet = new Set(node.required ?? []);
		for (const [name, propSchema] of Object.entries(node.properties)) {
			state.fieldNames.add(name);
			state.totalFieldCount++;
			if (!requiredSet.has(name)) {
				state.optionalCount++;
			}
			walk(propSchema, state, objectDepth);
		}
		return;
	}

	// Array: transparent wrapper for depth, but recurse into items
	if (node.type === 'array' && node.items) {
		walk(node.items, state, depth);
	}

	// Constraints
	if (node.enum) {
		state.enums++;
	}
	// `const` from z.literal() is NOT counted as enum — it's a fixed value, not an agent decision point

	if (node.pattern) {
		state.patterns++;
	}
	if (node.format) {
		state.patterns++;
	}

	if (node.minimum !== undefined) state.bounds++;
	if (node.maximum !== undefined) state.bounds++;
	if (node.exclusiveMinimum !== undefined) state.bounds++;
	if (node.exclusiveMaximum !== undefined) state.bounds++;
	if (node.minLength !== undefined) state.bounds++;
	if (node.maxLength !== undefined) state.bounds++;
	if (node.minItems !== undefined) state.bounds++;
	if (node.maxItems !== undefined) state.bounds++;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING
// ═══════════════════════════════════════════════════════════════════════════════

/** Weight multipliers for each complexity dimension */
const WEIGHTS = {
	fields: 1,
	depth: 3,
	unions: 5,
	intersections: 2,
	enums: 1,
	patterns: 2,
	bounds: 1,
} as const;

function computeScore(breakdown: ComplexityBreakdown): number {
	return (
		breakdown.fields * WEIGHTS.fields +
		breakdown.depth * WEIGHTS.depth +
		breakdown.unions * WEIGHTS.unions +
		breakdown.intersections * WEIGHTS.intersections +
		breakdown.enums * WEIGHTS.enums +
		breakdown.patterns * WEIGHTS.patterns +
		breakdown.bounds * WEIGHTS.bounds +
		breakdown.optionalRatio
	);
}

function scoreTier(score: number): ComplexityResult['tier'] {
	if (score <= 5) return 'low';
	if (score <= 12) return 'medium';
	if (score <= 20) return 'high';
	return 'critical';
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the complexity score for a JSON Schema.
 *
 * Accepts `Record<string, unknown>` and casts internally to handle
 * `oneOf`/`anyOf`/`allOf` fields that exist at runtime but aren't
 * in the core `JsonSchema` type.
 */
export function computeComplexity(schema: Record<string, unknown>): ComplexityResult {
	const state = createState();
	walk(schema as unknown as JsonSchemaNode, state, 0);

	const optionalRatio =
		state.totalFieldCount > 0 ? Math.floor((state.optionalCount / state.totalFieldCount) * 4) : 0;

	const breakdown: ComplexityBreakdown = {
		fields: state.fieldNames.size,
		depth: state.maxDepth,
		unions: state.unions,
		intersections: state.intersections,
		enums: state.enums,
		patterns: state.patterns,
		bounds: state.bounds,
		optionalRatio,
	};

	const score = computeScore(breakdown);

	return {
		score,
		tier: scoreTier(score),
		breakdown,
	};
}
