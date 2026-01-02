/**
 * @fileoverview @afd/testing - Testing utilities for Agent-First Development
 *
 * This package provides utilities for testing AFD commands:
 *
 * - **Validators**: Validate command results and definitions
 * - **Test Helpers**: Easy command testing with validation
 * - **Assertions**: Custom assertions for command results
 * - **Mock Server**: In-memory MCP server for testing
 * - **Scenarios**: JTBD scenario-based workflow testing
 *
 * @packageDocumentation
 */

// Validators
export {
	validateResult,
	validateError,
	validateCommandDefinition,
	type ValidationResult,
	type ValidationError,
	type ValidationWarning,
	type ResultValidationOptions,
} from './validators.js';

// Test helpers
export {
	testCommand,
	testCommandDefinition,
	testCommandMultiple,
	createTestContext,
	createMockCommand,
	createSuccessCommand,
	createFailureCommand,
	createTestRegistry,
	type TestContext,
	type CommandTestResult,
} from './test-helpers.js';

// Assertions
export {
	assertSuccess,
	assertFailure,
	assertErrorCode,
	assertConfidence,
	assertHasReasoning,
	assertHasSources,
	assertHasPlan,
	assertStepStatus,
	assertHasSuggestion,
	assertRetryable,
	assertAiResult,
} from './assertions.js';

// Mock server
export { MockMcpServer, createMockServer } from './mock-server.js';

// ============================================================================
// Scenario Testing (JTBD)
// ============================================================================

// Scenario types
export type {
	Scenario,
	Step,
	Expectation,
	FixtureConfig,
	Verification,
	AssertionMatcher,
	AssertionValue,
} from './types/scenario.js';

export { isScenario, isAssertionMatcher } from './types/scenario.js';

// Report types
export type {
	StepOutcome,
	StepError,
	StepResult,
	AssertionResult,
	ScenarioOutcome,
	ScenarioResult,
	VerificationResult,
	VerificationQueryResult,
	TestReport,
	TestSummary,
	EnvironmentInfo,
} from './types/report.js';

export {
	createEmptySummary,
	calculateSummary,
	createStepError,
	isStepResult,
	isScenarioResult,
} from './types/report.js';

// YAML parser
export type { ParseResult, ParseSuccess, ParseError } from './parsers/yaml.js';
export {
	parseScenarioString,
	parseScenarioFile,
	parseScenarioFiles,
} from './parsers/yaml.js';

// Evaluator
export type { EvaluationResult } from './runner/evaluator.js';
export { evaluateResult } from './runner/evaluator.js';

// CLI wrapper
export type {
	CliConfig,
	ExecuteOptions,
	ExecuteResult,
	ExecuteSuccess,
	ExecuteError,
} from './runner/cli-wrapper.js';
export { CliWrapper, createCliWrapper } from './runner/cli-wrapper.js';

// Executor
export type {
	ExecutorConfig,
	CommandHandler,
	InProcessExecutorConfig,
} from './runner/executor.js';
export {
	ScenarioExecutor,
	InProcessExecutor,
	createExecutor,
	createInProcessExecutor,
} from './runner/executor.js';

// Reporter
export type { ReporterConfig } from './runner/reporter.js';
export {
	TerminalReporter,
	createReporter,
	createJsonReporter,
	createVerboseReporter,
} from './runner/reporter.js';

// Fixture loader
export type {
	FixtureData,
	LoadFixtureResult,
	LoadFixtureOptions,
} from './runner/fixture-loader.js';
export { loadFixture, applyFixture } from './runner/fixture-loader.js';

// ============================================================================
// Re-export core types commonly used in testing
// ============================================================================

export {
	success,
	failure,
	isSuccess,
	isFailure,
	type CommandResult,
	type CommandDefinition,
	type CommandError,
} from '@afd/core';
