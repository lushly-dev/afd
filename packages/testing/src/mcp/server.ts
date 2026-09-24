/**
 * @fileoverview MCP Server for @lushly-dev/afd-testing
 *
 * Exposes JTBD scenario commands as MCP tools for AI agent integration.
 * Follows the same patterns as @lushly-dev/afd-server but focused on testing tools.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { AgentEnhancedResult } from './hints.js';
import { generateTools, type McpTool } from './tool-schemas.js';
import { createToolRegistry, executeTool, type ToolExecutionContext } from './tools.js';

// ============================================================================
// Types
// ============================================================================

/**
 * JSON-RPC 2.0 Request. Without an `id` it is a notification, which gets no
 * response.
 */
export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: string | number;
	method: string;
	params?: unknown;
}

/**
 * JSON-RPC 2.0 Response. `id` is `null` when the request's id could not be
 * read (parse errors and invalid requests).
 */
export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id?: string | number | null;
	result?: unknown;
	error?: JsonRpcError;
}

/**
 * JSON-RPC 2.0 Error
 */
export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

/**
 * MCP Server configuration options.
 */
export interface McpTestingServerOptions {
	/** Server name for identification */
	name?: string;

	/** Server version */
	version?: string;

	/** Command handler for executing scenario commands */
	commandHandler?: (name: string, input: unknown) => Promise<CommandResult<unknown>>;

	/**
	 * Working directory for file operations (default: process.cwd()). Tool
	 * path arguments resolve against it and may not leave it.
	 */
	cwd?: string;

	/** Enable verbose logging */
	verbose?: boolean;
}

/**
 * MCP Server instance.
 */
export interface McpTestingServer {
	/**
	 * Handle a JSON-RPC request. A notification (a request without an `id`) is
	 * processed but resolves to `undefined`: JSON-RPC servers never answer
	 * notifications.
	 */
	handleRequest(request: JsonRpcRequest & { id: string | number }): Promise<JsonRpcResponse>;
	handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined>;

	/** Get all available tools */
	getTools(): McpTool[];

	/** Execute a tool by name */
	executeTool<T>(name: string, input: unknown): Promise<AgentEnhancedResult<T>>;

	/** Server name */
	name: string;

	/** Server version */
	version: string;
}

// ============================================================================
// JSON-RPC Error Codes
// ============================================================================

const JSON_RPC_ERRORS = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
} as const;

// ============================================================================
// Server Implementation
// ============================================================================

/**
 * Create an MCP server for testing tools.
 *
 * @example
 * ```typescript
 * import { createMcpTestingServer } from '@lushly-dev/afd-testing';
 *
 * const server = createMcpTestingServer({
 *   name: 'testing-server',
 *   commandHandler: async (name, input) => myRegistry.execute(name, input),
 * });
 *
 * // Handle MCP requests
 * const response = await server.handleRequest({
 *   jsonrpc: '2.0',
 *   id: 1,
 *   method: 'tools/list',
 * });
 * ```
 */
export function createMcpTestingServer(options: McpTestingServerOptions = {}): McpTestingServer {
	const {
		name = '@lushly-dev/afd-testing',
		version = '0.1.0',
		commandHandler,
		cwd = process.cwd(),
		verbose = false,
	} = options;

	// Create tool registry with context
	const context: ToolExecutionContext = {
		commandHandler,
		cwd,
	};
	const registry = createToolRegistry(context);
	const tools = generateTools();

	// Logging helper
	const log = verbose ? (...args: unknown[]) => console.error('[MCP Testing]', ...args) : () => {};

	/**
	 * Handle tools/list request.
	 */
	function handleToolsList(): unknown {
		log('tools/list - returning', tools.length, 'tools');
		return {
			tools: tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			})),
		};
	}

	/**
	 * Handle tools/call request.
	 */
	async function handleToolsCall(params: unknown): Promise<unknown> {
		if (!params || typeof params !== 'object') {
			throw createJsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing params for tools/call');
		}

		const { name: toolName, arguments: toolArgs } = params as {
			name?: string;
			arguments?: unknown;
		};

		if (!toolName || typeof toolName !== 'string') {
			throw createJsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing or invalid tool name');
		}

		log('tools/call -', toolName, toolArgs);

		const result = await executeTool(registry, toolName, toolArgs ?? {});

		// Format result for MCP protocol
		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(result, null, 2),
				},
			],
			isError: !result.success,
		};
	}

	/**
	 * Handle initialize request.
	 */
	function handleInitialize(): unknown {
		log('initialize');
		return {
			protocolVersion: '2024-11-05',
			serverInfo: {
				name,
				version,
			},
			capabilities: {
				tools: {
					listChanged: false,
				},
			},
		};
	}

	/**
	 * Handle ping request.
	 */
	function handlePing(): unknown {
		return {};
	}

	async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
		const { id, method, params } = request;
		const isNotification = id === undefined;

		try {
			let result: unknown;

			switch (method) {
				case 'initialize':
					result = handleInitialize();
					break;

				case 'ping':
					result = handlePing();
					break;

				case 'tools/list':
					result = handleToolsList();
					break;

				case 'tools/call':
					result = await handleToolsCall(params);
					break;

				default:
					// Notifications such as notifications/initialized need no handling
					if (isNotification) return undefined;
					throw createJsonRpcError(JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${method}`);
			}

			return isNotification ? undefined : { jsonrpc: '2.0', id, result };
		} catch (error) {
			if (isNotification) {
				log('notification failed:', method, error);
				return undefined;
			}
			const jsonRpcError = isJsonRpcError(error)
				? error
				: createJsonRpcError(
						JSON_RPC_ERRORS.INTERNAL_ERROR,
						error instanceof Error ? error.message : 'Unknown error'
					);

			return {
				jsonrpc: '2.0',
				id,
				error: jsonRpcError,
			};
		}
	}

	return {
		name,
		version,
		handleRequest: handleRequest as McpTestingServer['handleRequest'],

		getTools(): McpTool[] {
			return tools;
		},

		async executeTool<T>(toolName: string, input: unknown): Promise<AgentEnhancedResult<T>> {
			return executeTool(registry, toolName, input);
		},
	};
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a JSON-RPC error object.
 */
function createJsonRpcError(code: number, message: string, data?: unknown): JsonRpcError {
	return { code, message, data };
}

/**
 * Check if an error is a JSON-RPC error.
 */
function isJsonRpcError(error: unknown): error is JsonRpcError {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		'message' in error &&
		typeof (error as JsonRpcError).code === 'number' &&
		typeof (error as JsonRpcError).message === 'string'
	);
}

// ============================================================================
// Stdio Transport (for CLI integration)
// ============================================================================

/**
 * Parse one stdio line into a request, or the error response to send back.
 */
function parseRequestLine(line: string): JsonRpcRequest | JsonRpcResponse {
	let message: unknown;
	try {
		message = JSON.parse(line);
	} catch {
		return {
			jsonrpc: '2.0',
			id: null,
			error: createJsonRpcError(JSON_RPC_ERRORS.PARSE_ERROR, 'Invalid JSON'),
		};
	}

	const candidate: Record<string, unknown> =
		typeof message === 'object' && message !== null && !Array.isArray(message)
			? (message as Record<string, unknown>)
			: {};
	const { id } = candidate;
	const usableId = typeof id === 'string' || typeof id === 'number' ? id : undefined;
	if (
		candidate.jsonrpc !== '2.0' ||
		typeof candidate.method !== 'string' ||
		(id !== undefined && usableId === undefined)
	) {
		return {
			jsonrpc: '2.0',
			id: usableId ?? null,
			error: createJsonRpcError(JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request'),
		};
	}
	return {
		jsonrpc: '2.0',
		method: candidate.method,
		...(usableId !== undefined ? { id: usableId } : {}),
		...(candidate.params !== undefined ? { params: candidate.params } : {}),
	};
}

/**
 * Run the MCP server on stdio transport.
 *
 * This is useful for CLI tools that communicate via stdin/stdout. Requests
 * get one response line each; notifications get none.
 *
 * @example
 * ```typescript
 * import { runStdioServer } from '@lushly-dev/afd-testing';
 *
 * // In your CLI tool
 * await runStdioServer({
 *   commandHandler: myHandler,
 * });
 * ```
 */
export async function runStdioServer(options: McpTestingServerOptions = {}): Promise<void> {
	const server = createMcpTestingServer(options);

	const readline = await import('node:readline');
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	for await (const line of rl) {
		if (!line.trim()) continue;

		const parsed = parseRequestLine(line);
		const response = 'method' in parsed ? await server.handleRequest(parsed) : parsed;
		if (response) {
			console.log(JSON.stringify(response));
		}
	}
}
