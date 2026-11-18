/**
 * The Chat Completions adapter over the model port (4.3): 4.2's endpoint is Chat Completions, not the Responses API
 * TanStack's default OpenAI adapter uses. `dangerouslyAllowBrowser` only lets the client run in a worker, which holds
 * no key.
 */
import { createOpenaiChatCompletions } from '@tanstack/ai-openai';
import type { AdapterFactory } from './tanstack.js';

export const openaiAdapter: AdapterFactory = (provider, fetchImpl) =>
	createOpenaiChatCompletions(provider.model as never, 'loam-model-port', {
		fetch: fetchImpl,
		maxRetries: 0,
		dangerouslyAllowBrowser: true,
	} as never) as never;
