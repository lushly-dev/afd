/**
 * @fileoverview In-process MCP transport over a `DirectRegistry`.
 *
 * `DirectTransport` answers the MCP methods `McpClient` sends (`initialize`, `tools/list`,
 * `tools/call`) from a registry in the same process. `McpClient` uses it for
 * `transport: 'direct'`, so a client can switch between a remote AFD server and an in-process
 * registry without changing its calls.
 */

import type { McpRequest, McpResponse, McpTool } from '@lushly-dev/afd-core';
import {
	type BatchRequest,
	type CommandExecutor,
	executeBatch,
	executePipeline,
	executionFailure,
	type PipelineRequest,
	truncateName,
} from '@lushly-dev/afd-core';
import type { DirectRegistry } from './direct-types.js';
import type { Transport } from './transport.js';
import { unknownToolFailure } from './unknown-tool.js';

/** Tool call parameters from the MCP protocol. */
interface ToolCallParams {
	name: string;
	arguments?: Record<string, unknown>;
}

function isToolCallParams(value: unknown): value is ToolCallParams {
	return (
		typeof value === 'object' &&
		value !== null &&
		'name' in value &&
		typeof value.name === 'string' &&
		(!('arguments' in value) ||
			value.arguments === undefined ||
			(typeof value.arguments === 'object' && value.arguments !== null))
	);
}

/**
 * Direct transport for in-process command execution.
 *
 * This transport calls the command registry directly, bypassing
 * all MCP protocol overhead. It provides:
 *
 * - **Zero latency**: ~0.01-0.1ms per call (vs 10-100ms for MCP)
 * - **No network**: Results are serialized into MCP tool content, but never leave the process
 * - **Same API**: Compatible with Transport interface for drop-in use
 *
 * `tools/call` always answers with a `CommandResult` in the tool content: an unknown name gives
 * an `UNKNOWN_TOOL` failure with a suggestion, and a registry that throws gives a
 * `COMMAND_EXECUTION_ERROR` failure (without the exception text). `afd-batch` and `afd-pipe`
 * run through core's `executeBatch()` and `executePipeline()` unless the registry defines
 * commands with those names.
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
	 */
	async send(request: McpRequest): Promise<McpResponse> {
		const requestId = request.id ?? ++this.requestIdCounter;
		try {
			return await this.dispatch(requestId, request);
		} catch (error) {
			// Only registry listing and lookup reach here; command execution failures are results.
			this.errorHandler?.(error instanceof Error ? error : new Error(String(error)));
			return {
				jsonrpc: '2.0',
				id: requestId,
				error: { code: -32603, message: 'The direct registry failed to handle the request' },
			};
		}
	}

	private async dispatch(requestId: string | number, request: McpRequest): Promise<McpResponse> {
		if (request.method === 'initialize') {
			return this.handleInitialize(requestId);
		}
		if (request.method === 'tools/list') {
			return this.handleToolsList(requestId);
		}
		if (request.method === 'tools/call') {
			if (!isToolCallParams(request.params)) {
				return {
					jsonrpc: '2.0',
					id: requestId,
					error: {
						code: -32602,
						message: 'tools/call requires a string name and an optional arguments object',
					},
				};
			}
			return this.handleToolCall(requestId, request.params);
		}

		return {
			jsonrpc: '2.0',
			id: requestId,
			error: {
				code: -32601,
				message: `Method not found: ${truncateName(request.method)}`,
			},
		};
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
	 * Set error handler, called with the exception when the registry throws.
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
		const tools: McpTool[] = this.registry.listCommands().map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
			inputSchema: {
				type: 'object' as const,
				properties: {},
			},
		}));
		return { jsonrpc: '2.0', id: requestId, result: { tools } };
	}

	private async handleToolCall(
		requestId: string | number,
		params: ToolCallParams
	): Promise<McpResponse> {
		const { payload, isError } = await this.runTool(params.name, params.arguments ?? {});
		const response: McpResponse = {
			jsonrpc: '2.0',
			id: requestId,
			result: {
				content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
				isError,
			},
		};
		this.messageHandler?.(response);
		return response;
	}

	/** Run a tool the way the AFD server's tool router does: its content and error flag. */
	private async runTool(
		name: string,
		args: Record<string, unknown>
	): Promise<{ payload: unknown; isError: boolean }> {
		const execute: CommandExecutor = async (command, input, context) => {
			try {
				return await this.registry.execute(command, input, context);
			} catch (error) {
				this.errorHandler?.(error instanceof Error ? error : new Error(String(error)));
				return executionFailure(error);
			}
		};

		if (this.registry.hasCommand(name)) {
			const result = await execute(name, args, {});
			return { payload: result, isError: !result.success };
		}
		if (name === 'afd-batch') {
			// SAFETY: executeBatch validates the whole envelope with isBatchRequest() before running.
			const batch = await executeBatch(args as unknown as BatchRequest, execute);
			return { payload: batch, isError: !batch.success };
		}
		if (name === 'afd-pipe') {
			// SAFETY: executePipeline validates the whole envelope before running any step.
			const pipeline = await executePipeline(args as unknown as PipelineRequest, execute);
			return {
				payload: pipeline,
				isError: pipeline.steps.some((step) => step.status === 'failure'),
			};
		}
		return { payload: unknownToolFailure(name, this.registry.listCommandNames()), isError: true };
	}
}
