/**
 * @fileoverview Browser-safe entry point: `@lushly-dev/afd-testing/browser`
 *
 * Exposes the scenario run loop (`runScenario`), expectation evaluation
 * (`evaluateResult`, `evaluateStep`), fixture application (`applyFixture`),
 * step reference resolution (`resolveStepReferences`), and scenario/report/adapter
 * types without loading any Node.js built-in (`node:fs`, `node:path`,
 * `node:child_process`) or YAML/file-system loader.
 *
 * Import from here when driving scenarios inside a browser page, web worker,
 * or webview (for example Specimen's `afd` runner). Node.js code parses scenario
 * files and loads fixture JSON on disk, then hands the parsed objects to this
 * entry in the browser.
 *
 * The root entry (`@lushly-dev/afd-testing`) re-exports everything below plus
 * the Node.js file loaders, CLI executor, commands and MCP testing server.
 *
 * Module-graph rule: nothing reachable from this file may import a Node.js
 * built-in, the root `@lushly-dev/afd-core` entry (only `@lushly-dev/afd-core/result`
 * and `@lushly-dev/afd-core/errors` at runtime), `@lushly-dev/afd-server`, `yaml`
 * or `zod`. `browser.test.ts` bundles this entry with esbuild for the browser to
 * enforce this.
 *
 * @packageDocumentation
 */

// Type-only exports are erased from emitted JavaScript and add nothing to the runtime graph.
export type { CommandError, CommandResult } from '@lushly-dev/afd-core';
export { failure, isFailure, isSuccess, success } from '@lushly-dev/afd-core/result';

// App adapters (browser-safe registry and built-in adapters used by applyFixture)
export type {
	AdapterContext,
	AdapterRegistry,
	AdapterRegistryOptions,
	AppAdapter,
	AppliedCommand as AdapterAppliedCommand,
	ApplyFixtureResult as AdapterApplyFixtureResult,
	CliConfig as AdapterCliConfig,
	CommandHandler as AdapterCommandHandler,
	CommandsConfig,
	ErrorsConfig,
	FixtureApplicator,
	FixtureConfig as AdapterFixtureConfig,
	FixtureResetter,
	FixtureValidationResult,
	FixtureValidator,
	JobsConfig,
} from './adapters/index.js';
export {
	createAdapterRegistry,
	createGenericAdapter,
	createTodoAdapter,
	detectAdapter,
	type GenericAdapterOptions,
	genericAdapter,
	getAdapter,
	getGlobalRegistry,
	listAdapters,
	registerAdapter,
	resetGlobalRegistry,
	setGlobalRegistry,
	type TodoFixture,
	type TodoSeed,
	todoAdapter,
} from './adapters/index.js';

// Evaluator
export type { EvaluationResult } from './runner/evaluator.js';
export { evaluateResult } from './runner/evaluator.js';

// Fixture applier (without Node file-system loader)
export type {
	AppliedCommand,
	ApplyFixtureOptions,
	ApplyFixtureResult,
	FixtureCommandHandler,
	FixtureData,
} from './runner/fixture-applier.js';
export { applyFixture } from './runner/fixture-applier.js';

// Scenario run loop
export type {
	ExecutedStepOutcome,
	ExecutedStepResult,
	ExecuteScenarioOptions,
	RunConfig,
	ScenarioHooks,
	SetupOutcome,
} from './runner/scenario-runner.js';
export {
	createTimeoutReason,
	determineOutcome,
	evaluateStep,
	runScenario,
} from './runner/scenario-runner.js';

// Step references
export {
	getValueAtPath,
	resolveStepReferences,
	StepReferenceError,
} from './runner/step-references.js';

// Matchers
export {
	findExpectationProblems,
	InvalidExpectationError,
	isAssertionMatcher,
} from './types/matchers.js';

// Report types and helpers
export type {
	AssertionResult,
	EnvironmentInfo,
	ScenarioError,
	ScenarioOutcome,
	ScenarioResult,
	StepError,
	StepOutcome,
	StepResult,
	TestReport,
	TestSummary,
	VerificationQueryResult,
	VerificationResult,
} from './types/report.js';
export {
	calculateSummary,
	createEmptySummary,
	createStepError,
	isScenarioResult,
	isStepResult,
} from './types/report.js';

// Scenario types
export type {
	AssertionMatcher,
	AssertionValue,
	Expectation,
	FixtureConfig,
	FollowExpectation,
	Scenario,
	Step,
	Verification,
} from './types/scenario.js';
export { isScenario, UNSUPPORTED_SCENARIO_FIELDS } from './types/scenario.js';
