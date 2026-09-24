import { describe, expect, it } from 'vitest';
import { readSseEvents, SseEventTooLargeError, SseParser } from './sse-parser.js';

function readerOf(...parts: string[]): ReadableStreamDefaultReader<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const part of parts) controller.enqueue(encoder.encode(part));
			controller.close();
		},
	}).getReader();
}

async function collect(...parts: string[]) {
	const events = [];
	for await (const event of readSseEvents(readerOf(...parts))) events.push(event);
	return events;
}

describe('SseParser', () => {
	it('accepts data fields with and without a space after the colon', () => {
		const events = new SseParser().push('data:{"a":1}\n\ndata: {"b":2}\n\ndata:  two spaces\n\n');
		expect(events.map((event) => event.data)).toEqual(['{"a":1}', '{"b":2}', ' two spaces']);
	});

	it('joins multi-line data fields with a newline', () => {
		const events = new SseParser().push('data: {"text":\ndata: "hello"}\n\n');
		expect(events).toEqual([{ event: 'message', data: '{"text":\n"hello"}' }]);
		expect(JSON.parse(events[0]?.data ?? '')).toEqual({ text: 'hello' });
	});

	it('ignores comments, unknown fields and retry', () => {
		const events = new SseParser().push(': ping\nretry: 10\nfoo: bar\ndata: x\n: another\n\n');
		expect(events).toEqual([{ event: 'message', data: 'x' }]);
	});

	it('reads event names and remembers the last event id', () => {
		const parser = new SseParser();
		expect(parser.push('event: chunk\nid: 7\ndata: 1\n\n')).toEqual([
			{ event: 'chunk', data: '1', id: '7' },
		]);
		expect(parser.push('data: 2\n\n')).toEqual([{ event: 'message', data: '2', id: '7' }]);
	});

	it('does not dispatch an event without data', () => {
		expect(new SseParser().push('event: chunk\n\n: only a comment\n\n')).toEqual([]);
	});

	it('handles CRLF, CR and LF line endings, including CRLF split across chunks', () => {
		const parser = new SseParser();
		expect(parser.push('data: a\r\n\r\ndata: b\r\rdata: c\r')).toEqual([
			{ event: 'message', data: 'a' },
			{ event: 'message', data: 'b' },
		]);
		// The LF completes the CRLF from the previous chunk, it is not a blank line.
		expect(parser.push('\ndata: d\n\n')).toEqual([{ event: 'message', data: 'c\nd' }]);
	});

	it('keeps a partial line across chunks and ignores empty chunks', () => {
		const parser = new SseParser();
		expect(parser.push('da')).toEqual([]);
		expect(parser.push('')).toEqual([]);
		expect(parser.push('ta: split')).toEqual([]);
		expect(parser.push('\n\n')).toEqual([{ event: 'message', data: 'split' }]);
	});

	it('throws once one event exceeds the size bound', () => {
		const parser = new SseParser(10);
		expect(() => parser.push('data: 12345\ndata: 67890\n')).toThrow(SseEventTooLargeError);
		expect(() => new SseParser(10).push(`data: ${'x'.repeat(20)}`)).toThrow(
			'A server-sent event exceeded 10 characters'
		);
	});

	it('bounds a line that never ends without holding it all', () => {
		const parser = new SseParser(1000);
		expect(() => {
			for (let i = 0; i < 100; i++) parser.push('x'.repeat(50));
		}).toThrow(SseEventTooLargeError);
	});

	it('reads a long line delivered in small pieces in linear time', () => {
		const parser = new SseParser();
		const text = `data: ${'y'.repeat(900_000)}\n\n`;
		const events = [];
		const started = performance.now();
		// Re-scanning a growing buffer on every 64-character piece would take minutes.
		for (let offset = 0; offset < text.length; offset += 64) {
			events.push(...parser.push(text.slice(offset, offset + 64)));
		}
		expect(events).toHaveLength(1);
		expect(events[0]?.data).toHaveLength(900_000);
		expect(performance.now() - started).toBeLessThan(2000);
	});
});

describe('readSseEvents', () => {
	it('decodes multi-byte characters split across reads', async () => {
		const bytes = new TextEncoder().encode('data: héllo\n\n');
		const reader = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes.slice(0, 8));
				controller.enqueue(bytes.slice(8));
				controller.close();
			},
		}).getReader();
		const events = [];
		for await (const event of readSseEvents(reader)) events.push(event.data);
		expect(events).toEqual(['héllo']);
	});

	it('discards an event the stream ends before its blank line', async () => {
		expect(await collect('data: one\n\n', 'data: two\n')).toEqual([
			{ event: 'message', data: 'one' },
		]);
	});
});
