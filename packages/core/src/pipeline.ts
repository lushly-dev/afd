/**
 * @fileoverview Pipeline types for chaining AFD commands
 *
 * Pipelines enable declarative composition of commands where the output of one
 * becomes the input of the next. Key features:
 * - Variable resolution ($prev, $first, $steps[n], $steps.alias)
 * - Conditional execution with when clauses
 * - Trust signal propagation (confidence, reasoning, sources)
 * - Error propagation with actionable suggestions
 */

import type { CommandError } from './errors.js';
import type { Alternative, Source, Warning } from './metadata.js';
import type { ResultMetadata } from './result.js';
import type { StreamChunk } from './streaming.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE REQUEST TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Request to execute a pipeline of chained commands.
 *
 * @example
 * ```typescript
 * const request: PipelineRequest = {
 *   id: 'my-pipeline',
 *   steps: [
 *     { command: 'user-get', input: { id: 123 }, as: 'user' },
 *     { command: 'order-list', input: { userId: '$prev.id' } },
 *   ],
 *   options: { timeoutMs: 30000 }
 * };
 * ```
 */
export interface PipelineRequest {
	/**
	 * Unique identifier for the pipeline execution.
	 * Auto-generated if not provided.
	 */
	id?: string;

	/**
	 * Ordered list of pipeline steps to execute.
	 * Steps are executed sequentially unless parallel is enabled.
	 */
	steps: PipelineStep[];

	/**
	 * Pipeline-level options.
	 */
	options?: PipelineOptions;
}

/**
 * A single step in a pipeline.
 *
 * @example
 * ```typescript
 * const step: PipelineStep = {
 *   command: 'order-list',
 *   input: { userId: '$prev.id', status: 'active' },
 *   as: 'orders',
 *   when: { $exists: '$prev.id' }
 * };
 * ```
 */
export interface PipelineStep {
	/**
	 * Command name to execute.
	 */
	command: string;

	/**
	 * Input for this step.
	 *
	 * Can reference outputs from previous steps using variables:
	 * - `$prev` - Output of immediately previous step
	 * - `$prev.field` - Specific field from previous output
	 * - `$first` - Output of first step
	 * - `$steps[n]` - Output of step at index n
	 * - `$steps.alias` - Output of step with matching `as` alias
	 * - `$input` - Original pipeline input
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
	 * Enable streaming for this step.
	 *
	 * When true, the step will emit StreamChunk events through the
	 * pipeline's onProgress callback.
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
	 */
	timeoutMs?: number;

	/**
	 * Execute steps in parallel where dependencies allow.
	 *
	 * Steps that don't reference $prev can potentially run in parallel.
	 */
	parallel?: boolean;

	/**
	 * Callback for streaming progress from steps.
	 *
	 * @param chunk - The stream chunk emitted
	 * @param stepIndex - Index of the step emitting the chunk
	 */
	onProgress?: (chunk: StreamChunk, stepIndex: number) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE CONDITION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Conditional expression for pipeline steps.
 *
 * Supports existence checks, comparisons, and logical combinations.
 *
 * @example
 * ```typescript
 * // Check if field exists
 * const exists: PipelineCondition = { $exists: '$prev.email' };
 *
 * // Check equality
 * const isPremium: PipelineCondition = { $eq: ['$steps.user.tier', 'premium'] };
 *
 * // Numeric comparison
 * const hasItems: PipelineCondition = { $gt: ['$prev.items.length', 0] };
 *
 * // Logical combination
 * const complex: PipelineCondition = {
 *   $and: [
 *     { $exists: '$prev.userId' },
 *     { $eq: ['$steps.user.active', true] }
 *   ]
 * };
 * ```
 */
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
	 * Original pipeline input.
	 */
	pipelineInput?: Record<string, unknown>;

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
export function isPipelineRequest(value: unknown): value is PipelineRequest {
	return (
		typeof value === 'object' &&
		value !== null &&
		'steps' in value &&
		Array.isArray((value as PipelineRequest).steps) &&
		(value as PipelineRequest).steps.every(isPipelineStep)
	);
}

/**
 * Type guard to check if a value is a PipelineStep.
 */
export function isPipelineStep(value: unknown): value is PipelineStep {
	return (
		typeof value === 'object' &&
		value !== null &&
		'command' in value &&
		typeof (value as PipelineStep).command === 'string'
	);
}

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
export function createPipeline(
	steps: PipelineStep[],
	options?: PipelineOptions
): PipelineRequest {
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
			reasoning: s.metadata!.reasoning as string,
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

/**
 * Resolve a single variable reference to its value from pipeline context.
 *
 * Supports the following variable patterns:
 * - `$prev` - Output of immediately previous step
 * - `$prev.field.subfield` - Nested field from previous output
 * - `$first` - Output of first step
 * - `$first.field` - Field from first step output
 * - `$steps[n]` - Output of step at index n
 * - `$steps[n].field` - Field from step at index n
 * - `$steps.alias` - Output of step with matching `as` alias
 * - `$steps.alias.field` - Field from aliased step
 * - `$input` - Original pipeline input
 * - `$input.field` - Field from pipeline input
 *
 * @param ref - Variable reference (e.g., '$prev', '$prev.field', '$steps.alias.field')
 * @param context - Pipeline execution context
 * @returns The resolved value, or undefined if not found
 *
 * @example
 * ```typescript
 * // Simple $prev reference
 * resolveVariable('$prev', context);
 *
 * // Nested field access
 * resolveVariable('$prev.user.name', context);
 *
 * // Step by index
 * resolveVariable('$steps[0].data', context);
 *
 * // Step by alias
 * resolveVariable('$steps.userStep.id', context);
 * ```
 */
export function resolveVariable(ref: string, context: PipelineContext): unknown {
	if (!ref.startsWith('$')) {
		return ref;
	}

	// $prev - previous step's data
	if (ref === '$prev') {
		return context.previousResult?.data;
	}

	// $first - first step's data
	if (ref === '$first') {
		return context.steps[0]?.data;
	}

	// $input - original pipeline input
	if (ref === '$input') {
		return context.pipelineInput;
	}

	// $steps[n] - step at index n
	if (ref.startsWith('$steps[')) {
		const match = ref.match(/^\$steps\[(\d+)\]/);
		if (match && match[1] !== undefined) {
			const index = parseInt(match[1], 10);
			const step = context.steps[index];
			const remaining = ref.slice(match[0].length);
			if (remaining.startsWith('.')) {
				return getNestedValue(step?.data, remaining.slice(1));
			}
			return step?.data;
		}
	}

	// $steps.alias - step with alias
	if (ref.startsWith('$steps.')) {
		const rest = ref.slice(7); // Remove '$steps.'
		const dotIndex = rest.indexOf('.');
		const alias = dotIndex >= 0 ? rest.slice(0, dotIndex) : rest;
		const step = context.steps.find((s) => s.alias === alias);
		if (dotIndex >= 0) {
			return getNestedValue(step?.data, rest.slice(dotIndex + 1));
		}
		return step?.data;
	}

	// $prev.field - field from previous step
	if (ref.startsWith('$prev.')) {
		return getNestedValue(context.previousResult?.data, ref.slice(6));
	}

	// $first.field - field from first step
	if (ref.startsWith('$first.')) {
		return getNestedValue(context.steps[0]?.data, ref.slice(7));
	}

	// $input.field - field from pipeline input
	if (ref.startsWith('$input.')) {
		return getNestedValue(context.pipelineInput, ref.slice(7));
	}

	return undefined;
}

/**
 * Resolve all variable references in an input object.
 *
 * @param input - Input object potentially containing variable references
 * @param context - Pipeline execution context
 * @returns Input object with all variables resolved
 */
export function resolveVariables(
	input: unknown,
	context: PipelineContext
): unknown {
	if (typeof input === 'string' && input.startsWith('$')) {
		return resolveVariable(input, context);
	}

	if (Array.isArray(input)) {
		return input.map((item) => resolveVariables(item, context));
	}

	if (typeof input === 'object' && input !== null) {
		return Object.fromEntries(
			Object.entries(input).map(([key, value]) => [key, resolveVariables(value, context)])
		);
	}

	return input;
}

/**
 * Get a nested value from an object using dot notation.
 *
 * @param obj - The object to traverse
 * @param path - Dot-separated path (e.g., 'user.profile.name')
 * @returns The value at the path, or undefined if not found
 *
 * @example
 * ```typescript
 * getNestedValue({ user: { name: 'Alice' } }, 'user.name'); // => 'Alice'
 * getNestedValue({ items: [1, 2, 3] }, 'items[1]'); // => 2
 * getNestedValue({}, 'missing.path'); // => undefined
 * ```
 */
export function getNestedValue(obj: unknown, path: string): unknown {
	if (obj === null || obj === undefined) {
		return undefined;
	}

	const parts = path.split('.');
	let current: unknown = obj;

	for (const part of parts) {
		if (current === null || current === undefined) {
			return undefined;
		}

		// Handle array index notation (e.g., 'items[0]')
		const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
		if (arrayMatch && arrayMatch[1] !== undefined && arrayMatch[2] !== undefined) {
			const prop = arrayMatch[1];
			const indexStr = arrayMatch[2];
			const arr = (current as Record<string, unknown>)[prop];
			if (!Array.isArray(arr)) {
				return undefined;
			}
			current = arr[parseInt(indexStr, 10)];
		} else {
			current = (current as Record<string, unknown>)[part];
		}
	}

	return current;
}

/**
 * Evaluate a pipeline condition against the current context.
 *
 * @param condition - The condition to evaluate
 * @param context - Pipeline execution context
 * @returns true if the condition is met, false otherwise
 */
export function evaluateCondition(condition: PipelineCondition, context: PipelineContext): boolean {
	if (isExistsCondition(condition)) {
		const value = resolveVariable(condition.$exists, context);
		return value !== undefined && value !== null;
	}

	if (isEqCondition(condition)) {
		const [ref, expected] = condition.$eq;
		const value = resolveVariable(ref, context);
		return value === expected;
	}

	if (isNeCondition(condition)) {
		const [ref, expected] = condition.$ne;
		const value = resolveVariable(ref, context);
		return value !== expected;
	}

	if (isGtCondition(condition)) {
		const [ref, threshold] = condition.$gt;
		const value = resolveVariable(ref, context);
		return typeof value === 'number' && value > threshold;
	}

	if (isGteCondition(condition)) {
		const [ref, threshold] = condition.$gte;
		const value = resolveVariable(ref, context);
		return typeof value === 'number' && value >= threshold;
	}

	if (isLtCondition(condition)) {
		const [ref, threshold] = condition.$lt;
		const value = resolveVariable(ref, context);
		return typeof value === 'number' && value < threshold;
	}

	if (isLteCondition(condition)) {
		const [ref, threshold] = condition.$lte;
		const value = resolveVariable(ref, context);
		return typeof value === 'number' && value <= threshold;
	}

	if (isAndCondition(condition)) {
		return condition.$and.every((c) => evaluateCondition(c, context));
	}

	if (isOrCondition(condition)) {
		return condition.$or.some((c) => evaluateCondition(c, context));
	}

	if (isNotCondition(condition)) {
		return !evaluateCondition(condition.$not, context);
	}

	return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKWARDS COMPATIBILITY ALIASES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Alias for resolveVariable (backwards compatibility).
 *
 * @deprecated Use resolveVariable instead
 */
export const resolveReference = resolveVariable;
