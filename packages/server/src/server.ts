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
} from "@afd/core";
import {
  calculateBatchConfidence,
  createBatchResult,
  createCompleteChunk,
  createErrorChunk,
  createFailedBatchResult,
  failure,
  isBatchRequest,
} from "@afd/core";
import type { ZodCommandDefinition } from "./schema.js";
import { validateInput, type ValidationResult } from "./validation.js";

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

  /** Enable stdio transport (default: true) */
  stdio?: boolean;

  /** Middleware to run before command execution */
  middleware?: CommandMiddleware[];

  /** Called when a command is executed */
  onCommand?: (command: string, input: unknown, result: CommandResult) => void;

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
    host = "localhost",
    devMode = false,
    // In dev mode, CORS is permissive by default; in production, it's off by default
    cors = devMode,
    stdio = true,
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
            tools: [
              // Built-in afd.batch tool
              {
                name: "afd.batch",
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
              },
              // User-defined commands
              ...commands.map((cmd) => {
                // Destructure to avoid duplicate 'type' property
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
            ],
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

      // Handle built-in afd.batch tool
      if (toolName === "afd.batch") {
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

  return {
    async start() {
      if (isRunning) {
        return;
      }

      // Start stdio transport if enabled
      if (stdio) {
        const readline = await import("node:readline");
        const rl = readline.createInterface({
          input: process.stdin,
          terminal: false,
        });

        rl.on("line", async (line) => {
          if (!line.trim()) return;
          try {
            const request = JSON.parse(line) as McpRequest;
            const response = await handleAsyncMcpRequest(request);
            process.stdout.write(JSON.stringify(response) + "\n");
          } catch (error) {
            // Silent fail for parse errors to avoid breaking protocol
          }
        });
      }

      httpServer = createServer(createRequestHandler());

      await new Promise<void>((resolve, reject) => {
        httpServer!.on("error", reject);
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
