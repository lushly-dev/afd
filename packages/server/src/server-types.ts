/**
 * @fileoverview MCP server type definitions and transport utilities.
 */

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
}

export type { CommandMiddleware } from '@lushly-dev/afd-core';

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
	 */
	executePipeline(request: PipelineRequest, context?: CommandContext): Promise<PipelineResult>;
}
