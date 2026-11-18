/** The Anthropic Messages adapter over the model port (4.3, S6). The test provider speaks this format too. */
import { createAnthropicChat } from '@tanstack/ai-anthropic';
import type { AdapterFactory } from './tanstack.js';

/**
 * The key is a placeholder the model port drops with the request's headers: the trusted host adds the real one
 * (4.2). No retries, so a stopped stream is not sent again.
 */
export const anthropicAdapter: AdapterFactory = (provider, fetchImpl) =>
	createAnthropicChat(provider.model as never, 'loam-model-port', {
		fetch: fetchImpl,
		maxRetries: 0,
	}) as never;
