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
	APPROVAL_INPUT_KEY,
	APPROVAL_REQUESTED_SCHEMA,
	type ApprovalHold,
	type ApprovalRelay,
	bindApprovalRelay,
} from './approval-relay.js';
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
import {
	ANSWER_TTL_SECONDS,
	type Asked,
	isRoundState,
	type RoundAnswers,
	type RoundState,
} from './elicitation-state.js';
import { requestContextValues } from './request-context.js';
import type { ContextConfig, CreateRequestContext, ToolStrategy } from './server-types.js';
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
	/**
	 * Freshness hint for `tools/list` and `server/discover` (default: 5 minutes; 0 with contexts,
	 * except for the hybrid strategy, whose list does not vary by context).
	 */
	toolsListTtlMs?: number;
	/** The tool strategy; `hybrid` keeps the default hint under contexts. */
	toolStrategy?: ToolStrategy;
	/**
	 * HMAC key for the `requestState` of confirmation and approval elicitations (default: a random
	 * key per process).
	 */
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
	toolStrategy: ToolStrategy;
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
	} else if (options.toolStrategy === 'hybrid') {
		lines.push(
			'The command tools listed are the common ones. Call afd-discover to find others, afd-detail for a schema, and afd-call to run one.'
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
	// out of their cache key, so the default is "always stale" there. The hybrid list does not
	// vary by context (spec/tool-strategies.md, H6).
	const listVariesByContext = Boolean(deps.contexts?.length) && deps.toolStrategy !== 'hybrid';
	const ttlMs = deps.toolsListTtlMs ?? (listVariesByContext ? 0 : DEFAULT_TOOLS_LIST_TTL_MS);
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

	// The requestState of confirmation and approval elicitations: HMAC-signed, bound to the method
	// and the caller's client id, and verified in the handler so a stale or altered state is "no
	// answer", not an error.
	const stateCodec = createRequestStateCodec<RoundState>({
		key: deps.confirmationKey ?? randomBytes(32),
		ttlSeconds: ANSWER_TTL_SECONDS,
		bind: (ctx) => `${ctx.mcpReq.method}\0${ctx.http?.authInfo?.clientId ?? ''}`,
	});

	/**
	 * The elicitations of one `tools/call`: the answers its retry carries, and the
	 * `input_required` result for the next question. One `requestState` carries the questions
	 * accepted in earlier rounds, so a call that needs a confirmation and then an approval keeps
	 * the first answer while the second is asked.
	 */
	function elicitationRound(ctx: ServerContext) {
		let answers: Promise<RoundAnswers> | undefined;
		const read = (): Promise<RoundAnswers> => {
			answers ??= (async () => {
				const none: RoundAnswers = { accepted: [], declined: [] };
				const state = ctx.mcpReq.requestState();
				if (typeof state !== 'string') return none;
				let payload: unknown;
				try {
					payload = await stateCodec.verify(state, ctx);
				} catch {
					return none;
				}
				if (!isRoundState(payload)) return none;
				// An answer carried from an earlier round lapses with its own question, so
				// re-minting the state never extends it.
				const now = Date.now();
				const accepted = payload.a.filter((item) => item.t > now);
				const declined: Asked[] = [];
				for (const asked of payload.p.filter((item) => item.t > now)) {
					const view = inputResponse(ctx.mcpReq.inputResponses, asked.k);
					if (view.kind !== 'elicit') continue;
					const field = asked.k === APPROVAL_INPUT_KEY ? 'approve' : 'confirm';
					const yes = view.action === 'accept' && view.content?.[field] === true;
					(yes ? accepted : declined).push(asked);
				}
				return { accepted, declined };
			})();
			return answers;
		};
		const ask = async (
			question: Omit<Asked, 't'>,
			message: string,
			requestedSchema: unknown,
			replaces: readonly string[] = [question.b]
		) => {
			const { accepted } = await read();
			// Earlier answers to the same question (an expired or spent approval, under any key)
			// are dropped, so the new answer is the only one.
			const kept = accepted.filter((item) => item.k !== question.k || !replaces.includes(item.b));
			const asked: Asked = { ...question, t: Date.now() + ANSWER_TTL_SECONDS * 1000 };
			return inputRequired({
				inputRequests: {
					[asked.k]: inputRequired.elicit({ message, requestedSchema: requestedSchema as never }),
				},
				requestState: await stateCodec.mint({ p: [asked], a: kept }, ctx),
			});
		};
		return { read, ask };
	}

	/**
	 * Whether one `tools/call` can carry a form elicitation. A modern request can when it declares
	 * form elicitation; a legacy stdio connection when its client declared it at `initialize` (the
	 * SDK shim then sends a real elicitation); a legacy HTTP request never (no back channel).
	 */
	function canElicitFor(era: McpRequestContext['era'], server: Server, ctx: ServerContext) {
		return era === 'legacy'
			? !options.requestValues && allowsFormElicitation(server.getClientCapabilities())
			: allowsFormElicitation(
					(ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[
						CLIENT_CAPABILITIES_META_KEY
					]
				);
	}

	/** What one `tools/call` can carry for confirmations. */
	function confirmationChannelFor(
		canElicit: boolean,
		round: ReturnType<typeof elicitationRound>,
		ctx: ServerContext
	): ConfirmationChannel {
		const meta = ctx.mcpReq._meta as Record<string, unknown> | undefined;
		const asks = (binding: string) => (item: Asked) =>
			item.k === CONFIRM_INPUT_KEY && item.b === binding;
		return {
			canElicit,
			acknowledged: meta?.[AFD_CONFIRM_META_KEY] === true,
			async response(binding) {
				const { accepted, declined } = await round.read();
				if (declined.some(asks(binding))) return 'decline';
				return accepted.some(asks(binding)) ? 'accept' : 'missing';
			},
			request: (message, binding) =>
				round.ask({ k: CONFIRM_INPUT_KEY, b: binding }, message, CONFIRM_REQUESTED_SCHEMA),
		};
	}

	/** The approval relay of one `tools/call` that can elicit, and the hold recorded on it. */
	function approvalRelayFor(round: ReturnType<typeof elicitationRound>) {
		let routed: string | undefined;
		let claimed = false;
		let held: ApprovalHold | undefined;
		const relay: ApprovalRelay = {
			route(command) {
				routed ??= command;
			},
			claim(command) {
				if (claimed || command !== routed) return false;
				claimed = true;
				return true;
			},
			async answer(bindings) {
				const { accepted, declined } = await round.read();
				const asks = (item: Asked) => item.k === APPROVAL_INPUT_KEY && bindings.includes(item.b);
				if (declined.some(asks)) return { kind: 'decline' };
				// The latest answer wins: this round's are read after those carried forward.
				const match = accepted.filter(asks).at(-1);
				return match?.n !== undefined && match.x !== undefined && match.m !== undefined
					? { kind: 'accept', binding: match.b, nonce: match.n, expiresAt: match.x, mac: match.m }
					: { kind: 'missing' };
			},
			hold(hold) {
				held ??= hold;
			},
		};
		return { relay, held: () => held };
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
			const canElicit = canElicitFor(era, server, ctx);
			const round = elicitationRound(ctx);
			const relay = canElicit ? approvalRelayFor(round) : undefined;
			let context = bindConfirmationChannel(
				scoped({ ...values, signal: ctx.mcpReq.signal, interface: 'mcp' }, state),
				confirmationChannelFor(canElicit, round, ctx)
			);
			if (relay) context = bindApprovalRelay(context, relay.relay);
			try {
				const result = await deps.routeToolCall(name, args ?? {}, context);
				// The approval middleware held the call for the human: ask, instead of returning
				// the held result.
				const held = relay?.held();
				if (held) {
					return (await round.ask(
						{
							k: APPROVAL_INPUT_KEY,
							b: held.binding,
							n: held.nonce,
							x: held.expiresAt,
							m: held.mac,
						},
						held.message,
						APPROVAL_REQUESTED_SCHEMA,
						held.bindings
					)) as never;
				}
				return { ...result } as never;
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
