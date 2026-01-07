/**
 * @fileoverview @lushly-dev/afd-testing - Testing utilities for Agent-First Development
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
	ScenarioValidationResult,
} from './runner/executor.js';
export {
	ScenarioExecutor,
	InProcessExecutor,
	createExecutor,
	createInProcessExecutor,
	validateScenario,
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
	AppliedCommand,
	ApplyFixtureResult,
	ApplyFixtureOptions,
} from './runner/fixture-loader.js';
export { loadFixture, applyFixture } from './runner/fixture-loader.js';

// ============================================================================
// App Adapters (Phase 4)
// ============================================================================

// Adapter types
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

// Registry
export {
	createAdapterRegistry,
	detectAdapter,
	getAdapter,
	getGlobalRegistry,
	listAdapters,
	registerAdapter,
	resetGlobalRegistry,
	setGlobalRegistry,
} from './adapters/index.js';

// Generic adapter
export {
	createGenericAdapter,
	genericAdapter,
	type GenericAdapterOptions,
} from './adapters/index.js';

// Todo adapter
export {
	createTodoAdapter,
	todoAdapter,
	type TodoFixture,
	type TodoSeed,
} from './adapters/index.js';

// ============================================================================
// Scenario Commands (Phase 2)
// ============================================================================

// scenario.list
export type {
	ScenarioListInput,
	ScenarioListOutput,
	ScenarioSummary,
} from './commands/list.js';
export { scenarioList, formatScenarioTable } from './commands/list.js';

// scenario.evaluate
export type {
	ScenarioEvaluateInput,
	ScenarioEvaluateOutput,
} from './commands/evaluate.js';
export {
	scenarioEvaluate,
	formatTerminal,
	formatJunit,
	formatMarkdown,
} from './commands/evaluate.js';

// scenario.coverage
export type {
	ScenarioCoverageInput,
	ScenarioCoverageOutput,
	CommandCoverage,
	ErrorCoverage,
	JobCoverage,
	CoverageSummary,
} from './commands/coverage.js';
export {
	scenarioCoverage,
	formatCoverageTerminal,
	formatCoverageMarkdown,
} from './commands/coverage.js';

// scenario.create
export type {
	ScenarioCreateInput,
	ScenarioCreateOutput,
	ScenarioStepInput,
} from './commands/create.js';
export { scenarioCreate, listTemplates } from './commands/create.js';

// scenario.suggest (Phase 3)
export type {
	SuggestionContext,
	ScenarioSuggestInput,
	ScenarioSuggestion,
	ScenarioSuggestOutput,
} from './commands/suggest.js';
export { scenarioSuggest } from './commands/suggest.js';

// ============================================================================
// MCP Integration (Phase 3)
// ============================================================================

// MCP Server
export {
	createMcpTestingServer,
	runStdioServer,
	type McpTestingServer,
	type McpTestingServerOptions,
	type JsonRpcRequest,
	type JsonRpcResponse,
	type JsonRpcError,
} from './mcp/server.js';

// MCP Tools
export {
	generateTools,
	createToolRegistry,
	executeTool,
	getTool,
	type McpTool,
	type RegisteredTool,
	type ToolHandler,
	type ToolExecutionContext,
} from './mcp/tools.js';

// Agent Hints
export {
	generateAgentHints,
	generateTestReportHints,
	generateCoverageHints,
	enhanceWithAgentHints,
	type AgentHints,
	type AgentEnhancedResult,
} from './mcp/hints.js';

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
} from '@lushly-dev/afd-core';
