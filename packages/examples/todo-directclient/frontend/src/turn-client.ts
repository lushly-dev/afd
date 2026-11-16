/**
 * @fileoverview One turn of the copilot, from the page: send the message to `POST /chat`, read
 * the turn's events as they stream (JSON lines), answer the server's questions on
 * `POST /chat/answer`.
 *
 * The page answers two kinds of question: an approval (the person's choice, which the panel
 * collects) and a view call (run in the page's own view-state registry, so the list on screen
 * changes, and its `CommandResult` sent back). See `backend/src/chat-http.ts` for the protocol.
 */

import type { CommandResult } from '@lushly-dev/afd-core';

export type CopilotMode = 'change' | 'look';

/** A command the model ran, as it ends. */
export interface ToolResultEvent {
	type: 'result';
	index: number;
	name: string;
	args: Record<string, unknown>;
	success: boolean;
	result: unknown;
	latencyMs: number;
}

/** Everything a turn's stream carries. */
export type TurnEvent =
	| { type: 'turn'; turn: string }
	| { type: 'call'; index: number; name: string; args: Record<string, unknown> }
	| ToolResultEvent
	| {
			type: 'approval';
			ask: number;
			command: string;
			summary: string;
			expiresAt: string;
	  }
	| { type: 'view'; ask: number; command: string; input: Record<string, unknown> }
	| { type: 'withdrawn'; ask: number }
	| {
			type: 'done';
			message: string;
			mode: CopilotMode;
			stopped?: 'rounds' | 'calls';
			toolExecutions: unknown[];
	  }
	| { type: 'error'; error: string };

export interface TurnOptions {
	/** Where the server is: the page's own origin unless it was opened with `?backend=`. */
	baseUrl: string;
	message: string;
	mode: CopilotMode;
	/** Each event, in order, including the questions (which the turn answers itself for views). */
	onEvent: (event: TurnEvent) => void;
	/** Runs a view-state command in the page; its result goes back to the server. */
	runView: (command: string, input: Record<string, unknown>) => Promise<CommandResult<unknown>>;
	signal?: AbortSignal;
	fetch?: typeof fetch;
}

/** The answer a turn ends with: its last `done` or `error` event. */
export type TurnEnd = Extract<TurnEvent, { type: 'done' } | { type: 'error' }>;

/** Read the HTTP error a refused request sent: its `error` and `suggestion`. */
async function refusal(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: string; suggestion?: string };
		return [body.error, body.suggestion].filter(Boolean).join('. ') || `HTTP ${response.status}`;
	} catch {
		return `HTTP ${response.status}`;
	}
}

/** Split a stream of bytes into the JSON objects on its lines. */
export async function* jsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	for (;;) {
		const { value, done } = await reader.read();
		buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
		let newline = buffer.indexOf('\n');
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line) yield JSON.parse(line);
			newline = buffer.indexOf('\n');
		}
		if (done) {
			if (buffer.trim()) yield JSON.parse(buffer);
			return;
		}
	}
}

/** Answer a question a turn asked: an approval (`approved`) or a view call (`result`). */
export async function answer(
	baseUrl: string,
	body:
		| { turn: string; ask: number; approved: boolean }
		| { turn: string; ask: number; result: unknown },
	fetchImpl: typeof fetch = fetch
): Promise<boolean> {
	const response = await fetchImpl(`${baseUrl}/chat/answer`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	return response.ok;
}

/**
 * Run one turn to its end. A refused request, a stream that breaks, or one that ends without an
 * answer comes back as an `error` end; it never throws, except when `signal` aborts.
 */
export async function runTurn(options: TurnOptions): Promise<TurnEnd> {
	const fetchImpl = options.fetch ?? fetch;
	const response = await fetchImpl(`${options.baseUrl}/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message: options.message, mode: options.mode }),
		...(options.signal && { signal: options.signal }),
	}).catch((error: unknown) => {
		if (options.signal?.aborted) throw error;
		return undefined;
	});
	if (!response) return { type: 'error', error: 'The server could not be reached' };
	if (!response.ok || !response.body) return { type: 'error', error: await refusal(response) };

	let turn = '';
	let end: TurnEnd | undefined;
	try {
		for await (const value of jsonLines(response.body)) {
			const event = value as TurnEvent;
			options.onEvent(event);
			if (event.type === 'turn') turn = event.turn;
			else if (event.type === 'view') {
				// Answer while the stream stays open: the turn waits for this result
				const result = await options.runView(event.command, event.input).catch(
					(): CommandResult<unknown> => ({
						success: false,
						error: {
							code: 'PAGE_VIEW_FAILED',
							message: `The page could not run ${event.command}`,
							suggestion: 'Answer in the chat instead',
						},
					})
				);
				await answer(options.baseUrl, { turn, ask: event.ask, result }, fetchImpl).catch(
					() => false
				);
			} else if (event.type === 'done' || event.type === 'error') end = event;
		}
	} catch (error) {
		if (options.signal?.aborted) throw error;
		return { type: 'error', error: 'The connection to the server broke during the answer' };
	}
	return end ?? { type: 'error', error: 'The server ended the answer without finishing it' };
}
