// afd-override: max-lines=950 — MCP client lifecycle and public request APIs; parsing and transport helpers are separate modules
/**
 * @fileoverview MCP Client implementation
 */

import type {
	BatchCommand,
	BatchOptions,
	BatchResult,
	CommandResult,
	McpInitializeResult,
	McpResponse,
	McpTool,
	McpToolCallResult,
	McpToolsListResult,
	PipelineOptions,
	PipelineRequest,
	PipelineResult,
	PipelineStep,
	StreamCallbacks,
	StreamChunk,
	StreamOptions,
} from '@lushly-dev/afd-core';
import {
	createMcpRequest,
	failure,
	isCompleteChunk,
	isDataChunk,
	isErrorChunk,
	isProgressChunk,
	success,
} from '@lushly-dev/afd-core';
import { backoffDelay, CancellableDelay } from './backoff.js';
import {
	isOutcomeUnknown,
	JsonRpcResponseError,
	NotConnectedError,
	RequestTimeoutError,
	toCommandError,
} from './client-errors.js';
import { McpClientEventEmitter } from './client-events.js';
import { DirectTransport } from './direct-transport.js';
import type { DirectRegistry } from './direct-types.js';
import {
	deriveStreamUrl,
	type StreamAbortState,
	streamDirect,
	streamErrorChunk,
	streamOverHttp,
} from './mcp-stream.js';
import {
	createBatchFailure,
	createPipelineFailure,
	createUnknownOutcomeBatch,
	createUnknownOutcomePipeline,
	getTextContent,
	isBatchResult,
	isCommandResult,
	isPipelineResult,
	outcomeUnknownError,
	parseTextContent,
} from './result-parsing.js';
import { DEFAULT_MAX_SSE_EVENT_SIZE } from './sse-parser.js';
import { createTransport, type Transport } from './transport.js';
import type {
	ClientStatus,
	ConnectionState,
	McpClientConfig,
	McpTransportType,
	PendingRequest,
} from './types.js';

/**
 * Resolved config type where url is always a string (resolved from url or endpoint).
 */
type ResolvedConfig = Omit<Required<McpClientConfig>, 'url' | 'endpoint' | 'registry'> & {
	url: string;
	endpoint?: string;
};

/** Options for a single `request()` or `callTool()`. */
export interface RequestOptions {
	/** Request timeout in milliseconds. Default: the client's `timeout`. */
	timeout?: number;
}

const SUPPORTED_TRANSPORTS: ReadonlySet<string> = new Set<McpTransportType>([
	'sse',
	'http',
	'direct',
]);

/** Node timers fire immediately for delays above 2^31 - 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Extra time `batch()` and `pipe()` wait beyond the server-side deadline in their options, so
 * the server's own timeout result can arrive before the client gives up.
 */
export const SERVER_DEADLINE_MARGIN_MS = 5000;

/**
 * MCP Client for AFD servers (`createMcpServer()` from `@lushly-dev/afd-server`) and in-process
 * registries.
 *
 * It speaks the AFD server's HTTP transport (`/sse` + `POST /message`, `POST /stream/<command>`).
 * It does not implement the MCP Streamable HTTP transport or read the legacy SSE `endpoint`
 * event, so it cannot talk to servers built on the official MCP SDK.
 *
 * @example
 * ```typescript
 * const client = new McpClient({ url: 'http://localhost:3100/sse' });
 *
 * await client.connect();
 *
 * // List available tools
 * const tools = await client.listTools();
 *
 * // Call a tool
 * const result = await client.call('document-create', { title: 'Test' });
 *
 * await client.disconnect();
 * ```
 */
export class McpClient extends McpClientEventEmitter {
	private readonly config: ResolvedConfig;
	private readonly registry: DirectRegistry | undefined;
	private transport: Transport | null = null;
	private state: ConnectionState = 'disconnected';
	private serverInfo: McpInitializeResult['serverInfo'] | null = null;
	private capabilities: McpInitializeResult['capabilities'] | null = null;
	private tools: McpTool[] = [];
	private connectedAt: Date | null = null;
	private reconnectAttempts = 0;
	private pendingRequests = new Map<string | number, PendingRequest>();
	private activeStreams = new Set<AbortController>();
	private intentionalDisconnect = false;
	private connectionGeneration = 0;
	private connectionController: AbortController | null = null;
	private readonly reconnectWait = new CancellableDelay();
	private reconnectPromise: Promise<void> | null = null;
	private reconnectGeneration: number | null = null;

	constructor(config: McpClientConfig) {
		super();
		const transport: string = config.transport ?? 'sse';
		if (!SUPPORTED_TRANSPORTS.has(transport)) {
			throw new Error(
				`Unsupported transport '${transport}'. McpClient supports 'sse', 'http' and 'direct' (with a registry).`
			);
		}
		if (transport === 'direct' && !config.registry) {
			throw new Error(
				"transport: 'direct' requires a registry: pass { transport: 'direct', registry: createDirectRegistry(commands) } (from @lushly-dev/afd-server), or use createDirectClient(registry)."
			);
		}

		// Resolve url from url or endpoint
		const resolvedUrl =
			config.url ?? config.endpoint ?? (transport === 'direct' ? 'direct://in-process' : undefined);
		if (!resolvedUrl) {
			throw new Error('Either url or endpoint must be provided');
		}

		this.registry = transport === 'direct' ? config.registry : undefined;
		this.config = {
			url: resolvedUrl,
			endpoint: config.endpoint,
			transport: transport as McpTransportType,
			clientName: config.clientName ?? '@lushly-dev/afd-client',
			clientVersion: config.clientVersion ?? '0.1.0',
			timeout: config.timeout ?? 30000,
			autoReconnect: config.autoReconnect ?? true,
			maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
			reconnectDelay: config.reconnectDelay ?? 1000,
			maxReconnectDelay: config.maxReconnectDelay ?? 30000,
			maxStreamEventSize: config.maxStreamEventSize ?? DEFAULT_MAX_SSE_EVENT_SIZE,
			headers: config.headers ?? {},
			debug: config.debug ?? false,
		};
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// CONNECTION MANAGEMENT
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Connect to the MCP server. Resolves, and `connected` is emitted, once the server is
	 * initialized and the tools list has been fetched (a failed tools refresh leaves the list
	 * empty but does not fail the connection).
	 */
	async connect(): Promise<McpInitializeResult> {
		if (this.state === 'connected') {
			throw new Error('Already connected');
		}

		this.intentionalDisconnect = false;
		this.reconnectWait.cancel();
		this.reconnectAttempts = 0;
		const generation = ++this.connectionGeneration;
		return this.establishConnection(generation, false);
	}

	/**
	 * Disconnect from the MCP server. Pending requests reject and active streams end with a
	 * `STREAM_CANCELLED` error chunk.
	 */
	async disconnect(): Promise<void> {
		this.intentionalDisconnect = true;
		this.connectionGeneration++;
		this.reconnectWait.cancel();
		this.connectionController?.abort(new Error('Client disconnected'));
		this.connectionController = null;

		const transport = this.transport;
		this.transport = null;
		transport?.disconnect();

		// Reject all pending requests and abort all streams
		for (const pending of this.pendingRequests.values()) {
			clearTimeout(pending.timeout);
			pending.controller.abort(new Error('Client disconnected'));
		}
		this.pendingRequests.clear();
		for (const controller of this.activeStreams) {
			controller.abort(new Error('Client disconnected'));
		}
		this.activeStreams.clear();

		this.setState('disconnected');
		this.emit('disconnected', 'Manual disconnect');

		this.serverInfo = null;
		this.capabilities = null;
		this.connectedAt = null;
		this.tools = [];
	}

	/**
	 * Get current client status.
	 */
	getStatus(): ClientStatus {
		return {
			state: this.state,
			url: this.state !== 'disconnected' ? this.config.url : null,
			serverInfo: this.serverInfo,
			capabilities: this.capabilities,
			connectedAt: this.connectedAt,
			reconnectAttempts: this.reconnectAttempts,
			pendingRequests: this.pendingRequests.size,
		};
	}

	/**
	 * Check if connected.
	 */
	isConnected(): boolean {
		return this.state === 'connected' && this.transport?.isConnected() === true;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// MCP OPERATIONS
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * List available tools.
	 */
	async listTools(): Promise<McpTool[]> {
		const response = await this.request<McpToolsListResult>('tools/list');
		this.tools = response.tools;
		return this.tools;
	}

	/**
	 * Get cached tools list.
	 */
	getTools(): McpTool[] {
		return this.tools;
	}

	/**
	 * Refresh tools list from server.
	 */
	async refreshTools(): Promise<McpTool[]> {
		const tools = await this.listTools();
		this.emit('toolsChanged', tools);
		return tools;
	}

	/**
	 * Call a tool and return raw MCP result.
	 *
	 * @param name - Tool name
	 * @param args - Tool arguments
	 * @param options - Request options such as `timeout`
	 */
	async callTool(
		name: string,
		args?: Record<string, unknown>,
		options?: RequestOptions
	): Promise<McpToolCallResult> {
		const params = {
			name,
			arguments: args,
		};

		return this.request<McpToolCallResult>(
			'tools/call',
			params as Record<string, unknown>,
			options
		);
	}

	/**
	 * Call a command and return a CommandResult.
	 *
	 * This is the preferred method for AFD - it wraps the MCP response
	 * in a standardized CommandResult. It never rejects: a JSON-RPC error becomes a failure with
	 * a matching AFD code (`INVALID_INPUT` for -32602, `SESSION_NOT_FOUND` for -32001, ...), a
	 * timeout becomes `TIMEOUT`, and a connection problem `CONNECTION_ERROR` or `NOT_CONNECTED`.
	 *
	 * @param name - Command/tool name
	 * @param args - Command arguments
	 */
	async call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<CommandResult<T>> {
		try {
			const result = await this.callTool(name, args);
			const parsed = parseTextContent(result);

			if (isCommandResult(parsed)) {
				return parsed as CommandResult<T>;
			}

			if (result.isError) {
				const errorText = getTextContent(result);

				return failure({
					code: 'TOOL_ERROR',
					message: errorText || 'Tool execution failed',
					suggestion: 'Check the tool arguments and try again',
				});
			}

			// Try to parse JSON from text content
			if (parsed !== undefined) return success(parsed as T);

			// SAFETY: Non-AFD tools may return plain text. Preserve that established fallback.
			return success(getTextContent(result) as unknown as T);
		} catch (error) {
			return failure(toCommandError(error));
		}
	}

	/**
	 * Execute multiple commands in a single batch request.
	 *
	 * Batch execution provides partial success semantics - the batch
	 * succeeds if at least one command succeeds, with aggregated
	 * confidence scores and detailed timing information.
	 *
	 * The request waits for `options.timeout` (the server-side batch deadline) plus
	 * {@link SERVER_DEADLINE_MARGIN_MS}, and never less than the client's `timeout`. If no result
	 * arrives (timeout or connection failure), the server may already have run some commands, so
	 * the result is an `OUTCOME_UNKNOWN` failure with `retryable: false`, no per-command results
	 * and zero success and failure counts.
	 *
	 * @param commands - Array of commands to execute
	 * @param options - Batch execution options
	 * @returns BatchResult with individual command results
	 *
	 * @example
	 * ```typescript
	 * const result = await client.batch([
	 *   { command: 'todo-create', input: { title: 'First' } },
	 *   { command: 'todo-create', input: { title: 'Second' } },
	 *   { command: 'todo-list', input: {} }
	 * ], { stopOnError: false });
	 *
	 * console.log(`${result.summary.successCount}/${result.summary.total} succeeded`);
	 * console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
	 * ```
	 */
	async batch<T = unknown>(
		commands: BatchCommand[],
		options?: BatchOptions
	): Promise<BatchResult<T>> {
		const startedAt = new Date().toISOString();

		try {
			const result = await this.callTool(
				'afd-batch',
				{ commands, options },
				{ timeout: this.timeoutWithMargin(options?.timeout) }
			);
			const parsed = parseTextContent(result);

			if (isBatchResult(parsed)) {
				return parsed as BatchResult<T>;
			}

			if (result.isError) {
				const errorText = getTextContent(result);

				return createBatchFailure(
					commands,
					startedAt,
					{
						code: 'BATCH_ERROR',
						message: errorText || 'Batch execution failed',
						suggestion: 'Check the batch commands and try again',
					},
					`Batch execution failed: ${errorText || 'Unknown error'}`
				);
			}

			return createBatchFailure(
				commands,
				startedAt,
				{
					code: 'PARSE_ERROR',
					message: 'Failed to parse batch result',
					suggestion: 'The server returned an invalid response',
				},
				'Failed to parse batch result'
			);
		} catch (error) {
			const cause = toCommandError(error);
			if (isOutcomeUnknown(error)) {
				return createUnknownOutcomeBatch(commands, startedAt, outcomeUnknownError(cause, 'batch'));
			}
			return createBatchFailure(
				commands,
				startedAt,
				cause,
				`Batch was not executed: ${cause.message}`
			);
		}
	}

	/**
	 * Execute a pipeline of chained commands.
	 *
	 * Pipelines enable declarative composition of commands where the output
	 * of one becomes the input of the next via variable resolution.
	 *
	 * The request waits for `timeoutMs` (the server-side pipeline deadline) plus
	 * {@link SERVER_DEADLINE_MARGIN_MS}, and never less than the client's `timeout`. If no result
	 * arrives (timeout or connection failure), earlier steps may already have run, so the result
	 * carries an `OUTCOME_UNKNOWN` error (`retryable: false`) on a single pipeline-level entry
	 * (`index: -1`) instead of a status for each step.
	 *
	 * @param stepsOrRequest - Array of pipeline steps or full PipelineRequest
	 * @param options - Optional pipeline options (used with an array of steps)
	 * @returns Pipeline result with aggregated metadata
	 *
	 * @example
	 * ```typescript
	 * const result = await client.pipe([
	 *   { command: 'user-get', input: { id: 123 }, as: 'user' },
	 *   { command: 'order-list', input: { userId: '$prev.id' } },
	 *   { command: 'order-summarize', input: {
	 *     orders: '$prev',
	 *     userName: '$steps.user.name'
	 *   }}
	 * ]);
	 *
	 * console.log(`Confidence: ${(result.metadata.confidence * 100).toFixed(1)}%`);
	 * console.log(`Completed: ${result.metadata.completedSteps}/${result.metadata.totalSteps}`);
	 * ```
	 */
	async pipe<T = unknown>(
		stepsOrRequest: PipelineStep[] | PipelineRequest,
		options?: PipelineOptions
	): Promise<PipelineResult<T>> {
		const request: PipelineRequest = Array.isArray(stepsOrRequest)
			? { steps: stepsOrRequest, options }
			: stepsOrRequest;

		try {
			// SAFETY: PipelineRequest is a plain object that serializes correctly as Record<string, unknown>
			// for the MCP tool call wire format.
			const result = await this.callTool(
				'afd-pipe',
				request as unknown as Record<string, unknown>,
				{ timeout: this.timeoutWithMargin(request.options?.timeoutMs) }
			);
			const parsed = parseTextContent(result);

			if (isPipelineResult(parsed)) {
				return parsed as PipelineResult<T>;
			}

			if (result.isError) {
				const errorText = getTextContent(result);

				return createPipelineFailure<T>(request, {
					code: 'PIPELINE_ERROR',
					message: errorText || 'Pipeline execution failed',
					suggestion: 'Check the pipeline steps and try again',
				});
			}

			return createPipelineFailure<T>(request);
		} catch (error) {
			const cause = toCommandError(error);
			if (isOutcomeUnknown(error)) {
				return createUnknownOutcomePipeline<T>(request, outcomeUnknownError(cause, 'pipeline'));
			}
			return createPipelineFailure<T>(request, cause);
		}
	}

	/**
	 * Stream command execution results with real-time progress.
	 *
	 * Returns an async generator that yields StreamChunk objects
	 * containing progress updates, incremental data, completion,
	 * or error information.
	 *
	 * The last chunk is always a `complete` or `error` chunk. The client makes the error chunk
	 * itself when the stream ends early (`STREAM_TRUNCATED`), `options.timeout` passes
	 * (`STREAM_TIMEOUT`), the caller's signal or `disconnect()` stops it (`STREAM_CANCELLED`),
	 * one event exceeds `maxStreamEventSize` (`STREAM_EVENT_TOO_LARGE`), or the client is not
	 * connected (`NOT_CONNECTED`).
	 *
	 * Over HTTP it posts to `<base>/stream/<command>`, where `<base>` is the client URL without
	 * a trailing `/sse`, `/message` or `/messages`, in the client's MCP session: the request
	 * carries the `Mcp-Session-Id` from `initialize`, so the stream sees the session's active
	 * context (`afd-context-enter`). If the server has expired that session (404), the client
	 * starts a new one and retries once, as it does for other requests. With
	 * `transport: 'direct'` it runs the command in process through core's `executeStream()`.
	 *
	 * @param name - Command name to execute
	 * @param args - Command arguments
	 * @param options - Stream options (abort signal, timeout)
	 * @returns AsyncGenerator of StreamChunk objects
	 *
	 * @example
	 * ```typescript
	 * for await (const chunk of client.stream('llm-generate', { prompt: 'Hello' })) {
	 *   if (chunk.type === 'progress') {
	 *     console.log(`Progress: ${(chunk.progress * 100).toFixed(0)}%`);
	 *   } else if (chunk.type === 'data') {
	 *     process.stdout.write(String(chunk.data));
	 *   } else if (chunk.type === 'complete') {
	 *     console.log('Done!', chunk.data);
	 *   } else if (chunk.type === 'error') {
	 *     console.error('Error:', chunk.error.message);
	 *   }
	 * }
	 * ```
	 */
	async *stream<T = unknown>(
		name: string,
		args?: Record<string, unknown>,
		options?: StreamOptions
	): AsyncGenerator<StreamChunk<T>, void, unknown> {
		if (!this.isConnected()) {
			yield streamErrorChunk(
				{
					code: 'NOT_CONNECTED',
					message: 'The client is not connected',
					suggestion: 'Call connect() before stream()',
					retryable: false,
				},
				0
			);
			return;
		}

		const controller = new AbortController();
		const abort: StreamAbortState = { timedOut: false, callerSignal: options?.signal, controller };
		const signal = options?.signal
			? AbortSignal.any([options.signal, controller.signal])
			: controller.signal;
		const timeoutMs =
			typeof options?.timeout === 'number' && options.timeout > 0 ? options.timeout : undefined;
		const timeoutId =
			timeoutMs === undefined
				? undefined
				: setTimeout(
						() => {
							abort.timedOut = true;
							controller.abort(new Error(`Stream timed out after ${timeoutMs}ms`));
						},
						Math.min(timeoutMs, MAX_TIMER_MS)
					);
		this.activeStreams.add(controller);

		try {
			if (this.registry) {
				yield* streamDirect<T>(this.registry, name, args, signal, abort, timeoutMs);
				return;
			}
			yield* streamOverHttp<T>({
				url: deriveStreamUrl(this.config.url, name),
				args,
				headers: this.config.headers,
				session: this.transport ?? undefined,
				signal,
				abort,
				timeoutMs,
				maxEventSize: this.config.maxStreamEventSize,
				debug: (message, data) => this.debug(message, data),
			});
		} finally {
			clearTimeout(timeoutId);
			controller.abort();
			this.activeStreams.delete(controller);
		}
	}

	/**
	 * Stream with callback-style API for convenience.
	 *
	 * This is a convenience wrapper around stream() that uses callbacks
	 * instead of async iteration.
	 *
	 * @param name - Command name to execute
	 * @param args - Command arguments
	 * @param callbacks - Callback handlers for stream events
	 * @param options - Stream options
	 * @returns Promise that resolves when stream completes
	 *
	 * @example
	 * ```typescript
	 * await client.streamWithCallbacks('llm-generate', { prompt: 'Hello' }, {
	 *   onProgress: (chunk) => console.log(`${(chunk.progress * 100).toFixed(0)}% - ${chunk.message}`),
	 *   onData: (chunk) => process.stdout.write(String(chunk.data)),
	 *   onComplete: (chunk) => console.log('Done!', chunk.data),
	 *   onError: (chunk) => console.error('Error:', chunk.error.message),
	 * });
	 * ```
	 */
	async streamWithCallbacks<T = unknown>(
		name: string,
		args: Record<string, unknown> | undefined,
		callbacks: StreamCallbacks<T>,
		options?: StreamOptions
	): Promise<void> {
		for await (const chunk of this.stream<T>(name, args, options)) {
			if (isProgressChunk(chunk) && callbacks.onProgress) {
				callbacks.onProgress(chunk);
			} else if (isDataChunk(chunk) && callbacks.onData) {
				callbacks.onData(chunk);
			} else if (isCompleteChunk(chunk) && callbacks.onComplete) {
				callbacks.onComplete(chunk);
			} else if (isErrorChunk(chunk) && callbacks.onError) {
				callbacks.onError(chunk);
			}
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// LOW-LEVEL REQUEST/RESPONSE
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Send a raw MCP request and wait for response.
	 *
	 * @throws NotConnectedError when not connected; RequestTimeoutError when no response arrives
	 *   in time; JsonRpcResponseError when the server answers with a JSON-RPC error;
	 *   HttpStatusError for another non-2xx HTTP status
	 */
	async request<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		options?: RequestOptions
	): Promise<T> {
		// Initialization requests must work during both initial connection and reconnection.
		const canRequest =
			this.transport &&
			(this.state === 'connected' ||
				this.state === 'connecting' ||
				this.state === 'reconnecting') &&
			this.transport.isConnected();

		if (!canRequest || !this.transport) {
			throw new NotConnectedError();
		}

		const request = createMcpRequest(method, params);
		this.debug(`Request [${request.id}]: ${method}`, params);
		const transport = this.transport;
		const controller = new AbortController();
		const timeoutMs = options?.timeout ?? this.config.timeout;
		const timeout = setTimeout(
			() => {
				controller.abort(new RequestTimeoutError(method, timeoutMs));
			},
			Math.min(timeoutMs, MAX_TIMER_MS)
		);
		this.pendingRequests.set(request.id, { controller, timeout, method });

		try {
			const response = await transport.send(request, controller.signal);
			this.debug(`Response [${request.id}]:`, response);

			if (response.error) throw new JsonRpcResponseError(response.error);
			return response.result as T;
		} catch (error) {
			if (controller.signal.aborted && controller.signal.reason instanceof Error) {
				throw controller.signal.reason;
			}
			throw error;
		} finally {
			clearTimeout(timeout);
			this.pendingRequests.delete(request.id);
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// INTERNAL
	// ═══════════════════════════════════════════════════════════════════════════

	/** A request timeout that outlasts a server-side deadline by the margin. */
	private timeoutWithMargin(serverDeadlineMs: number | undefined): number {
		if (
			typeof serverDeadlineMs !== 'number' ||
			!Number.isFinite(serverDeadlineMs) ||
			serverDeadlineMs < 0
		) {
			return this.config.timeout;
		}
		return Math.max(this.config.timeout, serverDeadlineMs + SERVER_DEADLINE_MARGIN_MS);
	}

	private async initialize(): Promise<McpInitializeResult> {
		const params = {
			protocolVersion: '2024-11-05',
			capabilities: {
				roots: { listChanged: false },
			},
			clientInfo: {
				name: this.config.clientName,
				version: this.config.clientVersion,
			},
		};

		return this.request<McpInitializeResult>('initialize', params as Record<string, unknown>);
	}

	private createConnectionTransport(): Transport {
		if (this.registry) return new DirectTransport(this.registry);
		// SAFETY: the constructor only admits 'sse', 'http' and 'direct', and 'direct' has a registry.
		const type = this.config.transport as 'sse' | 'http';
		return createTransport(type, this.config.url, this.config.headers);
	}

	private assertCurrent(generation: number): void {
		if (generation !== this.connectionGeneration || this.intentionalDisconnect) {
			throw new Error('Connection attempt is no longer current');
		}
	}

	/**
	 * Connect, initialize and refresh tools. An initial connection reports its failure through
	 * the `error` event and the rejection; reconnection attempts report nothing themselves, and
	 * the reconnect loop emits one `error` when it gives up.
	 */
	private async establishConnection(
		generation: number,
		reconnecting: boolean
	): Promise<McpInitializeResult> {
		this.setState(reconnecting ? 'reconnecting' : 'connecting');

		const transport = this.createConnectionTransport();
		this.transport = transport;
		transport.onMessage((response) => this.handleMessage(response));
		transport.onError((error) => this.handleError(transport, error));
		transport.onClose(() => this.handleClose(generation, transport));

		const controller = new AbortController();
		this.connectionController = controller;
		const timeout = setTimeout(() => {
			controller.abort(new Error(`Connection timed out after ${this.config.timeout}ms`));
		}, this.config.timeout);

		try {
			await transport.connect(controller.signal);
			clearTimeout(timeout);
			this.assertCurrent(generation);

			const initResult = await this.initialize();
			this.assertCurrent(generation);

			this.serverInfo = initResult.serverInfo;
			this.capabilities = initResult.capabilities;
			this.connectedAt = new Date();
			try {
				await this.refreshTools();
			} catch (error) {
				this.debug('Tools refresh after connect failed; the tools list stays empty', error);
			}
			this.assertCurrent(generation);
			this.setState('connected');
			this.emit('connected', initResult);
			return initResult;
		} catch (error) {
			const err =
				controller.signal.aborted && controller.signal.reason instanceof Error
					? controller.signal.reason
					: error instanceof Error
						? error
						: new Error(String(error));
			if (this.transport === transport) this.transport = null;
			transport.disconnect();
			if (
				!reconnecting &&
				generation === this.connectionGeneration &&
				!this.intentionalDisconnect
			) {
				this.setState('error');
				this.emit('error', err);
			}
			throw err;
		} finally {
			clearTimeout(timeout);
			if (this.connectionController === controller) this.connectionController = null;
		}
	}

	private async runReconnectLoop(generation: number): Promise<void> {
		let lastError: unknown;
		while (
			!this.intentionalDisconnect &&
			generation === this.connectionGeneration &&
			this.reconnectAttempts < this.config.maxReconnectAttempts
		) {
			this.reconnectAttempts++;
			this.setState('reconnecting');
			this.emit('reconnecting', this.reconnectAttempts, this.config.maxReconnectAttempts);
			await this.reconnectWait.wait(
				backoffDelay(
					this.reconnectAttempts,
					this.config.reconnectDelay,
					this.config.maxReconnectDelay
				)
			);
			if (this.intentionalDisconnect || generation !== this.connectionGeneration) return;

			try {
				await this.establishConnection(generation, true);
				this.reconnectAttempts = 0;
				return;
			} catch (error) {
				// Continue until the configured attempt bound is reached.
				lastError = error;
			}
		}

		if (!this.intentionalDisconnect && generation === this.connectionGeneration) {
			this.setState('error');
			this.emit('error', new Error('Max reconnection attempts reached', { cause: lastError }));
		}
	}

	private setState(state: ConnectionState): void {
		if (this.state !== state) {
			this.state = state;
			this.emit('stateChange', state);
		}
	}

	private handleMessage(response: McpResponse): void {
		this.emit('message', response);
	}

	/**
	 * Forward transport errors of the current, established connection. While connecting or
	 * reconnecting, failures are reported by `connect()` and the reconnect loop instead.
	 */
	private handleError(transport: Transport, error: Error): void {
		if (transport !== this.transport) return;
		if (this.state === 'connecting' || this.state === 'reconnecting') return;
		this.emit('error', error);
	}

	private handleClose(generation: number, transport: Transport): void {
		if (generation !== this.connectionGeneration || transport !== this.transport) return;

		if (!this.intentionalDisconnect && this.state === 'connected' && this.config.autoReconnect) {
			void this.attemptReconnect(generation);
		} else {
			this.setState('disconnected');
			this.emit('disconnected', 'Connection closed');
		}
	}

	private attemptReconnect(generation: number): Promise<void> {
		if (this.reconnectPromise && this.reconnectGeneration === generation) {
			return this.reconnectPromise;
		}

		const reconnectPromise = this.runReconnectLoop(generation).finally(() => {
			if (this.reconnectPromise === reconnectPromise) {
				this.reconnectPromise = null;
				this.reconnectGeneration = null;
			}
		});
		this.reconnectPromise = reconnectPromise;
		this.reconnectGeneration = generation;
		return reconnectPromise;
	}

	private debug(message: string, data?: unknown): void {
		if (this.config.debug) {
			console.log(`[McpClient] ${message}`, data ?? '');
		}
	}
}

/**
 * Create a new MCP client.
 *
 * @param config - Client configuration
 * @returns New McpClient instance
 */
export function createClient(config: McpClientConfig): McpClient {
	return new McpClient(config);
}
