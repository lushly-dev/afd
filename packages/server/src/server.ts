/**
 * @fileoverview MCP Server factory for AFD commands
 *
 * This module provides utilities for creating MCP-compliant servers
 * from Zod-defined commands.
 */

import { createServer, type Server as HttpServer } from "node:http";
import type {
  BatchCommand,
  BatchCommandResult,
  BatchOptions,
  BatchRequest,
  BatchResult,
  BatchTiming,
  CommandContext,
  CommandResult,
  StreamChunk,
} from "@lushly-dev/afd-core";
import {
  calculateBatchConfidence,
  createBatchResult,
  createCompleteChunk,
  createErrorChunk,
  createFailedBatchResult,
  failure,
  isBatchRequest,
} from "@lushly-dev/afd-core";
import { Server as McpSdkServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ZodCommandDefinition } from "./schema.js";
import { validateInput, type ValidationResult } from "./validation.js";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transport type for MCP server.
 *
 * - `"stdio"`: Standard input/output transport for IDE/CLI integration (Cursor, Claude Code, etc.)
 * - `"http"`: HTTP/SSE transport for browser-based clients
 * - `"auto"`: Auto-detect based on whether stdin is a TTY (stdio if piped, http if TTY)
 */
export type McpTransport = "stdio" | "http" | "auto";

/**
 * Detect whether stdin is being piped (non-TTY).
 * Used for auto-detection of transport mode.
 *
 * @returns true if stdin is a pipe (not interactive), false if it's a TTY
 */
export function isStdinPiped(): boolean {
  return !process.stdin.isTTY;
}

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

  /**
   * Enable development mode.
   * When true:
   * - Error responses include stack traces
   * - CORS allows all origins (*)
   * - Verbose validation errors are returned
   *
   * When false (default, secure by default):
   * - Stack traces are omitted from error responses
   * - CORS is restrictive (same-origin only unless cors option is set)
   * - Validation errors are sanitized
   */
  devMode?: boolean;

  /** Enable CORS for browser access (in production, requires explicit opt-in) */
  cors?: boolean;

  /**
   * Transport protocol to use.
   *
   * - `"stdio"`: Standard input/output for IDE/agent integration (Cursor, Claude Code, Antigravity)
   * - `"http"`: HTTP/SSE for browser-based clients and web UIs
   * - `"auto"`: Auto-detect based on environment (stdio if piped, http if TTY) - **default**
   *
   * @default "auto"
   *
   * @example
   * ```typescript
   * // For IDE integration (Cursor, Claude Code):
   * createMcpServer({ transport: "stdio", ... });
   *
   * // For web UI:
   * createMcpServer({ transport: "http", ... });
   *
   * // Auto-detect (recommended for most cases):
   * createMcpServer({ transport: "auto", ... });
   * ```
   */
  transport?: McpTransport;

  /**
   * @deprecated Use `transport: "stdio"` or `transport: "auto"` instead.
   * Enable stdio transport (default: true when transport is not specified)
   */
  stdio?: boolean;

  /** Middleware to run before command execution */
  middleware?: CommandMiddleware[];

  /** Called when a command is executed */
  onCommand?: (command: string, input: unknown, result: CommandResult) => void;

  /** Called on server errors */
  onError?: (error: Error) => void;

  /**
   * Tool strategy for MCP tool listing.
   * - "individual": Each command is exposed as a separate tool (default)
   * - "grouped": Commands are grouped by category into consolidated tools
   */
  toolStrategy?: "individual" | "grouped";

  /**
   * Custom function to derive group name from command.
   * Used when toolStrategy is "grouped".
   * Defaults to using command.category or first segment of command name.
   */
  groupByFn?: (command: ZodCommandDefinition) => string | undefined;
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

  /** Get server URL (returns "stdio://" for stdio transport) */
  getUrl(): string;

  /** Get registered commands */
  getCommands(): ZodCommandDefinition[];

  /**
   * Get the resolved transport mode.
   * Useful for debugging and logging.
   */
  getTransport(): "stdio" | "http";

  /** Execute a command directly (for testing) */
  execute(
    name: string,
    input: unknown,
    context?: CommandContext
  ): Promise<CommandResult>;
}

/**
 * SSE Client connection.
 */
interface SseClient {
  id: string;
  response: import("node:http").ServerResponse;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP MESSAGE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface McpRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

interface McpResponse {
  jsonrpc: "2.0";
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
    host = "localhost",
    devMode = false,
    // In dev mode, CORS is permissive by default; in production, it's off by default
    cors = devMode,
    transport = "auto",
    stdio, // deprecated, for backward compatibility
    middleware = [],
    onCommand,
    onError,
    toolStrategy = "grouped",
    groupByFn,
  } = options;

  // Resolve transport mode
  // - If explicit transport is set, use it
  // - If deprecated stdio option is set, use it for backward compatibility
  // - Otherwise, auto-detect based on environment
  function resolveTransport(): "stdio" | "http" {
    // Handle deprecated stdio option for backward compatibility
    if (stdio !== undefined) {
      return stdio ? "stdio" : "http";
    }

    // Auto-detect: use stdio if stdin is piped (not a TTY), otherwise use HTTP
    if (transport === "auto") {
      return isStdinPiped() ? "stdio" : "http";
    }

    // Explicit transport mode (stdio or http)
    return transport as "stdio" | "http";
  }

  const resolvedTransport = resolveTransport();
  const useStdio = resolvedTransport === "stdio";
  const useHttp = resolvedTransport === "http";

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
        code: "COMMAND_NOT_FOUND",
        message: `Command '${commandName}' not found`,
        suggestion: `Available commands: ${Array.from(commandMap.keys()).join(
          ", "
        )}`,
      });
    }

    // Validate input
    const validation = validateInput(command.inputSchema, input);
    if (!validation.success) {
      return failure({
        code: "VALIDATION_ERROR",
        message: "Input validation failed",
        suggestion: validation.errors.map((e) => e.message).join("; "),
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
        code: "COMMAND_EXECUTION_ERROR",
        message: devMode ? err.message : "An internal error occurred",
        suggestion: devMode
          ? "Check the command implementation"
          : "Contact support if this persists",
        // Only include stack traces in dev mode to prevent information leakage
        ...(devMode ? { details: { stack: err.stack } } : {}),
      });
    }
  }

  /**
   * Execute multiple commands in a batch with partial success semantics.
   */
  async function executeBatch(
    request: BatchRequest,
    context: CommandContext = {}
  ): Promise<BatchResult> {
    const startedAt = new Date().toISOString();
    const startTime = performance.now();

    // Validate request
    if (!request.commands || request.commands.length === 0) {
      return createFailedBatchResult(
        {
          code: "INVALID_BATCH_REQUEST",
          message: "Batch request must contain at least one command",
          suggestion: "Provide an array of commands to execute",
        },
        { startedAt }
      );
    }

    const options = request.options ?? {};
    const results: BatchCommandResult[] = [];
    let stopped = false;

    // Execute commands sequentially
    for (let i = 0; i < request.commands.length; i++) {
      const cmd = request.commands[i]!;

      if (stopped) {
        results.push({
          id: cmd.id ?? `cmd-${i}`,
          index: i,
          command: cmd.command,
          result: {
            success: false,
            error: {
              code: "COMMAND_SKIPPED",
              message: "Command skipped due to previous error (stopOnError enabled)",
            },
          },
          durationMs: 0,
        });
        continue;
      }

      const cmdStartTime = performance.now();
      const result = await executeCommand(cmd.command, cmd.input, {
        ...context,
        traceId: context.traceId ?? `batch-${Date.now()}-${i}`,
      });
      const cmdDuration = performance.now() - cmdStartTime;

      results.push({
        id: cmd.id ?? `cmd-${i}`,
        index: i,
        command: cmd.command,
        result,
        durationMs: Math.round(cmdDuration * 100) / 100,
      });

      if (!result.success && options.stopOnError) {
        stopped = true;
      }

      // Check timeout
      if (options.timeout && performance.now() - startTime > options.timeout) {
        for (let j = i + 1; j < request.commands.length; j++) {
          const remainingCmd = request.commands[j]!;
          results.push({
            id: remainingCmd.id ?? `cmd-${j}`,
            index: j,
            command: remainingCmd.command,
            result: {
              success: false,
              error: {
                code: "BATCH_TIMEOUT",
                message: `Batch timeout exceeded (${options.timeout}ms)`,
                retryable: true,
              },
            },
            durationMs: 0,
          });
        }
        break;
      }
    }

    const completedAt = new Date().toISOString();
    const totalMs = performance.now() - startTime;

    const timing: BatchTiming = {
      totalMs: Math.round(totalMs * 100) / 100,
      averageMs:
        results.length > 0
          ? Math.round((totalMs / results.length) * 100) / 100
          : 0,
      startedAt,
      completedAt,
    };

    return createBatchResult(results, timing, {
      traceId: context.traceId ?? `batch-${Date.now()}`,
    });
  }

  /**
   * Execute a command as a stream, yielding chunks.
   */
  async function* executeStream(
    commandName: string,
    input: unknown,
    context: CommandContext = {}
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const startTime = performance.now();
    let chunksEmitted = 0;

    try {
      const result = await executeCommand(commandName, input, context);

      if (!result.success) {
        yield createErrorChunk(
          result.error ?? {
            code: "COMMAND_FAILED",
            message: "Command execution failed",
          },
          chunksEmitted,
          result.error?.retryable ?? false
        );
        return;
      }

      const data = result.data;

      // If result is an array, emit each item as a chunk
      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
          yield {
            type: "data",
            data: data[i],
            index: i,
            isLast: i === data.length - 1,
          };
          chunksEmitted++;
        }
      } else {
        yield {
          type: "data",
          data: data,
          index: 0,
          isLast: true,
        };
        chunksEmitted++;
      }

      // Emit completion
      const totalDurationMs = performance.now() - startTime;
      yield createCompleteChunk(chunksEmitted, totalDurationMs, {
        confidence: result.confidence,
        reasoning: result.reasoning,
        metadata: result.metadata,
      });
    } catch (error) {
      yield createErrorChunk(
        {
          code: "STREAM_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
        chunksEmitted,
        true
      );
    }
  }

  /**
   * Get the tools list based on toolStrategy.
   */
  function getToolsList() {
    // Built-in afd-batch tool (always individual)
    const batchTool = {
      name: "afd-batch",
      description: "Execute multiple commands in a single batch request with partial success semantics",
      inputSchema: {
        type: "object" as const,
        properties: {
          commands: {
            type: "array",
            description: "Array of commands to execute",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Optional client-provided ID for correlating results" },
                command: { type: "string", description: "The command name to execute" },
                input: { type: "object", description: "Input parameters for the command" },
              },
              required: ["command"],
            },
          },
          options: {
            type: "object",
            description: "Batch execution options",
            properties: {
              stopOnError: { type: "boolean", description: "Stop execution on first error" },
              timeout: { type: "number", description: "Timeout in milliseconds for entire batch" },
            },
          },
        },
        required: ["commands"],
      },
    };

    // Individual strategy: each command is its own tool
    if (toolStrategy === "individual") {
      return [
        batchTool,
        ...commands.map((cmd) => {
          const { type: _type, ...restSchema } = cmd.jsonSchema;
          return {
            name: cmd.name,
            description: cmd.description,
            inputSchema: {
              type: "object" as const,
              ...restSchema,
            },
          };
        }),
      ];
    }

    // Grouped strategy: commands grouped by category/entity
    const defaultGroupFn = (cmd: ZodCommandDefinition): string => {
      return cmd.category || cmd.name.split("-")[0] || "general";
    };
    const getGroup = groupByFn || defaultGroupFn;

    // Group commands by their group key
    const groups: Record<string, ZodCommandDefinition[]> = {};
    for (const cmd of commands) {
      const group = getGroup(cmd) || "general";
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(cmd);
    }

    // Create a consolidated tool for each group
    const groupedTools = Object.entries(groups).map(([groupName, groupCmds]) => {
      // Build action enum from command names
      const actions = groupCmds.map(cmd => {
        // Extract action from command name (e.g., "todo-create" -> "create")
        const parts = cmd.name.split("-");
        return parts.length > 1 ? parts.slice(1).join("-") : cmd.name;
      });

      return {
        name: groupName,
        description: `${groupName} operations: ${actions.join(", ")}`,
        inputSchema: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              enum: actions,
              description: `Action to perform: ${actions.join(" | ")}`,
            },
            // Note: Full discriminated union would require merging all command schemas
            // For now, we use a generic "params" object
            params: {
              type: "object",
              description: "Parameters for the action (varies by action)",
            },
          },
          required: ["action"],
        },
      };
    });

    return [batchTool, ...groupedTools];
  }

  /**
   * Handle MCP JSON-RPC request.
   */
  function handleMcpRequest(request: McpRequest): McpResponse {
    const { id, method } = request;

    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name,
              version,
            },
          },
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: getToolsList(),
          },
        };

      case "notifications/initialized":
        // Client notification, no response needed for notifications
        // but we return a success for acknowledgment
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };

      default:
        return {
          jsonrpc: "2.0",
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
  async function handleAsyncMcpRequest(
    request: McpRequest
  ): Promise<McpResponse> {
    const { id, method, params } = request;

    if (method === "tools/call") {
      const { name: toolName, arguments: args } = params as {
        name: string;
        arguments?: unknown;
      };

      // Handle built-in afd-batch tool
      if (toolName === "afd-batch") {
        const batchRequest = args as BatchRequest;
        const result = await executeBatch(batchRequest, {
          traceId: `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: !result.success,
          },
        };
      }

      // Handle grouped tool calls (when toolStrategy === "grouped")
      if (toolStrategy === "grouped") {
        const typedArgs = args as { action?: string; params?: unknown } | undefined;
        const action = typedArgs?.action;
        const commandParams = typedArgs?.params ?? {};
        
        if (action && typeof action === "string") {
          // Construct actual command name: groupName-action
          const actualCommandName = `${toolName}-${action}`;
          
          const result = await executeCommand(actualCommandName, commandParams, {
            traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          });

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
              isError: !result.success,
            },
          };
        }
      }

      // Handle user-defined commands (individual mode)
      const result = await executeCommand(toolName, args ?? {}, {
        traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
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
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse
    ) => {
      // CORS headers - restrictive in production, permissive in dev mode
      if (cors) {
        // In dev mode, allow all origins; in production, allow same-origin or configured origins
        res.setHeader(
          "Access-Control-Allow-Origin",
          devMode ? "*" : req.headers.origin ?? ""
        );
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      }

      // Handle preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      // SSE endpoint
      if (url.pathname === "/sse" && req.method === "GET") {
        const clientId = `client-${++clientIdCounter}`;

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const client: SseClient = { id: clientId, response: res };
        sseClients.set(clientId, client);

        // Send endpoint info
        sendSseEvent(client, "endpoint", {
          url: `http://${host}:${port}/message`,
        });

        // Handle client disconnect
        req.on("close", () => {
          sseClients.delete(clientId);
        });

        return;
      }

      // Message endpoint
      if (url.pathname === "/message" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }

        try {
          const request = JSON.parse(body) as McpRequest;
          const response = await handleAsyncMcpRequest(request);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        } catch (error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32700,
                message: "Parse error",
              },
            })
          );
        }

        return;
      }

      // Health check
      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", name, version }));
        return;
      }

      // Batch endpoint
      if (url.pathname === "/batch" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }

        try {
          const batchRequest = JSON.parse(body) as BatchRequest;
          
          if (!isBatchRequest(batchRequest)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              success: false,
              error: {
                code: "INVALID_BATCH_REQUEST",
                message: "Invalid batch request format",
                suggestion: "Provide { commands: [...] } with command objects",
              },
            }));
            return;
          }

          const result = await executeBatch(batchRequest, {
            traceId: `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: false,
            error: {
              code: "PARSE_ERROR",
              message: "Failed to parse batch request",
              suggestion: "Ensure request body is valid JSON",
            },
          }));
        }
        return;
      }

      // Stream endpoint - SSE for streaming command results
      if (url.pathname.startsWith("/stream/") && req.method === "GET") {
        const commandName = url.pathname.slice("/stream/".length);
        const inputParam = url.searchParams.get("input");
        let input: unknown = {};

        if (inputParam) {
          try {
            input = JSON.parse(inputParam);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              success: false,
              error: {
                code: "INVALID_INPUT",
                message: "Failed to parse input parameter",
                suggestion: "Ensure input is valid JSON",
              },
            }));
            return;
          }
        }

        // Set up SSE response
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const context: CommandContext = {
          traceId: `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };

        // Handle client disconnect
        let aborted = false;
        req.on("close", () => {
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
              code: "STREAM_ERROR",
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
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    };
  }

  // Track MCP SDK server for stdio transport cleanup
  let mcpSdkServer: McpSdkServer | null = null;

  return {
    async start() {
      if (isRunning) {
        return;
      }

      // Start stdio transport if enabled using official MCP SDK
      if (useStdio) {
        mcpSdkServer = new McpSdkServer(
          { name, version },
          { capabilities: { tools: {} } }
        );

        // Register tools/list handler - use shared getToolsList() for consistency
        mcpSdkServer.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: getToolsList(),
        }));

        // Register tools/call handler
        mcpSdkServer.setRequestHandler(CallToolRequestSchema, async (request) => {
          const toolName = request.params.name;
          const args = request.params.arguments ?? {};

          // Handle built-in afd.batch tool
          if (toolName === "afd-batch") {
            // Validate that args looks like a BatchRequest before processing
            if (!isBatchRequest(args)) {
              return {
                content: [{ type: "text", text: JSON.stringify({
                  success: false,
                  error: {
                    code: "INVALID_BATCH_REQUEST",
                    message: "Invalid batch request format",
                    suggestion: "Provide { commands: [...] } with command objects",
                  },
                }, null, 2) }],
                isError: true,
              };
            }
            const result = await executeBatch(args, {
              traceId: `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              isError: !result.success,
            };
          }

          // Handle grouped tool calls (when toolStrategy === "grouped")
          // Grouped tools have format: { action: "create", params: {...} }
          if (toolStrategy === "grouped") {
            const action = (args as { action?: string }).action;
            const params = (args as { params?: unknown }).params ?? {};
            
            // Debug logging when enabled
            if (devMode) {
              console.error(`[MCP Debug] Grouped tool call: toolName=${toolName}, action=${action}, args=${JSON.stringify(args)}`);
            }
            
            // Check if this is a grouped tool call (has action property)
            if (action && typeof action === "string") {
              // Construct the actual command name: groupName-action
              // e.g., "todo" + "create" = "todo-create"
              const actualCommandName = `${toolName}-${action}`;
              
              // Execute the actual command
              const result = await executeCommand(actualCommandName, params, {
                traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              });

              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                isError: !result.success,
              };
            }
            
            // In grouped mode, if tool is a known group but action is missing/invalid,
            // return a helpful error instead of falling through
            const groupNames = new Set(commands.map(cmd => {
              const defaultGroupFn = (c: ZodCommandDefinition): string => c.category || c.name.split("-")[0] || "general";
              return (groupByFn || defaultGroupFn)(cmd);
            }));
            
            if (groupNames.has(toolName)) {
              const groupCommands = commands.filter(cmd => {
                const defaultGroupFn = (c: ZodCommandDefinition): string => c.category || c.name.split("-")[0] || "general";
                return (groupByFn || defaultGroupFn)(cmd) === toolName;
              });
              const availableActions = groupCommands.map(cmd => {
                const parts = cmd.name.split("-");
                return parts.length > 1 ? parts.slice(1).join("-") : cmd.name;
              });
              
              return {
                content: [{ type: "text", text: JSON.stringify({
                  success: false,
                  error: {
                    code: "INVALID_GROUPED_CALL",
                    message: `Grouped tool '${toolName}' requires an 'action' parameter`,
                    suggestion: `Provide { action: "<action>", params: {...} }. Available actions: ${availableActions.join(", ")}`,
                  },
                  _debug: devMode ? { receivedArgs: args } : undefined,
                }, null, 2) }],
                isError: true,
              };
            }
          }

          // Handle user-defined commands (individual mode or direct command calls)
          const result = await executeCommand(toolName, args, {
            traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          });

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: !result.success,
          };
        });

        // Connect to stdio transport
        const transport = new StdioServerTransport();
        await mcpSdkServer.connect(transport);

        isRunning = true;

        // For stdio-only mode, we're done
        if (!useHttp) {
          return;
        }
      }

      // Start HTTP transport if enabled
      if (useHttp) {
        httpServer = createServer(createRequestHandler());

        await new Promise<void>((resolve, reject) => {
          httpServer!.on("error", reject);
          httpServer!.listen(port, host, () => {
            isRunning = true;
            resolve();
          });
        });
      }
    },

    async stop() {
      if (!isRunning) {
        return;
      }

      // Close MCP SDK server if it exists
      if (mcpSdkServer) {
        await mcpSdkServer.close();
        mcpSdkServer = null;
      }

      // Close HTTP server if it exists
      if (httpServer) {
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
      }

      isRunning = false;
    },

    getUrl() {
      return useHttp ? `http://${host}:${port}` : "stdio://";
    },

    getCommands() {
      return commands;
    },

    /**
     * Get the resolved transport mode.
     * Useful for debugging and logging.
     */
    getTransport(): "stdio" | "http" {
      return resolvedTransport;
    },

    execute: executeCommand,
  };
}
