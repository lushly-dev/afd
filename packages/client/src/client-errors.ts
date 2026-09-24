/**
 * @fileoverview Errors raised by `McpClient.request()` and their mapping to AFD `CommandError`s.
 *
 * `request()` throws one of these classes so callers can tell whether the server could have run
 * the request: a JSON-RPC error answer or a 4xx HTTP status means it refused the request, while a
 * timeout, a dropped connection or a 5xx status leaves the outcome unknown.
 */

import type { CommandError, McpError } from '@lushly-dev/afd-core';
import { ErrorCodes, isCommandError } from '@lushly-dev/afd-core';

/** The client is not connected, so nothing was sent. */
export class NotConnectedError extends Error {
	constructor() {
		super('Not connected');
		this.name = 'NotConnectedError';
	}
}

/** No response arrived within the request timeout. */
export class RequestTimeoutError extends Error {
	constructor(
		readonly method: string,
		readonly timeoutMs: number
	) {
		super(`Request '${method}' timed out after ${timeoutMs}ms`);
		this.name = 'RequestTimeoutError';
	}
}

/** The server answered with a non-2xx HTTP status and no JSON-RPC error body. */
export class HttpStatusError extends Error {
	constructor(
		readonly status: number,
		readonly statusText: string
	) {
		super(`HTTP error: ${status} ${statusText}`);
		this.name = 'HttpStatusError';
	}
}

/** The server answered with a JSON-RPC error object. */
export class JsonRpcResponseError extends Error {
	readonly code: number;
	readonly data: unknown;

	constructor(error: McpError) {
		super(error.message);
		this.name = 'JsonRpcResponseError';
		this.code = error.code;
		this.data = error.data;
	}
}

interface JsonRpcCodeMapping {
	code: string;
	retryable: boolean;
	suggestion: string;
	/** Whether the server can have run (part of) the request before answering with this code. */
	outcomeUnknown?: boolean;
}

/** JSON-RPC 2.0 codes and the AFD server's `-32000`/`-32001` extensions. */
const JSON_RPC_CODES: Record<number, JsonRpcCodeMapping> = {
	[-32700]: {
		code: 'PARSE_ERROR',
		retryable: false,
		suggestion:
			'The server could not parse the request as JSON; check the arguments are serializable',
	},
	[-32600]: {
		code: 'INVALID_REQUEST',
		retryable: false,
		suggestion: 'The server rejected the JSON-RPC envelope; check that it is an AFD MCP endpoint',
	},
	[-32601]: {
		code: 'METHOD_NOT_FOUND',
		retryable: false,
		suggestion: 'The server does not support this MCP method; check the server type and version',
	},
	[-32602]: {
		code: ErrorCodes.INVALID_INPUT,
		retryable: false,
		suggestion: 'Correct the request parameters (tool name and arguments object) and try again',
	},
	[-32603]: {
		code: ErrorCodes.INTERNAL_ERROR,
		retryable: true,
		suggestion:
			'The server failed while handling the request; retry, and check the server logs if it persists',
		outcomeUnknown: true,
	},
	[-32000]: {
		code: 'REQUEST_REJECTED',
		retryable: false,
		suggestion:
			'The server rejected the HTTP request (Host, Origin, Content-Type or size); check the URL and headers',
	},
	[-32001]: {
		code: 'SESSION_NOT_FOUND',
		retryable: true,
		suggestion: 'The MCP session is unknown or expired; reconnect to start a new session',
	},
};

function serverSuggestion(data: unknown): string | undefined {
	if (typeof data !== 'object' || data === null || !('suggestion' in data)) return undefined;
	return typeof data.suggestion === 'string' && data.suggestion.length > 0
		? data.suggestion
		: undefined;
}

/** Map a JSON-RPC error answer to a CommandError, preferring the server's own suggestion. */
export function jsonRpcErrorToCommandError(error: JsonRpcResponseError): CommandError {
	const mapping = JSON_RPC_CODES[error.code];
	return {
		code: mapping?.code ?? 'JSON_RPC_ERROR',
		message: error.message || 'The server returned a JSON-RPC error',
		suggestion:
			serverSuggestion(error.data) ??
			mapping?.suggestion ??
			'Check the request against the server documentation',
		retryable: mapping?.retryable ?? false,
		details: { jsonRpcCode: error.code },
	};
}

/** Whether the server can have run the request that failed with `error`. */
export function isOutcomeUnknown(error: unknown): boolean {
	if (error instanceof NotConnectedError) return false;
	if (error instanceof JsonRpcResponseError) {
		return JSON_RPC_CODES[error.code]?.outcomeUnknown === true;
	}
	if (error instanceof HttpStatusError) return error.status < 400 || error.status >= 500;
	return true;
}

/**
 * Convert an error thrown by `request()` into a CommandError without a stack trace.
 */
export function toCommandError(error: unknown): CommandError {
	if (error instanceof JsonRpcResponseError) return jsonRpcErrorToCommandError(error);
	if (error instanceof NotConnectedError) {
		return {
			code: 'NOT_CONNECTED',
			message: 'The client is not connected',
			suggestion: 'Call connect() and try again',
			retryable: false,
		};
	}
	if (error instanceof RequestTimeoutError) {
		return {
			code: ErrorCodes.TIMEOUT,
			message: error.message,
			suggestion:
				'Retry with a larger timeout. The server may still have run the request, so check its effect before retrying a mutation.',
			retryable: true,
			details: { method: error.method, timeoutMs: error.timeoutMs },
		};
	}
	if (error instanceof HttpStatusError) {
		const serverSide = error.status >= 500 || error.status === 429;
		return {
			code: `HTTP_${error.status}`,
			message: error.message,
			suggestion: serverSide
				? 'The server is unavailable or overloaded; retry later'
				: 'The server refused the request; check that the URL points to an AFD MCP server endpoint',
			retryable: serverSide,
		};
	}
	if (isCommandError(error)) return { ...error };
	const message = error instanceof Error ? error.message : String(error);
	return {
		code: ErrorCodes.CONNECTION_ERROR,
		message: message || 'The request failed',
		suggestion:
			'Check that the server is reachable and retry. The request may have reached the server, so check its effect before retrying a mutation.',
		retryable: true,
	};
}
