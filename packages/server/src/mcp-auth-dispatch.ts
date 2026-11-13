/**
 * @fileoverview The decision before dispatch (`spec/authorization.md`, M6, "Before dispatch: the
 * 403"), in one implementation that the bearer layer and a host's own HTTP layer both run
 * (`handler.preDispatchCheck`), so a request gets exactly the same answer from either.
 */

import { jsonRpcError } from './json-rpc.js';
import type { ProtectedResource } from './mcp-auth-resource.js';
import type { ScopeChallenge } from './mcp-auth-scopes.js';
import type { ScopeView } from './scope-view.js';

/** What the decision before dispatch answers: pass the request on, or this response. */
export type PreDispatch =
	| { proceed: true }
	| {
			proceed: false;
			status: number;
			headers: Readonly<Record<string, string>>;
			/** The response body, JSON. */
			body: string;
	  };

/** The routes whose answer is the body of the request's own HTTP response, decided here. */
const JSON_RPC_ROUTES = new Set(['/mcp', '/message', '/rpc']);

/** Whether `path` is one of the routes the decision reads a body for. */
export function decidesBody(path: string): boolean {
	return JSON_RPC_ROUTES.has(path) || path === '/batch' || path.startsWith('/stream/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** An input without its `_meta` member, which carries request values, not input. */
function withoutMeta(input: unknown): unknown {
	if (!isRecord(input) || !('_meta' in input)) return input;
	const { _meta, ...rest } = input;
	return rest;
}

function response(
	status: number,
	body: unknown,
	headers: Record<string, string> = {}
): PreDispatch {
	return {
		proceed: false,
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	};
}

/** A body over the cap: the handler's own 413 for that route. */
export function bodyTooLarge(path: string): PreDispatch {
	const message = 'Request body is too large';
	const suggestion = 'Correct the request headers or body and retry';
	return response(
		413,
		JSON_RPC_ROUTES.has(path)
			? jsonRpcError(null, -32000, message, suggestion)
			: { success: false, error: { code: 'HTTP_413', message, suggestion } },
		{ Connection: 'close' }
	);
}

/** The 400 for a JSON-RPC batch: MCP has had none since 2025-06-18. */
const BATCH_REFUSED = response(400, {
	jsonrpc: '2.0',
	id: null,
	error: {
		code: -32600,
		message: 'JSON-RPC batches are not supported: send one message per request',
	},
});

/** How a 403 is spelled: M5's `Bearer` challenge, or a host's own scheme and suggestion. */
export interface ForbiddenStyle {
	challenge?: ScopeChallenge;
	scopeSource?: string;
}

/** The 403 naming `missing` (M5; a host's own layer, M6). */
export function forbidden(
	resource: ProtectedResource,
	missing: readonly string[],
	style: ForbiddenStyle = {}
): PreDispatch {
	return response(403, resource.forbiddenBody(missing, style.scopeSource), {
		'WWW-Authenticate': style.challenge
			? style.challenge.headerValue(missing)
			: resource.forbiddenChallenge(missing),
	});
}

/**
 * Decide a `POST` body on `path` for the caller `view` describes (M6): a JSON-RPC batch on a
 * JSON-RPC route is refused with 400; a `tools/call` is decided over every call it names, as the
 * router resolves them; `/rpc` as `afd-call`, `/batch` as `afd-batch`, `/stream/<name>` as a call
 * of that command; every other message needs the required scopes. A body that is not JSON
 * proceeds, to be decided again after routing.
 */
export function decideBody(
	view: ScopeView,
	path: string,
	text: string,
	resource: ProtectedResource,
	style: ForbiddenStyle = {}
): PreDispatch {
	let message: unknown;
	try {
		message = JSON.parse(text);
	} catch {
		return { proceed: true };
	}
	if (JSON_RPC_ROUTES.has(path) && Array.isArray(message)) return BATCH_REFUSED;
	let decision = view.decideRequest();
	const body = isRecord(message) ? message : {};
	if (path === '/mcp' || path === '/message') {
		const params = body.params;
		if (body.method === 'tools/call' && isRecord(params) && typeof params.name === 'string') {
			decision = view.decideCall(params.name, isRecord(params.arguments) ? params.arguments : {});
		}
	} else if (path === '/rpc') {
		if (typeof body.method === 'string') {
			decision = view.decideCommands([
				{ command: body.method, input: withoutMeta(body.params ?? {}) },
			]);
		}
	} else if (path === '/batch') {
		const items = body.commands;
		if (
			Array.isArray(items) &&
			items.length > 0 &&
			items.every((item) => isRecord(item) && typeof item.command === 'string')
		) {
			decision = view.decideCommands(
				items.map((item: Record<string, unknown>) => ({
					command: item.command as string,
					input: item.input ?? {},
				}))
			);
		}
	} else if (path.startsWith('/stream/')) {
		let name: string;
		try {
			name = decodeURIComponent(path.slice('/stream/'.length));
		} catch {
			return { proceed: true };
		}
		decision = view.decideCommands([{ command: name, input: withoutMeta(message) }]);
	}
	return decision === 'proceed'
		? { proceed: true }
		: forbidden(resource, decision.forbidden, style);
}
