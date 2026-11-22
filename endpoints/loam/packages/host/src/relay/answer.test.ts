import { describe, expect, it } from 'vitest';
import { mediaTypeOf, type ReadAnswer, readAnswer, StreamCut } from './answer.js';

const MAX = 64 * 1024;
const answer = (body: ConstructorParameters<typeof Response>[0], init: ResponseInit) =>
	readAnswer(new Response(body, init), { id: 7, max: MAX });
const json = (value: unknown, status = 200, type = 'application/json') =>
	answer(JSON.stringify(value), { status, headers: { 'content-type': type } });

async function events(read: ReadAnswer): Promise<string[]> {
	if (read.kind !== 'stream') throw new Error(`not a stream: ${read.kind}`);
	const texts: string[] = [];
	for await (const event of read.events) texts.push(event.text);
	return texts;
}

const sse = (text: string) =>
	answer(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });

describe("P6-E5: the answer's allow-list (8.1 step 15)", () => {
	it('P6-E5: by status: a `3xx` is invalid, an empty `2xx` passes with no body, another status with at most one JSON-RPC error', async () => {
		expect(await answer(null, { status: 302, headers: { location: '/x' } })).toEqual({
			kind: 'invalid',
		});
		expect(await answer(null, { status: 202 })).toEqual({ kind: 'empty', status: 202 });
		expect(await answer('', { status: 200 })).toEqual({ kind: 'empty', status: 200 });
		expect(await answer(null, { status: 204 })).toEqual({ kind: 'empty', status: 204 });
		const error = await json(
			{ jsonrpc: '2.0', id: 7, error: { code: -32601, message: 'no', data: 1, extra: 2 } },
			400
		);
		expect(error).toMatchObject({ kind: 'body', status: 400 });
		expect(JSON.parse((error as { text: string }).text)).toEqual({
			jsonrpc: '2.0',
			id: 7,
			error: { code: -32601, message: 'no', data: 1 },
		});
		expect(
			await json({ jsonrpc: '2.0', id: null, error: { code: 1, message: 'x' } }, 404)
		).toMatchObject({
			kind: 'body',
			status: 404,
		});
		// Any other body is replaced by none: a refusal's words, another request's error, HTML.
		for (const body of [
			{ code: 'UNAUTHORIZED', message: 'Sign in' },
			{ jsonrpc: '2.0', id: 8, error: { code: 1, message: 'x' } },
			{ jsonrpc: '2.0', id: 7, result: {} },
		])
			expect(await json(body, 401)).toEqual({ kind: 'body', status: 401 });
		expect(
			await answer('<html>', { status: 500, headers: { 'content-type': 'text/html' } })
		).toEqual({
			kind: 'body',
			status: 500,
		});
	});

	it("P6-E5: a `200` with a body: only `application/json` or `text/event-stream`, a `charset` other than `utf-8` refused, one response with the request's `id`", async () => {
		expect(await json({ jsonrpc: '2.0', id: 7, result: { ok: 1 } })).toMatchObject({
			kind: 'body',
			status: 200,
		});
		expect(
			await json({ jsonrpc: '2.0', id: 7, result: {} }, 200, 'application/json; charset="UTF-8"')
		).toMatchObject({
			kind: 'body',
		});
		expect(
			await json({ jsonrpc: '2.0', id: 7, result: {} }, 200, 'application/json; charset=latin1')
		).toEqual({
			kind: 'invalid',
		});
		expect(await json({ jsonrpc: '2.0', id: 7, result: {} }, 200, 'text/html')).toEqual({
			kind: 'invalid',
		});
		expect(await json({ jsonrpc: '2.0', id: 8, result: {} })).toEqual({ kind: 'invalid' });
		expect(
			await json([
				{ jsonrpc: '2.0', id: 7, result: {} },
				{ jsonrpc: '2.0', id: 7, result: {} },
			])
		).toEqual({ kind: 'invalid' });
		expect(
			await json({ jsonrpc: '2.0', id: 7, result: {}, error: { code: 1, message: 'x' } })
		).toEqual({
			kind: 'invalid',
		});
		expect(await json({ jsonrpc: '2.0', id: 7, method: 'x', result: {} })).toEqual({
			kind: 'invalid',
		});
		expect(mediaTypeOf('Text/Event-Stream; charset=utf-8')).toBe('text/event-stream');
	});

	it('P6-E5: a byte-order mark is dropped, and the body re-serialized with only the fields of a response', async () => {
		const read = await answer(
			`﻿${JSON.stringify({ jsonrpc: '2.0', id: 7, result: { a: 1 }, extra: true })}`,
			{
				status: 200,
				headers: { 'content-type': 'application/json' },
			}
		);
		expect(JSON.parse((read as { text: string }).text)).toEqual({
			jsonrpc: '2.0',
			id: 7,
			result: { a: 1 },
		});
	});

	it('P6-E5: a JSON body past `relay_response_bytes` is invalid, read no further', async () => {
		const big = JSON.stringify({ jsonrpc: '2.0', id: 7, result: 'x'.repeat(MAX) });
		expect(
			await answer(big, { status: 200, headers: { 'content-type': 'application/json' } })
		).toEqual({
			kind: 'invalid',
		});
	});

	it('P6-E5: a stream: multi-line `data:` joined, `id:`, the reconnection field, comments and a non-`message` event dropped, server requests and arrays dropped, ended after its one response', async () => {
		const read = await sse(
			[
				': a comment',
				// The reconnection-time field, written so no line reads as Vitest's option of that name.
				['re', 'try: 10'].join(''),
				'id: 4',
				'data: {"jsonrpc":"2.0",',
				'data: "method":"notifications/progress","params":{"p":1}}',
				'',
				'event: other',
				'data: {"jsonrpc":"2.0","method":"notifications/x"}',
				'',
				'data: {"jsonrpc":"2.0","id":99,"method":"sampling/createMessage","params":{}}',
				'',
				'data: [{"jsonrpc":"2.0","method":"x"}]',
				'',
				'data: not json',
				'',
				'event: message',
				'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true},"extra":1}',
				'',
				'data: {"jsonrpc":"2.0","method":"notifications/after"}',
				'',
			].join('\r\n')
		);
		expect(await events(read)).toEqual([
			'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"p":1}}\n\n',
			'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n',
		]);
	});

	it('P6-E5: a response with another `id` cuts the stream; so does a stream past `relay_response_bytes`', async () => {
		const other = await sse(
			'data: {"jsonrpc":"2.0","method":"n"}\n\ndata: {"jsonrpc":"2.0","id":8,"result":{}}\n\n'
		);
		const texts: string[] = [];
		await expect(
			(async () => {
				for await (const event of (other as { events: AsyncGenerator<{ text: string }> }).events)
					texts.push(event.text);
			})()
		).rejects.toBeInstanceOf(StreamCut);
		expect(texts).toHaveLength(1);
		const endless = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new TextEncoder().encode('data: {"jsonrpc":"2.0","method":"n"}\n\n'));
			},
		});
		const big = await answer(endless, {
			status: 200,
			headers: { 'content-type': 'text/event-stream' },
		});
		await expect(events(big)).rejects.toMatchObject({ reason: 'size' });
	});

	it('P6-E5: an event the stream ends before its blank line is never dispatched, so a cut response is not complete', async () => {
		for (const text of [
			'data: {"jsonrpc":"2.0","id":7,"result":{}}\n',
			'data: {"jsonrpc":"2.0","id":7,"result":{}}',
		])
			expect(await events(await sse(text))).toEqual([]);
	});

	it("P6-E5: a stream's lines split across chunks, and a `\\r\\n` split between two, read as one", async () => {
		const parts = ['data: {"jsonrpc":"2.0",', '"id":7,"result":{}}\r', '\n\r\n'];
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
				controller.close();
			},
		});
		const read = await answer(body, {
			status: 200,
			headers: { 'content-type': 'text/event-stream' },
		});
		expect(await events(read)).toEqual(['data: {"jsonrpc":"2.0","id":7,"result":{}}\n\n']);
	});
});
