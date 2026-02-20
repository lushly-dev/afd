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
// Command types
export type {
	CommandContext,
	CommandDefinition,
	CommandHandler,
	CommandParameter,
	CommandRegistry,
	JsonSchema,
} from './commands.js';
export { commandToMcpTool, createCommandRegistry } from './commands.js';
export type {
	GitHubConnectorOptions,
	Issue,
	IssueCreateOptions,
	IssueFilters,
	PrCreateOptions,
	PullRequest,
} from './connectors/github.js';
// Connectors
export { GitHubConnector } from './connectors/github.js';
export type {
	PackageManager,
	PackageManagerConnectorOptions,
} from './connectors/package-manager.js';
export { PackageManagerConnector } from './connectors/package-manager.js';
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
	HandoffCredentials,
	HandoffMetadata,
	HandoffProtocol,
	HandoffResult,
} from './handoff.js';
export {
	getHandoffProtocol,
	isHandoff,
	isHandoffCommand,
	isHandoffProtocol,
} from './handoff.js';

// MCP types
export type {
	McpClientCapabilities,
	McpContent,
	McpError,
	McpErrorCode,
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
export type { ExecOptions, ExecResult } from './platform.js';
// Platform utilities
export {
	createExecResult,
	ExecErrorCode,
	exec,
	findUp,
	getTempDir,
	isExecError,
	isLinux,
	isMac,
	isWindows,
	normalizePath,
} from './platform.js';
// Result types
export type { CommandResult, ResultMetadata } from './result.js';
export { failure, isFailure, isSuccess, success } from './result.js';
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
} from './streaming.js';
export {
	collectStreamData,
	consumeStream,
	createCompleteChunk,
	createDataChunk,
	createErrorChunk,
	createProgressChunk,
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
