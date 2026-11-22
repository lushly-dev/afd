/**
 * @fileoverview The runtime adapter over TanStack AI (phase 5 specification, 4.3; D27): `chat()` with Loam's tools,
 * whose `execute` calls the agent port, and TanStack's own provider adapter with the model port's `fetch` (S6). No
 * `needsApproval`, no client tools and no interrupt. TanStack's types stay inside this file.
 */

import { type AnyTextAdapter, chat, maxIterations } from '@tanstack/ai';
import { messagesFor, SYSTEM_PROMPT, sessionNonce, toolResultText } from './context.js';
import type { AgUiEventV1, CopilotProviderV1, CopilotRuntimeV1 } from './types.js';

/** Makes a provider kind's text adapter over the model port's `fetch`. */
export type AdapterFactory = (
	provider: CopilotProviderV1,
	fetchImpl: typeof fetch
) => AnyTextAdapter;

/** The tool that reads a confirmation this session raised (3.5's continuation names it), never the kernel's command. */
export const CONFIRMATION_TOOL = Object.freeze({
	name: 'confirmation-get',
	description:
		'Read how a confirmation this conversation raised ended, and the result of the call the shell ran once the person confirmed it',
	inputSchema: {
		type: 'object',
		properties: { notification: { type: 'string', minLength: 1, maxLength: 64 } },
		required: ['notification'],
		additionalProperties: false,
	} as Record<string, unknown>,
});

/** 4.4's defaults, which phase 4's settings will set. */
export const RUNTIME_LIMITS = Object.freeze({ iterations: 16, outputTokens: 16_384 });

export function createTanStackRuntime(adapterFor: AdapterFactory): CopilotRuntimeV1 {
	/** A session's random value for its content blocks (5.2), for the life of this runtime. */
	const nonces = new Map<string, string>();
	return {
		async *turn(input, ports) {
			let nonce = nonces.get(input.session.id);
			if (!nonce) {
				nonce = sessionNonce();
				nonces.set(input.session.id, nonce);
			}
			const blockValue = nonce;
			const adapter = adapterFor(input.provider, ports.model.fetchFor(input.provider));
			const tools = [
				...input.tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
					execute: async (args: unknown) =>
						toolResultText(tool.name, await ports.agent.call(tool.name, args ?? {}), blockValue),
				})),
				// A confirmation this session raised, read through the agent port's `confirmation` alone (3.2, 6.2): the
				// outcome of a call the person confirmed, which the kernel's half lets it read and nothing else.
				{
					...CONFIRMATION_TOOL,
					execute: async (args: unknown) =>
						toolResultText(
							CONFIRMATION_TOOL.name,
							await ports.agent.confirmation(
								String((args as { notification?: unknown } | null)?.notification ?? '')
							),
							blockValue
						),
				},
			];
			const abortController = new AbortController();
			if (ports.signal.aborted) abortController.abort();
			ports.signal.addEventListener('abort', () => abortController.abort(), { once: true });
			const stream = chat({
				adapter,
				messages: messagesFor(input.history, input.text),
				systemPrompts: [SYSTEM_PROMPT],
				tools,
				abortController,
				agentLoopStrategy: maxIterations(RUNTIME_LIMITS.iterations),
				threadId: input.session.id,
				runId: input.runId,
				// 4.2: the runtime sets `max_tokens`, since the adapter would send its own default; the trusted half
				// lowers a larger one anyway.
				modelOptions: { max_tokens: RUNTIME_LIMITS.outputTokens },
			} as never) as AsyncIterable<AgUiEventV1>;
			for await (const event of stream) yield event;
		},
	};
}
