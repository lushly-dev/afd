/** @fileoverview HTTP transport handler — MCP protocol, SSE, and REST endpoints. */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
	Actor,
	BatchRequest,
	BatchResult,
	CommandContext,
	CommandError,
	CommandResult,
	StreamChunk,
} from '@lushly-dev/afd-core';
import {
	checkBatchLimits,
	createErrorChunk,
	createFailedBatchResult,
	failedBatchRequest,
	failure,
	isBatchRequest,
	truncateName,
} from '@lushly-dev/afd-core';
import {
	type ApproverPredicate,
	approvalKeyInInput,
	bindApprover,
	decideApprover,
} from './approver.js';
import type { ContextState } from './bootstrap/afd-context.js';
import { createHttpConfirmationCheck } from './confirmation-gate.js';
import type { ConfirmationGate, ConfirmationStep } from './confirmations.js';
import { type ContextField, contextFieldValues } from './context-fields.js';
import { bindContextState } from './context-scope.js';
import {
	assertAllowedOrigins,
	HttpRequestError,
	type HttpSecurityOptions,
	readJsonBody,
	setPrereadBody,
	validateHttpRequest,
} from './http-security.js';
import type { SessionStore } from './http-sessions.js';
import { createSseHub } from './http-sse.js';
import {
	JsonRpcError,
	JsonRpcErrorCode,
	type JsonRpcMessage,
	jsonRpcError,
	jsonRpcResult,
	methodNotFound,
	parseJsonRpcMessage,
} from './json-rpc.js';
import type { AuthLayer } from './mcp-auth.js';
import type { ModernHttpLane } from './mcp-modern.js';
import { liftMetaArgument, metaArgumentKeys } from './meta-argument.js';
import { withMetaOutputBudget } from './output-budget.js';
import { credentialsBinding } from './principal-binding.js';
import { requestContextValues } from './request-context.js';
import { bindScopeView } from './scope-view.js';
import type { CreateRequestContext } from './server-types.js';
import { bindTaskDispatch } from './task-dispatch.js';
import type { TaskRuntime } from './tasks-runtime.js';
import { resultContent, type ToolCallResult } from './tool-router.js';

/** Seconds a refused `initialize` is told to wait (`Retry-After`) when the session store is full. */
const SESSION_RETRY_AFTER_S = 60;

/** Routes whose errors are JSON-RPC error objects rather than AFD failures. */
const JSON_RPC_PATHS = new Set(['/message', '/rpc', '/mcp']);

export interface HttpHandlerDeps extends HttpSecurityOptions {
	name: string;
	version: string;
	port: number;
	/** Detailed error messages. It changes no Origin check and no CORS header. */
	devMode: boolean;
	cors: boolean;
	getToolsList: (context: CommandContext) => unknown[];
	routeToolCall: (
		toolName: string,
		args: unknown,
		context: CommandContext
	) => Promise<ToolCallResult>;
	executeCommand: (
		name: string,
		input: unknown,
		context?: CommandContext
	) => Promise<CommandResult>;
	executeBatch: (request: BatchRequest, context?: CommandContext) => Promise<BatchResult>;
	executeStream: (
		name: string,
		input: unknown,
		context?: CommandContext
	) => AsyncGenerator<StreamChunk, void, unknown>;
	/** True for an exposed command declared with `mutation: true`; GET streaming refuses those. */
	isMutation?: (name: string) => boolean;
	/** Per-session context state. Without it every request is stateless and `Mcp-Session-Id` is ignored. */
	sessions?: SessionStore;
	/** Per-request values merged into the `CommandContext` of every remotely executed command. */
	createContext?: CreateRequestContext;
	/** Declared context fields, read from each request's `_meta`. */
	contextFields?: readonly ContextField[];
	/** Receives unexpected errors (including a throwing `createContext`). */
	onError?: (error: Error) => void;
	/** Maximum concurrent `/sse` connections (default: 100). */
	maxSseConnections?: number;
	/** Interval between SSE heartbeat comments in milliseconds (default: 25000). */
	sseHeartbeatMs?: number;
	/** The MCP 2026-07-28 endpoint served at `POST /mcp`. */
	modern?: ModernHttpLane;
	/** Confirmation enforcement for `/rpc`, `/batch` and `/stream` (acknowledged by `Afd-Confirm`). */
	confirmations?: ConfirmationGate;
	/** Host-verified confirmation check for `/rpc`, `/batch` and `/stream` (always refused). */
	hostVerifiedCheck?: (steps: readonly ConfirmationStep[]) => CommandError | undefined;
	/**
	 * MCP authorization (`spec/authorization.md`): every route but the metadata needs a verified
	 * token, and every command context carries the request's credentials.
	 */
	auth?: AuthLayer;
	/**
	 * Which callers are approvers (`spec/command-metadata.md`, "Approval evidence from an approver
	 * client"). The 2025-era `/message` lane never carries an approver's token back: an approver's
	 * `_meta["dev.afd/approval"]` there is refused, and its held results carry the token.
	 */
	approver?: ApproverPredicate;
	/** The actor of a call whose context has none (the server's `actor` option). */
	actor?: Actor;
	/** MCP Tasks runtime for refusing `task: 'required'` on the 2025 `/message` lane. */
	tasks?: TaskRuntime;
	/** Maximum commands accepted in a single batch (default: 500). */
	maxBatchSize?: number;
	/** Maximum parallelism accepted in a single batch (default: 16). */
	maxBatchParallelism?: number;
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function afdFailure(code: string, message: string, suggestion: string) {
	return { success: false, error: { code, message, suggestion } };
}

export function createHttpHandler(deps: HttpHandlerDeps) {
	const {
		name,
		version,
		cors,
		devMode,
		getToolsList,
		routeToolCall,
		executeCommand,
		executeBatch,
		executeStream,
		isMutation,
		sessions,
		createContext,
		contextFields,
		onError,
		modern,
		confirmations,
		hostVerifiedCheck,
		auth,
	} = deps;
	const unconfirmed = createHttpConfirmationCheck(confirmations);
	const metaKeys = metaArgumentKeys(contextFields);
	assertAllowedOrigins(deps.allowedOrigins);
	const maxBodyBytes = deps.maxBodyBytes ?? 1024 * 1024;
	if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0)
		throw new Error('maxBodyBytes must be a positive integer');
	const sse = createSseHub({
		maxConnections: deps.maxSseConnections,
		heartbeatMs: deps.sseHeartbeatMs,
	});
	const streams = new Map<ServerResponse, AbortController>();

	/** Report to `onError`. A failing `onError` has nowhere left to report, so it is ignored. */
	function report(error: unknown): void {
		try {
			const returned: unknown = onError?.(
				error instanceof Error ? error : new Error(String(error))
			);
			if (returned instanceof Promise) returned.catch(() => {});
		} catch {}
	}

	/**
	 * The caller's context state: `undefined` when sessions are disabled, `null` for a request
	 * without `Mcp-Session-Id` (stateless), otherwise the state of its session.
	 */
	function sessionState(req: IncomingMessage): ContextState | null | undefined {
		if (!sessions) return undefined;
		const id = req.headers['mcp-session-id'];
		if (id === undefined) return null;
		const state = sessions.get(String(id), sessionOwner(req));
		if (state) return state;
		throw new HttpRequestError(404, 'Unknown or expired MCP session', {
			rpcCode: JsonRpcErrorCode.SESSION_NOT_FOUND,
			suggestion: 'Send a new initialize request without Mcp-Session-Id to start a new session',
		});
	}

	/**
	 * Who owns the sessions `req` creates and may use: with MCP authorization, its verified
	 * credentials' issuer, subject and client, so one caller's session is unknown to another and
	 * no caller's `initialize` displaces another's session. Without it the transport carries no
	 * identity: every caller is one owner, and the unguessable session ID is the only binding.
	 */
	function sessionOwner(req: IncomingMessage): string | undefined {
		return auth ? credentialsBinding(auth.credentialsFor(req)) : undefined;
	}

	/**
	 * Whose quota a session `req` creates counts against: with MCP authorization, the verified
	 * issuer and subject, so one subject with many client IDs shares one `maxSessionsPerOwner`.
	 */
	function sessionQuotaKey(req: IncomingMessage): string | undefined {
		const credentials = auth?.credentialsFor(req);
		return credentials ? JSON.stringify([credentials.issuer, credentials.subject]) : undefined;
	}

	/**
	 * `INSUFFICIENT_SCOPE` when the request's credentials lack a scope these calls need, decided
	 * after routing and before the confirmation gate (M6); none without MCP authorization.
	 */
	function scopeRefusal(
		req: IncomingMessage,
		calls: readonly { command: string; input: unknown }[]
	): CommandError | undefined {
		const view = auth?.viewFor(req);
		const decision = view?.decideCommands(calls);
		return view && decision && decision !== 'proceed'
			? view.insufficientScope(decision.forbidden)
			: undefined;
	}

	/** The steps naming commands that exist for the caller: a confirmation never names another. */
	function existing<T extends { command: string }>(req: IncomingMessage, steps: T[]): T[] {
		const view = auth?.viewFor(req);
		return view ? steps.filter((step) => view.known(step.command)) : steps;
	}

	function scoped(context: CommandContext, state: ContextState | null | undefined): CommandContext {
		return state === undefined ? context : bindContextState(context, state);
	}

	/**
	 * The `CommandContext` for commands run by this request: `createContext` values, an
	 * `AbortSignal` that fires if the client disconnects before the response finishes, and
	 * the caller's session.
	 */
	async function commandContext(
		req: IncomingMessage,
		res: ServerResponse,
		state: ContextState | null | undefined,
		controller = new AbortController(),
		meta?: unknown
	): Promise<CommandContext> {
		res.once('close', () => {
			if (!res.writableFinished) controller.abort(new Error('Client disconnected'));
		});
		const custom = await requestContextValues(createContext, req, auth?.credentialsFor(req));
		// Declared fields from `_meta` first, so a value `createContext` sets wins.
		const declared = contextFieldValues(contextFields, meta);
		return bindScopeView(
			scoped(
				withMetaOutputBudget(
					{ ...declared, ...custom, signal: controller.signal, interface: 'mcp' },
					meta,
					custom
				),
				state
			),
			auth?.viewFor(req)
		);
	}

	/** An input object without its `_meta` member, which carries request values, not input. */
	function splitMeta(input: unknown): { input: unknown; meta: unknown } {
		if (!isRecord(input) || !('_meta' in input)) return { input, meta: undefined };
		const { _meta: meta, ...rest } = input;
		return { input: rest, meta };
	}

	/** Run a JSON-RPC request. Protocol and internal errors become error objects carrying its id. */
	async function answer(message: JsonRpcMessage, run: () => Promise<unknown>): Promise<unknown> {
		try {
			return jsonRpcResult(message.id, await run());
		} catch (error) {
			if (error instanceof JsonRpcError) {
				return jsonRpcError(message.id, error.code, error.message, error.suggestion, error.data);
			}
			report(error);
			return jsonRpcError(
				message.id,
				JsonRpcErrorCode.INTERNAL_ERROR,
				devMode && error instanceof Error ? error.message : 'Internal error',
				'Retry the request or contact the server operator'
			);
		}
	}

	async function dispatch(
		message: JsonRpcMessage,
		req: IncomingMessage,
		res: ServerResponse,
		state: ContextState | null | undefined
	): Promise<unknown> {
		switch (message.method) {
			case 'ping':
			case 'notifications/initialized':
				return {};
			case 'tools/list': {
				const view = auth?.viewFor(req);
				// M6, "Other methods": a listing needs the required scopes.
				const decision = view?.decideRequest();
				if (view && decision && decision !== 'proceed') {
					const error = view.insufficientScope(decision.forbidden);
					throw new JsonRpcError(
						JsonRpcErrorCode.INVALID_REQUEST,
						error.message,
						error.suggestion as string
					);
				}
				return { tools: getToolsList(bindScopeView(scoped({}, state), view)) };
			}
			case 'tools/call': {
				const params = message.params;
				if (!isRecord(params) || typeof params.name !== 'string') {
					throw new JsonRpcError(
						JsonRpcErrorCode.INVALID_PARAMS,
						'tools/call requires params.name',
						'Send params as { "name": "<tool>", "arguments": { ... } }'
					);
				}
				// Approval evidence is never input, from any caller.
				const keyed = approvalKeyInInput(params.arguments);
				if (keyed) return resultContent(failure(keyed), true);
				const lifted = liftMetaArgument(params.name, params.arguments, params._meta, metaKeys);
				if (!lifted.ok) return resultContent(failure(lifted.error), true);
				const args = lifted.args ?? {};
				if (!isRecord(args)) {
					throw new JsonRpcError(
						JsonRpcErrorCode.INVALID_PARAMS,
						'tools/call params.arguments must be an object',
						'Send the tool arguments as a JSON object'
					);
				}
				const context = await commandContext(req, res, state, undefined, lifted.meta);
				// A 2025-era request: an approver gets its token but cannot carry it back here.
				const actor = (context.actor ?? deps.actor) as Actor | undefined;
				const carrier = decideApprover({
					approver: deps.approver,
					context: { ...context, actor },
					actor,
					credentials: context.credentials,
					meta: params._meta,
					tool: params.name,
					modern: false,
				});
				if (carrier.kind === 'refuse') return resultContent(failure(carrier.error), true);
				let routedContext = carrier.approver ? bindApprover(context, carrier.approver) : context;
				if (deps.tasks) {
					routedContext = bindTaskDispatch(
						routedContext,
						deps.tasks.legacyHttpDispatchFor(auth?.credentialsFor(req))
					);
				}
				return routeToolCall(params.name, args, routedContext);
			}
			default:
				throw methodNotFound(message.method);
		}
	}

	async function handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const message = parseJsonRpcMessage(await readJsonBody(req, maxBodyBytes));
		if (message.method === 'initialize' && !message.notification) {
			if (sessions) {
				const id = sessions.create(sessionOwner(req), sessionQuotaKey(req));
				if (id === undefined) {
					// `-32000` with an AFD `data.code`, never `-32002`: that is MCP's deprecated
					// SERVER_NOT_INITIALIZED, which servers must not emit.
					res.setHeader('Retry-After', String(SESSION_RETRY_AFTER_S));
					json(res, 503, {
						jsonrpc: '2.0',
						id: message.id,
						error: {
							code: JsonRpcErrorCode.SERVER_ERROR,
							message: 'Too many live MCP sessions',
							data: {
								code: 'SESSION_LIMIT_REACHED',
								suggestion: `Retry after ${SESSION_RETRY_AFTER_S} seconds (Retry-After), when idle sessions have expired, or reuse a session you hold by sending its Mcp-Session-Id`,
								retryAfter: SESSION_RETRY_AFTER_S,
							},
						},
					});
					return;
				}
				res.setHeader('Mcp-Session-Id', id);
			}
			json(
				res,
				200,
				jsonRpcResult(message.id, {
					protocolVersion: '2024-11-05',
					capabilities: { tools: {} },
					serverInfo: { name, version },
				})
			);
			return;
		}
		const state = sessionState(req);
		// JSON-RPC forbids answering a notification. MCP notifications need no work here, and
		// request methods sent without an id are not executed: nobody could see their result.
		if (message.notification) {
			res.writeHead(202);
			res.end();
			return;
		}
		json(res, 200, await answer(message, () => dispatch(message, req, res, state)));
	}

	async function handleRpc(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const message = parseJsonRpcMessage(await readJsonBody(req, maxBodyBytes));
		const state = sessionState(req);
		const body = await answer(message, async () => {
			const { input, meta } = splitMeta(message.params ?? {});
			const keyed = approvalKeyInInput(input);
			if (keyed) return { success: false, error: keyed };
			const steps = [{ command: message.method, input }];
			const existingSteps = existing(req, steps);
			const refused =
				scopeRefusal(req, steps) ??
				hostVerifiedCheck?.(existingSteps) ??
				(await unconfirmed(req, existingSteps));
			if (refused) return { success: false, error: refused };
			return executeCommand(message.method, input, {
				...(await commandContext(req, res, state, undefined, meta)),
				traceId: `rpc-${randomUUID()}`,
			});
		});
		// A notification still runs (JSON-RPC semantics), but its outcome is not sent back.
		if (message.notification) {
			res.writeHead(202);
			res.end();
			return;
		}
		json(res, 200, body);
	}

	async function handleStream(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
		let commandName: string;
		try {
			commandName = decodeURIComponent(url.pathname.slice('/stream/'.length));
		} catch {
			throw new HttpRequestError(400, 'Invalid stream command name');
		}
		// GET is a safe method: link prefetchers and crawlers must not be able to trigger writes.
		// A command hidden from this caller is not one here (M6), so it falls through to the
		// engine's `COMMAND_NOT_FOUND`, the answer a server without it gives.
		const shown = auth?.viewFor(req)?.known(commandName) ?? true;
		if (req.method === 'GET' && shown && isMutation?.(commandName)) {
			res.setHeader('Allow', 'POST');
			json(
				res,
				405,
				afdFailure(
					'METHOD_NOT_ALLOWED',
					`Command '${truncateName(commandName)}' changes state and cannot be streamed with GET`,
					`POST /stream/${encodeURIComponent(commandName)} with the input as a JSON body`
				)
			);
			return;
		}
		let input: unknown;
		if (req.method === 'POST') input = await readJsonBody(req, maxBodyBytes);
		else {
			const query = url.searchParams.get('input') ?? '{}';
			// The same cap as a POST body: a host that raises Node's header size limit must
			// not let a query carry more input than `maxBodyBytes` allows.
			if (Buffer.byteLength(query, 'utf8') > maxBodyBytes) {
				throw new HttpRequestError(413, 'Stream input is too large', {
					suggestion: `POST the input to the same /stream path as a JSON body of at most ${maxBodyBytes} bytes`,
				});
			}
			try {
				input = JSON.parse(query);
			} catch {
				throw new HttpRequestError(400, 'Stream input must be valid JSON');
			}
		}
		const split = splitMeta(input);
		input = split.input;
		const steps = [{ command: commandName, input }];
		const existingSteps = existing(req, steps);
		const refused =
			approvalKeyInInput(input) ??
			scopeRefusal(req, steps) ??
			hostVerifiedCheck?.(existingSteps) ??
			(await unconfirmed(req, existingSteps));
		if (refused) {
			res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
			res.end(`event: chunk\ndata: ${JSON.stringify(createErrorChunk(refused, 0, false))}\n\n`);
			return;
		}
		const state = sessionState(req);
		const controller = new AbortController();
		const context: CommandContext = {
			...(await commandContext(req, res, state, controller, split.meta)),
			traceId: `stream-${randomUUID()}`,
		};
		streams.set(res, controller);
		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		});
		res.flushHeaders();
		try {
			for await (const chunk of executeStream(commandName, input, context)) {
				if (controller.signal.aborted) break;
				if (!res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`)) {
					await once(res, 'drain', { signal: controller.signal });
				}
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				report(error);
				const chunk = createErrorChunk(
					{
						code: 'STREAM_ERROR',
						message: devMode && error instanceof Error ? error.message : 'Stream execution failed',
						suggestion: 'Retry the command or contact the server operator',
						retryable: true,
					},
					0,
					true
				);
				res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
			}
		} finally {
			controller.abort();
			streams.delete(res);
			res.end();
		}
	}

	async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = validateHttpRequest(req, deps);
		// Only an origin `validateHttpRequest` accepted reaches here, and it is echoed, never `*`.
		if (cors && req.headers.origin) {
			res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
			res.setHeader('Vary', 'Origin');
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
			res.setHeader(
				'Access-Control-Allow-Headers',
				'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Afd-Confirm'
			);
			res.setHeader(
				'Access-Control-Expose-Headers',
				auth ? 'Mcp-Session-Id, WWW-Authenticate' : 'Mcp-Session-Id'
			);
		}
		// A CORS preflight carries no token and reaches nothing.
		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}
		// M1, M2 and M7: the metadata is public; every other route needs a verified token.
		if (auth && !(await auth.admit(req, res, url))) return;
		if (url.pathname === '/mcp' && modern) {
			await modern.handle(req, res);
			return;
		}
		if (url.pathname === '/health' && req.method === 'GET') {
			json(res, 200, { status: 'ok', name, version });
			return;
		}
		if (url.pathname === '/sse' && req.method === 'GET') {
			const scopeDecision = auth?.viewFor(req)?.decideRequest();
			if (auth && scopeDecision && scopeDecision !== 'proceed') {
				res.writeHead(403, {
					'Content-Type': 'application/json',
					'WWW-Authenticate': auth.protectedResource.forbiddenChallenge(scopeDecision.forbidden),
				});
				res.end(JSON.stringify(auth.protectedResource.forbiddenBody(scopeDecision.forbidden)));
				return;
			}
			if (sse.isFull()) {
				res.setHeader('Retry-After', '5');
				json(
					res,
					503,
					afdFailure(
						'SSE_CAPACITY_REACHED',
						'Too many open SSE connections',
						'Close idle SSE connections or retry later'
					)
				);
				return;
			}
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});
			sse.add(res);
			res.write(
				`event: endpoint\ndata: ${JSON.stringify({ url: new URL('/message', url).href })}\n\n`
			);
			return;
		}
		if (url.pathname === '/message' && req.method === 'POST') {
			await handleMessage(req, res);
			return;
		}
		if (url.pathname === '/rpc' && req.method === 'POST') {
			await handleRpc(req, res);
			return;
		}
		if (url.pathname === '/batch' && req.method === 'POST') {
			const request = await readJsonBody(req, maxBodyBytes);
			if (!isBatchRequest(request)) {
				json(res, 400, failedBatchRequest());
				return;
			}
			const limitError = checkBatchLimits(request, {
				maxBatchSize: deps.maxBatchSize,
				maxBatchParallelism: deps.maxBatchParallelism,
			});
			if (limitError) {
				json(res, 400, createFailedBatchResult(limitError, {}));
				return;
			}
			const steps = request.commands.map((item) => ({
				command: item.command,
				input: item.input ?? {},
			}));
			// A batch fails as a whole before its first step (M6), as a confirmation does.
			const existingSteps = existing(req, steps);
			const refused =
				approvalKeyInInput(steps.map((step) => step.input)) ??
				scopeRefusal(req, steps) ??
				hostVerifiedCheck?.(existingSteps) ??
				(await unconfirmed(req, existingSteps));
			if (refused) {
				json(res, 200, createFailedBatchResult(refused, {}));
				return;
			}
			const meta = (request as { _meta?: unknown })._meta;
			const context = await commandContext(req, res, sessionState(req), undefined, meta);
			json(res, 200, await executeBatch(request, { ...context, traceId: `batch-${randomUUID()}` }));
			return;
		}
		if (url.pathname.startsWith('/stream/') && (req.method === 'GET' || req.method === 'POST')) {
			await handleStream(req, res, url);
			return;
		}
		json(res, 404, { error: 'Not found' });
	}

	const handler = async (
		req: IncomingMessage,
		res: ServerResponse,
		body?: Uint8Array | string
	): Promise<void> => {
		// A host's own layer read the body to decide it (M6): the routes read that instead.
		if (body !== undefined) {
			setPrereadBody(req, typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body));
		}
		// Rejected/unconsumed uploads can emit a late socket error after the response.
		const observeRequestError = () => {};
		req.on('error', observeRequestError);
		req.once('close', () => req.off('error', observeRequestError));
		try {
			await route(req, res);
		} catch (error) {
			if (res.destroyed || res.writableEnded) return;
			if (res.headersSent) {
				res.end();
				return;
			}
			const known = error instanceof HttpRequestError ? error : undefined;
			if (!known) report(error);
			const status = known?.status ?? 500;
			const message = known?.message ?? 'An internal error occurred';
			const suggestion =
				known?.suggestion ??
				(status >= 500
					? 'Retry or contact the server operator'
					: 'Correct the request headers or body and retry');
			res.setHeader('Connection', 'close');
			const path = String(req.url).replace(/\?.*$/s, '');
			json(
				res,
				status,
				JSON_RPC_PATHS.has(path)
					? jsonRpcError(
							null,
							known?.rpcCode ?? JsonRpcErrorCode.INTERNAL_ERROR,
							message,
							suggestion
						)
					: afdFailure(`HTTP_${status}`, message, suggestion)
			);
		}
	};
	const dispose = () => {
		sse.closeAll();
		for (const [response, controller] of streams) {
			controller.abort();
			response.end();
		}
		streams.clear();
		sessions?.clear();
		modern?.close().catch(() => {});
	};
	return { handler, sseClients: sse.clients, dispose };
}
