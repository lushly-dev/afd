/**
 * @fileoverview MCP server type definitions and transport utilities.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
	CommandContext,
	CommandMiddleware,
	CommandResult,
	PipelineRequest,
	PipelineResult,
} from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transport type for MCP server.
 *
 * - `"stdio"`: Standard input/output transport for IDE/CLI integration (Cursor, Claude Code, etc.)
 * - `"http"`: HTTP/SSE transport for browser-based clients
 * - `"auto"`: Auto-detect based on whether stdin is a TTY (stdio if piped, http if TTY)
 */
export type McpTransport = 'stdio' | 'http' | 'auto';

/**
 * Detect whether stdin is being piped (non-TTY).
 * Used for auto-detection of transport mode.
 *
 * @returns true if stdin is a pipe (not interactive), false if it's a TTY
 */
export function isStdinPiped(): boolean {
	return !process.stdin.isTTY;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER OPTIONS & INTERFACE
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

	/** Allowed HTTP Host names (without ports). Defaults to the configured host and loopback names. Set explicitly for proxies and embedded hosts. */
	allowedHosts?: string[];

	/** Exact additional browser origins. Same-origin requests are allowed by default; devMode permits any origin. */
	allowedOrigins?: string[];

	/** Maximum request body size in bytes (default: 1048576). */
	maxBodyBytes?: number;

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
	 * - "lazy": Exposes afd-discover, afd-detail, and afd-call meta-tools instead of enumerating every command
	 */
	toolStrategy?: 'individual' | 'grouped' | 'lazy';

	/**
	 * Custom function to derive group name from command.
	 * Used when toolStrategy is "grouped".
	 * Defaults to using command.category or first segment of command name.
	 */
	groupByFn?: (command: ZodCommandDefinition) => string | undefined;

	/** Context configurations for tool scoping. When provided, enables context-based tool filtering. */
	contexts?: ContextConfig[];
}

/**
 * Options for creating an embeddable Node HTTP handler without starting a server.
 *
 * Aligns with the HTTP-relevant subset of `McpServerOptions`.
 */
export type McpHandlerOptions = Omit<McpServerOptions, 'transport' | 'stdio'>;

/**
 * Context configuration for tool scoping.
 */
export interface ContextConfig {
	/** Context name (kebab-case) */
	name: string;

	/** Human-readable description */
	description?: string;

	/** Keywords that suggest this context */
	triggers?: string[];

	/** Higher = suggested first in listings */
	priority?: number;
}

export type { CommandMiddleware } from '@lushly-dev/afd-core';

/**
 * Embeddable Node HTTP handler returned by `createMcpHandler()`.
 */
export type McpHandler = {
	(req: IncomingMessage, res: ServerResponse): Promise<void>;
	/** Close active SSE/stream responses when the embedding host shuts down. */
	dispose(): void;
};

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
	getTransport(): 'stdio' | 'http';

	/** Execute a command directly (for testing) */
	execute(name: string, input: unknown, context?: CommandContext): Promise<CommandResult>;

	/**
	 * Execute a pipeline of chained commands directly (for testing).
	 * Enables multi-step workflows with variable resolution.
	 *
	 * `context` reaches every command's context but is never visible to pipeline references:
	 * `$input` resolves to `request.input` (see `spec/pipeline-variables.md`).
	 */
	executePipeline(request: PipelineRequest, context?: CommandContext): Promise<PipelineResult>;
}
