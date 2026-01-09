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

// Result types
export type { CommandResult, ResultMetadata } from './result.js';
export { success, failure, isSuccess, isFailure } from './result.js';

// Error types
export type { CommandError, ErrorCode } from './errors.js';
export {
	ErrorCodes,
	createError,
	validationError,
	notFoundError,
	rateLimitError,
	timeoutError,
	internalError,
	wrapError,
	isCommandError,
} from './errors.js';

// Metadata types
export type {
	Source,
	PlanStep,
	PlanStepStatus,
	Alternative,
	Warning,
} from './metadata.js';
export {
	createSource,
	createStep,
	updateStepStatus,
	createWarning,
} from './metadata.js';

// Command types
export type {
	JsonSchema,
	CommandParameter,
	CommandDefinition,
	CommandHandler,
	CommandContext,
	CommandRegistry,
} from './commands.js';
export { createCommandRegistry, commandToMcpTool } from './commands.js';

// Batch types
export type {
	BatchCommand,
	BatchOptions,
	BatchRequest,
	BatchCommandResult,
	BatchSummary,
	BatchTiming,
	BatchResult,
} from './batch.js';
export {
	createBatchRequest,
	createBatchResult,
	createFailedBatchResult,
	calculateBatchConfidence,
	isBatchRequest,
	isBatchResult,
	isBatchCommand,
} from './batch.js';

// Streaming types
export type {
	ProgressChunk,
	DataChunk,
	CompleteChunk,
	ErrorChunk,
	StreamChunk,
	StreamOptions,
	StreamCallbacks,
	StreamableCommand,
} from './streaming.js';
export {
	createProgressChunk,
	createDataChunk,
	createCompleteChunk,
	createErrorChunk,
	isProgressChunk,
	isDataChunk,
	isCompleteChunk,
	isErrorChunk,
	isStreamChunk,
	isStreamableCommand,
	consumeStream,
	collectStreamData,
	createTimeoutController,
} from './streaming.js';

// MCP types
export type {
	McpRequest,
	McpResponse,
	McpError,
	McpNotification,
	McpTool,
	McpToolsListResult,
	McpToolCallParams,
	McpToolCallResult,
	McpContent,
	McpTextContent,
	McpImageContent,
	McpResourceContent,
	McpServerCapabilities,
	McpClientCapabilities,
	McpInitializeParams,
	McpInitializeResult,
	McpErrorCode,
} from './mcp.js';
export {
	McpErrorCodes,
	createMcpRequest,
	createMcpResponse,
	createMcpErrorResponse,
	textContent,
	isMcpRequest,
	isMcpResponse,
	isMcpNotification,
} from './mcp.js';

// Telemetry types
export type { TelemetryEvent, TelemetrySink } from './telemetry.js';
export { createTelemetryEvent, isTelemetryEvent } from './telemetry.js';

// Handoff types
export type {
	HandoffResult,
	HandoffCredentials,
	HandoffMetadata,
	HandoffProtocol,
} from './handoff.js';
export {
	isHandoff,
	isHandoffProtocol,
	isHandoffCommand,
	getHandoffProtocol,
} from './handoff.js';

// Pipeline types
export type {
	PipelineRequest,
	PipelineStep,
	PipelineOptions,
	PipelineCondition,
	PipelineConditionExists,
	PipelineConditionEq,
	PipelineConditionNe,
	PipelineConditionGt,
	PipelineConditionGte,
	PipelineConditionLt,
	PipelineConditionLte,
	PipelineConditionAnd,
	PipelineConditionOr,
	PipelineConditionNot,
	PipelineResult,
	PipelineMetadata,
	StepConfidence,
	StepReasoning,
	PipelineWarning,
	PipelineSource,
	PipelineAlternative,
	StepResult,
	StepStatus,
	PipelineContext,
} from './pipeline.js';
export {
	isPipelineRequest,
	isPipelineStep,
	isPipelineResult,
	isPipelineCondition,
	isExistsCondition,
	isEqCondition,
	isNeCondition,
	isGtCondition,
	isGteCondition,
	isLtCondition,
	isLteCondition,
	isAndCondition,
	isOrCondition,
	isNotCondition,
	createPipeline,
	aggregatePipelineConfidence,
	aggregatePipelineReasoning,
	aggregatePipelineWarnings,
	aggregatePipelineSources,
	aggregatePipelineAlternatives,
	buildConfidenceBreakdown,
	getNestedValue,
	resolveVariable,
	resolveReference,
	resolveVariables,
	evaluateCondition,
} from './pipeline.js';

// Platform utilities
export {
	isWindows,
	isMac,
	isLinux,
	exec,
	findUp,
	getTempDir,
	normalizePath,
	ExecErrorCode,
	createExecResult,
	isExecError,
} from './platform.js';
export type { ExecOptions, ExecResult } from './platform.js';

// Connectors
export { GitHubConnector } from './connectors/github.js';
export { PackageManagerConnector } from './connectors/package-manager.js';
export type {
	GitHubConnectorOptions,
	IssueCreateOptions,
	IssueFilters,
	Issue,
	PrCreateOptions,
	PullRequest,
} from './connectors/github.js';
export type {
	PackageManager,
	PackageManagerConnectorOptions,
} from './connectors/package-manager.js';
