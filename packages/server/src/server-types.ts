/**
 * @fileoverview MCP server type definitions and transport utilities.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
	Actor,
	Clock,
	CommandContext,
	CommandMiddleware,
	CommandResult,
	PipelineRequest,
	PipelineResult,
	RandomSource,
} from '@lushly-dev/afd-core';
import type { ContextField } from './context-fields.js';
import type { ZodCommandDefinition } from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transport type for MCP server.
 *
 * - `"stdio"`: Standard input/output transport for IDE/CLI integration (Cursor, Claude Code, etc.)
 * - `"http"`: HTTP/SSE transport for browser-based clients
 * - `"auto"`: Auto-detect based on whether stdin is a TTY (stdio if piped, http if TTY).
 *   Under Docker without `-t`, systemd, pm2 or CI, stdin is not a TTY, so `"auto"` picks stdio
 *   and the HTTP port never opens. Set `"http"` explicitly for network servers.
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

/** How an MCP server lists its commands as tools (`McpServerOptions.toolStrategy`). */
export type ToolStrategy = 'individual' | 'grouped' | 'lazy' | 'hybrid';

/** The most first-class tools a hybrid server lists (`spec/tool-strategies.md`, H5). */
export const MAX_FIRST_CLASS_TOOLS = 8;

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

	/**
	 * Send CORS response headers for accepted browser origins. It does not widen which
	 * origins are accepted; see `allowedOrigins`.
	 *
	 * @default devMode
	 */
	cors?: boolean;

	/** Allowed HTTP Host names (without ports). Defaults to the configured host and loopback names. Set explicitly for proxies and embedded hosts. */
	allowedHosts?: string[];

	/** Exact additional browser origins. Same-origin requests are allowed by default; devMode permits any origin. */
	allowedOrigins?: string[];

	/**
	 * Maximum request body size in bytes (default: 1048576). Also caps the UTF-8 size of the
	 * `input` query parameter of `GET /stream`; larger input is refused with HTTP 413.
	 */
	maxBodyBytes?: number;

	/**
	 * Per-request context for HTTP calls: its result is merged into the `CommandContext` of
	 * every remotely executed command. Use it to pass the authenticated user or the remote
	 * address to middleware such as `createRateLimitMiddleware`. Not called for stdio.
	 *
	 * @example
	 * ```typescript
	 * createContext: (req) => ({ clientId: req.socket.remoteAddress ?? 'unknown' }),
	 * middleware: [createRateLimitMiddleware({ maxRequests: 60, windowMs: 60_000,
	 *   keyFn: (ctx) => String(ctx.clientId) })],
	 * ```
	 */
	createContext?: CreateRequestContext;

	/** Maximum concurrent `/sse` connections; more receive HTTP 503 (default: 100). */
	maxSseConnections?: number;

	/**
	 * Maximum live HTTP sessions when `contexts` are configured; the least recently used one
	 * is evicted beyond it (default: 1000).
	 */
	maxSessions?: number;

	/** Idle time in milliseconds after which an HTTP session expires (default: 1800000, 30 minutes). */
	sessionIdleTimeoutMs?: number;

	/**
	 * Clock given to handlers as `context.clock` when the context has none, and used for
	 * HTTP session idle expiry. Default: `systemClock`. Pass `fixedClock()` in tests.
	 */
	clock?: Clock;

	/** Random source given to handlers as `context.random` when the context has none. Default: `systemRandom`. */
	random?: RandomSource;

	/**
	 * Request values the host declares (`spec/context-fields.md`): each one's context key, `_meta`
	 * key, schema, and whether the journal keeps it. A call's value is validated before middleware
	 * runs, and an invalid or missing required one fails the call with `VALIDATION_ERROR`.
	 */
	contextFields?: readonly ContextField[];

	/**
	 * Actor for commands called over MCP (stdio or HTTP) when the context has none.
	 * Default: `{ kind: 'agent' }`. `createContext` can set a per-request `actor`, and auth
	 * middleware can add its `id` and `label`.
	 */
	actor?: Actor;

	/**
	 * Guidance for agents returned by MCP `server/discover` on the `/mcp` endpoint and on
	 * stdio. Defaults to a description of the tool strategy, the meta-tools and, when
	 * `contexts` are configured, how to select one.
	 */
	instructions?: string;

	/**
	 * Freshness hint, in milliseconds, for `tools/list` and `server/discover` results on the
	 * MCP 2026-07-28 lane (`ttlMs`, with `cacheScope: "public"`). Default: 300000 (5 minutes),
	 * or 0 when `contexts` are configured, because MCP clients cache `tools/list` without its
	 * `_meta` and a context-scoped list would be served from the unscoped entry. The hybrid
	 * strategy keeps 300000 under `contexts`: its list does not vary by context. Set 0 when the
	 * command set changes at runtime.
	 */
	toolsListTtlMs?: number;

	/**
	 * Advertise a top-level MCP `outputSchema` (the CommandResult envelope with `data` typed by the
	 * command's `output` schema) on individual command tools. MCP clients then validate each
	 * result's `structuredContent` against it, so a handler whose data does not match its declared
	 * output schema fails on the client. `_meta.outputSchema` is reported either way.
	 *
	 * @default true
	 */
	advertiseOutputSchema?: boolean;

	/**
	 * Enforce `confirmPrompt` on the MCP and HTTP surfaces (`spec/command-metadata.md`,
	 * "Confirmations"). A call that reaches a command with `confirmPrompt` then runs only with a
	 * confirmation:
	 *
	 * - `"off"`: no enforcement (the default).
	 * - `"enforce"`: an accepted MCP elicitation, when the client can show one, or an
	 *   acknowledgement (`confirm: true`, or `_meta["dev.afd/confirm"]`). An agent can send an
	 *   acknowledgement on its own, so it is a deliberate second call, not the user's consent.
	 * - `"require-human"`: an accepted elicitation only.
	 *
	 * Otherwise the call fails with `CONFIRMATION_REQUIRED` or `CONFIRMATION_DECLINED` before the
	 * handler runs. In-process calls (`server.execute`, DirectClient) are never gated.
	 *
	 * @default 'off'
	 */
	confirmations?: 'off' | 'enforce' | 'require-human';

	/**
	 * HMAC key (at least 32 bytes) that signs the `requestState` of confirmation elicitations. Every
	 * instance that may receive a retry needs the same key. Without it, each process uses a random
	 * key, which works only when one process serves every request.
	 */
	confirmationKey?: string | Uint8Array;

	/**
	 * Transport protocol to use.
	 *
	 * - `"stdio"`: Standard input/output for IDE/agent integration (Cursor, Claude Code, Antigravity)
	 * - `"http"`: HTTP/SSE for browser-based clients and web UIs
	 * - `"auto"`: Auto-detect based on environment (stdio if piped, http if TTY) - **default**
	 *
	 * `"auto"` chooses stdio whenever stdin is not a TTY. That includes Docker without `-t`,
	 * systemd, pm2 and CI, where the HTTP port then silently never opens. Network servers
	 * should set `transport: "http"`. `start()` logs the resolved transport to stderr.
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
	 * // Auto-detect (for servers launched by an IDE or run from a terminal):
	 * createMcpServer({ transport: "auto", ... });
	 * ```
	 */
	transport?: McpTransport;

	/** Middleware to run before command execution */
	middleware?: CommandMiddleware[];

	/** Called when a command is executed */
	onCommand?: (command: string, input: unknown, result: CommandResult) => void;

	/** Called on server errors */
	onError?: (error: Error) => void;

	/**
	 * Tool strategy for MCP tool listing (`spec/tool-strategies.md`). `afd-call`, `afd-batch`
	 * and `afd-pipe` are listed in every strategy.
	 * - "grouped" (default): one tool per group (category, or the first name segment)
	 *   taking `{ action, params }`. Each grouped tool's `_meta.actions` carries every
	 *   action's command name, input schema and metadata; small groups also inline the
	 *   per-action schemas as `params.anyOf`. `afd-detail` is listed too.
	 * - "individual": each command is its own tool, with its input schema and `_meta`
	 * - "lazy": only the afd-discover and afd-detail meta-tools (plus the three above)
	 * - "hybrid": the five meta-tools, the context tools when `contexts` are configured, then
	 *   the commands named by `firstClassTools` as individual tools. The list never varies by
	 *   context and never changes while the server runs.
	 *
	 * @default "grouped"
	 */
	toolStrategy?: ToolStrategy;

	/**
	 * The commands the `"hybrid"` strategy lists as their own tools, in list order: at most
	 * {@link MAX_FIRST_CLASS_TOOLS}, each registered and MCP-exposed, none a meta-tool or context
	 * tool, none repeated. Required, and not empty, with `toolStrategy: "hybrid"`; refused with any
	 * other strategy. Server creation throws on a mistake, naming the entry.
	 */
	firstClassTools?: string[];

	/**
	 * Custom function to derive group name from command.
	 * Used when toolStrategy is "grouped".
	 * Defaults to using command.category or first segment of command name.
	 */
	groupByFn?: (command: ZodCommandDefinition) => string | undefined;

	/**
	 * Context configurations for tool scoping. When provided, enables context-based tool
	 * filtering and registers `afd-context-list`, `afd-context-enter` and `afd-context-exit`.
	 *
	 * Context state is per client: stdio has one stack, and each HTTP session has its own.
	 * Over HTTP, `initialize` returns an `Mcp-Session-Id` header that later requests repeat;
	 * requests without it see no active context and cannot enter one. Stacks hold at most 16
	 * contexts, and re-entering the active context is a no-op.
	 */
	contexts?: ContextConfig[];

	/**
	 * Register the afd-help, afd-docs and afd-schema bootstrap tools (MCP-exposed).
	 * They describe the MCP-exposed commands visible in the active context, including
	 * built-ins. The names become reserved, so a command with one of them throws.
	 *
	 * @default false
	 */
	bootstrap?: boolean;
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
 * Derive per-request `CommandContext` values from an HTTP request, for example the
 * authenticated user or the remote address.
 *
 * The returned object is merged into the context of every command the request executes
 * (`tools/call`, `afd-call`, batch items, pipeline steps, `/rpc`, `/batch` and `/stream`).
 * The reserved keys `traceId`, `signal` and `interface` are set by the server and ignored if
 * returned. A throw is reported to `onError` and answered as an internal error.
 */
export type CreateRequestContext = (
	req: IncomingMessage
) => Record<string, unknown> | Promise<Record<string, unknown>>;

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

	/** The declared context fields, so `replayJournal` can tell which recorded values still apply. */
	readonly contextFields: readonly ContextField[];

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
