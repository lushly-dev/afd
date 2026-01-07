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
