/**
 * @fileoverview JSON-RPC 2.0 envelopes for the HTTP `/message` and `/rpc` endpoints.
 */

import { truncateName } from '@lushly-dev/afd-core';
import { HttpRequestError } from './http-security.js';

/** JSON-RPC 2.0 error codes used by the HTTP transport. */
export const JsonRpcErrorCode = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	/** Transport-level rejection (Host, Origin, Content-Type, body size). */
	SERVER_ERROR: -32000,
	/** The `Mcp-Session-Id` is unknown or expired. */
	SESSION_NOT_FOUND: -32001,
} as const;

export type JsonRpcId = string | number | null;

/** A validated JSON-RPC request; `notification` is true when it has no `id` member. */
export interface JsonRpcMessage {
	id: JsonRpcId;
	method: string;
	params: unknown;
	notification: boolean;
}

/** A JSON-RPC error to answer a valid request with (HTTP 200). */
export class JsonRpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
		readonly suggestion: string
	) {
		super(message);
	}
}

export function jsonRpcResult(id: JsonRpcId, result: unknown) {
	return { jsonrpc: '2.0' as const, id, result };
}

export function jsonRpcError(id: JsonRpcId, code: number, message: string, suggestion: string) {
	return { jsonrpc: '2.0' as const, id, error: { code, message, data: { suggestion } } };
}

function invalidRequest(message: string): HttpRequestError {
	return new HttpRequestError(400, message, {
		rpcCode: JsonRpcErrorCode.INVALID_REQUEST,
		suggestion:
			'Send one JSON-RPC 2.0 request object: { "jsonrpc": "2.0", "id": 1, "method": "..." }',
	});
}

/**
 * Validate a parsed body as one JSON-RPC 2.0 request or notification.
 *
 * `jsonrpc` may be omitted for compatibility with the simple `/rpc` format, but any other
 * value than "2.0" is rejected. Batch arrays are not supported (MCP removed JSON-RPC batching).
 *
 * @throws HttpRequestError (HTTP 400, JSON-RPC -32600) when the body is not a valid request
 */
export function parseJsonRpcMessage(body: unknown): JsonRpcMessage {
	if (Array.isArray(body)) {
		throw invalidRequest('JSON-RPC batch arrays are not supported; send one request per HTTP call');
	}
	if (!body || typeof body !== 'object') throw invalidRequest('Expected a JSON-RPC request object');
	const request = body as Record<string, unknown>;
	if (request.jsonrpc !== undefined && request.jsonrpc !== '2.0') {
		throw invalidRequest('jsonrpc must be "2.0"');
	}
	// Only a message that declares JSON-RPC 2.0 can be a notification. The simple `/rpc` format
	// without a `jsonrpc` member predates this and is always answered (`id: null` if omitted).
	const notification = request.jsonrpc === '2.0' && !('id' in request);
	const id = request.id ?? null;
	if (id !== null && typeof id !== 'string' && typeof id !== 'number') {
		throw invalidRequest('id must be a string, a number or null');
	}
	if (typeof request.method !== 'string' || !request.method) {
		throw invalidRequest('Request method is required');
	}
	return { id, method: request.method, params: request.params, notification };
}

export function methodNotFound(method: string): JsonRpcError {
	return new JsonRpcError(
		JsonRpcErrorCode.METHOD_NOT_FOUND,
		`Method not found: ${truncateName(method)}`,
		'Use initialize, ping, tools/list or tools/call'
	);
}
