/** @fileoverview The `/chat` backend: what the person sees when the copilot is missing or fails. */

import { setStore, TodoStore } from '@afd/example-todo-ts/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { createChatBackend } from './chat.js';
import { PublicError } from './chat-http.js';
import { Copilot, CopilotError, type CopilotModel } from './copilot.js';
import { createCopilotRegistry } from './registry.js';

const quiet = () => {};

function backend(respond: CopilotModel['respond']) {
	return createChatBackend(
		new Copilot({ registry: createCopilotRegistry({}), model: { respond } }),
		quiet
	);
}

beforeEach(() => setStore(new TodoStore()));

describe('createChatBackend', () => {
	it('answers and counts a turn', async () => {
		const chat = backend(async () => ({ text: 'Nothing to do.', calls: [] }));
		const response = await chat.processChat('Anything left?', 'look');
		expect(response).toMatchObject({ message: 'Nothing to do.', mode: 'look' });
		expect(response.requestId).toMatch(/^req-/);
		expect(chat.getMetrics()).toMatchObject({ requestCount: 1, successCount: 1 });
	});

	it('says how to configure the model when there is none', async () => {
		const chat = createChatBackend(undefined, quiet);
		expect(chat.isConfigured()).toBe(false);
		await expect(chat.processChat('hi', 'change')).rejects.toThrow(
			new PublicError('Gemini is not configured. Set GOOGLE_API_KEY in .env.')
		);
	});

	it('counts a turn the page cancelled as cancelled, not as a failure of the copilot', async () => {
		const cancel = new AbortController();
		const chat = backend(async () => {
			cancel.abort();
			return { calls: [{ name: 'todo-stats', args: {} }] };
		});
		await expect(chat.processChat('hi', 'change', { signal: cancel.signal })).rejects.toThrow();
		expect(chat.getMetrics()).toMatchObject({ errorCount: 1, errorsByType: { cancelled: 1 } });
	});

	it("passes on a copilot failure's message, and hides any other", async () => {
		const shown = backend(async () => {
			throw new CopilotError('Try a simpler request.');
		});
		await expect(shown.processChat('hi', 'change')).rejects.toBeInstanceOf(PublicError);

		const hidden = backend(async () => {
			throw new Error('socket hang up at 10.0.0.1');
		});
		const error = await hidden.processChat('hi', 'change').catch((caught: unknown) => caught);
		expect(error).not.toBeInstanceOf(PublicError);
		expect(hidden.getMetrics()).toMatchObject({ errorCount: 1, errorsByType: { unknown: 1 } });
	});
});
