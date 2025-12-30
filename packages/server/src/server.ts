/**
 * @fileoverview MCP Server factory for AFD commands
 *
 * This module provides utilities for creating MCP-compliant servers
 * from Zod-defined commands.
 */

import { createServer, type Server as HttpServer } from 'node:http';
import type { CommandContext, CommandResult } from '@afd/core';
import { failure } from '@afd/core';
import type { ZodCommandDefinition } from './schema.js';
import { validateInput, type ValidationResult } from './validation.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * MCP Server configuration options.
 */
export interface McpServerOptions {
	/** Server name for identification */
	name: string;

	/** Server version */
	version: string;

	/** Commands to expose */
	commands: ZodCommandDefinition[];

	/** Port to listen on (default: 3100) */
	port?: number;

	/** Host to bind to (default: localhost) */
	host?: string;

	/** Enable CORS for browser access */
	cors?: boolean;

	/** Middleware to run before command execution */
	middleware?: CommandMiddleware[];

	/** Called when a command is executed */
	onCommand?: (
		command: string,
		input: unknown,
		result: CommandResult
	) => void;

	/** Called on server errors */
	onError?: (error: Error) => void;
}

/**
 * Middleware function type.
 */
export type CommandMiddleware = (
	commandName: string,
	input: unknown,
	context: CommandContext,
	next: () => Promise<CommandResult>
) => Promise<CommandResult>;

/**
 * MCP Server instance.
 */
export interface McpServer {
	/** Start the server */
	start(): Promise<void>;

	/** Stop the server */
	stop(): Promise<void>;

	/** Get server URL */
	getUrl(): string;

	/** Get registered commands */
	getCommands(): ZodCommandDefinition[];

	/** Execute a command directly (for testing) */
	execute(name: string, input: unknown, context?: CommandContext): Promise<CommandResult>;
}

/**
 * SSE Client connection.
 */
interface SseClient {
	id: string;
	response: import('node:http').ServerResponse;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP MESSAGE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface McpRequest {
	jsonrpc: '2.0';
	id: string | number;
	method: string;
	params?: unknown;
}

interface McpResponse {
	jsonrpc: '2.0';
	id: string | number;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an MCP server from Zod-defined commands.
 *
 * @example
 * ```typescript
 * import { createMcpServer, defineCommand } from '@afd/server';
 *
 * const server = createMcpServer({
 *   name: 'my-app',
 *   version: '1.0.0',
 *   commands: [createTodo, listTodos, deleteTodo],
 * });
 *
 * await server.start();
 * console.log(`Server running at ${server.getUrl()}`);
 * ```
 */
export function createMcpServer(options: McpServerOptions): McpServer {
	const {
		name,
		version,
		commands,
		port = 3100,
		host = 'localhost',
		cors = true,
		middleware = [],
		onCommand,
		onError,
	} = options;

	// Build command map for quick lookup
	const commandMap = new Map<string, ZodCommandDefinition>();
	for (const cmd of commands) {
		commandMap.set(cmd.name, cmd);
	}

	// Track SSE clients
	const sseClients = new Map<string, SseClient>();
	let clientIdCounter = 0;

	// HTTP Server
	let httpServer: HttpServer | null = null;
	let isRunning = false;

	/**
	 * Execute a command with validation and middleware.
	 */
	async function executeCommand(
		commandName: string,
		input: unknown,
		context: CommandContext = {}
	): Promise<CommandResult> {
		const command = commandMap.get(commandName);

		if (!command) {
			return failure({
				code: 'COMMAND_NOT_FOUND',
				message: `Command '${commandName}' not found`,
				suggestion: `Available commands: ${Array.from(commandMap.keys()).join(', ')}`,
			});
		}

		// Validate input
		const validation = validateInput(command.inputSchema, input);
		if (!validation.success) {
			return failure({
				code: 'VALIDATION_ERROR',
				message: 'Input validation failed',
				suggestion: validation.errors.map((e) => e.message).join('; '),
				details: { errors: validation.errors },
			});
		}

		// Build middleware chain
		const runHandler = async (): Promise<CommandResult> => {
			const startTime = Date.now();
			const result = await command.handler(validation.data, context);

			// Add metadata if not present
			if (!result.metadata) {
				result.metadata = {};
			}
			result.metadata.executionTimeMs = Date.now() - startTime;
			result.metadata.commandVersion = command.version;
			if (context.traceId) {
				result.metadata.traceId = context.traceId;
			}

			return result;
		};

		// Apply middleware in reverse order
		let next = runHandler;
		for (let i = middleware.length - 1; i >= 0; i--) {
			const mw = middleware[i]!;
			const currentNext = next;
			next = () => mw(commandName, validation.data, context, currentNext);
		}

		try {
			const result = await next();
			onCommand?.(commandName, input, result);
			return result;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			onError?.(err);
			return failure({
				code: 'COMMAND_EXECUTION_ERROR',
				message: err.message,
				suggestion: 'Check the command implementation',
				details: { stack: err.stack },
			});
		}
	}

	/**
	 * Handle MCP JSON-RPC request.
	 */
	function handleMcpRequest(request: McpRequest): McpResponse {
		const { id, method } = request;

		switch (method) {
			case 'initialize':
				return {
					jsonrpc: '2.0',
					id,
					result: {
						protocolVersion: '2024-11-05',
						capabilities: {
							tools: {},
						},
						serverInfo: {
							name,
							version,
						},
					},
				};

			case 'tools/list':
				return {
					jsonrpc: '2.0',
					id,
					result: {
						tools: commands.map((cmd) => {
							// Destructure to avoid duplicate 'type' property
							const { type: _type, ...restSchema } = cmd.jsonSchema;
							return {
								name: cmd.name,
								description: cmd.description,
								inputSchema: {
									type: 'object' as const,
									...restSchema,
								},
							};
						}),
					},
				};

			case 'notifications/initialized':
				// Client notification, no response needed for notifications
				// but we return a success for acknowledgment
				return {
					jsonrpc: '2.0',
					id,
					result: {},
				};

			default:
				return {
					jsonrpc: '2.0',
					id,
					error: {
						code: -32601,
						message: `Method not found: ${method}`,
					},
				};
		}
	}

	/**
	 * Handle async MCP request (tools/call).
	 */
	async function handleAsyncMcpRequest(request: McpRequest): Promise<McpResponse> {
		const { id, method, params } = request;

		if (method === 'tools/call') {
			const { name: toolName, arguments: args } = params as {
				name: string;
				arguments?: unknown;
			};

			const result = await executeCommand(toolName, args ?? {}, {
				traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			});

			return {
				jsonrpc: '2.0',
				id,
				result: {
					content: [
						{
							type: 'text',
							text: JSON.stringify(result, null, 2),
						},
					],
					isError: !result.success,
				},
			};
		}

		// Fall back to sync handler for other methods
		return handleMcpRequest(request);
	}

	/**
	 * Send SSE event to a client.
	 */
	function sendSseEvent(client: SseClient, event: string, data: unknown): void {
		const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		client.response.write(message);
	}

	/**
	 * Create HTTP request handler.
	 */
	function createRequestHandler() {
		return async (
			req: import('node:http').IncomingMessage,
			res: import('node:http').ServerResponse
		) => {
			// CORS headers
			if (cors) {
				res.setHeader('Access-Control-Allow-Origin', '*');
				res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
				res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
			}

			// Handle preflight
			if (req.method === 'OPTIONS') {
				res.writeHead(204);
				res.end();
				return;
			}

			const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

			// SSE endpoint
			if (url.pathname === '/sse' && req.method === 'GET') {
				const clientId = `client-${++clientIdCounter}`;

				res.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
				});

				const client: SseClient = { id: clientId, response: res };
				sseClients.set(clientId, client);

				// Send endpoint info
				sendSseEvent(client, 'endpoint', {
					url: `http://${host}:${port}/message`,
				});

				// Handle client disconnect
				req.on('close', () => {
					sseClients.delete(clientId);
				});

				return;
			}

			// Message endpoint
			if (url.pathname === '/message' && req.method === 'POST') {
				let body = '';
				for await (const chunk of req) {
					body += chunk;
				}

				try {
					const request = JSON.parse(body) as McpRequest;
					const response = await handleAsyncMcpRequest(request);

					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(response));
				} catch (error) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							jsonrpc: '2.0',
							id: null,
							error: {
								code: -32700,
								message: 'Parse error',
							},
						})
					);
				}

				return;
			}

			// Health check
			if (url.pathname === '/health' && req.method === 'GET') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ status: 'ok', name, version }));
				return;
			}

			// Not found
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Not found' }));
		};
	}

	return {
		async start() {
			if (isRunning) {
				return;
			}

			httpServer = createServer(createRequestHandler());

			await new Promise<void>((resolve, reject) => {
				httpServer!.on('error', reject);
				httpServer!.listen(port, host, () => {
					isRunning = true;
					resolve();
				});
			});
		},

		async stop() {
			if (!isRunning || !httpServer) {
				return;
			}

			// Close all SSE clients
			for (const client of sseClients.values()) {
				client.response.end();
			}
			sseClients.clear();

			await new Promise<void>((resolve, reject) => {
				httpServer!.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			});

			httpServer = null;
			isRunning = false;
		},

		getUrl() {
			return `http://${host}:${port}`;
		},

		getCommands() {
			return commands;
		},

		execute: executeCommand,
	};
}
