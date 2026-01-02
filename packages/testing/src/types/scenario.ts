/**
 * @fileoverview JTBD Scenario types for workflow testing
 *
 * A scenario represents a complete user job (JTBD) expressed as
 * a sequence of CLI commands with expected outcomes.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A JTBD scenario defining a complete user workflow.
 *
 * @example
 * ```yaml
 * name: Create and Complete Todo
 * description: As a user, I create a todo and mark it complete
 * job: basic-workflow
 * tags: [smoke, p0]
 * steps:
 *   - command: todo.create
 *     input: { title: "Buy groceries" }
 *     expect:
 *       success: true
 * ```
 */
export interface Scenario {
	/** Human-readable name */
	name: string;

	/** What job this accomplishes (user story format) */
	description: string;

	/** Job identifier (kebab-case) */
	job: string;

	/** Categorization tags for filtering */
	tags: string[];

	/** Schema version */
	version?: string;

	/** Starting state configuration */
	fixture?: FixtureConfig;

	/** Isolation mode: fresh (default) or chained */
	isolation?: 'fresh' | 'chained';

	/** Dependencies if isolation is 'chained' */
	dependsOn?: string[];

	/** Per-scenario timeout in milliseconds */
	timeout?: number;

	/** Steps to execute */
	steps: Step[];

	/** Final verification after all steps */
	verify?: Verification;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for scenario starting state.
 */
export interface FixtureConfig {
	/** Path to fixture file (JSON) */
	file: string;

	/** Optional base fixture to inherit from */
	base?: string;

	/** Inline overrides to apply on top of fixture */
	overrides?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A single step in a scenario.
 *
 * Each step executes a command and verifies the result.
 */
export interface Step {
	/** Command name to execute (e.g., "todo.create") */
	command: string;

	/** Input parameters for the command */
	input?: Record<string, unknown>;

	/** Optional description explaining this step */
	description?: string;

	/** Expected results */
	expect: Expectation;

	/** Continue scenario even if this step fails (default: false) */
	continueOnFailure?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPECTATION DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Expected outcome of a step.
 *
 * Supports various assertion types:
 * - Exact match: `data.id: "xbox"`
 * - Pattern: `reasoning: contains "override"`
 * - Existence: `data.createdAt: exists`
 * - Numeric: `data.count: gte 5`
 */
export interface Expectation {
	/** Whether command should succeed */
	success: boolean;

	/** Assertions on the data field (JSONPath-like keys) */
	data?: Record<string, unknown>;

	/** Expected error details (for failure tests) */
	error?: {
		code?: string;
		message?: string;
	};

	/** Pattern match on reasoning field */
	reasoning?: string;

	/** Minimum confidence threshold */
	confidence?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Final verification after all steps complete.
 */
export interface Verification {
	/** Path to expected state snapshot (JSON) */
	snapshot?: string;

	/** Human-readable assertions */
	assertions?: string[];

	/** Path to custom verification script */
	custom?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSERTION VALUE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Special assertion values for flexible matching.
 */
export type AssertionValue =
	| string
	| number
	| boolean
	| null
	| AssertionMatcher;

/**
 * Matchers for complex assertions.
 *
 * @example
 * ```yaml
 * expect:
 *   data.count: { gte: 5 }
 *   data.name: { contains: "xbox" }
 *   data.items: { length: 3 }
 * ```
 */
export interface AssertionMatcher {
	/** Value contains substring */
	contains?: string;

	/** Value matches regex pattern */
	matches?: string;

	/** Value exists (not null/undefined) */
	exists?: boolean;

	/** Value does not exist */
	notExists?: boolean;

	/** Array length equals */
	length?: number;

	/** Array includes value */
	includes?: unknown;

	/** Greater than or equal */
	gte?: number;

	/** Less than or equal */
	lte?: number;

	/** Value is between min and max (inclusive) */
	between?: [number, number];
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a value is an AssertionMatcher object.
 */
export function isAssertionMatcher(value: unknown): value is AssertionMatcher {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const keys = Object.keys(value);
	const matcherKeys = [
		'contains',
		'matches',
		'exists',
		'notExists',
		'length',
		'includes',
		'gte',
		'lte',
		'between',
	];
	return keys.some((k) => matcherKeys.includes(k));
}

/**
 * Check if a value is a valid Scenario.
 */
export function isScenario(value: unknown): value is Scenario {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.name === 'string' &&
		typeof obj.description === 'string' &&
		typeof obj.job === 'string' &&
		Array.isArray(obj.tags) &&
		Array.isArray(obj.steps)
	);
}
