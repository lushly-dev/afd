// afd-override: max-lines=1000 — canonical shared pipeline types and resolution helpers
/** Pipeline types for chaining AFD commands. */

import type { CommandError } from './errors.js';
import type { Alternative, Source, Warning } from './metadata.js';
import type { ResultMetadata } from './result.js';
import type { StreamChunk } from './streaming.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE REQUEST TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Request to execute a pipeline of chained commands. */
export interface PipelineRequest {
	/**
	 * Unique identifier for the pipeline execution.
	 * Auto-generated if not provided.
	 */
	id?: string;

	/**
	 * Ordered list of pipeline steps to execute, one after another.
	 */
	steps: PipelineStep[];

	/**
	 * Pipeline-level options.
	 */
	options?: PipelineOptions;

	/**
	 * Input for the whole pipeline, available to steps as `$input` and `$input.<path>`.
	 *
	 * Any JSON value, nested at most 64 levels deep; request preflight rejects anything else
	 * before a step runs. When omitted, `$input` references are unresolved (absent).
	 *
	 * **Behavior change:** `$input` used to resolve to the host's execution context (for
	 * `DirectClient.pipe`, the caller's whole call context, including trace IDs and any auth or
	 * custom values). It now resolves only to this field; the execution context is never
	 * visible to pipeline references.
	 */
	input?: unknown;
}

/** A single step in a pipeline. */
export interface PipelineStep {
	/**
	 * Command name to execute.
	 */
	command: string;

	/**
	 * Input for this step.
	 *
	 * A string value is a reference when the whole string is one of these forms, each
	 * optionally followed by `.<path>` (for example `$prev.user.name` or `$prev.items[0]`):
	 * - `$prev` - Output of the last successful step
	 * - `$first` - Output of the first step
	 * - `$steps[n]` - Output of the step at index n
	 * - `$steps.alias` - Output of the step with matching `as` alias
	 * - `$input` - The pipeline request's own `input` field
	 *
	 * Other strings, such as `$9.99` or `$HOME`, are literals; start a string with `$$` to send
	 * a literal that looks like a reference (`$$prev` becomes `$prev`). An unresolved reference
	 * is omitted as an object property and becomes `null` in an array. Nesting deeper than 64
	 * levels is rejected. See `spec/pipeline-variables.md`.
	 */
	input?: Record<string, unknown>;

	/**
	 * Optional alias for referencing this step's output.
	 *
	 * Other steps can reference this step using `$steps.alias`.
	 */
	as?: string;

	/**
	 * Condition for running this step.
	 *
	 * If the condition evaluates to false, the step is skipped.
	 */
	when?: PipelineCondition;

	/**
	 * Reserved for streaming a step's output. Not implemented: `executePipeline()` rejects a
	 * request with `stream: true` with an `UNSUPPORTED_OPTION` failure on that step before
	 * any command runs, the way it rejects `options.parallel`. `false` is accepted and has no
	 * effect.
	 *
	 * @deprecated Not implemented, and no chunk is ever emitted. To stream one command, use
	 * the server's `/stream` endpoint or `executeStream()`.
	 */
	stream?: boolean;
}

/**
 * Options for pipeline execution.
 */
export interface PipelineOptions {
	/**
	 * Continue on failure or stop immediately.
	 *
	 * - `false` (default): Pipeline stops on first failure
	 * - `true`: Continue executing, collect all errors
	 */
	continueOnFailure?: boolean;

	/**
	 * Timeout for entire pipeline in milliseconds.
	 * Cancellation is cooperative: handlers that ignore the abort signal may
	 * continue running and may still produce side effects after timeout.
	 */
	timeoutMs?: number;

	/**
	 * Reserved for dependency-aware parallel execution. Currently rejected with
	 * `UNSUPPORTED_OPTION` when true.
	 */
	parallel?: boolean;

	/**
	 * Reserved for progress chunks from streaming steps. Not implemented: it is accepted but
	 * never called, because steps do not stream (see {@link PipelineStep.stream}).
	 *
	 * @deprecated Not implemented; it is never called.
	 * @param chunk - The stream chunk emitted
	 * @param stepIndex - Index of the step emitting the chunk
	 */
	onProgress?: (chunk: StreamChunk, stepIndex: number) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE CONDITION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Conditional expression for existence, comparison, and logical checks. */
export type PipelineCondition =
	| PipelineConditionExists
	| PipelineConditionEq
	| PipelineConditionNe
	| PipelineConditionGt
	| PipelineConditionGte
	| PipelineConditionLt
	| PipelineConditionLte
	| PipelineConditionAnd
	| PipelineConditionOr
	| PipelineConditionNot;

/**
 * Check if a field exists in the context.
 */
export interface PipelineConditionExists {
	/** Variable reference to check for existence */
	$exists: string;
}

/**
 * Check if a field equals a value.
 */
export interface PipelineConditionEq {
	/** [variable reference, expected value] */
	$eq: [string, unknown];
}

/**
 * Check if a field does not equal a value.
 */
export interface PipelineConditionNe {
	/** [variable reference, value to not equal] */
	$ne: [string, unknown];
}

/**
 * Check if a field is greater than a value.
 */
export interface PipelineConditionGt {
	/** [variable reference, value to compare against] */
	$gt: [string, number];
}

/**
 * Check if a field is greater than or equal to a value.
 */
export interface PipelineConditionGte {
	/** [variable reference, value to compare against] */
	$gte: [string, number];
}

/**
 * Check if a field is less than a value.
 */
export interface PipelineConditionLt {
	/** [variable reference, value to compare against] */
	$lt: [string, number];
}

/**
 * Check if a field is less than or equal to a value.
 */
export interface PipelineConditionLte {
	/** [variable reference, value to compare against] */
	$lte: [string, number];
}

/**
 * Logical AND - all conditions must be true.
 */
export interface PipelineConditionAnd {
	/** Array of conditions that must all be true */
	$and: PipelineCondition[];
}

/**
 * Logical OR - any condition must be true.
 */
export interface PipelineConditionOr {
	/** Array of conditions where at least one must be true */
	$or: PipelineCondition[];
}

/**
 * Logical NOT - negates a condition.
 */
export interface PipelineConditionNot {
	/** Condition to negate */
	$not: PipelineCondition;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of executing a pipeline.
 *
 * @template T - Type of the final output data
 *
 * @example
 * ```typescript
 * const result: PipelineResult<Order[]> = {
 *   data: [{ id: 1, total: 100 }],
 *   metadata: {
 *     confidence: 0.87,
 *     completedSteps: 3,
 *     totalSteps: 3,
 *     executionTimeMs: 150
 *   },
 *   steps: [...]
 * };
 * ```
 */
export interface PipelineResult<T = unknown> {
	/**
	 * Final output (last successful step's data).
	 */
	data: T;

	/**
	 * Aggregated metadata from all steps.
	 */
	metadata: PipelineMetadata;

	/**
	 * Results from each step.
	 */
	steps: StepResult[];
}

/**
 * Aggregated metadata from pipeline execution.
 *
 * Combines trust signals from all steps with pipeline-specific fields.
 */
export interface PipelineMetadata extends ResultMetadata {
	/**
	 * Minimum confidence across all steps (weakest link principle).
	 *
	 * The pipeline is only as trustworthy as its least confident step.
	 */
	confidence: number;

	/**
	 * Per-step confidence breakdown.
	 */
	confidenceBreakdown: StepConfidence[];

	/**
	 * Aggregated reasoning from all steps.
	 */
	reasoning: StepReasoning[];

	/**
	 * Warnings from ALL steps, tagged with step index.
	 */
	warnings: PipelineWarning[];

	/**
	 * Sources from ALL steps.
	 */
	sources: PipelineSource[];

	/**
	 * Alternatives from ANY step that suggested them.
	 */
	alternatives: PipelineAlternative[];

	/**
	 * Total execution time (sum of all steps).
	 */
	executionTimeMs: number;

	/**
	 * Number of steps completed successfully.
	 */
	completedSteps: number;

	/**
	 * Total number of steps in the pipeline.
	 */
	totalSteps: number;
}

/**
 * Confidence information for a single step.
 */
export interface StepConfidence {
	/**
	 * Step index (0-based).
	 */
	step: number;

	/**
	 * Step alias if provided.
	 */
	alias?: string;

	/**
	 * Command that was executed.
	 */
	command: string;

	/**
	 * Confidence score for this step (0-1).
	 */
	confidence: number;

	/**
	 * Explanation of why this confidence level.
	 */
	reasoning?: string;
}

/**
 * Reasoning from a single step.
 */
export interface StepReasoning {
	/**
	 * Which step provided this reasoning.
	 */
	stepIndex: number;

	/**
	 * Command that was executed.
	 */
	command: string;

	/**
	 * Explanation of WHY this step made its decisions.
	 */
	reasoning: string;
}

/**
 * Warning from a pipeline step.
 */
export interface PipelineWarning extends Warning {
	/**
	 * Which step generated this warning.
	 */
	stepIndex: number;

	/**
	 * Step alias if provided.
	 */
	stepAlias?: string;
}

/**
 * Source used by a pipeline step.
 */
export interface PipelineSource extends Source {
	/**
	 * Which step used this source.
	 */
	stepIndex: number;
}

/**
 * Alternative suggested by a pipeline step.
 */
export interface PipelineAlternative extends Alternative<unknown> {
	/**
	 * Which step suggested this alternative.
	 */
	stepIndex: number;
}

/**
 * Result of a single pipeline step.
 */
export interface StepResult {
	/**
	 * Step index (0-based).
	 */
	index: number;

	/**
	 * Step alias if provided.
	 */
	alias?: string;

	/**
	 * Command that was executed.
	 */
	command: string;

	/**
	 * Step status.
	 */
	status: StepStatus;

	/**
	 * Step output (if successful).
	 */
	data?: unknown;

	/**
	 * Step error (if failed).
	 *
	 * Includes suggestion following AFD error patterns.
	 */
	error?: CommandError;

	/**
	 * Step execution time in milliseconds.
	 */
	executionTimeMs: number;

	/**
	 * Full step metadata (confidence, reasoning, sources, etc.).
	 */
	metadata?: ResultMetadata;
}

/**
 * Possible statuses for a pipeline step.
 */
export type StepStatus = 'success' | 'failure' | 'skipped';

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE CONTEXT (Internal)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context available during pipeline execution.
 *
 * Used for variable resolution.
 */
export interface PipelineContext {
	/**
	 * The pipeline request's `input` field, which `$input` resolves to.
	 *
	 * Never the host's execution context. Widened from `Record<string, unknown>` because the
	 * request `input` may be any JSON value.
	 */
	pipelineInput?: unknown;

	/**
	 * Result of the previous step.
	 */
	previousResult?: StepResult;

	/**
	 * All completed step results.
	 */
	steps: StepResult[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type guard to check if a value is a PipelineRequest.
 */
export { isPipelineRequest, isPipelineStep } from './request-validation.js';

/**
 * Type guard to check if a value is a PipelineResult.
 */
export function isPipelineResult(value: unknown): value is PipelineResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		'data' in value &&
		'metadata' in value &&
		'steps' in value &&
		Array.isArray((value as PipelineResult).steps)
	);
}

/**
 * Type guard to check if a value is a PipelineCondition.
 */
export function isPipelineCondition(value: unknown): value is PipelineCondition {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const keys = Object.keys(value);
	if (keys.length !== 1) {
		return false;
	}

	const key = keys[0] as string;
	return ['$exists', '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$and', '$or', '$not'].includes(
		key
	);
}

/**
 * Type guard for $exists condition.
 */
export function isExistsCondition(
	condition: PipelineCondition
): condition is PipelineConditionExists {
	return '$exists' in condition;
}

/**
 * Type guard for $eq condition.
 */
export function isEqCondition(condition: PipelineCondition): condition is PipelineConditionEq {
	return '$eq' in condition;
}

/**
 * Type guard for $ne condition.
 */
export function isNeCondition(condition: PipelineCondition): condition is PipelineConditionNe {
	return '$ne' in condition;
}

/**
 * Type guard for $gt condition.
 */
export function isGtCondition(condition: PipelineCondition): condition is PipelineConditionGt {
	return '$gt' in condition;
}

/**
 * Type guard for $gte condition.
 */
export function isGteCondition(condition: PipelineCondition): condition is PipelineConditionGte {
	return '$gte' in condition;
}

/**
 * Type guard for $lt condition.
 */
export function isLtCondition(condition: PipelineCondition): condition is PipelineConditionLt {
	return '$lt' in condition;
}

/**
 * Type guard for $lte condition.
 */
export function isLteCondition(condition: PipelineCondition): condition is PipelineConditionLte {
	return '$lte' in condition;
}

/**
 * Type guard for $and condition.
 */
export function isAndCondition(condition: PipelineCondition): condition is PipelineConditionAnd {
	return '$and' in condition;
}

/**
 * Type guard for $or condition.
 */
export function isOrCondition(condition: PipelineCondition): condition is PipelineConditionOr {
	return '$or' in condition;
}

/**
 * Type guard for $not condition.
 */
export function isNotCondition(condition: PipelineCondition): condition is PipelineConditionNot {
	return '$not' in condition;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a PipelineRequest from an array of steps.
 *
 * @param steps - Pipeline steps
 * @param options - Optional pipeline options
 * @returns A PipelineRequest object
 */
export function createPipeline(steps: PipelineStep[], options?: PipelineOptions): PipelineRequest {
	return {
		steps,
		...(options && { options }),
	};
}

/**
 * Calculate aggregated confidence from step results.
 *
 * Uses the "weakest link" principle - pipeline confidence is the minimum
 * of all step confidences.
 *
 * @param steps - Array of step results
 * @returns Minimum confidence across all successful steps (0 if no successful steps)
 */
export function aggregatePipelineConfidence(steps: StepResult[]): number {
	const confidences = steps
		.filter((s) => s.status === 'success')
		.map((s) => (s.metadata?.confidence as number | undefined) ?? 1.0);

	return confidences.length > 0 ? Math.min(...confidences) : 0;
}

/**
 * Aggregate reasoning from all steps.
 *
 * @param steps - Array of step results
 * @returns Array of step reasoning with attribution
 */
export function aggregatePipelineReasoning(steps: StepResult[]): StepReasoning[] {
	return steps
		.filter((s) => s.status === 'success' && s.metadata?.reasoning)
		.map((s) => ({
			stepIndex: s.index,
			command: s.command,
			reasoning: s.metadata?.reasoning as string,
		}));
}

/**
 * Aggregate warnings from all steps.
 *
 * @param steps - Array of step results
 * @returns Array of pipeline warnings with step attribution
 */
export function aggregatePipelineWarnings(steps: StepResult[]): PipelineWarning[] {
	const warnings: PipelineWarning[] = [];

	for (const step of steps) {
		const stepWarnings = step.metadata?.warnings as Warning[] | undefined;
		if (stepWarnings) {
			for (const warning of stepWarnings) {
				warnings.push({
					...warning,
					stepIndex: step.index,
					stepAlias: step.alias,
				});
			}
		}
	}

	return warnings;
}

/**
 * Aggregate sources from all steps.
 *
 * @param steps - Array of step results
 * @returns Array of pipeline sources with step attribution
 */
export function aggregatePipelineSources(steps: StepResult[]): PipelineSource[] {
	const sources: PipelineSource[] = [];

	for (const step of steps) {
		const stepSources = step.metadata?.sources as Source[] | undefined;
		if (stepSources) {
			for (const source of stepSources) {
				sources.push({
					...source,
					stepIndex: step.index,
				});
			}
		}
	}

	return sources;
}

/**
 * Aggregate alternatives from all steps.
 *
 * @param steps - Array of step results
 * @returns Array of pipeline alternatives with step attribution
 */
export function aggregatePipelineAlternatives(steps: StepResult[]): PipelineAlternative[] {
	const alternatives: PipelineAlternative[] = [];

	for (const step of steps) {
		const stepAlternatives = step.metadata?.alternatives as Alternative<unknown>[] | undefined;
		if (stepAlternatives) {
			for (const alt of stepAlternatives) {
				alternatives.push({
					...alt,
					stepIndex: step.index,
				});
			}
		}
	}

	return alternatives;
}

/**
 * Build confidence breakdown from step results.
 *
 * @param steps - Array of step results with original step definitions
 * @param stepDefs - Original step definitions for alias lookup
 * @returns Array of step confidence information
 */
export function buildConfidenceBreakdown(
	steps: StepResult[],
	stepDefs?: PipelineStep[]
): StepConfidence[] {
	return steps
		.filter((s) => s.status === 'success')
		.map((s) => ({
			step: s.index,
			alias: s.alias ?? stepDefs?.[s.index]?.as,
			command: s.command,
			confidence: (s.metadata?.confidence as number | undefined) ?? 1.0,
			reasoning: s.metadata?.reasoning as string | undefined,
		}));
}

// Variable resolution lives in its own module (file-size convention); re-exported here so the
// public API is unchanged. See spec/pipeline-variables.md.
export {
	evaluateCondition,
	getNestedValue,
	resolveVariable,
	resolveVariables,
} from './pipeline-variables.js';
