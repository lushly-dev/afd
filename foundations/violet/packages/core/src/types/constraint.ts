import { z } from 'zod';

/**
 * Constraint Types
 *
 * Define design rules that tokens must comply with.
 */

// =============================================================================
// Constraint Type Enum
// =============================================================================

export const ConstraintTypeSchema = z.enum([
	'enum', // Value must be one of allowed values
	'range', // Numeric value within range
	'pattern', // Value or token ID matches regex pattern
	'scale', // Value is multiple of base
	'contrast', // Color contrast ratio (WCAG)
	'reference', // Value references another token
	'ramp', // Two-stage ramp membership and governed off-ramp exceptions
]);

export type ConstraintType = z.infer<typeof ConstraintTypeSchema>;

// =============================================================================
// Constraint Configs by Type
// =============================================================================

export const EnumConfigSchema = z.object({
	type: z.literal('enum'),
	values: z.array(z.string()).min(1),
});

export type EnumConfig = z.infer<typeof EnumConfigSchema>;

export const RangeConfigSchema = z.object({
	type: z.literal('range'),
	min: z.number().optional(),
	max: z.number().optional(),
});

export type RangeConfig = z.infer<typeof RangeConfigSchema>;

export const PatternConfigSchema = z.object({
	type: z.literal('pattern'),
	pattern: z.string().min(1),
	flags: z.string().optional(),
	/** Validate token value (default: 'value') or token id ('id') */
	target: z.enum(['value', 'id']).optional(),
});

export type PatternConfig = z.infer<typeof PatternConfigSchema>;

export const ScaleConfigSchema = z.object({
	type: z.literal('scale'),
	base: z.number().positive(),
	tolerance: z.number().nonnegative().default(0),
});

export type ScaleConfig = z.infer<typeof ScaleConfigSchema>;

export const ContrastConfigSchema = z.object({
	type: z.literal('contrast'),
	against: z.string().min(1), // Token ID to compare against
	min: z.number().positive().default(4.5), // WCAG AA default
	// Token ID of the opaque surface under a translucent `against` (#1326)
	backdrop: z.string().min(1).optional(),
});

export type ContrastConfig = z.infer<typeof ContrastConfigSchema>;

export const ReferenceConfigSchema = z.object({
	type: z.literal('reference'),
	token: z.string().min(1), // Token that must exist
});

export type ReferenceConfig = z.infer<typeof ReferenceConfigSchema>;

export const RampPairWithSchema = z.object({
	fromSuffix: z.string().min(1),
	toSuffix: z.string().min(1),
	/** Ramp glob for the sibling token, e.g. 'ref.type.*.line' */
	rampTarget: z.string().min(1),
});

export type RampPairWith = z.infer<typeof RampPairWithSchema>;

export const RampWarnUnevenSchema = z.object({
	/** Max ratio between the largest and smallest adjacent step multiplier (must be > 1, e.g. 1.5) */
	maxRatioSpread: z.number(),
	/** Skip numeric sentinel steps above this value (e.g. 1000 skips 9999px pill radius) */
	ignoreAbove: z.number().positive().optional(),
});

export type RampWarnUneven = z.infer<typeof RampWarnUnevenSchema>;

export const RampConfigSchema = z.object({
	type: z.literal('ramp'),
	/** Glob matching allowed Stage 1 ramp tokens, e.g. 'ref.space.*' or 'ref.type.*.size' */
	ramp: z.string(),
	/** Require a non-empty human OperationRecord.reason on off-ramp literals (default: true) */
	requireOffRampReason: z.boolean().default(true),
	/** Warn when >= N semantic tokens in applyTo share the same off-ramp literal (default: 2) */
	repeatThreshold: z.number().int().default(2),
	/** Optional sibling pairing check (e.g. type.*.size paired with type.*.line on the same step) */
	pairWith: RampPairWithSchema.optional(),
	/** Optional progression check across ordered steps matching `ramp` */
	warnUneven: RampWarnUnevenSchema.optional(),
});

export type RampConfig = z.infer<typeof RampConfigSchema>;

// Union of all config types
export const ConstraintConfigSchema = z.discriminatedUnion('type', [
	EnumConfigSchema,
	RangeConfigSchema,
	PatternConfigSchema,
	ScaleConfigSchema,
	ContrastConfigSchema,
	ReferenceConfigSchema,
	RampConfigSchema,
]);

export type ConstraintConfig = z.infer<typeof ConstraintConfigSchema>;

// =============================================================================
// Constraint Severity
// =============================================================================

export const ConstraintSeveritySchema = z.enum(['error', 'warning', 'info']);

export type ConstraintSeverity = z.infer<typeof ConstraintSeveritySchema>;

// =============================================================================
// Constraint Definition
// =============================================================================

export const ConstraintSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string().optional(),
	config: ConstraintConfigSchema,
	severity: ConstraintSeveritySchema.default('error'),
	applyTo: z.string().min(1), // Glob pattern for token IDs (e.g., "color.*")
	enabled: z.boolean().default(true),
	// Why a rule is disabled: a rule left failing on purpose says so (#1327)
	disabledReason: z.string().min(1).max(1000).optional(),
});

export type Constraint = z.infer<typeof ConstraintSchema>;

// =============================================================================
// Constraint with Source (for inherited constraints)
// =============================================================================

export const ConstraintWithSourceSchema = ConstraintSchema.extend({
	source: z.string(), // Node where constraint was defined
});

export type ConstraintWithSource = z.infer<typeof ConstraintWithSourceSchema>;

// =============================================================================
// Constraint Violation
// =============================================================================

export const ConstraintViolationSchema = z.object({
	constraintId: z.string(),
	constraintName: z.string(),
	severity: ConstraintSeveritySchema,
	/** Optional stable sub-check identifier (e.g. 'ramp:unreasoned', 'ramp:repeat') */
	code: z.string().optional(),
	message: z.string(),
	expected: z.string().optional(),
	actual: z.string().optional(),
});

export type ConstraintViolation = z.infer<typeof ConstraintViolationSchema>;

// =============================================================================
// Validation Result for a Single Token
// =============================================================================

export const TokenValidationResultSchema = z.object({
	tokenId: z.string(),
	value: z.unknown(),
	valid: z.boolean(),
	violations: z.array(ConstraintViolationSchema),
});

export type TokenValidationResult = z.infer<typeof TokenValidationResultSchema>;

// =============================================================================
// Validation Summary
// =============================================================================

export const ValidationSummarySchema = z.object({
	totalTokens: z.number(),
	validTokens: z.number(),
	errors: z.number(),
	warnings: z.number(),
	infos: z.number(),
});

export type ValidationSummary = z.infer<typeof ValidationSummarySchema>;
