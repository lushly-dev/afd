/**
 * @fileoverview `McpClient.stream()` over HTTP (`POST <base>/stream/<command>`) and in process.
 *
 * Every stream ends with exactly one terminal chunk the caller can rely on: the server's
 * `complete` or `error` chunk, or a client-made error chunk that says why the stream stopped
 * (`STREAM_TRUNCATED`, `STREAM_TIMEOUT`, `STREAM_CANCELLED`, `STREAM_EVENT_TOO_LARGE`, ...).
 */

import type { CommandError, ErrorChunk, StreamChunk } from '@lushly-dev/afd-core';
import {
	executeStream,
	isCommandError,
	isCompleteChunk,
	isErrorChunk,
	isStreamChunk,
} from '@lushly-dev/afd-core';
import { toCommandError } from './client-errors.js';
import type { DirectRegistry } from './direct-types.js';
import { readSseEvents, SseEventTooLargeError } from './sse-parser.js';

/**
 * The `/stream/<command>` URL for a server URL. A trailing `/sse`, `/message` or `/messages` is
 * replaced and any other base path is kept, so `http://host/api/mcp/sse` streams from
 * `http://host/api/mcp/stream/<command>` (the same rule as the Python client).
 */
export function deriveStreamUrl(serverUrl: string, commandName: string): string {
	const url = new URL(serverUrl);
	const base = url.pathname.replace(/\/+$/, '').replace(/\/(?:sse|messages?)$/, '');
	url.pathname = `${base}/stream/${encodeURIComponent(commandName)}`;
	url.search = '';
	url.hash = '';
	return url.toString();
}

/** A client-made terminal error chunk. */
export function streamErrorChunk(
	error: CommandError,
	chunksBeforeError: number,
	recoverable = false
): ErrorChunk {
	return { type: 'error', error, chunksBeforeError, recoverable };
}

/** Why a stream's signal was aborted. */
export interface StreamAbortState {
	/** The stream's own timeout fired. */
	timedOut: boolean;
	/** The caller's signal, if any. */
	callerSignal?: AbortSignal;
	/** The signal the client aborts on `disconnect()` or timeout. */
	controller: AbortController;
}

function abortChunk(state: StreamAbortState, timeoutMs: number | undefined, chunks: number) {
	if (state.timedOut) {
		return streamErrorChunk(
			{
				code: 'STREAM_TIMEOUT',
				message: `Stream did not finish within ${timeoutMs}ms`,
				suggestion:
					'Retry with a larger timeout. The command may still have run, so check its effect before retrying a mutation.',
				retryable: true,
			},
			chunks
		);
	}
	const byCaller = state.callerSignal?.aborted === true;
	const reason: unknown = state.controller.signal.reason;
	return streamErrorChunk(
		{
			code: 'STREAM_CANCELLED',
			message: byCaller
				? 'Stream was cancelled by the caller'
				: reason instanceof Error
					? `Stream was cancelled: ${reason.message}`
					: 'Stream was cancelled',
			suggestion: byCaller
				? 'The request was aborted by the client'
				: 'Reconnect the client and start the stream again if the result is still needed',
		},
		chunks
	);
}

const TRUNCATED: CommandError = {
	code: 'STREAM_TRUNCATED',
	message: 'The stream ended without a complete or error chunk',
	suggestion:
		'The connection closed before the command reported its result. Check whether the command took effect before running it again.',
	retryable: false,
};

async function httpFailure(response: Response): Promise<CommandError> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = undefined;
	}
	if (typeof body === 'object' && body !== null && 'error' in body && isCommandError(body.error)) {
		return body.error;
	}
	return {
		code: 'STREAM_ERROR',
		message: `HTTP ${response.status}: ${response.statusText}`,
		suggestion: 'Check the command name and arguments, and that the server supports streaming',
		retryable: response.status >= 500,
	};
}

/** Options for {@link streamOverHttp}. */
export interface HttpStreamRequest {
	url: string;
	args: Record<string, unknown> | undefined;
	headers: Record<string, string>;
	signal: AbortSignal;
	abort: StreamAbortState;
	timeoutMs: number | undefined;
	maxEventSize: number;
	debug: (message: string, data?: unknown) => void;
}

/**
 * Stream a command from an AFD server's `/stream/<command>` endpoint.
 */
export async function* streamOverHttp<T>(
	request: HttpStreamRequest
): AsyncGenerator<StreamChunk<T>, void, unknown> {
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let chunks = 0;
	try {
		const response = await fetch(request.url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'text/event-stream',
				...request.headers,
			},
			body: JSON.stringify(request.args ?? {}),
			signal: request.signal,
		});
		if (!response.ok) {
			yield streamErrorChunk(await httpFailure(response), 0);
			return;
		}
		reader = response.body?.getReader();
		if (!reader) {
			yield streamErrorChunk(
				{
					code: 'STREAM_ERROR',
					message: 'Response body is not readable',
					suggestion: 'The server does not support streaming',
				},
				0
			);
			return;
		}

		for await (const event of readSseEvents(reader, request.maxEventSize)) {
			if (event.data === '[DONE]') break;
			let chunk: unknown;
			try {
				chunk = JSON.parse(event.data);
			} catch {
				request.debug('Malformed stream chunk:', event.data);
				continue;
			}
			if (!isStreamChunk(chunk)) {
				request.debug('Ignoring a stream event that is not a chunk:', event.data);
				continue;
			}
			const typed = chunk as StreamChunk<T>;
			yield typed;
			if (isCompleteChunk(typed) || isErrorChunk(typed)) return;
			chunks++;
		}
		yield request.signal.aborted
			? abortChunk(request.abort, request.timeoutMs, chunks)
			: streamErrorChunk(TRUNCATED, chunks);
	} catch (error) {
		if (request.signal.aborted) {
			yield abortChunk(request.abort, request.timeoutMs, chunks);
		} else if (error instanceof SseEventTooLargeError) {
			yield streamErrorChunk(
				{
					code: 'STREAM_EVENT_TOO_LARGE',
					message: error.message,
					suggestion:
						'Have the command emit smaller chunks, or raise maxStreamEventSize in the client config',
					retryable: false,
				},
				chunks
			);
		} else {
			yield streamErrorChunk(toCommandError(error), chunks, true);
		}
	} finally {
		if (reader) {
			try {
				await reader.cancel();
			} catch {
				// The underlying fetch may already have released the reader.
			}
			reader.releaseLock();
		}
	}
}

/**
 * Stream a command in process through a registry, with the stream semantics of core's
 * `executeStream()`.
 */
export async function* streamDirect<T>(
	registry: DirectRegistry,
	name: string,
	args: Record<string, unknown> | undefined,
	signal: AbortSignal,
	abort: StreamAbortState,
	timeoutMs: number | undefined
): AsyncGenerator<StreamChunk<T>, void, unknown> {
	let chunks = 0;
	for await (const chunk of executeStream<T>(
		name,
		args ?? {},
		(command, input, context) => registry.execute(command, input, context),
		{ signal }
	)) {
		if (isErrorChunk(chunk) && chunk.error.code === 'STREAM_ABORTED' && signal.aborted) {
			yield abortChunk(abort, timeoutMs, chunks);
			return;
		}
		yield chunk;
		chunks++;
	}
}
