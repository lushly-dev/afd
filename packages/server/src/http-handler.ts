/**
 * @fileoverview HTTP transport handler — MCP protocol, SSE, and REST endpoints.
 */

import type {
	BatchRequest,
	CommandContext,
	CommandResult,
	StreamChunk,
} from '@lushly-dev/afd-core';
import { createErrorChunk, isBatchRequest } from '@lushly-dev/afd-core';
import type { ToolCallResult } from './tool-router.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface SseClient {
	id: string;
	response: import('node:http').ServerResponse;
}

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

export interface HttpHandlerDeps {
	name: string;
	version: string;
	host: string;
	port: number;
	cors: boolean;
	devMode: boolean;
	getToolsList: () => unknown[];
	routeToolCall: (toolName: string, args: unknown) => Promise<ToolCallResult>;
	executeCommand: (
		name: string,
		input: unknown,
		context?: CommandContext
	) => Promise<CommandResult>;
	executeBatch: (
		request: BatchRequest,
		context?: CommandContext
	) => Promise<import('@lushly-dev/afd-core').BatchResult>;
	executeStream: (
		name: string,
		input: unknown,
		context?: CommandContext
	) => AsyncGenerator<StreamChunk, void, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

export function createHttpHandler(deps: HttpHandlerDeps) {
	const {
		name,
		version,
		host,
		port,
		cors,
		devMode,
		getToolsList,
		routeToolCall,
		executeCommand,
		executeBatch,
		executeStream,
	} = deps;

	// SSE client tracking
	const sseClients = new Map<string, SseClient>();
	let clientIdCounter = 0;

	function sendSseEvent(client: SseClient, event: string, data: unknown): void {
		const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		client.response.write(message);
	}

	/**
	 * Handle MCP JSON-RPC request (synchronous methods).
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
						tools: getToolsList(),
					},
				};

			case 'notifications/initialized':
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
	 * Handle async MCP request (tools/call) — delegates to shared tool router.
	 */
	async function handleAsyncMcpRequest(request: McpRequest): Promise<McpResponse> {
		const { id, method, params } = request;

		if (method === 'tools/call') {
			const { name: toolName, arguments: args } = params as {
				name: string;
				arguments?: unknown;
			};
			const result = await routeToolCall(toolName, args ?? {});
			return {
				jsonrpc: '2.0',
				id,
				result,
			};
		}

		// Fall back to sync handler for other methods
		return handleMcpRequest(request);
	}

	/**
	 * Create HTTP request handler for all endpoints.
	 */
	const handler = async (
		req: import('node:http').IncomingMessage,
		res: import('node:http').ServerResponse
	) => {
		// CORS headers - restrictive in production, permissive in dev mode
		if (cors) {
			res.setHeader('Access-Control-Allow-Origin', devMode ? '*' : (req.headers.origin ?? ''));
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

		// Message endpoint (MCP JSON-RPC)
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
			} catch (_error) {
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

		// RPC endpoint - Simple JSON-RPC for browser clients
		if (url.pathname === '/rpc' && req.method === 'POST') {
			let body = '';
			for await (const chunk of req) {
				body += chunk;
			}

			try {
				const request = JSON.parse(body) as {
					method: string;
					params?: unknown;
					id?: string | number;
				};

				const { method: commandName, params, id = null } = request;

				if (!commandName || typeof commandName !== 'string') {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							jsonrpc: '2.0',
							id,
							error: {
								code: -32600,
								message: 'Invalid request: method is required',
							},
						})
					);
					return;
				}

				const result = await executeCommand(commandName, params ?? {}, {
					traceId: `rpc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				});

				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						jsonrpc: '2.0',
						id,
						result,
					})
				);
			} catch (_error) {
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

		// Batch endpoint
		if (url.pathname === '/batch' && req.method === 'POST') {
			let body = '';
			for await (const chunk of req) {
				body += chunk;
			}

			try {
				const batchRequest = JSON.parse(body) as import('@lushly-dev/afd-core').BatchRequest;

				if (!isBatchRequest(batchRequest)) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							success: false,
							error: {
								code: 'INVALID_BATCH_REQUEST',
								message: 'Invalid batch request format',
								suggestion: 'Provide { commands: [...] } with command objects',
							},
						})
					);
					return;
				}

				const result = await executeBatch(batchRequest, {
					traceId: `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				});

				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(result));
			} catch (_error) {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						success: false,
						error: {
							code: 'PARSE_ERROR',
							message: 'Failed to parse batch request',
							suggestion: 'Ensure request body is valid JSON',
						},
					})
				);
			}
			return;
		}

		// Stream endpoint - SSE for streaming command results
		if (url.pathname.startsWith('/stream/') && req.method === 'GET') {
			const commandName = url.pathname.slice('/stream/'.length);
			const inputParam = url.searchParams.get('input');
			let input: unknown = {};

			if (inputParam) {
				try {
					input = JSON.parse(inputParam);
				} catch {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							success: false,
							error: {
								code: 'INVALID_INPUT',
								message: 'Failed to parse input parameter',
								suggestion: 'Ensure input is valid JSON',
							},
						})
					);
					return;
				}
			}

			// Set up SSE response
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});

			const context: CommandContext = {
				traceId: `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			};

			// Handle client disconnect
			let aborted = false;
			req.on('close', () => {
				aborted = true;
			});

			// Stream the command execution
			try {
				for await (const chunk of executeStream(commandName, input, context)) {
					if (aborted) break;
					res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
				}
			} catch (error) {
				const errorChunk = createErrorChunk(
					{
						code: 'STREAM_ERROR',
						message: error instanceof Error ? error.message : String(error),
						retryable: true,
					},
					0,
					true
				);
				res.write(`event: chunk\ndata: ${JSON.stringify(errorChunk)}\n\n`);
			}

			res.end();
			return;
		}

		// Not found
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	};

	return { handler, sseClients };
}
