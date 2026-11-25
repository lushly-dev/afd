/**
 * @fileoverview @lushly-dev/afd-server - Server-side utilities for AFD
 *
 * This package provides tools for building MCP servers with:
 * - Zod-based command definitions with automatic validation
 * - MCP server factory with multiple transport support:
 *   - stdio: For IDE/agent integration (Cursor, Claude Code, Antigravity)
 *   - http/SSE: For browser-based clients and web UIs
 *   - auto: Auto-detect based on environment (default)
 * - Middleware for logging, tracing, rate limiting
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { defineCommand, createMcpServer, success } from '@lushly-dev/afd-server';
 *
 * const greet = defineCommand({
 *   name: 'greet',
 *   description: 'Greet a user',
 *   input: z.object({
 *     name: z.string(),
 *   }),
 *   async handler(input) {
 *     return success({ message: `Hello, ${input.name}!` });
 *   },
 * });
 *
 * // Auto-detect transport (recommended)
 * const server = createMcpServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   commands: [greet],
 * });
 *
 * // Or explicitly set transport for IDE integration
 * const stdioServer = createMcpServer({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   commands: [greet],
 *   transport: 'stdio',
 * });
 *
 * await server.start();
 * ```
 *
 * @packageDocumentation
 */

// Re-export telemetry types from core for convenience
// Re-export handoff types from core for convenience
// Server factory
export type {
	ApprovalDecision,
	ApprovalPolicy,
	CommandConfirmationMode,
	CommandMiddleware,
	CreateHandoffOptions,
	ExposeOptions,
	HandoffCredentials,
	HandoffMetadata,
	HandoffProtocol,
	HandoffResult,
	OutputBudget,
	ReconnectPolicy,
	TaskSupport,
	TelemetryEvent,
	TelemetrySink,
} from '@lushly-dev/afd-core';
// Re-export core helpers for convenience
export {
	AFD_OUTPUT_BUDGET_META_KEY,
	createHandoff,
	createTelemetryEvent,
	defaultExpose,
	defaultReconnectPolicy,
	error,
	failure,
	getHandoffProtocol,
	isFailure,
	isHandoff,
	isHandoffCommand,
	isHandoffProtocol,
	isReconnectPolicy,
	isSuccess,
	isTelemetryEvent,
	MAX_OUTPUT_BUDGET_BYTES,
	success,
} from '@lushly-dev/afd-core';
export type { OutputBudgetAsk, OutputBudgetReport } from '@lushly-dev/afd-core/commands';
// App-to-app calls (spec/command-metadata.md, "App-to-app calls")
export type { CallGrant } from '@lushly-dev/afd-core/internal/app-calls';
export { type AppCallRegistryOptions, createAppCallRegistry } from './app-call-registry.js';
// Pre-execution approval gate
export {
	type ApprovalCommand,
	type ApprovalMiddlewareOptions,
	type ApprovalNonceStore,
	type ApprovalRejection,
	type ApprovalRequest,
	type ApprovalSecret,
	createApprovalMiddleware,
} from './approval.js';
// Approval evidence from an approver client (spec/command-metadata.md)
export { AFD_APPROVAL_META_KEY, type ApproverPredicate } from './approver.js';
// Bootstrap tools
export {
	type ContextState,
	createAfdContextEnterCommand,
	createAfdContextExitCommand,
	createAfdContextListCommand,
	createAfdDocsCommand,
	createAfdHelpCommand,
	createAfdSchemaCommand,
	createContextState,
	type DescribedCommand,
	getBootstrapCommands,
} from './bootstrap/index.js';
export { DEFAULT_COMMAND_TIMEOUT_MS } from './command-timeout.js';
// Validating in-process registry for DirectClient
export {
	createDirectRegistry,
	type DirectCommandRegistry,
	type DirectExecuteOptions,
	type DirectListToolsOptions,
	type DirectRegistryCommand,
	type DirectRegistryOptions,
	type DirectToolSurface,
	type ExposeInterface,
} from './direct-registry.js';
export { createDirectToolSurface, type DirectToolSurfaceOptions } from './direct-tool-surface.js';
// Handoff schemas
export {
	type HandoffCredentialsInput,
	type HandoffCredentialsOutput,
	HandoffCredentialsSchema,
	type HandoffMetadataInput,
	type HandoffMetadataOutput,
	HandoffMetadataSchema,
	type HandoffResultInput,
	type HandoffResultOutput,
	HandoffResultSchema,
} from './handoff-schema.js';
// Host-verified confirmation relay and input digest (spec/command-metadata.md)
export {
	allowsUrlElicitation,
	type HumanRelay,
	inputDigest,
	isRelayUrl,
	RELAY_INPUT_KEY,
	type RelayBeginResult,
	type RelayCall,
	type RelayOutcome,
	type RelayPrompt,
} from './human-relay.js';
// Command journal: recording middleware and replay
export {
	createJournalMiddleware,
	JOURNAL_RESULT_UNSERIALIZABLE,
	type JournalMiddlewareOptions,
	type JournalRedactInfo,
} from './journal.js';
export {
	type JournalReplayTarget,
	type ReplayDifference,
	type ReplayEntryReport,
	type ReplayJournalOptions,
	type ReplayReport,
	type ReplayStatus,
	replayJournal,
} from './journal-replay.js';
// MCP authorization on HTTP (spec/authorization.md, M1 to M5 and M7): createMcpHandler's `auth`
export {
	type AuthRefusal,
	credentialsActor,
	type McpAuthOptions,
	type PreDispatch,
	type PreDispatchCheck,
	type PreDispatchCheckOptions,
} from './mcp-auth.js';
export { type BearerResult, extractBearer } from './mcp-auth-bearer.js';
export {
	createIntrospectionVerifier,
	type IntrospectionVerifierOptions,
	isCompactJws,
	type JwksKeySourceOptions,
	type JwtIssuer,
	JwtVerifier,
	type JwtVerifierOptions,
	jwksKeySource,
	type KeyLookup,
	type KeySource,
	type TokenRequest,
	type TokenVerification,
	type TokenVerifier,
} from './mcp-auth-jwt.js';
export {
	audienceAccepts,
	createProtectedResource,
	isScopeToken,
	PROTECTED_RESOURCE_WELL_KNOWN,
	type ProtectedResource,
	type ProtectedResourceOptions,
} from './mcp-auth-resource.js';
export {
	AUTH_RULE_CODES,
	type AuthRuleCode,
	type Credentials,
	checkClaims,
	checkIntrospection,
	checkJwsHeader,
	checkKeyFit,
	createTokenRules,
	DEFAULT_CLOCK_SKEW_S,
	DEFAULT_MAX_TOKEN_LIFETIME_S,
	DEFAULT_SCOPE_LIMIT,
	MAX_CLAIM_CHARS,
	MAX_CLOCK_SKEW_S,
	parseScopeClaim,
	type RuleResult,
	SIGNING_ALGORITHMS,
	type SigningAlgorithm,
	type TokenRules,
	type TokenRulesOptions,
} from './mcp-auth-rules.js';
export {
	type RequestDecision,
	requestDecision,
	ScopeChallenge,
	type ScopeDecision,
	type ScopeResolver,
	staticDecision,
} from './mcp-auth-scopes.js';
// MCP resources, tool `_meta` keys and Agent Skills (spec/mcp-resources.md)
export { checkMetaEntry } from './meta-keys.js';
// Middleware
export {
	ConsoleTelemetrySink,
	type ConsoleTelemetrySinkOptions,
	composeMiddleware,
	createAutoTraceIdMiddleware,
	createLoggingMiddleware,
	createRateLimitMiddleware,
	createRetryMiddleware,
	createTelemetryMiddleware,
	createTimingMiddleware,
	createTracingMiddleware,
	type DefaultMiddlewareOptions,
	defaultMiddleware,
	type LoggingOptions,
	type RateLimitOptions,
	type RetryOptions,
	type Span,
	type TelemetryOptions,
	type TimingOptions,
	type TraceIdOptions,
	type Tracer,
	type TracingOptions,
} from './middleware.js';
// Validation utilities
export {
	type DateRange,
	type Pagination,
	type PaginationInput,
	patterns,
	type Search,
	type Sorting,
	type SortingInput,
} from './patterns.js';
// The principal binding that confirmation and approval-relay state bind (spec/authorization.md, M8)
export {
	credentialsBinding,
	type PrincipalCredentials,
	principalBinding,
} from './principal-binding.js';
export {
	MCP_APP_MIME_TYPE,
	type ResourceCaller,
	type ResourceContents,
	type ResourceEntry,
	type ResourceProvider,
	type ResourcesOption,
} from './resources.js';
// Schema and command definition
export {
	defineCommand,
	defineCommandWithSchema,
	getRequiredFields,
	isObjectSchema,
	type ZodCommandDefinition,
	type ZodCommandOptions,
	type ZodToJsonSchemaOptions,
	zodToJsonSchema,
} from './schema.js';
export {
	type ContextConfig,
	createMcpHandler,
	createMcpServer,
	isStdinPiped,
	MAX_FIRST_CLASS_TOOLS,
	type McpHandler,
	type McpHandlerOptions,
	type McpServer,
	type McpServerOptions,
	type McpTransport,
	type ToolStrategy,
} from './server.js';
export {
	type Skill,
	SkillCatalog,
	type SkillCatalogOptions,
	skillFromDirectory,
} from './skills.js';
// MCP Tasks (spec/command-metadata.md, "Tasks"; SEP-2663)
export {
	applyTaskChange,
	DEFAULT_MAX_RUNNING_TASKS,
	DEFAULT_MAX_TASK_RESULT_BYTES,
	DEFAULT_MAX_TASKS,
	DEFAULT_MAX_TASKS_PER_OWNER,
	DEFAULT_TASK_CHECK_INTERVAL_MS,
	DEFAULT_TASK_MAX_RUN_MS,
	DEFAULT_TASK_POLL_INTERVAL_MS,
	DEFAULT_TASK_TTL_MS,
	InMemoryTaskStore,
	type InMemoryTaskStoreOptions,
	isTaskExpired,
	isTerminalTaskStatus,
	TASKS_EXTENSION_ID,
	type TaskCall,
	type TaskChange,
	type TaskOptions,
	type TaskRecord,
	type TaskRpcError,
	type TaskStatus,
	type TaskStore,
	TaskStoreError,
	type TaskStoreErrorKind,
	taskFailureResult,
	taskOwnerMatches,
} from './tasks.js';
export {
	DEFAULT_MAX_VALIDATION_ISSUES,
	type EnhancedValidationResult,
	formatEnhancedValidationError,
	formatValidationErrors,
	isValid,
	mapZodIssueCode,
	optional,
	type SchemaInfo,
	VALIDATION_ISSUE_CODES,
	type ValidationError,
	ValidationException,
	type ValidationIssueCode,
	type ValidationResult,
	validateInput,
	validateInputEnhanced,
	validateOrThrow,
	withDefault,
} from './validation.js';
// The brand on credentials afd-server verified itself (also `@lushly-dev/afd-server/credentials`)
export { isVerifiedCredentials } from './verified-credentials.js';
