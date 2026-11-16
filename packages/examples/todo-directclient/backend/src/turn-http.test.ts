/**
 * @fileoverview A turn over HTTP with the real copilot and a scripted model: the page approves or
 * denies a held clear and runs the view-state commands, answering on `/chat/answer` while the
 * turn's stream is open.
 */

import type { AddressInfo } from 'node:net';
import { setStore, TodoStore } from '@afd/example-todo-ts/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChatBackend } from './chat.js';
import { type ChatServer, createChatServer } from './chat-http.js';
import { Copilot, type ModelCall, type ModelMessage } from './copilot.js';
import { loadChatServerConfig } from './http-security.js';
import { createCopilotRegistry } from './registry.js';

type Event = Record<string, unknown> & { type: string };

let running: ChatServer | undefined;
let store: TodoStore;

beforeEach(() => {
	store = new TodoStore();
	setStore(store);
	const done = store.create({ title: 'Done already' });
	store.toggle(done.id);
	store.create({ title: 'Still open' });
});

afterEach(async () => {
	const server = running?.server;
	running = undefined;
	if (!server) return;
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Serve a copilot whose model makes `calls` in one round; returns what the model read last. */
async function start(calls: ModelCall[], viewTimeoutMs?: number) {
	const seen: ModelMessage[][] = [];
	const copilot = new Copilot({
		registry: createCopilotRegistry({}),
		model: {
			async respond({ messages }) {
				seen.push([...messages]);
				return seen.length === 1 ? { calls } : { text: 'done', calls: [] };
			},
		},
	});
	const config = loadChatServerConfig({});
	running = createChatServer(config, {
		chat: createChatBackend(copilot, () => {}),
		onError: () => {},
		...(viewTimeoutMs !== undefined && { viewTimeoutMs }),
	});
	const { server } = running;
	await new Promise<void>((ready) => server.listen(0, config.host, ready));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const lastResult = () => {
		const last = seen.at(-1)?.at(-1);
		return last?.role === 'tool' ? last.results[0]?.result : undefined;
	};
	return { base, lastResult };
}

/**
 * Send a message and read its turn as the page does, letting `onEvent` answer questions; the
 * turn's events, in order. `leave` aborts the request.
 */
async function converse(
	base: string,
	onEvent: (event: Event, turn: string) => Promise<void> | void,
	leave?: AbortSignal
): Promise<Event[]> {
	const response = await fetch(`${base}/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message: 'Go' }),
		...(leave && { signal: leave }),
	});
	const events: Event[] = [];
	let turn = '';
	let buffer = '';
	const decoder = new TextDecoder();
	try {
		for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
			buffer += decoder.decode(chunk, { stream: true });
			let newline = buffer.indexOf('\n');
			while (newline >= 0) {
				const event = JSON.parse(buffer.slice(0, newline)) as Event;
				buffer = buffer.slice(newline + 1);
				events.push(event);
				if (event.type === 'turn') turn = String(event.turn);
				await onEvent(event, turn);
				newline = buffer.indexOf('\n');
			}
		}
	} catch (error) {
		if (!leave?.aborted) throw error;
	}
	return events;
}

function answer(base: string, body: Record<string, unknown>) {
	return fetch(`${base}/chat/answer`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('a held clear', () => {
	it('runs when the person approves it in the page', async () => {
		const { base } = await start([{ name: 'todo-clear', args: {} }]);
		const events = await converse(base, async (event, turn) => {
			if (event.type === 'approval') {
				expect(event).toMatchObject({ command: 'todo-clear', summary: expect.any(String) });
				expect((await answer(base, { turn, ask: event.ask, approved: true })).status).toBe(200);
			}
		});

		expect(events.map((event) => event.type)).toEqual([
			'turn',
			'call',
			'approval',
			'result',
			'done',
		]);
		expect(events[3]).toMatchObject({ name: 'todo-clear', success: true });
		expect(store.count()).toBe(1);
	});

	it('does not run when the person denies it', async () => {
		const { base, lastResult } = await start([{ name: 'todo-clear', args: {} }]);
		await converse(base, async (event, turn) => {
			if (event.type === 'approval') await answer(base, { turn, ask: event.ask, approved: false });
		});

		expect(lastResult()).toMatchObject({ error: { code: 'APPROVAL_REQUIRED' } });
		expect(store.count()).toBe(2);
	});

	it('is a no when the page leaves before answering, and the turn closes', async () => {
		const { base } = await start([{ name: 'todo-clear', args: {} }]);
		const leave = new AbortController();
		await converse(
			base,
			(event) => {
				if (event.type === 'approval') leave.abort();
			},
			leave.signal
		);

		await expect.poll(() => running?.turns.size).toBe(0);
		expect(store.count()).toBe(2);
	});

	it('takes one answer only, and not as a view result', async () => {
		const { base } = await start([{ name: 'todo-clear', args: {} }]);
		await converse(base, async (event, turn) => {
			if (event.type !== 'approval') return;
			const wrongKind = await answer(base, { turn, ask: event.ask, result: { success: true } });
			expect(wrongKind.status).toBe(404);
			expect((await answer(base, { turn, ask: event.ask, approved: false })).status).toBe(200);
			expect((await answer(base, { turn, ask: event.ask, approved: true })).status).toBe(404);
		});
		expect(store.count()).toBe(2);
	});
});

describe("the page's view", () => {
	const filter = { status: 'pending', priority: 'high' };

	it("is set by the page, and the model reads the page's result", async () => {
		const { base, lastResult } = await start([
			{ name: 'view-state-set', args: { id: 'todo-filter', state: filter } },
		]);
		const events = await converse(base, async (event, turn) => {
			if (event.type === 'view') {
				expect(event).toMatchObject({
					command: 'view-state-set',
					input: { id: 'todo-filter', state: filter },
				});
				const result = { success: true, data: { id: 'todo-filter', state: filter } };
				await answer(base, { turn, ask: event.ask, result });
			}
		});

		expect(events.map((event) => event.type)).toEqual(['turn', 'call', 'view', 'result', 'done']);
		expect(lastResult()).toMatchObject({ success: true, data: { state: filter } });
	});

	it('fails the call, and withdraws the question, when the page does not answer in time', async () => {
		const { base, lastResult } = await start(
			[{ name: 'view-state-get', args: { id: 'todo-filter' } }],
			50
		);
		const events = await converse(base, () => {});

		expect(events.map((event) => event.type)).toContain('withdrawn');
		expect(lastResult()).toMatchObject({ error: { code: 'PAGE_DID_NOT_ANSWER' } });
	});
});
