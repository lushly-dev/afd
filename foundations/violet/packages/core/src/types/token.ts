import { z } from 'zod';

/**
 * Token categories
 */
export const TokenCategorySchema = z.enum([
	'color',
	'spacing',
	'typography',
	'shadow',
	'motion',
	'radius',
	'opacity',
	'z-index',
	'custom',
]);

export type TokenCategory = z.infer<typeof TokenCategorySchema>;

/**
 * Token tiers (following Design Tokens W3C patterns)
 */
export const TokenTierSchema = z.enum(['global', 'semantic', 'component']);

export type TokenTier = z.infer<typeof TokenTierSchema>;

/**
 * Token status
 */
export const TokenStatusSchema = z.enum(['stable', 'beta', 'deprecated']);

export type TokenStatus = z.infer<typeof TokenStatusSchema>;

/**
 * Token value - can be a literal or a reference
 */
export const TokenValueSchema = z.union([
	// Simple literal values
	z.string(),
	z.number(),

	// Reference to another token
	z
		.object({
			ref: z.string(),
			transform: z.string().optional(), // e.g., 'multiply(1.5)', 'add(8px)'
		})
		.strict(),

	// Platform-specific values (at least one platform must be specified)
	z
		.object({
			web: z.union([z.string(), z.number()]).optional(),
			ios: z.union([z.string(), z.number()]).optional(),
			android: z.union([z.string(), z.number()]).optional(),
		})
		.strict()
		.refine((obj) => obj.web !== undefined || obj.ios !== undefined || obj.android !== undefined, {
			message: 'At least one platform value must be specified',
		}),

	// Composite value (for shadows, typography, etc.)
	z.record(z.string(), z.any()),
]);

export type TokenValue = z.infer<typeof TokenValueSchema>;

/**
 * Token constraint for validation
 */
export const TokenConstraintSchema = z.object({
	type: z.enum(['color', 'dimension', 'ratio', 'enum']),

	// Color constraints
	contrastAgainst: z.string().optional(),
	minContrast: z.number().optional(),
	wcagLevel: z.enum(['AA', 'AAA']).optional(),

	// Dimension constraints
	min: z.number().optional(),
	max: z.number().optional(),
	unit: z.string().optional(),
	multipleOf: z.number().optional(),

	// Enum constraints
	allowedValues: z.array(z.string()).optional(),
});

export type TokenConstraint = z.infer<typeof TokenConstraintSchema>;

/**
 * Token metadata
 */
export const TokenMetadataSchema = z.object({
	description: z.string().optional(),
	/** DTCG `$type` (e.g. 'color', 'dimension'), kept as imported */
	type: z.string().optional(),
	category: TokenCategorySchema.default('custom'),
	tier: TokenTierSchema.default('semantic'),
	status: TokenStatusSchema.default('stable'),
	deprecatedBy: z.string().optional(),
	since: z.string().optional(),
	owner: z.string().optional(),
	platforms: z.array(z.string()).default([]),
	cssProperty: z.string().optional(),
	figmaVariable: z.string().optional(),
	constraint: TokenConstraintSchema.optional(),
	tags: z.array(z.string()).default([]),
});

export type TokenMetadata = z.infer<typeof TokenMetadataSchema>;

/**
 * A token definition (stored in operations)
 */
export const TokenDefinitionSchema = z.object({
	id: z.string().min(1),
	value: TokenValueSchema,
	metadata: TokenMetadataSchema.optional(),
});

export type TokenDefinition = z.infer<typeof TokenDefinitionSchema>;

/**
 * Why a token's reference could not be followed during resolution
 */
export interface TokenReferenceError {
	code: 'TOKEN_REFERENCE_NOT_FOUND' | 'CIRCULAR_REFERENCE' | 'NOT_IMPLEMENTED';
	message: string;
	/** Reference chain from this token to the failure */
	path: string[];
}

/**
 * Resolved token (after inheritance resolution)
 */
export interface ResolvedToken {
	id: string;
	value: TokenValue;
	resolvedValue: string | number; // Final computed value (references followed)
	/**
	 * `value` with every reference (`{ ref }` or a DTCG `"{a.b}"` alias, including
	 * ones nested in composite values) replaced by the referenced token's value in
	 * this node. Equals `value` when the token has no references.
	 */
	finalValue?: TokenValue;
	/** Token ID this token aliases directly, when its whole value is a single reference */
	aliasOf?: string;
	/** Set when a reference could not be followed; `resolvedValue` then falls back to the literal */
	referenceError?: TokenReferenceError;
	metadata: TokenMetadata;

	// Lineage information
	resolvedAt: string; // Node where value was set
	inheritanceChain: string[]; // Path from root to current node
	operationHistory?: Array<{
		nodeId: string;
		operation: string;
		value?: TokenValue;
		/** Where the value came from: copy source, included node, or reset target */
		fromNode?: string;
		/** Source token id, when a copy renamed it */
		fromToken?: string;
	}>;
}

/**
 * Token lineage query result
 */
export interface TokenLineage {
	tokenId: string;
	currentValue: TokenValue;
	resolvedAt: string;
	chain: Array<{
		nodeId: string;
		operation: 'add' | 'override' | 'inherit' | 'reset' | 'copy' | 'include';
		value?: TokenValue;
		/** Where the value came from: copy source, included node, or reset target */
		fromNode?: string;
		/** Owner of `fromNode`, when it has one */
		fromOwner?: string;
		/** Source token id, when a copy renamed it */
		fromToken?: string;
		/** True when later changes at `fromNode` show up here (the value is read live) */
		tracksSource?: boolean;
		/** True when a later step on the same node replaced this value */
		superseded?: boolean;
	}>;
}
