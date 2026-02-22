/**
 * @fileoverview Types for semantic quality (surface) validation.
 *
 * Cross-command analysis that detects duplicate descriptions, ambiguous naming,
 * overlapping schemas, and prompt injection risks.
 */

import type { JsonSchema } from '@lushly-dev/afd-core';

// ═══════════════════════════════════════════════════════════════════════════════
// CORE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for `validateCommandSurface()`.
 */
export interface SurfaceValidationOptions {
	/** Similarity threshold (0-1) for flagging description pairs. Default: 0.7 */
	similarityThreshold?: number;

	/** Minimum schema overlap ratio (0-1) to flag. Default: 0.8 */
	schemaOverlapThreshold?: number;

	/** Enable prompt injection detection in descriptions. Default: true */
	detectInjection?: boolean;

	/** Enable description quality checks (min length, verb presence). Default: true */
	checkDescriptionQuality?: boolean;

	/** Minimum description length in characters for description-quality rule. Default: 20 */
	minDescriptionLength?: number;

	/** Enable naming convention enforcement. Default: true */
	enforceNaming?: boolean;

	/** Naming pattern to enforce. Default: /^[a-z][a-z0-9]*-[a-z][a-z0-9-]*$/ */
	namingPattern?: RegExp;

	/** Categories to skip during validation */
	skipCategories?: string[];

	/** Treat warnings as errors */
	strict?: boolean;

	/** Suppress specific findings. Rule name or `rule:commandA:commandB` for pair-specific suppression. */
	suppressions?: string[];

	/** Additional injection patterns to check alongside built-in patterns */
	additionalInjectionPatterns?: InjectionPattern[];
}

/**
 * Result of surface validation.
 */
export interface SurfaceValidationResult {
	/** Overall pass/fail */
	valid: boolean;

	/** All findings (including suppressed) */
	findings: SurfaceFinding[];

	/** Summary statistics */
	summary: SurfaceValidationSummary;
}

/**
 * Summary statistics for the validation run.
 */
export interface SurfaceValidationSummary {
	/** Total commands analyzed */
	commandCount: number;

	/** Number of error-level findings */
	errorCount: number;

	/** Number of warning-level findings */
	warningCount: number;

	/** Number of info-level findings */
	infoCount: number;

	/** Number of suppressed findings (not counted in error/warning/info totals) */
	suppressedCount: number;

	/** Rules that were evaluated */
	rulesEvaluated: string[];

	/** Validation duration in ms */
	durationMs: number;
}

/**
 * A single finding from surface validation.
 */
export interface SurfaceFinding {
	/** Rule identifier */
	rule: SurfaceRule;

	/** Severity level */
	severity: 'error' | 'warning' | 'info';

	/** Human-readable description of the finding */
	message: string;

	/** Commands involved in this finding */
	commands: string[];

	/** Actionable fix suggestion */
	suggestion: string;

	/** Supporting evidence (similarity score, overlapping fields, etc.) */
	evidence?: Record<string, unknown>;

	/** Whether this finding was suppressed via the `suppressions` option */
	suppressed?: boolean;
}

/**
 * Rule identifiers for surface validation.
 */
export type SurfaceRule =
	| 'similar-descriptions'
	| 'schema-overlap'
	| 'naming-convention'
	| 'naming-collision'
	| 'missing-category'
	| 'description-injection'
	| 'description-quality'
	| 'orphaned-category';

// ═══════════════════════════════════════════════════════════════════════════════
// INJECTION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A regex-based pattern for detecting prompt injection in descriptions.
 */
export interface InjectionPattern {
	/** Pattern identifier */
	id: string;

	/** Regex to match against descriptions */
	pattern: RegExp;

	/** Human-readable explanation */
	description: string;

	/** Example of flagged text */
	example: string;
}

/**
 * A match from injection pattern scanning.
 */
export interface InjectionMatch {
	/** Pattern identifier that matched */
	patternId: string;

	/** The text that matched */
	matchedText: string;

	/** Human-readable description of the pattern */
	description: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMILARITY TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for cosine similarity computation.
 */
export interface SimilarityOptions {
	/** Remove common English stop words before comparison. Default: true */
	removeStopWords?: boolean;

	/** Perform case-insensitive comparison by lowercasing tokens. Default: true */
	caseInsensitive?: boolean;

	/** Additional stop words to exclude */
	additionalStopWords?: string[];
}

/**
 * Pairwise similarity matrix for a command set.
 */
export interface SimilarityMatrix {
	/** Pairs sorted by descending similarity */
	pairs: SimilarityPair[];

	/** Get similarity between two specific commands */
	get(commandA: string, commandB: string): number;
}

/**
 * A single pair with their similarity score.
 */
export interface SimilarityPair {
	commandA: string;
	commandB: string;
	score: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA OVERLAP TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of comparing two command input schemas.
 */
export interface SchemaOverlapResult {
	/** Commands being compared */
	commandA: string;
	commandB: string;

	/** Fields present in both schemas */
	sharedFields: string[];

	/** Fields unique to command A */
	uniqueToA: string[];

	/** Fields unique to command B */
	uniqueToB: string[];

	/** Overlap ratio: sharedFields.length / union(allFields).length */
	overlapRatio: number;

	/** Whether the shared fields have compatible types */
	typesCompatible: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DESCRIPTION QUALITY TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for description quality checking.
 */
export interface DescriptionQualityOptions {
	/** Minimum description length in characters. Default: 20 */
	minLength?: number;

	/** Additional verbs to accept beyond the built-in list */
	additionalVerbs?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL: NORMALIZED COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalized command representation used internally by surface validation.
 * Both `ZodCommandDefinition[]` and `CommandDefinition[]` are mapped to this.
 */
export interface SurfaceCommand {
	name: string;
	description: string;
	category?: string;
	jsonSchema?: JsonSchema;
}
