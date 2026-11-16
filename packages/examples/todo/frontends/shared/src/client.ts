/**
 * @fileoverview The page's connection to a to-do backend: MCP over Streamable HTTP on `/mcp`, the
 * current transport, reading each command's structured `CommandResult`.
 *
 * The client declares form elicitation, so when the server holds a call for a person (an agent's
 * `todo-clear`, through the approval middleware's `mcp-elicitation` relay) or asks to confirm one,
 * the question comes to the page, which shows it and answers with the person's choice.
 */

import type { ElicitationRequest, ElicitationResponse } from '@lushly-dev/afd-client';
import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import type { CommandResult } from '@lushly-dev/afd-core';

/** Asks the person a server's question and returns their answer. */
export type AskPerson = (request: ElicitationRequest) => Promise<ElicitationResponse>;

/** A command call, as the command log records it. */
export interface CallRecord {
	id: number;
	command: string;
	input: Record<string, unknown>;
	startedAt: number;
	durationMs?: number;
	result?: CommandResult<unknown>;
}

export interface TodoClientOptions {
	/** The backend, such as `http://localhost:3100` (the page adds `/mcp`). */
	baseUrl: string;
	ask: AskPerson;
	/** Told about every call when it starts and again when it ends. */
	onCall?: (record: CallRecord) => void;
	/** The `fetch` to use; tests pass one. */
	fetch?: typeof fetch;
}

/** A transport failure as a `CommandResult`, so the page handles every outcome one way. */
function unreachable(error: unknown): CommandResult<never> {
	return {
		success: false,
		error: {
			code: 'BACKEND_UNREACHABLE',
			message: error instanceof Error ? error.message : String(error),
			suggestion:
				'Start a backend (pnpm dev:ts from packages/examples/todo, or TRANSPORT=http pnpm start in backends/typescript), then retry',
			retryable: true,
		},
	};
}

/** A result the page could not read as a `CommandResult`. */
function unreadable(reason: string): CommandResult<never> {
	return {
		success: false,
		error: {
			code: 'BAD_RESULT',
			message: `The backend's answer was not a command result: ${reason}`,
			suggestion: 'Check that the backend is an AFD server, and look at its log',
			retryable: false,
		},
	};
}

/** The `CommandResult` in a `tools/call` result: its structured content, or its JSON text. */
function readResult<T>(payload: unknown): CommandResult<T> {
	const result = payload as
		| { structuredContent?: unknown; content?: { type: string; text?: string }[] }
		| undefined;
	let value = result?.structuredContent;
	if (value === undefined) {
		const text = result?.content?.find((part) => part.type === 'text')?.text;
		if (text === undefined) return unreadable('it had neither structured content nor text');
		try {
			value = JSON.parse(text);
		} catch {
			return unreadable('its text was not JSON');
		}
	}
	if (
		typeof value !== 'object' ||
		value === null ||
		typeof (value as { success?: unknown }).success !== 'boolean'
	) {
		return unreadable('it had no success field');
	}
	return value as CommandResult<T>;
}

export class TodoClient {
	private transport: StreamableHttpTransport | undefined;
	/** The connection being opened, shared by every call that needs one meanwhile. */
	private connecting: Promise<StreamableHttpTransport> | undefined;
	private nextId = 1;
	/** Rises on every disconnect, so a connection that finishes opening after one is closed. */
	private generation = 0;

	private readonly options: TodoClientOptions;

	constructor(options: TodoClientOptions) {
		this.options = options;
	}

	/** Connect afresh, dropping any current connection. */
	async connect(): Promise<void> {
		this.disconnect();
		await this.transportFor();
	}

	get connected(): boolean {
		return this.transport !== undefined;
	}

	/** The open connection, or the one being opened; opens one if there is none. */
	private transportFor(): Promise<StreamableHttpTransport> {
		if (this.transport) return Promise.resolve(this.transport);
		this.connecting ??= this.open().finally(() => {
			this.connecting = undefined;
		});
		return this.connecting;
	}

	private async open(): Promise<StreamableHttpTransport> {
		const generation = this.generation;
		const transport = new StreamableHttpTransport(`${this.options.baseUrl}/mcp`, {
			clientName: 'todo-page',
			clientVersion: '1.0.0',
			onElicitation: (request) => this.options.ask(request),
			...(this.options.fetch && { fetch: this.options.fetch }),
		});
		await transport.connect();
		if (generation !== this.generation) {
			// Disconnected while this was opening: close it rather than leave it open
			transport.disconnect();
			throw new Error('Disconnected while connecting');
		}
		this.transport = transport;
		return transport;
	}

	/**
	 * Run one command and return its `CommandResult`; a transport failure is one too. `log: false`
	 * keeps a background read (the page's polling) out of the command log.
	 */
	async call<T>(
		command: string,
		input: Record<string, unknown> = {},
		options: { log?: boolean } = {}
	): Promise<CommandResult<T>> {
		const log = options.log !== false;
		const record: CallRecord = { id: this.nextId++, command, input, startedAt: Date.now() };
		if (log) this.options.onCall?.(record);
		let result: CommandResult<T>;
		let used: StreamableHttpTransport | undefined;
		try {
			used = await this.transportFor();
			const response = await used.send({
				jsonrpc: '2.0',
				id: record.id,
				method: 'tools/call',
				params: { name: command, arguments: input },
			});
			result = response.error
				? {
						success: false,
						error: {
							code: 'MCP_ERROR',
							message: response.error.message,
							suggestion:
								'Check the command name and input (afd-detail describes them), or the backend log',
							retryable: false,
						},
					}
				: readResult<T>(response.result);
		} catch (error) {
			// Drop only the connection this call used; another call may already have opened a new one
			if (used && this.transport === used) {
				used.disconnect();
				this.transport = undefined;
			}
			result = unreachable(error);
		}
		const done = { ...record, durationMs: Date.now() - record.startedAt, result };
		if (log) this.options.onCall?.(done);
		return result;
	}

	disconnect(): void {
		this.generation++;
		this.connecting = undefined;
		this.transport?.disconnect();
		this.transport = undefined;
	}
}
