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

// Assertions
export {
	assertAiResult,
	assertConfidence,
	assertErrorCode,
	assertFailure,
	assertHasPlan,
	assertHasReasoning,
	assertHasSources,
	assertHasSuggestion,
	assertRetryable,
	assertStepStatus,
	assertSuccess,
} from './assertions.js';
// Mock server
export { createMockServer, MockMcpServer } from './mock-server.js';
// Test helpers
export {
	type CommandTestResult,
	createFailureCommand,
	createMockCommand,
	createSuccessCommand,
	createTestContext,
	createTestRegistry,
	type TestContext,
	testCommand,
	testCommandDefinition,
	testCommandMultiple,
} from './test-helpers.js';
// Validators
export {
	type ResultValidationOptions,
	type ValidationError,
	type ValidationResult,
	type ValidationWarning,
	validateCommandDefinition,
	validateError,
	validateResult,
} from './validators.js';

// ============================================================================
// Scenario Testing (JTBD)
// ============================================================================

// YAML parser
export type { ParseError, ParseResult, ParseSuccess } from './parsers/yaml.js';
export {
	parseScenarioFile,
	parseScenarioFiles,
	parseScenarioString,
} from './parsers/yaml.js';
// CLI wrapper
export type {
	CliConfig,
	ExecuteError,
	ExecuteOptions,
	ExecuteResult,
	ExecuteSuccess,
} from './runner/cli-wrapper.js';
export { CliWrapper, createCliWrapper } from './runner/cli-wrapper.js';
// Evaluator
export type { EvaluationResult } from './runner/evaluator.js';
export { evaluateResult } from './runner/evaluator.js';
// Executor
export type {
	CommandHandler,
	ExecutorConfig,
	InProcessExecutorConfig,
	ScenarioValidationResult,
} from './runner/executor.js';
export {
	createExecutor,
	createInProcessExecutor,
	InProcessExecutor,
	ScenarioExecutor,
	validateScenario,
} from './runner/executor.js';
// Fixture loader
export type {
	AppliedCommand,
	ApplyFixtureOptions,
	ApplyFixtureResult,
	FixtureData,
	LoadFixtureOptions,
	LoadFixtureResult,
} from './runner/fixture-loader.js';
export { applyFixture, loadFixture } from './runner/fixture-loader.js';
// Reporter
export type { ReporterConfig } from './runner/reporter.js';
export {
	createJsonReporter,
	createReporter,
	createVerboseReporter,
	TerminalReporter,
} from './runner/reporter.js';
// Report types
export type {
	AssertionResult,
	EnvironmentInfo,
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
	Scenario,
	Step,
	Verification,
} from './types/scenario.js';
export { isAssertionMatcher, isScenario } from './types/scenario.js';

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
// Generic adapter
// Todo adapter
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

// ============================================================================
// Scenario Commands (Phase 2)
// ============================================================================

// scenario-coverage
export type {
	CommandCoverage,
	CoverageSummary,
	ErrorCoverage,
	JobCoverage,
	ScenarioCoverageInput,
	ScenarioCoverageOutput,
} from './commands/coverage.js';
export {
	formatCoverageMarkdown,
	formatCoverageTerminal,
	scenarioCoverage,
} from './commands/coverage.js';
// scenario-create
export type {
	ScenarioCreateInput,
	ScenarioCreateOutput,
	ScenarioStepInput,
} from './commands/create.js';
export { listTemplates, scenarioCreate } from './commands/create.js';
// scenario-evaluate
export type {
	ScenarioEvaluateInput,
	ScenarioEvaluateOutput,
} from './commands/evaluate.js';
export {
	formatJunit,
	formatMarkdown,
	formatTerminal,
	scenarioEvaluate,
} from './commands/evaluate.js';
// scenario-list
export type {
	ScenarioListInput,
	ScenarioListOutput,
	ScenarioSummary,
} from './commands/list.js';
export { formatScenarioTable, scenarioList } from './commands/list.js';

// scenario-suggest (Phase 3)
export type {
	ScenarioSuggestInput,
	ScenarioSuggestion,
	ScenarioSuggestOutput,
	SuggestionContext,
} from './commands/suggest.js';
export { scenarioSuggest } from './commands/suggest.js';

// ============================================================================
// MCP Integration (Phase 3)
// ============================================================================

// Agent Hints
export {
	type AgentEnhancedResult,
	type AgentHints,
	enhanceWithAgentHints,
	generateAgentHints,
	generateCoverageHints,
	generateTestReportHints,
} from './mcp/hints.js';
// MCP Server
export {
	createMcpTestingServer,
	type JsonRpcError,
	type JsonRpcRequest,
	type JsonRpcResponse,
	type McpTestingServer,
	type McpTestingServerOptions,
	runStdioServer,
} from './mcp/server.js';
// MCP Tools
export {
	createToolRegistry,
	executeTool,
	generateTools,
	getTool,
	type McpTool,
	type RegisteredTool,
	type ToolExecutionContext,
	type ToolHandler,
} from './mcp/tools.js';

// ============================================================================
// Re-export core types commonly used in testing
// ============================================================================

export {
	type CommandDefinition,
	type CommandError,
	type CommandResult,
	failure,
	isFailure,
	isSuccess,
	success,
} from '@lushly-dev/afd-core';
