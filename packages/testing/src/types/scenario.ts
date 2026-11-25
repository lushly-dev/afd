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
 *   - command: todo-create
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

	/**
	 * @deprecated Not implemented. The YAML parser rejects it and the executors
	 * report an `unsupported` error instead of silently ignoring it.
	 */
	isolation?: 'fresh' | 'chained';

	/**
	 * @deprecated Not implemented. The YAML parser rejects it and the executors
	 * report an `unsupported` error instead of silently ignoring it.
	 */
	dependsOn?: string[];

	/**
	 * Per-scenario timeout in milliseconds. When it passes, the running step is
	 * abandoned, the remaining steps are skipped and the scenario is reported as
	 * an `error` with a `timeout` error.
	 */
	timeout?: number;

	/** Steps to execute */
	steps: Step[];

	/**
	 * @deprecated Not implemented. The YAML parser rejects it and the executors
	 * report an `unsupported` error instead of silently ignoring it.
	 */
	verify?: Verification;

	/**
	 * Absolute path of the file this scenario was parsed from. Set by
	 * `parseScenarioFile`; relative fixture paths resolve against its directory.
	 */
	sourcePath?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for scenario starting state.
 */
export interface FixtureConfig {
	/**
	 * Path to fixture file (JSON). A relative path resolves against the scenario
	 * file's directory (or the executor's `basePath` for scenarios built in code).
	 */
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
	/** Command name to execute (e.g., "todo-create") */
	command: string;

	/** Input parameters for the command */
	input?: Record<string, unknown>;

	/** Optional description explaining this step */
	description?: string;

	/** Expected results */
	expect: Expectation;

	/** Continue scenario even if this step fails (default: false) */
	continueOnFailure?: boolean;

	/**
	 * Follow the refusal's `error.recovery` (`spec/recovery.md`) and check that it gets further.
	 * Only on a step that expects a failure; see {@link FollowExpectation}.
	 */
	follow?: FollowExpectation;
}

/**
 * Following a refused step's structured recovery, and what counts as getting further.
 *
 * The runner reads the refusal's `error.recovery` and takes its step:
 * - `call`: runs `recovery.command` with `recovery.input` and `input`, and judges it by `expect`
 *   (default: it succeeds). With `thenRetry`, it then repeats the refused call unchanged and
 *   judges that by `retry` (default: it succeeds).
 * - `fix-input`: repeats the refused command with its input, `recovery.input` and `input` merged,
 *   and judges it by `expect` (default: it succeeds).
 * - `retry`: repeats the refused call unchanged at once, judged by `expect` (default: it
 *   succeeds). The runner does not wait `afterMs`; a fixture that models time arranges it.
 *
 * Whatever `expect` says, a followed call that fails with the same command and code as the
 * refusal fails the step: following the advice led straight back to it. A refusal with no
 * recovery, or one whose kind is `external` or `stop`, has nothing to follow and fails the step;
 * assert those with `expect.error.recovery` instead.
 *
 * @example
 * ```yaml
 * - command: cell-register
 *   input: { branch: fix/b, issues: [302], route: sol/high }
 *   expect:
 *     success: false
 *     error: { code: ALREADY_CLAIMED, recovery: { kind: call, command: issue-check } }
 *   follow:
 *     expect: { success: true, data: { dispatchable: [305] } }
 * ```
 */
export interface FollowExpectation {
	/**
	 * Values for the recovery's `needs`, and nothing else: a scenario cannot add to or replace
	 * what the recovery says. Step references resolve here as in a step's `input`.
	 */
	input?: Record<string, unknown>;

	/** What the recovery's own call returns. Default: `{ success: true }`. */
	expect?: Expectation;

	/** `call` with `thenRetry` only: what the repeated refused call returns. Default: success. */
	retry?: Expectation;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPECTATION DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Expected outcome of a step.
 *
 * Data assertions are exact values or matcher objects (see `AssertionMatcher`):
 * - Exact match: `data: { id: "xbox" }`
 * - Pattern: `data: { name: { contains: "box" } }`
 * - Existence: `data: { createdAt: { exists: true } }`
 * - Numeric: `data: { count: { gte: 5 } }`
 *
 * `data` is only checked when `success` is true, and `error` only when
 * `success` is false; the parser rejects the other combinations.
 */
export interface Expectation {
	/** Whether command should succeed */
	success: boolean;

	/** Assertions on the data field (JSONPath-like keys) */
	data?: Record<string, unknown>;

	/** Expected error details (for failure tests) */
	error?: {
		/** Error code, compared exactly */
		code?: string;
		/** Substring the error message must contain */
		message?: string;
		/**
		 * Recovery suggestion: a string the suggestion must contain, or a
		 * matcher object such as `{ contains: "view-state-list" }`
		 */
		suggestion?: string | AssertionMatcher;
		/**
		 * The structured recovery (`spec/recovery.md`), checked like `data`: each named field
		 * must match, and others are ignored. `{ kind: call, command: issue-check }`.
		 */
		recovery?: Record<string, unknown>;
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
export type AssertionValue = string | number | boolean | null | AssertionMatcher;

/**
 * Matchers for complex assertions.
 *
 * An object is a matcher only when every key is a matcher key. Mixing matcher
 * keys with other keys (for example `{ exists: true, name: "Bob" }`) is an
 * error, so a typo such as `matchs` can never be silently ignored. To compare
 * against a literal object whose keys look like matchers, use `equals`.
 *
 * @example
 * ```yaml
 * expect:
 *   success: true
 *   data:
 *     count: { gte: 5 }
 *     name: { contains: "xbox" }
 *     items: { length: 3 }
 *     settings: { equals: { exists: true } }
 * ```
 */
export interface AssertionMatcher {
	/** Value deep-equals the given value */
	equals?: unknown;

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
// UNSUPPORTED FIELDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Scenario fields the format declares but the runner does not implement.
 * The parser rejects them and the executors report an `unsupported` error,
 * so a scenario relying on them cannot pass without checking anything.
 */
export const UNSUPPORTED_SCENARIO_FIELDS: Readonly<Record<string, string>> = {
	verify:
		"'verify' is not supported: final verification is not implemented. Add a last step that reads the state and asserts on it instead.",
	isolation:
		"'isolation' is not supported: scenarios always run against the handler's current state. Use a fixture (for example with clearFirst) to start from a known state.",
	dependsOn:
		"'dependsOn' is not supported: scenarios cannot depend on each other. Give each scenario its own fixture or setup steps.",
};

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

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
