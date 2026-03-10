/**
 * @fileoverview MCP Server factory for AFD commands.
 *
 * This module provides the `createMcpServer` factory that wires together
 * execution, tool routing, and transport layers into a single MCP server.
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { Server as McpSdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createContextState } from './bootstrap/afd-context.js';
import { createExecutionEngine } from './execution.js';
import { createHttpHandler } from './http-handler.js';
import type { ZodCommandDefinition } from './schema.js';
import type { McpServer, McpServerOptions } from './server-types.js';
import { isStdinPiped } from './server-types.js';
import { createToolRouter } from './tool-router.js';
import { getToolsList } from './tools.js';

export type {
	CommandMiddleware,
	ContextConfig,
	McpServer,
	McpServerOptions,
	McpTransport,
} from './server-types.js';
// Re-export public types so existing imports from './server.js' still work
export { isStdinPiped } from './server-types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create an MCP server from Zod-defined commands.
 *
 * @example
 * ```typescript
 * import { createMcpServer, defineCommand } from '@lushly-dev/afd-server';
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
		devMode = false,
		cors = devMode,
		transport = 'auto',
		stdio,
		middleware = [],
		onCommand,
		onError,
		toolStrategy = 'grouped',
		groupByFn,
		contexts,
	} = options;

	// ── Context state (when contexts are configured) ─────────────────────────

	const contextState = contexts?.length ? createContextState() : undefined;

	// ── Transport resolution ────────────────────────────────────────────────

	function resolveTransport(): 'stdio' | 'http' {
		if (stdio !== undefined) {
			return stdio ? 'stdio' : 'http';
		}
		if (transport === 'auto') {
			return isStdinPiped() ? 'stdio' : 'http';
		}
		return transport as 'stdio' | 'http';
	}

	const resolvedTransport = resolveTransport();
	const useStdio = resolvedTransport === 'stdio';
	const useHttp = resolvedTransport === 'http';

	// ── Command map ─────────────────────────────────────────────────────────

	const commandMap = new Map<string, ZodCommandDefinition>();
	for (const cmd of commands) {
		commandMap.set(cmd.name, cmd);
	}

	// ── Wire up execution, routing, and tools ───────────────────────────────

	const engine = createExecutionEngine({
		commandMap,
		middleware,
		devMode,
		onCommand,
		onError,
	});

	const routeToolCall = createToolRouter({
		executeCommand: engine.executeCommand,
		executeBatch: engine.executeBatch,
		executePipeline: engine.executePipeline,
		commands,
		toolStrategy,
		groupByFn,
		devMode,
		contextState,
	});

	const boundGetToolsList = () =>
		getToolsList(commands, toolStrategy, groupByFn, contextState?.getActive());

	// ── Server state ────────────────────────────────────────────────────────

	let httpServer: HttpServer | null = null;
	let mcpSdkServer: McpSdkServer | null = null;
	let isRunning = false;

	// ── Public API ──────────────────────────────────────────────────────────

	return {
		async start() {
			if (isRunning) return;

			// Stdio transport via MCP SDK
			if (useStdio) {
				mcpSdkServer = new McpSdkServer({ name, version }, { capabilities: { tools: {} } });

				mcpSdkServer.setRequestHandler(ListToolsRequestSchema, async () => ({
					tools: boundGetToolsList(),
				}));

				mcpSdkServer.setRequestHandler(CallToolRequestSchema, async (request) => {
					// Spread into anonymous object for MCP SDK index signature compatibility
					return { ...(await routeToolCall(request.params.name, request.params.arguments ?? {})) };
				});

				const stdioTransport = new StdioServerTransport();
				await mcpSdkServer.connect(stdioTransport);
				isRunning = true;

				if (!useHttp) return;
			}

			// HTTP transport
			if (useHttp) {
				const { handler } = createHttpHandler({
					name,
					version,
					host,
					port,
					cors,
					devMode,
					getToolsList: boundGetToolsList,
					routeToolCall,
					executeCommand: engine.executeCommand,
					executeBatch: engine.executeBatch,
					executeStream: engine.executeStream,
				});

				httpServer = createServer(handler);

				await new Promise<void>((resolve, reject) => {
					httpServer?.on('error', reject);
					httpServer?.listen(port, host, () => {
						isRunning = true;
						resolve();
					});
				});
			}
		},

		async stop() {
			if (!isRunning) return;

			if (mcpSdkServer) {
				await mcpSdkServer.close();
				mcpSdkServer = null;
			}

			if (httpServer) {
				await new Promise<void>((resolve, reject) => {
					httpServer?.close((err) => {
						if (err) reject(err);
						else resolve();
					});
				});
				httpServer = null;
			}

			isRunning = false;
		},

		getUrl() {
			return useHttp ? `http://${host}:${port}` : 'stdio://';
		},

		getCommands() {
			return commands;
		},

		getTransport(): 'stdio' | 'http' {
			return resolvedTransport;
		},

		execute: engine.executeCommand,
		executePipeline: engine.executePipeline,
	};
}
