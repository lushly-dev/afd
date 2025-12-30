/**
 * @fileoverview Metadata types for UX-enabling command results
 *
 * These types enable rich agent UX by providing:
 * - Source attribution (where did this info come from?)
 * - Plan visualization (what steps will be taken?)
 * - Alternatives (what other options exist?)
 * - Warnings (what should the user be aware of?)
 */

/**
 * Information source used by a command to produce its result.
 *
 * Enables: Attribution, verification, trust building
 *
 * @example
 * ```typescript
 * const source: Source = {
 *   type: 'document',
 *   id: 'style-guide-v3',
 *   title: 'Microsoft Style Guide',
 *   location: 'Chapter 3.2 - Capitalization'
 * };
 * ```
 */
export interface Source {
	/**
	 * Source type identifier.
	 *
	 * Common values: 'document', 'url', 'database', 'api', 'user_input', 'model'
	 */
	type: string;

	/**
	 * Unique identifier for the source.
	 * Used for linking and retrieval.
	 */
	id?: string;

	/**
	 * Human-readable title for display.
	 */
	title?: string;

	/**
	 * URL if the source is web-accessible.
	 */
	url?: string;

	/**
	 * Specific location within the source (page, section, line, etc.).
	 */
	location?: string;

	/**
	 * When the source was last accessed or retrieved.
	 */
	accessedAt?: string;

	/**
	 * Confidence or relevance score for this source (0-1).
	 */
	relevance?: number;
}

/**
 * A step in a multi-step plan or operation.
 *
 * Enables: Plan visualization, progress tracking, transparency
 *
 * @example
 * ```typescript
 * const step: PlanStep = {
 *   id: 'validate-input',
 *   action: 'validate',
 *   description: 'Validate document format and content',
 *   status: 'in_progress'
 * };
 * ```
 */
export interface PlanStep {
	/**
	 * Unique identifier for this step.
	 * Used for referencing in dependencies and UI updates.
	 */
	id: string;

	/**
	 * The action being performed.
	 * Should be a verb: 'fetch', 'validate', 'transform', 'save', etc.
	 */
	action: string;

	/**
	 * Current status of this step.
	 */
	status: PlanStepStatus;

	/**
	 * Human-readable description of what this step does.
	 */
	description?: string;

	/**
	 * IDs of steps that must complete before this one can start.
	 */
	dependsOn?: string[];

	/**
	 * Result data if the step is complete.
	 */
	result?: unknown;

	/**
	 * Error information if the step failed.
	 */
	error?: {
		code: string;
		message: string;
	};

	/**
	 * Progress percentage (0-100) if the step is in progress.
	 */
	progress?: number;

	/**
	 * Estimated time remaining in milliseconds.
	 */
	estimatedTimeRemainingMs?: number;
}

/**
 * Possible statuses for a plan step.
 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped';

/**
 * An alternative result that was considered but not chosen.
 *
 * Enables: User choice, exploration, transparency about decisions
 *
 * @template T - The type of the alternative data (same as main result)
 *
 * @example
 * ```typescript
 * const alt: Alternative<TextResult> = {
 *   data: { text: 'More formal version...' },
 *   reason: 'More formal tone, suitable for business communication',
 *   confidence: 0.72
 * };
 * ```
 */
export interface Alternative<T> {
	/**
	 * The alternative result data.
	 */
	data: T;

	/**
	 * Why this alternative wasn't selected as the primary result.
	 * Or why a user might prefer this option.
	 */
	reason: string;

	/**
	 * Confidence score for this alternative (0-1).
	 */
	confidence?: number;

	/**
	 * Label or name for this alternative.
	 * @example "Formal", "Concise", "Detailed"
	 */
	label?: string;
}

/**
 * A non-fatal warning or notice to surface to the user.
 *
 * Enables: Proactive transparency, awareness of potential issues
 *
 * @example
 * ```typescript
 * const warning: Warning = {
 *   code: 'OUTDATED_SOURCE',
 *   message: 'The style guide used is 6 months old',
 *   severity: 'info'
 * };
 * ```
 */
export interface Warning {
	/**
	 * Machine-readable warning code.
	 * Use SCREAMING_SNAKE_CASE for consistency.
	 */
	code: string;

	/**
	 * Human-readable warning message.
	 */
	message: string;

	/**
	 * Severity level for UI treatment.
	 *
	 * - 'info': Informational, no action needed
	 * - 'warning': Something to be aware of
	 * - 'caution': May need attention before proceeding
	 */
	severity?: 'info' | 'warning' | 'caution';

	/**
	 * Additional context or details.
	 */
	details?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new Source.
 */
export function createSource(
	type: string,
	options?: Omit<Source, 'type'>
): Source {
	return { type, ...options };
}

/**
 * Create a new PlanStep with pending status.
 */
export function createStep(
	id: string,
	action: string,
	description?: string
): PlanStep {
	return {
		id,
		action,
		status: 'pending',
		description,
	};
}

/**
 * Update a PlanStep's status.
 */
export function updateStepStatus(
	step: PlanStep,
	status: PlanStepStatus,
	result?: unknown
): PlanStep {
	return {
		...step,
		status,
		result: status === 'complete' ? result : step.result,
	};
}

/**
 * Create a new Warning.
 */
export function createWarning(
	code: string,
	message: string,
	severity: Warning['severity'] = 'warning'
): Warning {
	return { code, message, severity };
}
