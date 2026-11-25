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
import type { ApproverPredicate } from './approver.js';
import type { ContextField } from './context-fields.js';
import type { HumanRelay } from './human-relay.js';
import type { McpAuthOptions, PreDispatchCheck, PreDispatchCheckOptions } from './mcp-auth.js';
import type { Credentials } from './mcp-auth-rules.js';
import type { ResourcesOption } from './resources.js';
import type { ZodCommandDefinition } from './schema.js';
import type { SkillCatalog } from './skills.js';
import type { TaskOptions, TaskStore } from './tasks.js';

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
	 * Enable development mode: error responses include exception messages and stacks, and
	 * validation errors are verbose. When false (the default) they are redacted.
	 *
	 * It changes no HTTP check: Host and Origin validation and CORS headers are the same either
	 * way, so a page the developer visits cannot reach a dev server. To call the server from a
	 * browser app on another origin (such as a dev server on another port), list that origin in
	 * `allowedOrigins` and set `cors: true`.
	 */
	devMode?: boolean;

	/**
	 * Send CORS response headers for accepted browser origins: the request's own origin is
	 * echoed, never `*`. It does not widen which origins are accepted; see `allowedOrigins`.
	 *
	 * @default false
	 */
	cors?: boolean;

	/** Allowed HTTP Host names (without ports). Defaults to the configured host and loopback names. Set explicitly for proxies and embedded hosts. */
	allowedHosts?: string[];

	/**
	 * Exact additional browser origins, such as `http://localhost:5173`: each a serialized http(s)
	 * origin (`scheme://host[:port]`, no path or trailing slash; `*` and `null` throw). Same-origin
	 * requests are allowed by default, and requests without an Origin unless their
	 * `Sec-Fetch-Site` is `cross-site` or `same-site`; any other browser origin is refused with
	 * HTTP 403, in `devMode` too.
	 */
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
	 * Its `actor`, and `credentials` (`{ issuer, subject, clientId }` of a token the host
	 * verified), are the call's principal: the `requestState` of a confirmation or approval
	 * elicitation is bound to them (`principalBinding`, #532), so an answer one caller gave never
	 * counts for another. Set them only from what the host verified, never from a header a caller
	 * can send. `credentials` without a non-empty `issuer`, `subject` and `clientId` fail such a
	 * call with an internal error. The SDK's own `authInfo` contributes only its `clientId`: a
	 * host that authenticates people through the SDK must copy their identity into `credentials`
	 * (or the `actor`), or every user of one client shares a binding.
	 *
	 * Credentials set here are the host's, not afd-server's: `isVerifiedCredentials` does not
	 * recognise them, so afd-auth's middleware still gates such a call on its own session.
	 *
	 * With `auth`, it is given the request's verified `credentials` as its second argument, and
	 * maps them to the `actor` (M4); the `credentials` it returns are ignored, since only the
	 * server sets them. Without an `actor` from it, the actor is `{ kind: 'agent', id: <clientId>,
	 * onBehalfOf: <subject> }`. The `Authorization` header is gone from `req` by then.
	 *
	 * @example
	 * ```typescript
	 * createContext: (req) => ({ clientId: req.socket.remoteAddress ?? 'unknown' }),
	 * middleware: [createRateLimitMiddleware({ maxRequests: 60, windowMs: 60_000,
	 *   keyFn: (ctx) => String(ctx.clientId) })],
	 * ```
	 */
	createContext?: CreateRequestContext;

	/**
	 * MCP authorization (`spec/authorization.md`, M1 to M5 and M7): the server becomes an OAuth
	 * 2.1 protected resource. Every HTTP route (`/mcp`, `/sse`, `/message`, `/rpc`, `/batch`,
	 * `/stream`, `/health` and any other path) then needs exactly one valid bearer token in the
	 * `Authorization` header, verified by `auth.verifier` (`JwtVerifier`, with the audience
	 * always checked); a request without one is answered 401 with M5's challenge and body. Only
	 * the RFC 9728 metadata, served at its two well-known paths, and CORS preflights are public.
	 * stdio, `server.execute` and in-process registries are unaffected.
	 *
	 * Each call's context carries the verified `credentials` (never the token), frozen, and
	 * recognised by `isVerifiedCredentials` until the request ends or they expire. **A host that
	 * also runs afd-auth's middleware passes `isVerifiedCredentials` to it**
	 * (`createAuthMiddleware(adapter, { isVerifiedCredentials })`, from
	 * `@lushly-dev/afd-server/credentials`), so a token's call keeps the actor its credentials
	 * map to instead of being gated on the adapter's session.
	 *
	 * Scopes (M6: `requiredScopes`, `resolver`, `filterToolsByScope`) are not enforced by this
	 * version; passing one throws rather than being ignored.
	 */
	auth?: McpAuthOptions;

	/** Maximum concurrent `/sse` connections; more receive HTTP 503 (default: 100). */
	maxSseConnections?: number;

	/**
	 * Maximum live HTTP sessions when `contexts` are configured (default: 1000). Beyond it, an
	 * `initialize` evicts the least recently used session of its own owner (with `auth`, the
	 * verified issuer, subject and client), never another's; an owner with no session to give up
	 * is refused with HTTP 503, `Retry-After` and JSON-RPC `-32000` whose `data.code` is
	 * `SESSION_LIMIT_REACHED`. Without `auth` every caller is one owner.
	 */
	maxSessions?: number;

	/**
	 * With `auth`: maximum live HTTP sessions of one subject, keyed by the verified issuer and
	 * subject so its client IDs share one quota (default: 100, or `maxSessions` when smaller;
	 * never more than `maxSessions`). At it, that subject's least recently used session is
	 * evicted, so one subject cannot fill the store; up to `maxSessions / maxSessionsPerOwner`
	 * distinct subjects still can, and a new subject is then refused until sessions expire.
	 * Sessions exist only with `contexts`: without them the value is still checked but has no
	 * effect. Without `auth` every caller is one owner whose quota is `maxSessions`, and passing
	 * this option throws.
	 */
	maxSessionsPerOwner?: number;

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
	 * HMAC key (a string or bytes, at least 32 bytes, as approval secrets) that signs the
	 * `requestState` of confirmation and approval elicitations, bound to the call's principal (see
	 * `createContext`). Every instance that may receive a retry needs the same key. Without it,
	 * each process uses its own random key, which works only when one process serves every
	 * request (see `instances`). Keep it out of source.
	 *
	 * @throws TypeError at creation when it is shorter than 32 bytes
	 */
	confirmationKey?: string | Uint8Array;

	/**
	 * How many processes serve this server's URL. Two things are per process unless the host shares
	 * them: the `confirmationKey` (a random key otherwise), used when `confirmations` is not
	 * `'off'` or an approval middleware has `relay: 'mcp-elicitation'`; and the spent single-use
	 * tokens of each `createApprovalMiddleware` without a `nonceStore`.
	 *
	 * - `'multiple'`: several processes (or engines) answer the same callers, for example behind a
	 *   load balancer. Creating the server throws unless each of those defaults that is in use is
	 *   supplied: a shared `confirmationKey` and, for single-use approval middleware, a shared
	 *   `nonceStore`.
	 * - `'single'`: one process serves every request, so the defaults are enough. A supplied
	 *   `confirmationKey` is still validated.
	 * - Left out: as `'single'`, but a server served over HTTP (`start()` with the HTTP transport,
	 *   or `createMcpHandler`) logs one warning to stderr when it relies on either default, once per
	 *   process. stdio logs nothing.
	 *
	 * The default key is random per server or handler, so two handlers in one process do not share
	 * it either. Approval middleware is seen in `middleware` directly or inside `composeMiddleware`,
	 * from any installed copy of this package from this version on (older copies do not mark
	 * theirs); one wrapped inside another middleware is not.
	 * `taskStore` is shared separately.
	 */
	instances?: 'single' | 'multiple';

	/**
	 * Host-verified confirmation relay (`spec/command-metadata.md`, "Host-verified confirmation"):
	 * required to confirm commands with `confirmationMode: 'host-verified'` over MCP 2026-07-28,
	 * regardless of `confirmations` (`'off'` included). Without one, MCP and HTTP calls to a
	 * host-verified command fail with `CONFIRMATION_REQUIRED`.
	 */
	humanRelay?: HumanRelay;

	/**
	 * Which callers are approvers (`spec/command-metadata.md`, "Approval evidence from an approver
	 * client"): MCP clients trusted to show a person a held action and carry the person's decision
	 * back, such as an application shell that mounts this server. Called once per `tools/call`
	 * with the call's context after `createContext` (its `credentials` and `actor`); only `true`
	 * makes an approver. Read only what you verified: the credentials, or an actor you mapped from
	 * them. A throw fails the call as an internal error. None by default.
	 *
	 * For an approver, an `APPROVAL_REQUIRED` result carries `details.approvalToken` (whatever
	 * `includeToken` says) and is never turned into a form elicitation, and a retry of one command
	 * on an MCP 2026-07-28 request carries the token in `_meta["dev.afd/approval"]`
	 * (`AFD_APPROVAL_META_KEY`). Its tokens bind its principal binding (`spec/authorization.md`,
	 * M8), so only the same principal can redeem them. Without credentials that is the actor
	 * alone, so over HTTP name only callers with verified credentials. From any other caller the
	 * key is ignored. The key in tool arguments is refused from every caller.
	 *
	 * An approver promises what the server cannot check: it never gives the token to an agent or a
	 * model, and presents it only on a retry a person approved after seeing the action, shown by
	 * the display rules (`approvalDisplay` in `@lushly-dev/afd-core`).
	 */
	approver?: ApproverPredicate;

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

	/**
	 * MCP resources (`spec/mcp-resources.md`, R1 to R6): a {@link ResourceProvider}, or an array of
	 * static entries. The server then declares the `resources` capability and answers
	 * `resources/list`, `resources/read` and `resources/templates/list` on `/mcp` and stdio, in
	 * both MCP eras. A list never varies by connection, session or context; under `auth`, providers
	 * receive the request's verified {@link ResourceCaller} credentials and modern-era provider
	 * responses carry `cacheScope: "private"`. Entries are checked when the server is built, and
	 * creation throws naming the entry that breaks a rule. A `ui://` entry needs the
	 * `text/html;profile=mcp-app` MIME type; its `_meta.ui` goes on the content a read returns.
	 * The deprecated `/sse` and `/message` lane serves none of this.
	 */
	resources?: ResourcesOption;

	/**
	 * Agent Skills served over MCP (`spec/mcp-resources.md`, S1 to S8): a {@link SkillCatalog}, fixed
	 * when it is built. The server declares the `io.modelcontextprotocol/skills` extension and
	 * `resources`, answers `skills/list` and `skills/get`, and serves every skill file as a
	 * resource (`skill://<path>/<file>`) with its `dev.afd/digest`. `new SkillCatalog(skills, {
	 * directoryRead: true })` also serves `resources/directory/read`.
	 */
	skills?: SkillCatalog;

	/**
	 * Durable store for MCP Tasks (`spec/command-metadata.md`, "Tasks"). Defaults to an in-process
	 * {@link InMemoryTaskStore}. Pass a shared store when multiple server processes sit behind one
	 * URL.
	 */
	taskStore?: TaskStore;

	/**
	 * MCP Tasks runtime options (`spec/command-metadata.md`, "Tasks"): `ttlMs`, `pollIntervalMs`,
	 * `checkIntervalMs`, `maxResultBytes`, `maxRunning`, `tokenExpiryGraceMs` and
	 * `callersIdentifiedByHook`.
	 */
	taskOptions?: TaskOptions;

	/**
	 * Server-level default per-command deadline in milliseconds (`spec/execution-controls.md`).
	 * Applied when a call does not specify its own `context.timeout`. Pass `0` or `null` to
	 * disable the default deadline for trusted long-running deployments.
	 *
	 * @default 30000
	 */
	defaultTimeoutMs?: number | null;

	/**
	 * Maximum number of commands accepted in a single batch (`spec/execution-controls.md`).
	 *
	 * @default 500
	 */
	maxBatchSize?: number;

	/**
	 * Maximum `options.parallelism` accepted in a single batch (`spec/execution-controls.md`).
	 *
	 * @default 16
	 */
	maxBatchParallelism?: number;

	/**
	 * Maximum number of validation issues reported per `VALIDATION_ERROR`
	 * (`spec/execution-controls.md`).
	 *
	 * @default 100
	 */
	maxValidationIssues?: number;
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
 * authenticated user or the remote address. On a server with `auth`, `verified.credentials` are
 * the request's verified credentials, to map to an `actor`.
 *
 * The returned object is merged into the context of every command the request executes
 * (`tools/call`, `afd-call`, batch items, pipeline steps, `/rpc`, `/batch` and `/stream`).
 * The reserved keys `traceId`, `signal` and `interface` are set by the server and ignored if
 * returned. A throw is reported to `onError` and answered as an internal error.
 */
export type CreateRequestContext = (
	req: IncomingMessage,
	verified: { credentials?: Credentials }
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/**
 * Embeddable Node HTTP handler returned by `createMcpHandler()`.
 */
export type McpHandler = {
	/**
	 * Serve one request. `body` is its body when a host's own layer has already read it (to run
	 * {@link McpHandler.preDispatchCheck}); the handler then reads it instead of the stream.
	 */
	(req: IncomingMessage, res: ServerResponse, body?: Uint8Array | string): Promise<void>;
	/** Close active SSE/stream responses when the embedding host shuts down. */
	dispose(): void;
	/**
	 * **Trust-bearing.** Admit `credentials` that a host's own layer vouches for, for `req` alone,
	 * instead of a bearer token (`spec/authorization.md`, M6, "A host's own layer"): only for a
	 * gateway that has itself authenticated the caller, never from anything the caller sent. They
	 * are checked as a verifier's are (shape, a numeric `expiresAt` not yet passed, the
	 * certificate binding where required), frozen, and branded for `isVerifiedCredentials` while
	 * the handler serves `req`. A request without them still needs a valid bearer token.
	 *
	 * @throws Error without the `auth` option; when `req` carries a bearer token (in the
	 *   `Authorization` header or the query) or was admitted before; or when the credentials fail
	 *   those checks
	 */
	admit(req: IncomingMessage, credentials: Credentials): void;
	/**
	 * The decision before dispatch for a host's own layer (M6): the bearer layer's own
	 * implementation, with a 403 in the host's scheme (`challenge`) and suggestion
	 * (`scopeSource`). Run its `decide(req, body)` after `admit` and after reading the body.
	 *
	 * @throws Error without the `auth` option
	 */
	preDispatchCheck(options?: PreDispatchCheckOptions): PreDispatchCheck;
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
