/**
 * @fileoverview MCP Server factory for AFD commands.
 *
 * This module provides the `createMcpServer` factory that wires together
 * execution, tool routing, and transport layers into a single MCP server.
 */

import { createServer, type Server as HttpServer } from 'node:http';
import type { CommandContext } from '@lushly-dev/afd-core';
import { isMcpExposed } from '@lushly-dev/afd-core';
import { Server as McpSdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
	createAfdContextEnterCommand,
	createAfdContextExitCommand,
	createAfdContextListCommand,
	createContextState,
} from './bootstrap/afd-context.js';
import { getBootstrapCommands } from './bootstrap/registry.js';
import { assertValidCommandNames } from './command-names.js';
import { filterByContext } from './command-routing.js';
import { resolveContextState } from './context-scope.js';
import { createExecutionEngine } from './execution.js';
import { createHttpHandler } from './http-handler.js';
import { createSessionStore } from './http-sessions.js';
import { defineCommand, type ZodCommandDefinition } from './schema.js';
import type { McpHandler, McpHandlerOptions, McpServer, McpServerOptions } from './server-types.js';
import { isStdinPiped } from './server-types.js';
import { createToolRouter } from './tool-router.js';
import { getToolsList } from './tools.js';

export type {
	CommandMiddleware,
	ContextConfig,
	CreateRequestContext,
	McpHandler,
	McpHandlerOptions,
	McpServer,
	McpServerOptions,
	McpTransport,
} from './server-types.js';
// Re-export public types so existing imports from './server.js' still work
export { isStdinPiped } from './server-types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

function createSharedHttpRuntime(options: McpHandlerOptions) {
	const {
		name,
		version,
		commands,
		port = 3100,
		host = 'localhost',
		devMode = false,
		cors = devMode,
		middleware = [],
		onCommand,
		onError,
		toolStrategy = 'grouped',
		groupByFn,
		contexts,
		bootstrap = false,
	} = options;

	assertValidCommandNames(commands, { bootstrap, contexts: Boolean(contexts?.length) });

	// stdio serves one client, so it uses this single state. HTTP callers each get a session
	// state (or none), bound to their command context by the HTTP handler.
	const contextState = contexts?.length ? createContextState() : undefined;
	const sessions = contextState
		? createSessionStore({
				maxSessions: options.maxSessions,
				idleTimeoutMs: options.sessionIdleTimeoutMs,
			})
		: undefined;

	const registeredCommands = [...commands];
	if (contextState && contexts) {
		const getContexts = () => [...contexts];
		const builtins = [
			defineCommand({
				...createAfdContextListCommand(getContexts, contextState),
				input: z.object({}),
				expose: { mcp: true },
			}),
			defineCommand({
				...createAfdContextEnterCommand(getContexts, contextState),
				input: z.object({ context: z.string().min(1) }),
				expose: { mcp: true },
			}),
			defineCommand({
				...createAfdContextExitCommand(contextState),
				input: z.object({}),
				expose: { mcp: true },
			}),
		];
		for (const command of builtins) {
			if (registeredCommands.some((existing) => existing.name === command.name)) {
				throw new Error(`Reserved context command name: ${command.name}`);
			}
			registeredCommands.push(command);
		}
	}
	if (bootstrap) {
		// afd-help/afd-docs/afd-schema describe what a remote agent can see and call:
		// MCP-exposed commands in the active context (built-ins included).
		// The caller's context state: the HTTP session's, or the single stdio state.
		const describe = (context?: CommandContext) =>
			filterByContext(remoteCommands, resolveContextState(context, contextState)?.getActive());
		registeredCommands.push(...getBootstrapCommands(describe));
	}
	const commandMap = new Map<string, ZodCommandDefinition>();
	for (const cmd of registeredCommands) {
		commandMap.set(cmd.name, cmd);
	}

	const engine = createExecutionEngine({
		commandMap,
		middleware,
		devMode,
		onCommand,
		onError,
	});

	const remoteCommands = registeredCommands.filter((command) => isMcpExposed(command));
	const remoteEngine = createExecutionEngine({
		commandMap: new Map(remoteCommands.map((command) => [command.name, command])),
		middleware,
		devMode,
		onCommand,
		onError,
		contextState,
	});
	const exposedCommandNames = new Set(remoteCommands.map((c) => c.name));
	const mutationNames = new Set(
		remoteCommands.filter((command) => command.mutation === true).map((command) => command.name)
	);

	const routeToolCall = createToolRouter({
		executeCommand: remoteEngine.executeCommand,
		executeBatch: remoteEngine.executeBatch,
		executePipeline: remoteEngine.executePipeline,
		commands: remoteCommands,
		toolStrategy,
		groupByFn,
		devMode,
		allCommands: remoteCommands,
		exposedCommandNames,
		contextState,
	});

	const boundGetToolsList = (context: CommandContext = {}) =>
		getToolsList(
			remoteCommands,
			toolStrategy,
			groupByFn,
			resolveContextState(context, contextState)?.getActive()
		);

	const { handler, dispose } = createHttpHandler({
		name,
		version,
		host,
		port,
		cors,
		devMode,
		allowedHosts: options.allowedHosts,
		allowedOrigins: options.allowedOrigins,
		maxBodyBytes: options.maxBodyBytes,
		maxSseConnections: options.maxSseConnections,
		getToolsList: boundGetToolsList,
		routeToolCall,
		executeCommand: remoteEngine.executeCommand,
		executeBatch: remoteEngine.executeBatch,
		executeStream: remoteEngine.executeStream,
		isMutation: (commandName) => mutationNames.has(commandName),
		sessions,
		createContext: options.createContext,
		onError,
	});

	return {
		engine,
		routeToolCall,
		getToolsList: boundGetToolsList,
		handler,
		dispose,
		url: `http://${host}:${port}`,
	};
}

/**
 * Create an embeddable Node HTTP handler for MCP endpoints.
 *
 * Unlike `createMcpServer()`, this does not create or start an HTTP server.
 * The caller owns the server lifecycle and can attach the returned handler to
 * any Node HTTP host that accepts `(req, res) => Promise<void>`.
 */
export function createMcpHandler(options: McpHandlerOptions): McpHandler {
	const runtime = createSharedHttpRuntime(options);
	return Object.assign(runtime.handler, { dispose: runtime.dispose });
}

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
	const autoDetected = stdio === undefined && transport === 'auto';

	// ── Shared execution/runtime wiring ─────────────────────────────────────

	const sharedRuntime = createSharedHttpRuntime({
		...options,
		name,
		version,
		commands,
		port,
		host,
		devMode,
		cors,
		middleware,
		onCommand,
		onError,
		toolStrategy,
		groupByFn,
		contexts,
	});

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
					tools: sharedRuntime.getToolsList(),
				}));

				mcpSdkServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
					// Spread into anonymous object for MCP SDK index signature compatibility
					return {
						...(await sharedRuntime.routeToolCall(
							request.params.name,
							request.params.arguments ?? {},
							{ signal: extra.signal, interface: 'mcp' }
						)),
					};
				});

				const stdioTransport = new StdioServerTransport();
				await mcpSdkServer.connect(stdioTransport);
				isRunning = true;
				// stdout carries MCP frames, so the notice goes to stderr.
				console.error(
					autoDetected
						? `[${name}] MCP transport: stdio (auto-detected because stdin is not a TTY; set transport: 'http' to serve HTTP)`
						: `[${name}] MCP transport: stdio`
				);

				if (!useHttp) return;
			}

			// HTTP transport
			if (useHttp) {
				httpServer = createServer(sharedRuntime.handler);

				await new Promise<void>((resolve, reject) => {
					httpServer?.on('error', reject);
					httpServer?.listen(port, host, () => {
						isRunning = true;
						resolve();
					});
				});
				console.error(
					`[${name}] MCP transport: http at ${sharedRuntime.url}${autoDetected ? ' (auto-detected because stdin is a TTY)' : ''}`
				);
			}
		},

		async stop() {
			if (!isRunning) return;

			if (mcpSdkServer) {
				await mcpSdkServer.close();
				mcpSdkServer = null;
			}

			if (httpServer) {
				sharedRuntime.dispose();
				httpServer.closeAllConnections();
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
			return useHttp ? sharedRuntime.url : 'stdio://';
		},

		getCommands() {
			return commands;
		},

		getTransport(): 'stdio' | 'http' {
			return resolvedTransport;
		},

		execute: sharedRuntime.engine.executeCommand,
		executePipeline: sharedRuntime.engine.executePipeline,
	};
}
