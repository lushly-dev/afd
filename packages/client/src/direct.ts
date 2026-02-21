/**
 * @fileoverview Direct Transport for zero-overhead in-process command execution
 *
 * This transport enables co-located agents to execute commands directly
 * without any transport overhead (no JSON-RPC, no IPC, no network).
 *
 * @example
 * ```typescript
 * import { createDirectClient } from '@lushly-dev/afd-client';
 * import { registry } from '@my-app/commands';
 *
 * const client = createDirectClient(registry);
 * const result = await client.call('todo-create', { title: 'Fast!' });
 * // ~0.03-0.1ms latency vs 10-100ms for MCP
 * ```
 *
 * @example Context propagation
 * ```typescript
 * const client = createDirectClient(registry, {
 *   source: 'my-agent',
 *   debug: true,
 * });
 *
 * // traceId is auto-generated or can be passed per-call
 * const result = await client.call('command', args, { traceId: 'trace-123' });
 * ```
 */

import type {
	CommandContext,
	CommandMiddleware,
	CommandResult,
	HandoffResult,
	McpRequest,
	McpResponse,
	McpTool,
	PipelineContext,
	PipelineMetadata,
	PipelineRequest,
	PipelineResult,
	PipelineStep,
	ResultMetadata,
	StepResult,
} from '@lushly-dev/afd-core';
import {
	aggregatePipelineAlternatives,
	aggregatePipelineConfidence,
	aggregatePipelineReasoning,
	aggregatePipelineSources,
	aggregatePipelineWarnings,
	buildConfidenceBreakdown,
	evaluateCondition,
	failure,
	resolveVariables,
	validationError,
} from '@lushly-dev/afd-core';
import type {
	HandoffConnection,
	HandoffConnectionOptions,
	ReconnectingHandoffConnection,
	ReconnectionOptions,
} from './handoff.js';
import { connectHandoff, createReconnectingHandoff } from './handoff.js';
import type { Transport } from './transport.js';

// ═══════════════════════════════════════════════════════════════════════════
// UNKNOWN TOOL ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Structured error returned when an agent calls a non-existent tool.
 * Provides actionable information for the agent to self-correct.
 */
export interface UnknownToolError {
	error: 'UNKNOWN_TOOL';
	message: string;
	requested_tool: string;
	available_tools: string[];
	suggestions: string[];
	hint: string | null;
}

/**
 * Calculate similarity between two strings using Levenshtein distance.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
function calculateSimilarity(a: string, b: string): number {
	const aLower = a.toLowerCase();
	const bLower = b.toLowerCase();

	if (aLower === bLower) return 1;

	const matrix: number[][] = [];

	for (let i = 0; i <= aLower.length; i++) {
		matrix[i] = [i];
	}

	const firstRow = matrix[0];
	if (!firstRow) return 0;
	for (let j = 0; j <= bLower.length; j++) {
		firstRow[j] = j;
	}

	for (let i = 1; i <= aLower.length; i++) {
		const currentRow = matrix[i];
		const prevRow = matrix[i - 1];
		if (!currentRow || !prevRow) continue;
		for (let j = 1; j <= bLower.length; j++) {
			const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
			const deletion = prevRow[j] ?? 0;
			const insertion = currentRow[j - 1] ?? 0;
			const substitution = prevRow[j - 1] ?? 0;
			currentRow[j] = Math.min(deletion + 1, insertion + 1, substitution + cost);
		}
	}

	const maxLen = Math.max(aLower.length, bLower.length);
	const distance = matrix[aLower.length]?.[bLower.length] ?? maxLen;
	return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

/**
 * Find similar tool names for suggestions.
 * Returns tools with similarity >= 0.4, sorted by similarity.
 */
function findSimilarTools(
	requestedTool: string,
	availableTools: string[],
	maxSuggestions = 3
): string[] {
	return availableTools
		.map((tool) => ({ tool, similarity: calculateSimilarity(requestedTool, tool) }))
		.filter((item) => item.similarity >= 0.4)
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, maxSuggestions)
		.map((item) => item.tool);
}

/**
 * Create a structured unknown tool error.
 */
function createUnknownToolError(requestedTool: string, availableTools: string[]): UnknownToolError {
	const suggestions = findSimilarTools(requestedTool, availableTools);
	const hint = suggestions.length > 0 ? `Did you mean '${suggestions[0]}'?` : null;

	return {
		error: 'UNKNOWN_TOOL',
		message: `Tool '${requestedTool}' not found in registry`,
		requested_tool: requestedTool,
		available_tools: availableTools,
		suggestions,
		hint,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// DIRECT CLIENT OPTIONS AND CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for creating a DirectClient.
 */
export interface DirectClientOptions {
	/**
	 * Source identifier for this client (e.g., 'my-agent', 'api-server').
	 * Propagated to command handlers via context.
	 */
	source?: string;

	/**
	 * Enable debug logging.
	 */
	debug?: boolean;

	/**
	 * Whether to validate inputs against command schemas.
	 * Default: true
	 */
	validateInputs?: boolean;

	/**
	 * Middleware to run before command execution.
	 * Executes in onion pattern (same as server middleware).
	 * When empty or omitted, the zero-overhead path is preserved.
	 */
	middleware?: CommandMiddleware[];
}

/**
 * Context options for individual command calls.
 */
export interface DirectCallContext {
	/**
	 * Trace ID for this command invocation.
	 * If not provided, one will be auto-generated.
	 */
	traceId?: string;

	/**
	 * Timeout in milliseconds for this call.
	 */
	timeout?: number;

	/**
	 * Signal for cancellation.
	 */
	signal?: AbortSignal;

	/**
	 * Additional custom context values.
	 */
	[key: string]: unknown;
}

/**
 * Interface for command registries that support direct execution.
 *
 * Implement this interface in your application to enable direct transport.
 */
export interface DirectRegistry {
	/**
	 * Execute a command directly.
	 * @param name - Command name
	 * @param input - Command input
	 * @param context - Optional command context for tracing/cancellation
	 * @returns Command result
	 */
	execute<T>(name: string, input?: unknown, context?: CommandContext): Promise<CommandResult<T>>;

	/**
	 * List available command names.
	 */
	listCommandNames(): string[];

	/**
	 * List commands with metadata.
	 */
	listCommands(): Array<{ name: string; description: string }>;

	/**
	 * Check if a command exists.
	 */
	hasCommand(name: string): boolean;

	/**
	 * Get command definition for validation (optional).
	 * If provided, enables input validation.
	 */
	getCommand?(name: string): CommandDefinition | undefined;
}

/**
 * Command definition for validation purposes.
 * Matches the structure from @lushly-dev/afd-core.
 */
export interface CommandDefinition {
	name: string;
	description: string;
	parameters: CommandParameter[];
}

/**
 * Command parameter definition for validation.
 */
export interface CommandParameter {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
	description: string;
	required?: boolean;
	default?: unknown;
	enum?: unknown[];
}

/**
 * Direct transport for in-process command execution.
 *
 * This transport calls the command registry directly, bypassing
 * all MCP protocol overhead. It provides:
 *
 * - **Zero latency**: ~0.01-0.1ms per call (vs 10-100ms for MCP)
 * - **No serialization**: Objects passed directly (no JSON encode/decode)
 * - **Same API**: Compatible with Transport interface for drop-in use
 *
 * Trade-offs:
 * - Requires same runtime (Node.js, Bun, etc.)
 * - No process isolation (exceptions propagate)
 * - Registry must be importable
 */
export class DirectTransport implements Transport {
	private connected = false;
	private messageHandler: ((response: McpResponse) => void) | null = null;
	private errorHandler: ((error: Error) => void) | null = null;
	private closeHandler: (() => void) | null = null;
	private requestIdCounter = 0;

	constructor(private readonly registry: DirectRegistry) {}

	/**
	 * Connect (no-op for direct transport, always succeeds immediately).
	 */
	async connect(): Promise<void> {
		this.connected = true;
	}

	/**
	 * Disconnect (marks as disconnected).
	 */
	disconnect(): void {
		this.connected = false;
		if (this.closeHandler) {
			this.closeHandler();
		}
	}

	/**
	 * Send a request by executing the command directly.
	 *
	 * This bypasses MCP protocol and calls the registry directly.
	 */
	async send(request: McpRequest): Promise<McpResponse> {
		const requestId = request.id ?? ++this.requestIdCounter;

		try {
			// Handle MCP protocol methods
			if (request.method === 'initialize') {
				return this.handleInitialize(requestId);
			}

			if (request.method === 'tools/list') {
				return this.handleToolsList(requestId);
			}

			if (request.method === 'tools/call') {
				// SAFETY: When method is 'tools/call', params conforms to ToolCallParams per the MCP protocol spec.
				const params = request.params as unknown as ToolCallParams;
				return await this.handleToolCall(requestId, params);
			}

			// Unknown method
			return {
				jsonrpc: '2.0',
				id: requestId,
				error: {
					code: -32601,
					message: `Method not found: ${request.method}`,
				},
			};
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));

			if (this.errorHandler) {
				this.errorHandler(err);
			}

			return {
				jsonrpc: '2.0',
				id: requestId,
				error: {
					code: -32603,
					message: err.message,
				},
			};
		}
	}

	/**
	 * Check if connected.
	 */
	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Set message handler (called after each response).
	 */
	onMessage(handler: (response: McpResponse) => void): void {
		this.messageHandler = handler;
	}

	/**
	 * Set error handler.
	 */
	onError(handler: (error: Error) => void): void {
		this.errorHandler = handler;
	}

	/**
	 * Set close handler.
	 */
	onClose(handler: () => void): void {
		this.closeHandler = handler;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// MCP PROTOCOL HANDLERS
	// ═══════════════════════════════════════════════════════════════════════════

	private handleInitialize(requestId: string | number): McpResponse {
		return {
			jsonrpc: '2.0',
			id: requestId,
			result: {
				protocolVersion: '2024-11-05',
				capabilities: {
					tools: { listChanged: false },
				},
				serverInfo: {
					name: 'direct-transport',
					version: '1.0.0',
				},
			},
		};
	}

	private handleToolsList(requestId: string | number): McpResponse {
		const commands = this.registry.listCommands();

		const tools: McpTool[] = commands.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
			inputSchema: {
				type: 'object' as const,
				properties: {},
			},
		}));

		return {
			jsonrpc: '2.0',
			id: requestId,
			result: {
				tools,
			},
		};
	}

	private async handleToolCall(
		requestId: string | number,
		params: ToolCallParams
	): Promise<McpResponse> {
		const { name, arguments: args } = params;

		// Check if the command exists - return structured error if not
		if (!this.registry.hasCommand(name)) {
			const availableTools = this.registry.listCommandNames();
			const unknownToolError = createUnknownToolError(name, availableTools);

			// Return as a successful MCP response with error content
			// This allows the agent to receive and process the error
			const content = [
				{
					type: 'text' as const,
					text: JSON.stringify(unknownToolError),
				},
			];

			const response: McpResponse = {
				jsonrpc: '2.0',
				id: requestId,
				result: {
					content,
					isError: true,
				},
			};

			if (this.messageHandler) {
				this.messageHandler(response);
			}

			return response;
		}

		// Execute the command directly
		const result = await this.registry.execute(name, args ?? {});

		// Convert CommandResult to MCP response format
		const content = [
			{
				type: 'text' as const,
				text: JSON.stringify(result),
			},
		];

		const response: McpResponse = {
			jsonrpc: '2.0',
			id: requestId,
			result: {
				content,
				isError: !result.success,
			},
		};

		// Dispatch through message handler if set
		if (this.messageHandler) {
			this.messageHandler(response);
		}

		return response;
	}
}

/**
 * Tool call parameters from MCP protocol.
 */
interface ToolCallParams {
	name: string;
	arguments?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// INPUT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validation error details for a specific parameter.
 */
interface ValidationIssue {
	parameter: string;
	message: string;
	expected?: string;
	received?: string;
}

/**
 * Validate input against command parameters.
 * Returns null if valid, or an array of validation issues.
 */
function validateInput(
	input: Record<string, unknown> | undefined,
	parameters: CommandParameter[]
): ValidationIssue[] | null {
	const issues: ValidationIssue[] = [];
	const inputObj = input ?? {};

	for (const param of parameters) {
		const value = inputObj[param.name];

		// Check required parameters
		if (param.required && value === undefined) {
			issues.push({
				parameter: param.name,
				message: `Required parameter '${param.name}' is missing`,
				expected: param.type,
			});
			continue;
		}

		// Skip validation for undefined optional parameters
		if (value === undefined) {
			continue;
		}

		// Type validation
		const actualType = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
		if (actualType !== param.type) {
			issues.push({
				parameter: param.name,
				message: `Parameter '${param.name}' has wrong type`,
				expected: param.type,
				received: actualType,
			});
		}

		// Enum validation
		if (param.enum && !param.enum.includes(value)) {
			issues.push({
				parameter: param.name,
				message: `Parameter '${param.name}' must be one of: ${param.enum.join(', ')}`,
				expected: param.enum.join(' | '),
				received: String(value),
			});
		}
	}

	return issues.length > 0 ? issues : null;
}

/**
 * Generate a unique trace ID.
 */
function generateTraceId(): string {
	return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * DirectClient for zero-overhead in-process command execution.
 *
 * Use this when you don't need the full McpClient features like
 * reconnection, events, etc. This provides the minimal API for
 * command execution with optional validation and context propagation.
 *
 * @example
 * ```typescript
 * import { createDirectClient } from '@lushly-dev/afd-client';
 * import { registry } from '@my-app/commands';
 *
 * const client = createDirectClient(registry);
 *
 * // Type-safe command execution
 * const result = await client.call<Todo>('todo-create', { title: 'Test' });
 *
 * if (result.success) {
 *   console.log(result.data.id);
 * }
 * ```
 *
 * @example With context propagation
 * ```typescript
 * const client = createDirectClient(registry, {
 *   source: 'my-agent',
 *   debug: true,
 * });
 *
 * // Context is propagated to command handlers
 * const result = await client.call('command', args, { traceId: 'custom-trace' });
 * ```
 */
export class DirectClient {
	private readonly options: Required<Omit<DirectClientOptions, 'source' | 'middleware'>> & {
		source?: string;
		middleware: CommandMiddleware[];
	};

	constructor(
		private readonly registry: DirectRegistry,
		options: DirectClientOptions = {}
	) {
		this.options = {
			source: options.source,
			debug: options.debug ?? false,
			validateInputs: options.validateInputs ?? true,
			middleware: options.middleware ?? [],
		};
	}

	/**
	 * Call a command and return a CommandResult.
	 *
	 * This is the most efficient path - direct registry access
	 * with zero transport overhead.
	 *
	 * @param name - Command name
	 * @param args - Command arguments
	 * @param context - Optional context for tracing/cancellation
	 * @returns Command result
	 */
	async call<T = unknown>(
		name: string,
		args?: Record<string, unknown>,
		context?: DirectCallContext
	): Promise<CommandResult<T> | CommandResult<UnknownToolError>> {
		const startTime = this.options.debug ? performance.now() : 0;
		const traceId = context?.traceId ?? generateTraceId();

		this.debug(`[${traceId}] Calling ${name}`, args);

		// Check if the command exists - return structured error if not
		if (!this.registry.hasCommand(name)) {
			const availableTools = this.registry.listCommandNames();
			const unknownToolError = createUnknownToolError(name, availableTools);

			this.debug(`[${traceId}] Unknown command: ${name}`);

			// Return as a CommandResult with the UnknownToolError as data
			// This allows agents to receive structured information for recovery
			return {
				success: false,
				data: unknownToolError,
				error: {
					code: 'UNKNOWN_TOOL',
					message: unknownToolError.message,
				},
			};
		}

		// Input validation (if registry supports getCommand)
		if (this.options.validateInputs && this.registry.getCommand) {
			const command = this.registry.getCommand(name);
			if (command) {
				const issues = validateInput(args, command.parameters);
				if (issues) {
					this.debug(`[${traceId}] Validation failed:`, issues);

					return failure(
						validationError(
							`Invalid input for '${name}': ${issues.map((i) => i.message).join('; ')}`,
							{ issues }
						)
					) as CommandResult<T>;
				}
			}
		}

		// Build command context
		const commandContext: CommandContext = {
			traceId,
			...context,
		};

		// Add source if configured
		if (this.options.source) {
			commandContext.source = this.options.source;
		}

		// Execute the command (with middleware if configured)
		let result: CommandResult<T>;

		if (this.options.middleware.length > 0) {
			// Build onion chain around registry.execute()
			let next: () => Promise<CommandResult> = () =>
				this.registry.execute<T>(name, args, commandContext);
			for (let i = this.options.middleware.length - 1; i >= 0; i--) {
				const mw = this.options.middleware[i];
				if (!mw) continue;
				const currentNext = next;
				next = () => mw(name, args ?? {}, commandContext, currentNext);
			}
			result = (await next()) as CommandResult<T>;
		} else {
			// Zero-overhead path: no middleware
			result = await this.registry.execute<T>(name, args, commandContext);
		}

		if (this.options.debug) {
			const duration = performance.now() - startTime;
			this.debug(`[${traceId}] Completed in ${duration.toFixed(3)}ms`, {
				success: result.success,
			});
		}

		return result;
	}

	/**
	 * List available commands.
	 */
	listCommands(): Array<{ name: string; description: string }> {
		return this.registry.listCommands();
	}

	/**
	 * List command names.
	 */
	listCommandNames(): string[] {
		return this.registry.listCommandNames();
	}

	/**
	 * Check if a command exists.
	 */
	hasCommand(name: string): boolean {
		return this.registry.hasCommand(name);
	}

	/**
	 * Get the source identifier for this client.
	 */
	getSource(): string | undefined {
		return this.options.source;
	}

	/**
	 * Connect to a handoff endpoint using the appropriate protocol handler.
	 *
	 * @param handoff - The handoff result from a command
	 * @param options - Connection options and callbacks
	 * @returns A promise that resolves to a HandoffConnection
	 * @throws Error if no handler is registered for the protocol
	 */
	async connectHandoff(
		handoff: HandoffResult,
		options: HandoffConnectionOptions = {}
	): Promise<HandoffConnection> {
		return connectHandoff(handoff, options);
	}

	/**
	 * Create a reconnecting handoff connection with automatic retry logic.
	 *
	 * @param handoff - The initial handoff result
	 * @param options - Reconnection options and callbacks
	 * @returns A promise that resolves to a ReconnectingHandoffConnection
	 */
	async createReconnectingHandoff(
		handoff: HandoffResult,
		options: ReconnectionOptions = {}
	): Promise<ReconnectingHandoffConnection> {
		return createReconnectingHandoff(this, handoff, options);
	}

	/**
	 * Execute a pipeline of commands, chaining outputs to inputs.
	 *
	 * Pipelines allow declarative composition of commands where the output
	 * of one step flows into the next. Supports variable resolution
	 * ($prev, $first, $steps[n], $steps.alias), conditional execution,
	 * and aggregated metadata (confidence, reasoning, warnings).
	 *
	 * @param request - Pipeline request or array of steps
	 * @param context - Optional call context for tracing
	 * @returns Pipeline result with final data and aggregated metadata
	 *
	 * @example Basic pipeline
	 * ```typescript
	 * const result = await client.pipe([
	 *   { command: 'user-get', input: { id: 123 }, as: 'user' },
	 *   { command: 'order-list', input: { userId: '$prev.id' } },
	 *   { command: 'order-total', input: { orders: '$prev' } }
	 * ]);
	 *
	 * console.log(result.data); // Total from last step
	 * console.log(result.metadata.confidence); // Minimum confidence across steps
	 * ```
	 *
	 * @example Conditional execution
	 * ```typescript
	 * const result = await client.pipe([
	 *   { command: 'user-get', input: { id: 123 }, as: 'user' },
	 *   {
	 *     command: 'premium-features',
	 *     input: { userId: '$user.id' },
	 *     when: { $eq: ['$user.tier', 'premium'] }
	 *   }
	 * ]);
	 * ```
	 */
	async pipe<T = unknown>(
		request: PipelineRequest | PipelineStep[],
		context?: DirectCallContext
	): Promise<PipelineResult<T>> {
		const startTime = performance.now();
		const traceId = context?.traceId ?? generateTraceId();

		// Normalize request
		const pipelineRequest: PipelineRequest = Array.isArray(request) ? { steps: request } : request;

		const { steps: stepDefs, options = {} } = pipelineRequest;
		const { continueOnFailure = false, timeoutMs } = options;

		this.debug(`[${traceId}] Starting pipeline with ${stepDefs.length} steps`);

		// Initialize pipeline context
		const pipelineContext: PipelineContext = {
			pipelineInput: undefined,
			steps: [],
			previousResult: undefined,
		};

		const stepResults: StepResult[] = [];
		let finalData: unknown;
		let pipelineFailed = false;

		// Execute each step
		for (let i = 0; i < stepDefs.length; i++) {
			const stepDef = stepDefs[i];
			if (!stepDef) continue;
			const stepStartTime = performance.now();

			// Check timeout
			if (timeoutMs && performance.now() - startTime > timeoutMs) {
				const stepResult: StepResult = {
					index: i,
					alias: stepDef.as,
					command: stepDef.command,
					status: 'skipped',
					executionTimeMs: 0,
					error: {
						code: 'TIMEOUT',
						message: `Pipeline timeout (${timeoutMs}ms) exceeded`,
					},
				};
				stepResults.push(stepResult);
				pipelineFailed = true;
				break;
			}

			// Evaluate condition if present
			if (stepDef.when) {
				const conditionMet = evaluateCondition(stepDef.when, pipelineContext);
				if (!conditionMet) {
					this.debug(`[${traceId}] Step ${i} (${stepDef.command}) skipped: condition not met`);
					const stepResult: StepResult = {
						index: i,
						alias: stepDef.as,
						command: stepDef.command,
						status: 'skipped',
						executionTimeMs: 0,
					};
					stepResults.push(stepResult);
					// Add to context with undefined data so alias is still resolvable
					pipelineContext.steps.push({
						index: i,
						alias: stepDef.as,
						command: stepDef.command,
						status: 'skipped',
						data: undefined,
						executionTimeMs: 0,
					});
					continue;
				}
			}

			// If pipeline already failed and we're not continuing on failure, skip
			if (pipelineFailed && !continueOnFailure) {
				const stepResult: StepResult = {
					index: i,
					alias: stepDef.as,
					command: stepDef.command,
					status: 'skipped',
					executionTimeMs: 0,
				};
				stepResults.push(stepResult);
				continue;
			}

			// Resolve variables in input
			const resolvedInput = stepDef.input
				? (resolveVariables(stepDef.input, pipelineContext) as Record<string, unknown>)
				: undefined;

			this.debug(`[${traceId}] Step ${i}: ${stepDef.command}`, resolvedInput);

			// Execute the command
			const result = await this.call<unknown>(stepDef.command, resolvedInput, {
				...context,
				traceId: `${traceId}-step-${i}`,
			});

			const stepExecutionTime = performance.now() - stepStartTime;

			if (result.success) {
				const stepResult: StepResult = {
					index: i,
					alias: stepDef.as,
					command: stepDef.command,
					status: 'success',
					data: result.data,
					executionTimeMs: stepExecutionTime,
					metadata: this.extractResultMetadata(result),
				};
				stepResults.push(stepResult);

				// Update context
				pipelineContext.steps.push(stepResult);
				pipelineContext.previousResult = stepResult;
				finalData = result.data;
			} else {
				const stepResult: StepResult = {
					index: i,
					alias: stepDef.as,
					command: stepDef.command,
					status: 'failure',
					error: result.error,
					executionTimeMs: stepExecutionTime,
				};
				stepResults.push(stepResult);
				pipelineContext.steps.push(stepResult);
				pipelineFailed = true;

				if (!continueOnFailure) {
					this.debug(`[${traceId}] Pipeline failed at step ${i}: ${result.error?.message}`);
					// Mark remaining steps as skipped
					for (let j = i + 1; j < stepDefs.length; j++) {
						const skippedDef = stepDefs[j];
						if (!skippedDef) continue;
						stepResults.push({
							index: j,
							alias: skippedDef.as,
							command: skippedDef.command,
							status: 'skipped',
							executionTimeMs: 0,
						});
					}
					break;
				}
			}
		}

		const totalExecutionTime = performance.now() - startTime;

		// Build aggregated metadata
		const metadata = this.buildPipelineMetadata(stepResults, stepDefs, totalExecutionTime);

		this.debug(`[${traceId}] Pipeline completed in ${totalExecutionTime.toFixed(3)}ms`, {
			completedSteps: metadata.completedSteps,
			totalSteps: metadata.totalSteps,
			success: !pipelineFailed,
		});

		return {
			data: finalData as T,
			metadata,
			steps: stepResults,
		};
	}

	/**
	 * Extract metadata from a command result.
	 */
	private extractResultMetadata(result: CommandResult<unknown>): ResultMetadata {
		return {
			confidence: result.confidence,
			reasoning: result.reasoning,
			warnings: result.warnings,
			sources: result.sources,
			alternatives: result.alternatives,
			executionTimeMs: result.metadata?.executionTimeMs,
		};
	}

	/**
	 * Build aggregated pipeline metadata from step results.
	 */
	private buildPipelineMetadata(
		steps: StepResult[],
		stepDefs: PipelineStep[],
		totalExecutionTime: number
	): PipelineMetadata {
		const completedSteps = steps.filter((s) => s.status === 'success').length;
		const totalSteps = steps.length;

		return {
			confidence: aggregatePipelineConfidence(steps),
			confidenceBreakdown: buildConfidenceBreakdown(steps, stepDefs),
			reasoning: aggregatePipelineReasoning(steps),
			warnings: aggregatePipelineWarnings(steps),
			sources: aggregatePipelineSources(steps),
			alternatives: aggregatePipelineAlternatives(steps),
			executionTimeMs: totalExecutionTime,
			completedSteps,
			totalSteps,
		};
	}

	/**
	 * Debug logging helper.
	 */
	private debug(message: string, data?: unknown): void {
		if (this.options.debug) {
			console.log(`[DirectClient] ${message}`, data ?? '');
		}
	}
}

/**
 * Create a new DirectClient for zero-overhead command execution.
 *
 * This is the recommended way to create a DirectClient. It provides
 * the same API as McpClient.call() but with ~100x faster execution
 * for co-located modules.
 *
 * @param registry - The command registry to execute against
 * @param options - Optional configuration for validation, context, and debugging
 * @returns A new DirectClient instance
 *
 * @example Basic usage
 * ```typescript
 * import { createDirectClient } from '@lushly-dev/afd-client';
 * import { registry } from './commands';
 *
 * const client = createDirectClient(registry);
 * const result = await client.call('plant.get', { id: 'tomato-123' });
 * // ~0.03-0.1ms latency vs ~2-10ms for MCP
 * ```
 *
 * @example With options
 * ```typescript
 * const client = createDirectClient(registry, {
 *   source: 'garden-api',
 *   debug: true,
 *   validateInputs: true,
 * });
 * ```
 */
export function createDirectClient(
	registry: DirectRegistry,
	options?: DirectClientOptions
): DirectClient {
	return new DirectClient(registry, options);
}
