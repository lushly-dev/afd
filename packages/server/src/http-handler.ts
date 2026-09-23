/** @fileoverview HTTP transport handler — MCP protocol, SSE, and REST endpoints. */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
	BatchRequest,
	BatchResult,
	CommandContext,
	CommandResult,
	StreamChunk,
} from '@lushly-dev/afd-core';
import { createErrorChunk, isBatchRequest, truncateName } from '@lushly-dev/afd-core';
import type { ContextState } from './bootstrap/afd-context.js';
import { bindContextState } from './context-scope.js';
import {
	HttpRequestError,
	type HttpSecurityOptions,
	readJsonBody,
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
import type { CreateRequestContext } from './server-types.js';
import type { ToolCallResult } from './tool-router.js';

/** CommandContext keys the server sets itself; `createContext` cannot override them. */
const RESERVED_CONTEXT_KEYS = new Set(['traceId', 'signal', 'interface']);

/** Routes whose errors are JSON-RPC error objects rather than AFD failures. */
const JSON_RPC_PATHS = new Set(['/message', '/rpc']);

export interface HttpHandlerDeps extends HttpSecurityOptions {
	name: string;
	version: string;
	port: number;
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
	/** Receives unexpected errors (including a throwing `createContext`). */
	onError?: (error: Error) => void;
	/** Maximum concurrent `/sse` connections (default: 100). */
	maxSseConnections?: number;
	/** Interval between SSE heartbeat comments in milliseconds (default: 25000). */
	sseHeartbeatMs?: number;
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
		onError,
	} = deps;
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
		const state = sessions.get(String(id));
		if (state) return state;
		throw new HttpRequestError(404, 'Unknown or expired MCP session', {
			rpcCode: JsonRpcErrorCode.SESSION_NOT_FOUND,
			suggestion: 'Send a new initialize request without Mcp-Session-Id to start a new session',
		});
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
		controller = new AbortController()
	): Promise<CommandContext> {
		res.once('close', () => {
			if (!res.writableFinished) controller.abort(new Error('Client disconnected'));
		});
		const extra: unknown = createContext ? await createContext(req) : {};
		if (!isRecord(extra)) throw new Error('createContext must return an object');
		const custom = Object.fromEntries(
			Object.entries(extra).filter(([key]) => !RESERVED_CONTEXT_KEYS.has(key))
		);
		return scoped({ ...custom, signal: controller.signal, interface: 'mcp' }, state);
	}

	/** Run a JSON-RPC request. Protocol and internal errors become error objects carrying its id. */
	async function answer(message: JsonRpcMessage, run: () => Promise<unknown>): Promise<unknown> {
		try {
			return jsonRpcResult(message.id, await run());
		} catch (error) {
			if (error instanceof JsonRpcError) {
				return jsonRpcError(message.id, error.code, error.message, error.suggestion);
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
			case 'tools/list':
				return { tools: getToolsList(scoped({}, state)) };
			case 'tools/call': {
				const params = message.params;
				if (!isRecord(params) || typeof params.name !== 'string') {
					throw new JsonRpcError(
						JsonRpcErrorCode.INVALID_PARAMS,
						'tools/call requires params.name',
						'Send params as { "name": "<tool>", "arguments": { ... } }'
					);
				}
				const args = params.arguments ?? {};
				if (!isRecord(args)) {
					throw new JsonRpcError(
						JsonRpcErrorCode.INVALID_PARAMS,
						'tools/call params.arguments must be an object',
						'Send the tool arguments as a JSON object'
					);
				}
				return routeToolCall(params.name, args, await commandContext(req, res, state));
			}
			default:
				throw methodNotFound(message.method);
		}
	}

	async function handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const message = parseJsonRpcMessage(await readJsonBody(req, maxBodyBytes));
		if (message.method === 'initialize' && !message.notification) {
			if (sessions) res.setHeader('Mcp-Session-Id', sessions.create());
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
		const body = await answer(message, async () =>
			executeCommand(message.method, message.params ?? {}, {
				...(await commandContext(req, res, state)),
				traceId: `rpc-${randomUUID()}`,
			})
		);
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
		if (req.method === 'GET' && isMutation?.(commandName)) {
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
			try {
				input = JSON.parse(url.searchParams.get('input') ?? '{}');
			} catch {
				throw new HttpRequestError(400, 'Stream input must be valid JSON');
			}
		}
		const state = sessionState(req);
		const controller = new AbortController();
		const context: CommandContext = {
			...(await commandContext(req, res, state, controller)),
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
		if (cors && req.headers.origin) {
			res.setHeader('Access-Control-Allow-Origin', devMode ? '*' : req.headers.origin);
			res.setHeader('Vary', 'Origin');
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');
			res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
		}
		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}
		if (url.pathname === '/health' && req.method === 'GET') {
			json(res, 200, { status: 'ok', name, version });
			return;
		}
		if (url.pathname === '/sse' && req.method === 'GET') {
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
			if (!isBatchRequest(request))
				throw new HttpRequestError(400, 'Provide { commands: [...] } with command objects');
			const context = await commandContext(req, res, sessionState(req));
			json(res, 200, await executeBatch(request, { ...context, traceId: `batch-${randomUUID()}` }));
			return;
		}
		if (url.pathname.startsWith('/stream/') && (req.method === 'GET' || req.method === 'POST')) {
			await handleStream(req, res, url);
			return;
		}
		json(res, 404, { error: 'Not found' });
	}

	const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
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
	};
	return { handler, sseClients: sse.clients, dispose };
}
