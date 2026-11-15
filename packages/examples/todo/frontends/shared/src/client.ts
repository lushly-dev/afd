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

export class TodoClient {
	private transport: StreamableHttpTransport | undefined;
	private nextId = 1;

	constructor(private readonly options: TodoClientOptions) {}

	/** Connect, or reconnect after the backend went away. */
	async connect(): Promise<void> {
		const transport = new StreamableHttpTransport(`${this.options.baseUrl}/mcp`, {
			clientName: 'todo-page',
			clientVersion: '1.0.0',
			onElicitation: (request) => this.options.ask(request),
			...(this.options.fetch && { fetch: this.options.fetch }),
		});
		await transport.connect();
		this.transport?.disconnect();
		this.transport = transport;
	}

	get connected(): boolean {
		return this.transport !== undefined;
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
		try {
			if (!this.transport) await this.connect();
			const response = await this.transport?.send({
				jsonrpc: '2.0',
				id: record.id,
				method: 'tools/call',
				params: { name: command, arguments: input },
			});
			if (response?.error) {
				result = unreachable(new Error(response.error.message));
			} else {
				const payload = response?.result as
					| { structuredContent?: unknown; content?: { type: string; text?: string }[] }
					| undefined;
				const structured =
					payload?.structuredContent ??
					JSON.parse(payload?.content?.find((part) => part.type === 'text')?.text ?? 'null');
				result = structured as CommandResult<T>;
			}
		} catch (error) {
			this.transport?.disconnect();
			this.transport = undefined;
			result = unreachable(error);
		}
		const done = { ...record, durationMs: Date.now() - record.startedAt, result };
		if (log) this.options.onCall?.(done);
		return result;
	}

	disconnect(): void {
		this.transport?.disconnect();
		this.transport = undefined;
	}
}
