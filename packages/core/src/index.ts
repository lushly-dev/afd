/**
 * @fileoverview @lushly-dev/afd-core - Core types and utilities for Agent-First Development
 *
 * This package provides the foundational types used across all AFD packages:
 *
 * - **CommandResult**: Standard result type with UX-enabling fields
 * - **CommandError**: Actionable error structure
 * - **CommandDefinition**: Full command schema with handler
 * - **BatchResult**: Batch execution with aggregated confidence
 * - **StreamChunk**: Streaming results with progress feedback
 * - **MCP types**: Model Context Protocol types for agent communication
 *
 * @packageDocumentation
 */

// Batch types
export type {
	BatchCommand,
	BatchCommandResult,
	BatchOptions,
	BatchRequest,
	BatchResult,
	BatchSummary,
	BatchTiming,
	BatchWarning,
} from './batch.js';
export {
	calculateBatchConfidence,
	createBatchRequest,
	createBatchResult,
	createFailedBatchResult,
	isBatchCommand,
	isBatchRequest,
	isBatchResult,
} from './batch.js';
// Batch and stream executors (shared by the registry and hosts such as the MCP server)
export type { ExecutorOptions, StreamExecutorOptions } from './command-execution.js';
export { executeBatch, executeStream, executionFailure } from './command-execution.js';
// Command types
export type {
	CommandContext,
	CommandDefinition,
	CommandExample,
	CommandHandler,
	CommandMiddleware,
	CommandParameter,
	CommandRegistry,
	CommandRegistryOptions,
	ExposeOptions,
	JsonSchema,
} from './commands.js';
export {
	commandsToMcpTools,
	commandToMcpTool,
	createCommandRegistry,
	defaultExpose,
	isExposedTo,
	isMcpExposed,
	validateCommandName,
} from './commands.js';
// Connectors — deprecated root re-exports. The connectors spawn processes
// (node:child_process), so re-exporting them here stops the root entry from
// being bundled for the browser. Import them from '@lushly-dev/afd-core/connectors';
// these re-exports will be removed in the next major version.
export type {
	/** @deprecated Import from `@lushly-dev/afd-core/connectors`. Removed from the root entry in the next major version. */
	GitHubConnectorOptions,
	/** @deprecated Import from `@lushly-dev/afd-core/connectors`. Removed from the root entry in the next major version. */
	Issue,
	/** @deprecated Import from `@lushly-dev/afd-core/connectors`. Removed from the root entry in the next major version. */
	IssueCreateOptions,
	/** @deprecated Import from `@lushly-dev/afd-core/connectors`. Removed from the root entry in the next major version. */
	IssueFilters,
	/** @deprecated Import from `@lushly-dev/afd-core/connectors`. Removed from the root entry in the next major version. */
	PrCreateOptions,
	/** @deprecated Import from `@lushly-dev/afd-core/connectors`. Removed from the root entry in the next major version. */
	PullRequest,
} from './connectors/github.js';
export {
	/** @deprecated Import from `@lushly-dev/afd-core/connectors`. Removed from the root entry in the next major version. */
	GitHubConnector,
} from './connectors/github.js';
export type {
	/** @deprecated Import from `@lushly-dev/afd-core/connectors`. Removed from the root entry in the next major version. */
	PackageManager,
	/** @deprecated Import from `@lushly-dev/afd-core/connectors`. Removed from the root entry in the next major version. */
	PackageManagerConnectorOptions,
} from './connectors/package-manager.js';
export {
	/** @deprecated Import from `@lushly-dev/afd-core/connectors`. Removed from the root entry in the next major version. */
	PackageManagerConnector,
} from './connectors/package-manager.js';
// Error types
export type { CommandError, ErrorCode } from './errors.js';
export {
	createError,
	ErrorCodes,
	internalError,
	isCommandError,
	notFoundError,
	rateLimitError,
	timeoutError,
	validationError,
	wrapError,
} from './errors.js';
// Handoff types
export type {
	CreateHandoffOptions,
	HandoffCredentials,
	HandoffMetadata,
	HandoffProtocol,
	HandoffResult,
	ReconnectPolicy,
} from './handoff.js';
export {
	createHandoff,
	defaultReconnectPolicy,
	getHandoffProtocol,
	isHandoff,
	isHandoffCommand,
	isHandoffProtocol,
	isReconnectPolicy,
} from './handoff.js';

// MCP types
export type {
	McpClientCapabilities,
	McpContent,
	McpError,
	McpErrorCode,
	McpId,
	McpImageContent,
	McpInitializeParams,
	McpInitializeResult,
	McpNotification,
	McpRequest,
	McpResourceContent,
	McpResponse,
	McpServerCapabilities,
	McpTextContent,
	McpTool,
	McpToolCallParams,
	McpToolCallResult,
	McpToolsListResult,
} from './mcp.js';
export {
	createMcpErrorResponse,
	createMcpRequest,
	createMcpResponse,
	isMcpNotification,
	isMcpRequest,
	isMcpResponse,
	McpErrorCodes,
	textContent,
} from './mcp.js';
// Metadata types
export type {
	Alternative,
	PlanStep,
	PlanStepStatus,
	Source,
	Warning,
	WarningSeverity,
} from './metadata.js';
export {
	createSource,
	createStep,
	createWarning,
	updateStepStatus,
} from './metadata.js';
// Pipeline types
export type {
	PipelineAlternative,
	PipelineCondition,
	PipelineConditionAnd,
	PipelineConditionEq,
	PipelineConditionExists,
	PipelineConditionGt,
	PipelineConditionGte,
	PipelineConditionLt,
	PipelineConditionLte,
	PipelineConditionNe,
	PipelineConditionNot,
	PipelineConditionOr,
	PipelineContext,
	PipelineMetadata,
	PipelineOptions,
	PipelineRequest,
	PipelineResult,
	PipelineSource,
	PipelineStep,
	PipelineWarning,
	StepConfidence,
	StepReasoning,
	StepResult,
	StepStatus,
} from './pipeline.js';
export {
	aggregatePipelineAlternatives,
	aggregatePipelineConfidence,
	aggregatePipelineReasoning,
	aggregatePipelineSources,
	aggregatePipelineWarnings,
	buildConfidenceBreakdown,
	createPipeline,
	evaluateCondition,
	getNestedValue,
	isAndCondition,
	isEqCondition,
	isExistsCondition,
	isGtCondition,
	isGteCondition,
	isLtCondition,
	isLteCondition,
	isNeCondition,
	isNotCondition,
	isOrCondition,
	isPipelineCondition,
	isPipelineRequest,
	isPipelineResult,
	isPipelineStep,
	resolveReference,
	resolveVariable,
	resolveVariables,
} from './pipeline.js';
// Pipeline executor (separate module for file-size compliance)
export type { CommandExecutor } from './pipeline-executor.js';
export { executePipeline } from './pipeline-executor.js';
// Platform utilities — available via '@lushly-dev/afd-core/platform' subpath.
// NOT re-exported from the barrel to avoid pulling Node.js builtins into browser bundles.
// import { exec, findUp, isWindows } from '@lushly-dev/afd-core/platform';

// Result types
export type { CommandResult, ResultMetadata } from './result.js';
export { error, failure, isFailure, isSuccess, success } from './result.js';
// Similarity utilities
export {
	calculateSimilarity,
	findSimilarTools,
	MAX_SIMILARITY_INPUT_LENGTH,
	truncateName,
} from './similarity.js';
// Streaming types
export type {
	CompleteChunk,
	DataChunk,
	ErrorChunk,
	ProgressChunk,
	StreamableCommand,
	StreamCallbacks,
	StreamChunk,
	StreamOptions,
	TimeoutController,
} from './streaming.js';
export {
	collectStreamData,
	consumeStream,
	createCompleteChunk,
	createDataChunk,
	createErrorChunk,
	createProgressChunk,
	createProgressChunkWithSteps,
	createTimeoutController,
	isCompleteChunk,
	isDataChunk,
	isErrorChunk,
	isProgressChunk,
	isStreamableCommand,
	isStreamChunk,
} from './streaming.js';
// Telemetry types
export type { TelemetryEvent, TelemetrySink } from './telemetry.js';
export { createTelemetryEvent, isTelemetryEvent } from './telemetry.js';
