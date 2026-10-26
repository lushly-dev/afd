/**
 * @fileoverview The MCP 2026-07-28 lane: stateless `POST /mcp` and dual-era stdio.
 *
 * Both entries come from the MCP TypeScript SDK v2 and share one server factory, so the
 * modern (per-request `_meta`) and legacy (`initialize`) eras see the same tools:
 *
 * - `createMcpHandler` serves `/mcp`. Modern requests are served statelessly; 2025-era clients
 *   that send `initialize` are served by the SDK's stateless legacy fallback. The SDK
 *   validates `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`, answers `server/discover`
 *   and adds `resultType`, `serverInfo` and the cache fields. AFD's Host, Origin and body-size
 *   checks run before it, in the HTTP handler.
 * - `serveStdio` serves stdio: the opening message selects the era for the connection.
 *
 * Contexts (`contexts` option) are explicit request input on the modern era:
 * `_meta["dev.afd/context"]` on `tools/list` and `tools/call` selects the active context of
 * that request only. A legacy stdio connection keeps the server's single context stack, and a
 * legacy HTTP request has no context state (as a `/message` request without a session).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CommandContext } from '@lushly-dev/afd-core';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
	CLIENT_CAPABILITIES_META_KEY,
	createMcpHandler,
	createRequestStateCodec,
	inputRequired,
	inputResponse,
	type McpRequestContext,
	ProtocolError,
	ProtocolErrorCode,
	Server,
	type ServerContext,
	type Transport,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
	AFD_CONTEXT_META_KEY,
	type ContextState,
	createContextState,
} from './bootstrap/afd-context.js';
import {
	AFD_CONFIRM_META_KEY,
	bindConfirmationChannel,
	CONFIRM_INPUT_KEY,
	CONFIRM_REQUESTED_SCHEMA,
	type ConfirmationChannel,
	InputRequiredSignal,
} from './confirmations.js';
import { bindContextState } from './context-scope.js';
import { requestContextValues } from './request-context.js';
import type { ContextConfig, CreateRequestContext } from './server-types.js';
import type { ToolCallResult } from './tool-router.js';

/** The MCP protocol revision this lane serves statelessly. */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/** Default freshness hint for `tools/list` and `server/discover` results (5 minutes). */
export const DEFAULT_TOOLS_LIST_TTL_MS = 300_000;

export interface ModernMcpDeps {
	name: string;
	version: string;
	/** Natural-language guidance returned by `server/discover`. */
	instructions: string;
	getToolsList: (context: CommandContext) => unknown[];
	routeToolCall: (
		toolName: string,
		args: Record<string, unknown>,
		context: CommandContext
	) => Promise<ToolCallResult>;
	/** Configured contexts; enables `_meta["dev.afd/context"]`. */
	contexts?: ContextConfig[];
	/** Freshness hint for `tools/list` and `server/discover` (default: 5 minutes, 0 with contexts). */
	toolsListTtlMs?: number;
	/** HMAC key for confirmation `requestState` (default: a random key per process). */
	confirmationKey?: string | Uint8Array;
	devMode: boolean;
	/** Receives unexpected errors from tool handlers and `createContext`. */
	onError?: (error: Error) => void;
}

interface FactoryOptions {
	/** The context state of a legacy-era stdio connection (one client, one stack). */
	legacyContextState?: ContextState;
	/** Per-request values for HTTP; not called on stdio. */
	requestValues?: () => Promise<Record<string, unknown>>;
}

/** Report to `onError`. A failing `onError` has nowhere left to report, so it is ignored. */
function reporter(onError: ModernMcpDeps['onError']) {
	return (error: unknown): void => {
		try {
			const returned: unknown = onError?.(
				error instanceof Error ? error : new Error(String(error))
			);
			if (returned instanceof Promise) returned.catch(() => {});
		} catch {}
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether declared client capabilities allow a form elicitation: `elicitation: {}` means form
 * only; otherwise `form` must be listed.
 */
function allowsFormElicitation(capabilities: unknown): boolean {
	const elicitation = isRecord(capabilities) ? capabilities.elicitation : undefined;
	if (!isRecord(elicitation)) return false;
	return Object.keys(elicitation).length === 0 || 'form' in elicitation;
}

/**
 * The `server/discover` instructions: how an agent should use the tools this server lists.
 */
export function defaultInstructions(options: {
	name: string;
	toolStrategy: 'individual' | 'grouped' | 'lazy';
	contexts?: ContextConfig[];
	bootstrap?: boolean;
}): string {
	const lines = [
		`${options.name} is an AFD server. Every tool returns a CommandResult as JSON text: { success, data, error: { code, message, suggestion } }; follow error.suggestion to recover.`,
	];
	if (options.toolStrategy === 'lazy') {
		lines.push(
			'Call afd-discover to find commands, afd-detail for a command schema, and afd-call to run one.'
		);
	} else if (options.toolStrategy === 'grouped') {
		lines.push(
			'Each tool groups related commands: pass { action, params }. afd-detail returns a command schema; afd-call runs any command by name.'
		);
	} else {
		lines.push('Each command is its own tool; afd-call also runs any command by name.');
	}
	lines.push('Use afd-batch for several independent commands and afd-pipe to chain them.');
	if (options.bootstrap) lines.push('afd-help, afd-docs and afd-schema describe this server.');
	if (options.contexts?.length) {
		lines.push(
			`Commands are scoped by context (afd-context-list lists them). Send _meta["${AFD_CONTEXT_META_KEY}"] with a context name on tools/list and tools/call to work in that context.`
		);
	}
	return lines.join(' ');
}

/**
 * Create the server factory both entries share. It runs once per HTTP request, and once per
 * stdio connection (plus a discarded `server/discover` probe instance).
 */
function createServerFactory(deps: ModernMcpDeps, options: FactoryOptions) {
	const report = reporter(deps.onError);
	const contextNames = new Set((deps.contexts ?? []).map((context) => context.name));
	// With contexts, tools/list varies by `_meta["dev.afd/context"]`, which SDK clients leave
	// out of their cache key, so the default is "always stale" there.
	const ttlMs = deps.toolsListTtlMs ?? (deps.contexts?.length ? 0 : DEFAULT_TOOLS_LIST_TTL_MS);
	if (!Number.isSafeInteger(ttlMs) || ttlMs < 0) {
		throw new Error('toolsListTtlMs must be a non-negative integer');
	}

	/**
	 * The context state of one request: `undefined` without contexts; the connection's stack
	 * on legacy stdio; `null` on legacy HTTP (no session); otherwise a per-request state with
	 * the `_meta` context active.
	 */
	function contextStateFor(era: McpRequestContext['era'], meta: unknown) {
		if (!deps.contexts?.length) return undefined;
		if (era === 'legacy') return options.legacyContextState ?? null;
		const state = createContextState({ persistent: false });
		const requested = isRecord(meta) ? meta[AFD_CONTEXT_META_KEY] : undefined;
		if (requested === undefined) return state;
		if (typeof requested !== 'string' || !contextNames.has(requested)) {
			throw new ProtocolError(
				ProtocolErrorCode.InvalidParams,
				`Unknown context in _meta["${AFD_CONTEXT_META_KEY}"]`,
				{ suggestion: `Use one of: ${[...contextNames].join(', ')}` }
			);
		}
		state.enter(requested);
		return state;
	}

	function scoped(context: CommandContext, state: ContextState | null | undefined) {
		return state === undefined ? context : bindContextState(context, state);
	}

	// Confirmation requestState: HMAC-signed, bound to the method and the caller's client id, and
	// verified in the handler so a stale or altered state is "no confirmation", not an error.
	const confirmationCodec = createRequestStateCodec<{ b: string }>({
		key: deps.confirmationKey ?? randomBytes(32),
		bind: (ctx) => `${ctx.mcpReq.method}\0${ctx.http?.authInfo?.clientId ?? ''}`,
	});

	/**
	 * What one `tools/call` can carry for confirmations. A modern request elicits when it declares
	 * form elicitation; a legacy stdio connection when its client declared it at `initialize` (the
	 * SDK shim then sends a real elicitation); a legacy HTTP request never (no back channel).
	 */
	function confirmationChannelFor(
		era: McpRequestContext['era'],
		server: Server,
		ctx: ServerContext
	): ConfirmationChannel {
		const canElicit =
			era === 'legacy'
				? !options.requestValues && allowsFormElicitation(server.getClientCapabilities())
				: allowsFormElicitation(
						(ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[
							CLIENT_CAPABILITIES_META_KEY
						]
					);
		const meta = ctx.mcpReq._meta as Record<string, unknown> | undefined;
		return {
			canElicit,
			acknowledged: meta?.[AFD_CONFIRM_META_KEY] === true,
			async response(binding) {
				const view = inputResponse(ctx.mcpReq.inputResponses, CONFIRM_INPUT_KEY);
				if (view.kind !== 'elicit') return 'missing';
				const state = ctx.mcpReq.requestState();
				if (typeof state !== 'string') return 'missing';
				try {
					const payload = await confirmationCodec.verify(state, ctx);
					if (payload?.b !== binding) return 'missing';
				} catch {
					return 'missing';
				}
				return view.action === 'accept' && view.content?.confirm === true ? 'accept' : 'decline';
			},
			async request(message, binding) {
				return inputRequired({
					inputRequests: {
						[CONFIRM_INPUT_KEY]: inputRequired.elicit({
							message,
							requestedSchema: CONFIRM_REQUESTED_SCHEMA as never,
						}),
					},
					requestState: await confirmationCodec.mint({ b: binding }, ctx),
				});
			},
		};
	}

	function internalError(error: unknown): ProtocolError {
		report(error);
		return new ProtocolError(
			ProtocolErrorCode.InternalError,
			deps.devMode && error instanceof Error ? error.message : 'Internal error'
		);
	}

	return ({ era }: McpRequestContext) => {
		const server = new Server(
			{ name: deps.name, version: deps.version },
			{
				capabilities: { tools: { listChanged: false } },
				instructions: deps.instructions,
				cacheHints: {
					'tools/list': { ttlMs, cacheScope: 'public' },
					'server/discover': { ttlMs, cacheScope: 'public' },
				},
			}
		);

		// The SDK lifts `_meta` (minus the reserved envelope keys) into `ctx.mcpReq._meta`.
		server.setRequestHandler('tools/list', async (_request, ctx) => {
			const state = contextStateFor(era, ctx.mcpReq._meta);
			return { tools: deps.getToolsList(scoped({}, state)) as never };
		});

		server.setRequestHandler('tools/call', async (request, ctx) => {
			const { name, arguments: args } = request.params;
			const state = contextStateFor(era, ctx.mcpReq._meta);
			let values: Record<string, unknown>;
			try {
				values = options.requestValues ? await options.requestValues() : {};
			} catch (error) {
				throw internalError(error);
			}
			const context = bindConfirmationChannel(
				scoped({ ...values, signal: ctx.mcpReq.signal, interface: 'mcp' }, state),
				confirmationChannelFor(era, server, ctx)
			);
			try {
				return { ...(await deps.routeToolCall(name, args ?? {}, context)) } as never;
			} catch (error) {
				if (error instanceof InputRequiredSignal) return error.result as never;
				throw internalError(error);
			}
		});

		return server;
	};
}

export interface ModernHttpLane {
	/** Serve one request to the `/mcp` path; Host/Origin validation has already run. */
	handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
	/** Abort in-flight modern exchanges. */
	close(): Promise<void>;
}

/** Create the `/mcp` endpoint handler. */
export function createModernHttpLane(
	deps: ModernMcpDeps & { createContext?: CreateRequestContext; maxBodyBytes: number }
): ModernHttpLane {
	const currentRequest = new AsyncLocalStorage<IncomingMessage>();
	const factory = createServerFactory(deps, {
		requestValues: () => {
			const req = currentRequest.getStore();
			return req ? requestContextValues(deps.createContext, req) : Promise.resolve({});
		},
	});
	// The SDK reports rejected requests (bad headers, unsupported versions) through `onerror`;
	// those are client mistakes answered on the wire, so they are not forwarded to `onError`.
	const handler = createMcpHandler(factory, { maxRequestBodySize: deps.maxBodyBytes });
	const node = toNodeHandler(handler, {
		maxRequestBodySize: deps.maxBodyBytes,
		onerror: reporter(deps.onError),
	});
	return {
		handle: (req, res) => currentRequest.run(req, () => node(req, res)),
		close: () => handler.close(),
	};
}

/**
 * Serve MCP over stdio in both eras: the process's standard streams, or `transport` (tests,
 * Unix sockets).
 */
export function serveModernStdio(
	deps: ModernMcpDeps,
	legacyContextState: ContextState | undefined,
	transport?: Transport
): { close(): Promise<void> } {
	return serveStdio(createServerFactory(deps, { legacyContextState }), {
		...(transport && { transport }),
		onerror: reporter(deps.onError),
	});
}
