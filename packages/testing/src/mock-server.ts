/**
 * @fileoverview Mock MCP server for testing
 *
 * This creates an in-memory MCP server that can be used for testing
 * without needing a real server.
 */

import type {
	BatchRequest,
	CommandDefinition,
	CommandRegistry,
	McpRequest,
	McpResponse,
	McpTool,
	McpToolCallParams,
	McpToolsListResult,
} from '@lushly-dev/afd-core';
import {
	commandToMcpTool,
	createCommandRegistry,
	createMcpErrorResponse,
	createMcpResponse,
	McpErrorCodes,
	textContent,
} from '@lushly-dev/afd-core';

/** Name of the built-in batch tool, as on the real server. */
const BATCH_TOOL = 'afd-batch';

/**
 * Options for {@link MockMcpServer}.
 */
export interface MockServerOptions {
	/**
	 * Include raw exception messages and stack traces in results, like `devMode`
	 * in `createMcpServer()`. Default `false`.
	 */
	devMode?: boolean;
}

/**
 * Mock MCP server for testing.
 *
 * Follows the real server's remote semantics:
 * - only commands with `expose.mcp: true` are listed, and calling any other
 *   command returns `COMMAND_NOT_EXPOSED`;
 * - `tools/call` with the built-in `afd-batch` tool runs a batch through the
 *   shared core executor: malformed envelopes are rejected before anything
 *   runs, `options.timeout` is a deadline at any `parallelism`, and every
 *   entry is exposure-checked;
 * - handler exceptions are reported without their message or stack unless
 *   `devMode` is set.
 *
 * Commands built with `createMockCommand()`, `createSuccessCommand()` or
 * `createFailureCommand()` are exposed to MCP.
 */
export class MockMcpServer {
	private registry: CommandRegistry;
	private serverInfo = {
		name: 'MockMcpServer',
		version: '0.1.0',
	};
	private requestLog: Array<{ request: McpRequest; response: McpResponse }> = [];

	constructor(commands?: CommandDefinition[], options: MockServerOptions = {}) {
		this.registry = createCommandRegistry({ devMode: options.devMode });

		if (commands) {
			for (const command of commands) {
				this.registry.register(command);
			}
		}
	}

	/**
	 * Register a command on the mock server.
	 */
	register<TInput = unknown, TOutput = unknown>(command: CommandDefinition<TInput, TOutput>): void {
		this.registry.register(command);
	}

	/**
	 * Process an MCP request and return a response.
	 */
	async handleRequest(request: McpRequest): Promise<McpResponse> {
		let response: McpResponse;

		try {
			switch (request.method) {
				case 'initialize':
					response = this.handleInitialize(request);
					break;

				case 'tools/list':
					response = this.handleToolsList(request);
					break;

				case 'tools/call':
					response = await this.handleToolsCall(request);
					break;

				default:
					response = createMcpErrorResponse(
						request.id,
						McpErrorCodes.METHOD_NOT_FOUND,
						`Method not found: ${request.method}`
					);
			}
		} catch (error) {
			response = createMcpErrorResponse(
				request.id,
				McpErrorCodes.INTERNAL_ERROR,
				error instanceof Error ? error.message : String(error)
			);
		}

		this.requestLog.push({ request, response });
		return response;
	}

	/**
	 * Get the request log.
	 */
	getRequestLog(): Array<{ request: McpRequest; response: McpResponse }> {
		return [...this.requestLog];
	}

	/**
	 * Clear the request log.
	 */
	clearRequestLog(): void {
		this.requestLog = [];
	}

	/**
	 * Get the tools an MCP client can see: registered commands with `expose.mcp: true`.
	 */
	getTools(): McpTool[] {
		return this.registry.listByExposure('mcp').map(commandToMcpTool);
	}

	/**
	 * Reset server state.
	 */
	reset(): void {
		this.requestLog = [];
	}

	private handleInitialize(request: McpRequest): McpResponse {
		return createMcpResponse(request.id, {
			protocolVersion: '2024-11-05',
			capabilities: {
				tools: { listChanged: false },
			},
			serverInfo: this.serverInfo,
		});
	}

	private handleToolsList(request: McpRequest): McpResponse {
		const tools = this.getTools();
		const result: McpToolsListResult = { tools };
		return createMcpResponse(request.id, result);
	}

	private async handleToolsCall(request: McpRequest): Promise<McpResponse> {
		const params = request.params as McpToolCallParams | undefined;

		if (!params?.name) {
			return createMcpErrorResponse(request.id, McpErrorCodes.INVALID_PARAMS, 'Missing tool name');
		}

		// Remote callers are MCP clients, so every entry point is exposure-checked.
		const args: unknown = params.arguments;
		const result =
			params.name === BATCH_TOOL
				? // SAFETY: executeBatch validates the whole envelope before running anything.
					await this.registry.executeBatch(args as BatchRequest, { interface: 'mcp' })
				: await this.registry.execute(params.name, args ?? {}, { interface: 'mcp' });

		// Convert CommandResult to MCP content
		const content = [textContent(JSON.stringify(result))];

		return createMcpResponse(request.id, {
			content,
			isError: !result.success,
		});
	}
}

/**
 * Create a mock MCP server.
 */
export function createMockServer(
	commands?: CommandDefinition[],
	options?: MockServerOptions
): MockMcpServer {
	return new MockMcpServer(commands, options);
}
