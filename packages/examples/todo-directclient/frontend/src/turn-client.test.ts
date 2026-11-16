/** @fileoverview The page's side of a turn: reading the stream and answering view calls. */

import { describe, expect, it } from 'vitest';
import { jsonLines, runTurn, type TurnEvent } from './turn-client';

/** A stream that delivers `text` in the given chunk sizes, so lines split across chunks. */
function stream(text: string, size = 7): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(text);
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.length) return controller.close();
			controller.enqueue(bytes.slice(offset, offset + size));
			offset += size;
		},
	});
}

const ndjson = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join('\n');

describe('jsonLines', () => {
	it('reads each line, however the bytes arrive, including a last line without a newline', async () => {
		const read: unknown[] = [];
		for await (const value of jsonLines(stream('{"a":1}\n\n{"b":"é"}\n{"c":3}', 3)))
			read.push(value);
		expect(read).toEqual([{ a: 1 }, { b: 'é' }, { c: 3 }]);
	});
});

describe('runTurn', () => {
	it("runs a view call in the page and sends the page's result back", async () => {
		const answers: unknown[] = [];
		const fetchStub = (async (url: string, init?: RequestInit) => {
			if (url.endsWith('/chat/answer')) {
				answers.push(JSON.parse(String(init?.body)));
				return new Response('{"accepted":true}');
			}
			return new Response(
				stream(
					ndjson(
						{ type: 'turn', turn: 't-1' },
						{ type: 'view', ask: 1, command: 'view-state-get', input: { id: 'todo-filter' } },
						{ type: 'done', message: 'Shown', mode: 'look', toolExecutions: [] }
					)
				)
			);
		}) as typeof fetch;
		const events: TurnEvent[] = [];
		const end = await runTurn({
			baseUrl: 'http://page',
			message: 'What am I seeing?',
			mode: 'look',
			fetch: fetchStub,
			onEvent: (event) => events.push(event),
			runView: async (command, input) => ({ success: true, data: { command, input } }),
		});

		expect(end).toMatchObject({ type: 'done', message: 'Shown' });
		expect(events.map((event) => event.type)).toEqual(['turn', 'view', 'done']);
		expect(answers).toEqual([
			{
				turn: 't-1',
				ask: 1,
				result: {
					success: true,
					data: { command: 'view-state-get', input: { id: 'todo-filter' } },
				},
			},
		]);
	});

	it('ends with the refusal when the server turns the message down', async () => {
		const fetchStub = (async () =>
			new Response(
				JSON.stringify({ error: 'Invalid mode', suggestion: 'Use one of: change, look' }),
				{
					status: 400,
				}
			)) as typeof fetch;
		const end = await runTurn({
			baseUrl: 'http://page',
			message: 'hi',
			mode: 'change',
			fetch: fetchStub,
			onEvent: () => {},
			runView: async () => ({ success: true }),
		});
		expect(end).toEqual({ type: 'error', error: 'Invalid mode. Use one of: change, look' });
	});

	it('ends with an error when the stream stops before the answer', async () => {
		const fetchStub = (async () =>
			new Response(stream(ndjson({ type: 'turn', turn: 't-2' })))) as typeof fetch;
		const end = await runTurn({
			baseUrl: 'http://page',
			message: 'hi',
			mode: 'change',
			fetch: fetchStub,
			onEvent: () => {},
			runView: async () => ({ success: true }),
		});
		expect(end.type).toBe('error');
	});
});
