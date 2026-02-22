/**
 * @fileoverview Surface validation — cross-command semantic quality analysis.
 *
 * Detects duplicate descriptions, ambiguous naming, overlapping schemas,
 * and prompt injection risks across a command set.
 */

// Injection detection
export { checkInjection, INJECTION_PATTERNS } from './injection.js';
// Rules (for direct use / testing)
export {
	checkCircularPrerequisites,
	checkDescriptionInjection,
	checkDescriptionQuality,
	checkMissingCategory,
	checkNamingCollision,
	checkNamingConvention,
	checkOrphanedCategory,
	checkSchemaComplexity,
	checkSchemaOverlap,
	checkSimilarDescriptions,
	checkUnresolvedPrerequisites,
	DESCRIPTION_VERBS,
} from './rules.js';

// Schema complexity
export { computeComplexity } from './schema-complexity.js';
// Schema overlap
export { commandParametersToJsonSchema, compareSchemas } from './schema-overlap.js';
// Similarity engine
export { buildSimilarityMatrix, cosineSimilarity } from './similarity.js';
// Types
export type {
	ComplexityBreakdown,
	ComplexityResult,
	DescriptionQualityOptions,
	InjectionMatch,
	InjectionPattern,
	SchemaOverlapResult,
	SimilarityMatrix,
	SimilarityOptions,
	SimilarityPair,
	SurfaceCommand,
	SurfaceFinding,
	SurfaceRule,
	SurfaceValidationOptions,
	SurfaceValidationResult,
	SurfaceValidationSummary,
} from './types.js';
// Main validator
export { validateCommandSurface } from './validate.js';
