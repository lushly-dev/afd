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
import type { Actor, CommandContext } from '@lushly-dev/afd-core';
import { failure } from '@lushly-dev/afd-core';
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
import { createAdmission, type DecodedCall } from './admission.js';
import {
	APPROVAL_INPUT_KEY,
	APPROVAL_REQUESTED_SCHEMA,
	type ApprovalRelay,
	bindApprovalRelay,
	type StepsHold,
} from './approval-relay.js';
import { createUpFrontApproval } from './approval-up-front.js';
import { type ApproverPredicate, approvalKeyInInput } from './approver.js';
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
import { AFD_CONTEXT_FIELDS_META_KEY, type ContextField } from './context-fields.js';
import { type DescribedContextField, describeContextFields } from './context-fields-describe.js';
import { bindContextState } from './context-scope.js';
import {
	ANSWER_TTL_SECONDS,
	type Asked,
	isRoundState,
	type RoundAnswers,
	type RoundState,
} from './elicitation-state.js';
import { prereadBody } from './http-security.js';
import { bindHumanRelayChannel, RELAY_INPUT_KEY } from './human-relay.js';
import type { AuthLayer } from './mcp-auth.js';
import { type PrincipalCredentials, principalBinding } from './principal-binding.js';
import { requestContextValues } from './request-context.js';
import { type ResourceService, resourceCacheHints } from './resources.js';
import { bindScopeView, type ScopeView } from './scope-view.js';
import type { ContextConfig, CreateRequestContext, ToolStrategy } from './server-types.js';
import { bindTaskDispatch } from './task-dispatch.js';
import { TASKS_EXTENSION_ID } from './tasks.js';
import { CreateTaskSignal, patchToolsCallForTasks, type TaskRuntime } from './tasks-runtime.js';
import {
	asToolRouter,
	resultContent,
	type ToolCallFunction,
	type ToolRouter,
	toolResultOf,
} from './tool-router.js';

/** The MCP protocol revision this lane serves statelessly. */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/**
 * Labels the layout of the `requestState` binding (#532 added the principal), so a state minted
 * under an earlier layout never verifies.
 */
const STATE_BINDING_VERSION = 'afd.requestState.v2';

/** Default freshness hint for `tools/list` and `server/discover` results (5 minutes). */
export const DEFAULT_TOOLS_LIST_TTL_MS = 300_000;

export interface ModernMcpDeps {
	name: string;
	version: string;
	/** Natural-language guidance returned by `server/discover`. */
	instructions: string;
	getToolsList: (context: CommandContext) => readonly unknown[];
	/** Runs the router's stages after admission (`admission.ts`): a tool router, or a plain function. */
	routeToolCall: ToolRouter | ToolCallFunction;
	/** Configured contexts; enables `_meta["dev.afd/context"]`. */
	contexts?: ContextConfig[];
	/** Declared context fields, read from each `tools/call`'s `_meta` and listed by `server/discover`. */
	contextFields?: readonly ContextField[];
	/**
	 * Freshness hint for `tools/list` and `server/discover` (default: 5 minutes; 0 with contexts,
	 * except for the hybrid and lazy strategies, whose lists do not vary by context).
	 */
	toolsListTtlMs?: number;
	/** The tool strategy; `hybrid` keeps the default hint under contexts. */
	toolStrategy?: ToolStrategy;
	/**
	 * HMAC key for the `requestState` of confirmation and approval elicitations (default: a random
	 * key per process).
	 */
	confirmationKey?: string | Uint8Array;
	/**
	 * The actor of a call whose context has none (the server's `actor` option): the principal
	 * binding of its `requestState` names the actor the commands run with.
	 */
	actor?: Actor;
	/**
	 * Which callers are approvers (`spec/command-metadata.md`, "Approval evidence from an approver
	 * client"): the server's `approver` option.
	 */
	approver?: ApproverPredicate;
	/**
	 * Whether the server tells apart the HTTP caller with `credentials`, for the idempotency step
	 * (`spec/idempotency.md`, S3). Default: it cannot.
	 */
	identifiesHttpCaller?: (credentials: unknown) => boolean;
	/**
	 * Resources, skills and the Skills extension (`spec/mcp-resources.md`), when the server was
	 * given a `resources` provider or a `skills` catalog.
	 */
	resources?: ResourceService;
	/** `ttlMs` of resource and skill results: the `tools/list` TTL option, never lowered by contexts. */
	resourcesTtlMs?: number;
	/** MCP Tasks runtime (`spec/command-metadata.md`, "Tasks"). */
	tasks?: TaskRuntime;
	/** Whether MCP authorization is configured on this server (R3/R4 `cacheScope` on HTTP and stdio). */
	authConfigured?: boolean;
	devMode: boolean;
	/** Receives unexpected errors from tool handlers and `createContext`. */
	onError?: (error: Error) => void;
}

interface FactoryOptions {
	/** The context state of a legacy-era stdio connection (one client, one stack). */
	legacyContextState?: ContextState;
	/** Per-request values for HTTP; not called on stdio. */
	requestValues?: () => Promise<Record<string, unknown>>;
	/** The scope view of the HTTP request being served (MCP authorization, M6). */
	requestView?: () => ScopeView | undefined;
	/** Whether requests must carry an admitted HTTP scope view (HTTP with `auth`, M1 fail-closed). */
	requireView?: boolean;
	/** Whether `tools/list` varies by the caller's authorization (`filterToolsByScope`). */
	privateToolsList?: boolean;
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
		`${options.name} is an AFD server. Every tool returns a CommandResult as JSON text: { success, data, error: { code, message, suggestion, recovery } }; follow error.suggestion to recover. When error.recovery is present, it is the same step in a form a program can follow.`,
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
 * Refuse a `tools/call` whose arguments hold `dev.afd/approval` as the transport delivers it,
 * before the SDK validates the request ("Approval evidence from an approver client", rule 5).
 * The SDK's validation rebuilds `arguments` and drops a member named `__proto__`, so a key
 * beneath one would never reach the router's own check: it would vanish instead of being refused.
 */
function refuseApprovalKeyBeforeParsing(
	server: Server,
	modern: boolean,
	report: (error: unknown) => void
): void {
	const connect = server.connect.bind(server);
	server.connect = async (transport: Transport) => {
		await connect(transport);
		const deliver = transport.onmessage;
		transport.onmessage = (message, extra) => {
			const request = message as {
				id?: unknown;
				method?: unknown;
				params?: { arguments?: unknown };
			};
			const refusal =
				request.method === 'tools/call' && request.id !== undefined
					? approvalKeyInInput(request.params?.arguments)
					: undefined;
			if (!refusal) return deliver?.(message, extra as never);
			transport
				.send({
					jsonrpc: '2.0',
					id: request.id as string | number,
					result: {
						...resultContent(failure(refusal), true),
						...(modern && { resultType: 'complete' }),
					} as never,
				})
				.catch(report);
		};
	};
}

/**
 * The freshness hint of `tools/list` and `server/discover`, defaults applied.
 *
 * @throws Error when `toolsListTtlMs` is not a non-negative integer
 */
export function resolveToolsListTtlMs(
	deps: Pick<ModernMcpDeps, 'contexts' | 'toolStrategy' | 'toolsListTtlMs'>
): number {
	// With contexts, tools/list varies by `_meta["dev.afd/context"]`, which SDK clients leave
	// out of their cache key, so the default is "always stale" there. The hybrid and lazy lists
	// do not vary by context (spec/tool-strategies.md, H6 and "lazy").
	const listVariesByContext =
		Boolean(deps.contexts?.length) &&
		deps.toolStrategy !== 'hybrid' &&
		deps.toolStrategy !== 'lazy';
	const ttlMs = deps.toolsListTtlMs ?? (listVariesByContext ? 0 : DEFAULT_TOOLS_LIST_TTL_MS);
	if (!Number.isSafeInteger(ttlMs) || ttlMs < 0) {
		throw new Error('toolsListTtlMs must be a non-negative integer');
	}
	return ttlMs;
}

/**
 * The SDK's own check of the `/mcp` body limit (`createMcpHandler`'s `maxRequestBodySize`, the
 * first the lane's options meet), made without building the lane, so stdio refuses what HTTP
 * would with the same error. `stdio-runtime.test.ts` calls the SDK's check beside it and fails if
 * an SDK upgrade changes it.
 *
 * @throws RangeError when `maxBodyBytes` is not a positive number
 */
export function checkModernBodyLimit(maxBodyBytes: unknown): void {
	if (typeof maxBodyBytes !== 'number' || !Number.isFinite(maxBodyBytes) || maxBodyBytes <= 0) {
		throw new RangeError(
			`maxRequestBodySize must be a positive number of bytes, got ${String(maxBodyBytes)}`
		);
	}
}

/**
 * Create the server factory both entries share. It runs once per HTTP request, and once per
 * stdio connection (plus a discarded `server/discover` probe instance).
 *
 * The SDK needs a new `Server` for each exchange: `createMcpHandler` refuses an instance still
 * serving another request, and binds the request's era, protocol revision and client identity
 * to the instance. So the factory builds one per call, and everything that does not depend on
 * the request is built once per server (#1746): capabilities and cache hints for each era here,
 * and the described context fields at the first call that needs them.
 */
function createServerFactory(deps: ModernMcpDeps, options: FactoryOptions) {
	const report = reporter(deps.onError);
	const contextNames = new Set((deps.contexts ?? []).map((context) => context.name));
	const ttlMs = resolveToolsListTtlMs(deps);

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

	const admission = createAdmission({
		router: asToolRouter(deps.routeToolCall),
		contextFields: deps.contextFields,
		approver: deps.approver,
		actor: deps.actor,
		identifiesHttpCaller: deps.identifiesHttpCaller,
	});
	/**
	 * How this lane tells callers apart (`spec/idempotency.md`, S3): over HTTP, by what the server
	 * knows of each request; over stdio, by this connection, which each factory serves alone.
	 */
	const transport = (
		options.requestValues !== undefined ? { kind: 'http' } : { kind: 'connection', connection: {} }
	) as NonNullable<DecodedCall['transport']>;

	function scoped(context: CommandContext, state: ContextState | null | undefined) {
		return state === undefined ? context : bindContextState(context, state);
	}

	// The key of the requestState of confirmation and approval elicitations, one per process
	// unless the host shares one.
	const stateKey = deps.confirmationKey ?? randomBytes(32);

	/**
	 * The elicitations of one `tools/call`: the answers its retry carries, and the
	 * `input_required` result for the next question. One `requestState` carries the questions
	 * accepted in earlier rounds, so a call that needs a confirmation and then an approval keeps
	 * the first answer while the second is asked.
	 *
	 * The state is HMAC-signed and bound to the method, the SDK's `authInfo.clientId` and the
	 * call's principal binding (`spec/authorization.md`, M8; #532), and verified in the handler,
	 * so a stale or altered state is "no answer", not an error. The binding is never in the state:
	 * the SDK keeps only a truncated HMAC of it, so the state names no one. A state issued to
	 * another principal (another actor, or another issuer, subject or client) fails that check
	 * exactly as an altered one fails its MAC, and the call is asked again. `principal` is read
	 * only when the round reads or mints a state.
	 */
	function elicitationRound(ctx: ServerContext, principal: () => string) {
		const stateCodec = createRequestStateCodec<RoundState>({
			key: stateKey,
			ttlSeconds: ANSWER_TTL_SECONDS,
			// A JSON array, so no value can run into the next. The version label keeps a state
			// minted before the principal was bound from ever verifying.
			bind: (bound) =>
				JSON.stringify([
					STATE_BINDING_VERSION,
					bound.mcpReq.method,
					bound.http?.authInfo?.clientId ?? '',
					principal(),
				]),
		});
		let answers: Promise<RoundAnswers> | undefined;
		const read = (): Promise<RoundAnswers> => {
			answers ??= (async () => {
				const none: RoundAnswers = { accepted: [], declined: [] };
				const state = ctx.mcpReq.requestState();
				if (typeof state !== 'string') return none;
				// Credentials that cannot be bound fail the call here, before any state is
				// verified: a retry is refused with an internal error, as a mint is.
				principal();
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
		/**
		 * Ask `questions` with one form elicitation under their shared input key: one answer
		 * covers them all. Earlier answers to the same questions (`replaces`, their bindings under
		 * every key: an expired or spent approval) are dropped, so the new answer is the only one.
		 */
		const askAll = async (
			questions: ReadonlyArray<Omit<Asked, 't'>>,
			message: string,
			requestedSchema: unknown,
			replaces: readonly string[]
		) => {
			const { accepted } = await read();
			const key = (questions[0] as Omit<Asked, 't'>).k;
			const kept = accepted.filter((item) => item.k !== key || !replaces.includes(item.b));
			const t = Date.now() + ANSWER_TTL_SECONDS * 1000;
			return inputRequired({
				inputRequests: {
					[key]: inputRequired.elicit({ message, requestedSchema: requestedSchema as never }),
				},
				requestState: await stateCodec.mint(
					{ p: questions.map((question) => ({ ...question, t })), a: kept },
					ctx
				),
			});
		};
		const ask = (
			question: Omit<Asked, 't'>,
			message: string,
			requestedSchema: unknown,
			replaces: readonly string[] = [question.b]
		) => askAll([question], message, requestedSchema, replaces);
		return { read, ask, askAll };
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

	/**
	 * The approval relay of one `tools/call` that can elicit, and the hold recorded on it: one
	 * command's, or every gated step's of an `afd-batch` or `afd-pipe` asked up front.
	 */
	function approvalRelayFor(round: ReturnType<typeof elicitationRound>) {
		let routed: string | undefined;
		let claimed = false;
		let held: StepsHold | undefined;
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
			hold({ message, ...question }) {
				held ??= { questions: [question], message };
			},
			async answers() {
				const { accepted, declined } = await round.read();
				const approval = (item: Asked) => item.k === APPROVAL_INPUT_KEY;
				return {
					accepted: accepted.filter(approval).flatMap((item) =>
						item.n !== undefined && item.x !== undefined && item.m !== undefined
							? [
									{
										binding: item.b,
										nonce: item.n,
										expiresAt: item.x,
										mac: item.m,
										...(item.s !== undefined &&
											item.i !== undefined &&
											item.c !== undefined && {
												step: { index: item.s, input: item.i, call: item.c },
											}),
									},
								]
							: []
					),
					declined: declined.filter(approval).map((item) => item.b),
				};
			},
			holdSteps(hold) {
				if (hold.questions.length > 0) held ??= hold;
			},
			upFront: (tool, request, commands) => createUpFrontApproval(relay, tool, request, commands),
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

	const isHttp = options.requestValues !== undefined;
	const authConfigured = deps.authConfigured === true || options.requireView === true;
	const resourceCaps = deps.resources?.capabilities as
		| (Record<string, unknown> & { extensions?: Record<string, Record<string, unknown>> })
		| undefined;
	/** The capabilities of an exchange in `era`: only a modern one may declare MCP Tasks. */
	const capabilitiesFor = (era: McpRequestContext['era']) => {
		const declaresTasks = era === 'modern' && deps.tasks?.declaresTasksTo(isHttp) === true;
		const extensions = {
			...(resourceCaps?.extensions ?? {}),
			...(declaresTasks ? { [TASKS_EXTENSION_ID]: {} } : {}),
		};
		return {
			tools: { listChanged: false },
			...resourceCaps,
			...(Object.keys(extensions).length > 0 && { extensions }),
		};
	};
	// The SDK copies these before changing them, so every instance can be given the same objects.
	const capabilities = {
		modern: capabilitiesFor('modern'),
		legacy: capabilitiesFor('legacy'),
	};
	const cacheHints = {
		// A list filtered by authorization varies by caller (M6, "Listing").
		'tools/list': { ttlMs, cacheScope: options.privateToolsList ? 'private' : 'public' },
		'server/discover': { ttlMs, cacheScope: 'public' },
		...(deps.resources &&
			resourceCacheHints(
				deps.resourcesTtlMs ?? ttlMs,
				Boolean(authConfigured && deps.resources.hasProvider)
			)),
	};
	/**
	 * The declared context fields as `server/discover` lists them. Described at the first exchange,
	 * where they always were: a field JSON Schema cannot represent (`z.coerce.date()`) fails each
	 * `/mcp` exchange and stdio connection, as before, not the server's construction.
	 */
	let described: DescribedContextField[] | undefined;

	return ({ era }: McpRequestContext) => {
		const server = new Server(
			{ name: deps.name, version: deps.version },
			{
				capabilities: capabilities[era] as never,
				instructions: deps.instructions,
				cacheHints: cacheHints as never,
			}
		);
		deps.resources?.install(server, {
			modern: era === 'modern',
			internalError,
			requestView: options.requestView,
			authConfigured,
			requireView: options.requireView,
		});
		if (deps.tasks?.servesTasks) {
			patchToolsCallForTasks(server);
		}
		deps.tasks?.installHandlers(server, {
			era,
			isHttp,
			requestValues: options.requestValues,
			requestView: options.requestView,
			internalError,
		});
		refuseApprovalKeyBeforeParsing(server, era === 'modern', report);

		if (deps.contextFields?.length) {
			described ??= describeContextFields(deps.contextFields);
			const fields = described;
			// The SDK's serving layer installs its own `server/discover` handler, which calls
			// `_ondiscover()` per request; wrapping it adds the declared fields to that answer.
			// `context-fields-mcp.test.ts` fails if an SDK upgrade changes this.
			const sdk = server as unknown as { _ondiscover(): Record<string, unknown> };
			const discover = sdk._ondiscover.bind(server);
			sdk._ondiscover = () => {
				const result = discover();
				const meta = result._meta && typeof result._meta === 'object' ? result._meta : {};
				return { ...result, _meta: { ...meta, [AFD_CONTEXT_FIELDS_META_KEY]: fields } };
			};
		}

		// The SDK lifts `_meta` (minus the reserved envelope keys) into `ctx.mcpReq._meta`.
		server.setRequestHandler('tools/list', async (_request, ctx) => {
			const state = contextStateFor(era, ctx.mcpReq._meta);
			const view = options.requestView?.();
			// M6, "Other methods": a listing needs the required scopes.
			const decision = view?.decideRequest();
			if (view && decision && decision !== 'proceed') {
				const error = view.insufficientScope(decision.forbidden);
				throw new ProtocolError(ProtocolErrorCode.InvalidRequest, error.message, {
					code: error.code,
					suggestion: error.suggestion,
					scopes: decision.forbidden,
				});
			}
			return { tools: deps.getToolsList(bindScopeView(scoped({}, state), view)) as never };
		});

		server.setRequestHandler('tools/call', async (request, ctx) => {
			// Decode the call; admission (`admission.ts`) and the router decide it.
			const canElicit = canElicitFor(era, server, ctx);
			const rawCaps = (ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[
				CLIENT_CAPABILITIES_META_KEY
			];
			const relayView = inputResponse(ctx.mcpReq.inputResponses, RELAY_INPUT_KEY);
			const rawState = ctx.mcpReq.requestState();
			const view = options.requestView?.();
			let relay: ReturnType<typeof approvalRelayFor> | undefined;
			let round: ReturnType<typeof elicitationRound> | undefined;
			try {
				const outcome = await admission.run({
					lane: era === 'modern' ? 'mcp' : 'mcp-legacy',
					tool: request.params.name,
					args: request.params.arguments,
					meta: ctx.mcpReq._meta,
					state: (meta) => contextStateFor(era, meta),
					values: options.requestValues ?? (() => ({})),
					view,
					signal: ctx.mcpReq.signal,
					transport,
					channels(context, principal) {
						// The principal binding of the elicitations' `requestState`: who is calling, as
						// the call starts. It is checked and bound only when a state is read or minted,
						// so other calls are unaffected.
						let binding: string | undefined;
						const callRound = elicitationRound(ctx, () => {
							binding ??= principalBinding(
								principal.actor,
								principal.credentials as PrincipalCredentials | undefined
							);
							return binding;
						});
						round = callRound;
						// An approver's call carries its token in `_meta`, and is never asked with a form.
						relay = canElicit && !principal.approver ? approvalRelayFor(callRound) : undefined;
						let bound = bindHumanRelayChannel(
							bindConfirmationChannel(context, confirmationChannelFor(canElicit, callRound, ctx)),
							{
								modern: era === 'modern',
								...(isRecord(rawCaps) && { clientCapabilities: rawCaps }),
								...(typeof rawState === 'string' &&
									rawState.length > 0 && { requestState: rawState }),
								...(relayView.kind === 'elicit' && { relayAction: relayView.action }),
							}
						);
						if (relay) bound = bindApprovalRelay(bound, relay.relay);
						if (deps.tasks) {
							bound = bindTaskDispatch(
								bound,
								deps.tasks.dispatchFor(era, isHttp, ctx, view?.credentials)
							);
						}
						return bound;
					},
				});
				// The approval middleware held the call for the human: ask, instead of returning
				// the held result.
				const held = relay?.held();
				if (held && round) {
					return (await round.askAll(
						held.questions.map((question) => ({
							k: APPROVAL_INPUT_KEY,
							b: question.binding,
							n: question.nonce,
							x: question.expiresAt,
							m: question.mac,
							...(question.step && {
								s: question.step.index,
								i: question.step.input,
								c: question.step.call,
							}),
						})),
						held.message,
						APPROVAL_REQUESTED_SCHEMA,
						held.questions.flatMap((question) => question.bindings)
					)) as never;
				}
				return { ...toolResultOf(outcome) } as never;
			} catch (error) {
				if (error instanceof InputRequiredSignal) return error.result as never;
				if (error instanceof CreateTaskSignal || error instanceof ProtocolError) throw error;
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

/**
 * `req`, or, when its body was read before routing (the authorization layer's decision before
 * dispatch, M6), a request that yields those same bytes, so the SDK reads exactly what was sent.
 */
function replayed(req: IncomingMessage) {
	const body = prereadBody(req);
	if (!body) return req;
	return {
		method: req.method,
		url: req.url,
		headers: req.headers,
		async *[Symbol.asyncIterator]() {
			yield body;
		},
	};
}

/** Create the `/mcp` endpoint handler. */
export function createModernHttpLane(
	deps: ModernMcpDeps & {
		createContext?: CreateRequestContext;
		maxBodyBytes: number;
		/** MCP authorization: each call's context carries the credentials its request admitted. */
		auth?: AuthLayer;
	}
): ModernHttpLane {
	const currentRequest = new AsyncLocalStorage<IncomingMessage>();
	const factory = createServerFactory(deps, {
		requestValues: async () => {
			const req = currentRequest.getStore();
			// M1: with authorization, a call that cannot be tied to an admitted request fails.
			if (!req) {
				if (deps.auth) throw new Error('No HTTP request carries this call');
				return {};
			}
			return requestContextValues(deps.createContext, req, deps.auth?.credentialsFor(req));
		},
		requestView: () => {
			const req = currentRequest.getStore();
			return req ? deps.auth?.viewFor(req) : undefined;
		},
		requireView: Boolean(deps.auth),
		privateToolsList: deps.auth?.filterToolsByScope === true,
	});
	// The SDK reports rejected requests (bad headers, unsupported versions) through `onerror`;
	// those are client mistakes answered on the wire, so they are not forwarded to `onError`.
	const handler = createMcpHandler(factory, { maxRequestBodySize: deps.maxBodyBytes });
	const node = toNodeHandler(handler, {
		maxRequestBodySize: deps.maxBodyBytes,
		onerror: reporter(deps.onError),
	});
	return {
		handle: (req, res) => currentRequest.run(req, () => node(replayed(req), res)),
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
