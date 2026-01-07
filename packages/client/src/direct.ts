/**
 * @fileoverview Direct Transport for zero-overhead in-process command execution
 *
 * This transport enables co-located agents to execute commands directly
 * without any transport overhead (no JSON-RPC, no IPC, no network).
 *
 * @example
 * ```typescript
 * import { DirectClient } from '@lushly-dev/afd-client';
 * import { registry } from '@my-app/commands';
 *
 * const client = new DirectClient(registry);
 * const result = await client.call('todo-create', { title: 'Fast!' });
 * // ~0.01-0.1ms latency vs 10-100ms for MCP
 * ```
 */

import type { CommandResult, McpRequest, McpResponse, McpTool } from '@lushly-dev/afd-core';
import { success, failure } from '@lushly-dev/afd-core';
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

	for (let j = 0; j <= bLower.length; j++) {
		matrix[0][j] = j;
	}

	for (let i = 1; i <= aLower.length; i++) {
		for (let j = 1; j <= bLower.length; j++) {
			const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1, // deletion
				matrix[i][j - 1] + 1, // insertion
				matrix[i - 1][j - 1] + cost // substitution
			);
		}
	}

	const maxLen = Math.max(aLower.length, bLower.length);
	return maxLen === 0 ? 1 : 1 - matrix[aLower.length][bLower.length] / maxLen;
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
function createUnknownToolError(
	requestedTool: string,
	availableTools: string[]
): UnknownToolError {
	const suggestions = findSimilarTools(requestedTool, availableTools);
	const hint =
		suggestions.length > 0 ? `Did you mean '${suggestions[0]}'?` : null;

	return {
		error: 'UNKNOWN_TOOL',
		message: `Tool '${requestedTool}' not found in registry`,
		requested_tool: requestedTool,
		available_tools: availableTools,
		suggestions,
		hint,
	};
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
	 * @returns Command result
	 */
	execute<T>(name: string, input?: unknown): Promise<CommandResult<T>>;

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

/**
 * Simplified client for direct registry access.
 *
 * Use this when you don't need the full McpClient features like
 * reconnection, events, etc. This provides the minimal API for
 * command execution.
 *
 * @example
 * ```typescript
 * import { DirectClient } from '@lushly-dev/afd-client';
 * import { registry } from '@my-app/commands';
 *
 * const client = new DirectClient(registry);
 *
 * // Type-safe command execution
 * const result = await client.call<Todo>('todo-create', { title: 'Test' });
 *
 * if (result.success) {
 *   console.log(result.data.id);
 * }
 * ```
 */
export class DirectClient {
	constructor(private readonly registry: DirectRegistry) {}

	/**
	 * Call a command and return a CommandResult.
	 *
	 * This is the most efficient path - direct registry access
	 * with zero transport overhead.
	 *
	 * @param name - Command name
	 * @param args - Command arguments
	 * @returns Command result
	 */
	async call<T = unknown>(
		name: string,
		args?: Record<string, unknown>
	): Promise<CommandResult<T> | CommandResult<UnknownToolError>> {
		// Check if the command exists - return structured error if not
		if (!this.registry.hasCommand(name)) {
			const availableTools = this.registry.listCommandNames();
			const unknownToolError = createUnknownToolError(name, availableTools);
			
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

		return this.registry.execute<T>(name, args);
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
}
