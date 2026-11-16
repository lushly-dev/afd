/**
 * @fileoverview The copilot: a model that manages todos by calling the to-do reference's own
 * commands through DirectClient, in this process.
 *
 * - **The commands are the main example's** (`@afd/example-todo-ts/commands`), with its
 *   middleware: approvals, the change history and logging. Nothing here defines a command.
 * - **The model's tools come from the MCP tool surface** (`createDirectToolSurface` and
 *   `listTools()`): each command's own name, description and JSON Schema, exactly as an MCP
 *   server with these commands lists them. No schema is written by hand.
 * - **`allow` decides what the model may run.** In `look` mode only the commands that declare
 *   `mutation: false` are permitted: the rest are left out of the tool list, and a call to one fails with
 *   `COMMAND_NOT_ALLOWED` before it runs, whatever the model sends. Contexts only narrow what an
 *   agent is offered; `allow` is the boundary.
 * - **The model calls as an agent** (`context.actor`), so the change history says the copilot
 *   made a change, and `todo-clear` is held for the person's approval.
 *
 * The model itself is behind {@link CopilotModel}: Gemini in `gemini.ts`, a scripted one in tests.
 */

import { allCommands } from '@afd/example-todo-ts/commands';
import {
	createDirectClient,
	type DirectApprovalHook,
	type DirectClient,
	isUnknownToolError,
} from '@lushly-dev/afd-client';
import type { Actor, CommandResult } from '@lushly-dev/afd-core';
import type { DirectCommandRegistry } from '@lushly-dev/afd-server';

/** `change`: the copilot may run every to-do command. `look`: only the ones that read. */
export type CopilotMode = 'change' | 'look';

export const COPILOT_MODES: readonly CopilotMode[] = ['change', 'look'];

/** Who the copilot's calls run as: an agent, so history names it and approvals hold it. */
export const COPILOT_ACTOR: Actor = {
	kind: 'agent',
	id: 'todo-copilot',
	label: 'Gemini (todo assistant)',
};

/**
 * The commands a mode permits, read from the commands' own metadata: in `look` mode those that
 * declare `mutation: false`, in `change` mode all of them. Meta-tools (`afd-call`, `afd-batch`
 * and the rest) are not permitted in either: the model gets each command as its own tool.
 */
export function allowedCommands(mode: CopilotMode): ReadonlySet<string> {
	return new Set(
		allCommands
			.filter((command) => mode === 'change' || command.mutation === false)
			.map((command) => command.name)
	);
}

/** The `allow` predicate for a mode. */
export function allowFor(mode: CopilotMode): (name: string) => boolean {
	const allowed = allowedCommands(mode);
	return (name) => allowed.has(name);
}

/** A tool as a model sees it: the MCP tool's name, description and input JSON Schema. */
export interface ModelTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

/** One tool call the model asked for. */
export interface ModelCall {
	name: string;
	args: Record<string, unknown>;
}

/** What the model said in one round: text, tool calls, or both. */
export interface ModelReply {
	text?: string;
	calls: ModelCall[];
	/**
	 * The provider's own form of this reply, sent back unchanged in the next round. Gemini needs
	 * its function-call parts (with their thought signatures) returned as they came.
	 */
	raw?: unknown;
}

/** The conversation so far, in a form any model adapter can translate. */
export type ModelMessage =
	| { role: 'user'; text: string }
	| { role: 'model'; reply: ModelReply }
	| { role: 'tool'; results: { name: string; result: Record<string, unknown> }[] };

/** A chat model that can call tools. */
export interface CopilotModel {
	respond(request: {
		system: string;
		messages: readonly ModelMessage[];
		tools: readonly ModelTool[];
	}): Promise<ModelReply>;
}

/** One command the model ran, as the page shows it. */
export interface ToolExecution {
	name: string;
	args: Record<string, unknown>;
	success: boolean;
	/** The command's data on success, its error otherwise. */
	result: unknown;
	latencyMs: number;
}

/** What one message to the copilot produced. */
export interface CopilotTurn {
	message: string;
	mode: CopilotMode;
	toolExecutions: ToolExecution[];
	totalToolLatencyMs: number;
	modelLatencyMs: number;
}

/** A failure whose message is safe to show the person. */
export class CopilotError extends Error {}

export interface CopilotOptions {
	/** The registry the commands run in: `createCopilotRegistry` in `registry.ts`. */
	registry: DirectCommandRegistry;
	model: CopilotModel;
	/** Most rounds of tool calls for one message; the model's output is untrusted. Default 5. */
	maxRounds?: number;
	/** Asks the person to approve a held call. Without it, the model gets `APPROVAL_REQUIRED`. */
	onApprovalNeeded?: DirectApprovalHook;
}

const SYSTEM = {
	change: `You manage the person's todo list with the tools you are given. Use them to act, then answer in one or two sentences.
Each tool returns a result with success, data and, on failure, an error with a suggestion: follow the suggestion.
Clearing completed todos can't be undone, so it waits for the person to approve it. If a tool returns APPROVAL_REQUIRED, tell the person it needs their approval.`,
	look: `You help the person review their todo list. In this mode you can only read it: the tools you are given are the ones that read.
If the person asks you to change something, say that you are in look-only mode and they can switch to letting you make changes.
Answer in one or two sentences.`,
} as const;

/** The result as the model reads it: the whole `CommandResult`, a plain JSON object. */
function forModel(result: CommandResult<unknown>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
}

/** The copilot: build it once, then {@link Copilot.run} one message at a time. */
export class Copilot {
	private readonly maxRounds: number;

	constructor(private readonly options: CopilotOptions) {
		this.maxRounds = options.maxRounds ?? 5;
	}

	/** A client for one mode: the copilot's actor, the mode's `allow` and the approval hook. */
	client(mode: CopilotMode): DirectClient {
		return createDirectClient(this.options.registry, {
			actor: COPILOT_ACTOR,
			allow: allowFor(mode),
			...(this.options.onApprovalNeeded && { onApprovalNeeded: this.options.onApprovalNeeded }),
		});
	}

	/** The model's tools in a mode: what `listTools()` gives under the mode's `allow`. */
	tools(mode: CopilotMode): ModelTool[] {
		return this.client(mode)
			.listTools()
			.map((tool) => ({
				name: tool.name,
				description: tool.description ?? tool.title ?? tool.name,
				parameters: tool.inputSchema as Record<string, unknown>,
			}));
	}

	/** Answer one message, running the tools the model calls until it replies with text. */
	async run(message: string, mode: CopilotMode, signal?: AbortSignal): Promise<CopilotTurn> {
		const client = this.client(mode);
		const tools = this.tools(mode);
		const messages: ModelMessage[] = [{ role: 'user', text: message }];
		const toolExecutions: ToolExecution[] = [];
		let totalToolLatencyMs = 0;
		let modelLatencyMs = 0;

		for (let round = 0; ; round++) {
			signal?.throwIfAborted();
			const start = performance.now();
			const reply = await this.options.model.respond({ system: SYSTEM[mode], messages, tools });
			modelLatencyMs += performance.now() - start;
			if (reply.calls.length === 0) {
				return {
					message: reply.text?.trim() || 'Done.',
					mode,
					toolExecutions,
					totalToolLatencyMs,
					modelLatencyMs,
				};
			}
			if (round >= this.maxRounds) {
				throw new CopilotError(
					`Stopped after ${this.maxRounds} rounds of tool calls. Try a simpler request.`
				);
			}
			messages.push({ role: 'model', reply });

			const results: { name: string; result: Record<string, unknown> }[] = [];
			for (const call of reply.calls) {
				const callStart = performance.now();
				// allow, validation, approvals and the history all apply here, as for any caller
				const result = await client.call(call.name, call.args, signal ? { signal } : undefined);
				const latencyMs = performance.now() - callStart;
				totalToolLatencyMs += latencyMs;
				const success = result.success && !isUnknownToolError(result);
				toolExecutions.push({
					name: call.name,
					args: call.args,
					success,
					result: success ? result.data : result.error,
					latencyMs,
				});
				results.push({ name: call.name, result: forModel(result) });
			}
			messages.push({ role: 'tool', results });
		}
	}
}
