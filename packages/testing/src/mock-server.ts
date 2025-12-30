/**
 * @fileoverview Mock MCP server for testing
 *
 * This creates an in-memory MCP server that can be used for testing
 * without needing a real server.
 */

import type {
	CommandDefinition,
	CommandRegistry,
	McpRequest,
	McpResponse,
	McpTool,
	McpToolCallParams,
	McpToolsListResult,
} from '@afd/core';
import {
	commandToMcpTool,
	createCommandRegistry,
	createMcpErrorResponse,
	createMcpResponse,
	McpErrorCodes,
	textContent,
} from '@afd/core';

/**
 * Mock MCP server for testing.
 */
export class MockMcpServer {
	private registry: CommandRegistry;
	private serverInfo = {
		name: 'MockMcpServer',
		version: '0.1.0',
	};
	private initialized = false;
	private requestLog: Array<{ request: McpRequest; response: McpResponse }> = [];

	constructor(commands?: CommandDefinition[]) {
		this.registry = createCommandRegistry();

		if (commands) {
			for (const command of commands) {
				this.registry.register(command);
			}
		}
	}

	/**
	 * Register a command on the mock server.
	 */
	register(command: CommandDefinition): void {
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
	 * Get all registered tools.
	 */
	getTools(): McpTool[] {
		return this.registry.list().map(commandToMcpTool);
	}

	/**
	 * Reset server state.
	 */
	reset(): void {
		this.initialized = false;
		this.requestLog = [];
	}

	private handleInitialize(request: McpRequest): McpResponse {
		this.initialized = true;

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
			return createMcpErrorResponse(
				request.id,
				McpErrorCodes.INVALID_PARAMS,
				'Missing tool name'
			);
		}

		const result = await this.registry.execute(params.name, params.arguments ?? {});

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
export function createMockServer(commands?: CommandDefinition[]): MockMcpServer {
	return new MockMcpServer(commands);
}
