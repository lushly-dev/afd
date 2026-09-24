/**
 * @fileoverview Server-Sent Events parser shared by `McpClient.stream()` and the SSE handoff handler.
 *
 * Follows the WHATWG event-stream format: lines end in CRLF, LF or CR; a line starting with `:`
 * is a comment; `field:value` drops one leading space from the value (`data:x` and `data: x` are
 * the same); several `data` lines join with `\n`; a blank line dispatches the event. An event that
 * the stream ends before its blank line is discarded, as the spec requires.
 *
 * Input is scanned once, so the cost is linear in the stream size, and one event (its data lines
 * plus the line being read) is bounded by `maxEventSize` characters.
 */

/** Default bound for one event: 1 MiB of characters. */
export const DEFAULT_MAX_SSE_EVENT_SIZE = 1024 * 1024;

/** One dispatched server-sent event. */
export interface SseEvent {
	/** The `event` field, or `'message'` when the event had none. */
	event: string;
	/** The `data` lines joined with `\n`. */
	data: string;
	/** The last `id` field seen on the stream, if any. */
	id?: string;
}

/** Thrown when one event grows beyond the parser's `maxEventSize`. */
export class SseEventTooLargeError extends Error {
	constructor(readonly limit: number) {
		super(`A server-sent event exceeded ${limit} characters`);
		this.name = 'SseEventTooLargeError';
	}
}

const LF = 10;
const CR = 13;

/**
 * Incremental event-stream parser. Feed decoded text with `feed()` (or `push()`); it yields the
 * events that text completed.
 */
export class SseParser {
	private lineParts: string[] = [];
	private lineLength = 0;
	private dataLines: string[] = [];
	private dataLength = 0;
	private eventType = '';
	private lastEventId: string | undefined;
	/** The previous chunk ended in CR, so a leading LF in the next chunk belongs to it. */
	private pendingCr = false;

	constructor(private readonly maxEventSize = DEFAULT_MAX_SSE_EVENT_SIZE) {}

	/**
	 * Parse the next piece of the stream, returning the events it completed.
	 *
	 * @throws SseEventTooLargeError when the current event exceeds `maxEventSize`
	 */
	push(text: string): SseEvent[] {
		return [...this.feed(text)];
	}

	/**
	 * Parse the next piece of the stream, yielding each event as soon as it is complete, so the
	 * events before an oversized one are delivered before the error.
	 *
	 * @throws SseEventTooLargeError when the current event exceeds `maxEventSize`
	 */
	*feed(text: string): Generator<SseEvent, void, unknown> {
		if (text.length === 0) return;
		let start = 0;
		if (this.pendingCr && text.charCodeAt(0) === LF) start = 1;
		this.pendingCr = false;

		for (let index = start; index < text.length; index++) {
			const code = text.charCodeAt(index);
			if (code !== LF && code !== CR) continue;
			this.appendToLine(text.slice(start, index));
			const event = this.processLine(this.takeLine());
			if (event) yield event;
			if (code === CR) {
				if (index + 1 >= text.length) this.pendingCr = true;
				else if (text.charCodeAt(index + 1) === LF) index++;
			}
			start = index + 1;
		}
		if (start < text.length) this.appendToLine(text.slice(start));
	}

	private appendToLine(part: string): void {
		if (part.length === 0) return;
		this.lineLength += part.length;
		if (this.lineLength + this.dataLength > this.maxEventSize) {
			throw new SseEventTooLargeError(this.maxEventSize);
		}
		this.lineParts.push(part);
	}

	private takeLine(): string {
		const line = this.lineParts.length === 1 ? (this.lineParts[0] ?? '') : this.lineParts.join('');
		this.lineParts = [];
		this.lineLength = 0;
		return line;
	}

	/** Apply one line; a blank line returns the event it completes, if any. */
	private processLine(line: string): SseEvent | undefined {
		if (line.length === 0) return this.dispatch();
		if (line.charCodeAt(0) === 58 /* ':' */) return undefined; // comment

		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? '' : line.slice(colon + 1);
		if (value.charCodeAt(0) === 32 /* ' ' */) value = value.slice(1);

		switch (field) {
			case 'data':
				this.dataLines.push(value);
				this.dataLength += value.length + 1;
				break;
			case 'event':
				this.eventType = value;
				break;
			case 'id':
				if (!value.includes('\0')) this.lastEventId = value;
				break;
			default:
				// `retry` and unknown fields do not affect the parsed events.
				break;
		}
		return undefined;
	}

	private dispatch(): SseEvent | undefined {
		const event: SseEvent | undefined =
			this.dataLines.length > 0
				? {
						event: this.eventType || 'message',
						data: this.dataLines.join('\n'),
						...(this.lastEventId !== undefined ? { id: this.lastEventId } : {}),
					}
				: undefined;
		this.dataLines = [];
		this.dataLength = 0;
		this.eventType = '';
		return event;
	}
}

/**
 * Read a byte stream as server-sent events.
 *
 * @param reader - Reader of the response body
 * @param maxEventSize - Bound for one event in characters
 * @throws SseEventTooLargeError when an event exceeds `maxEventSize`
 */
export async function* readSseEvents(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	maxEventSize = DEFAULT_MAX_SSE_EVENT_SIZE
): AsyncGenerator<SseEvent, void, unknown> {
	const decoder = new TextDecoder();
	const parser = new SseParser(maxEventSize);
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		yield* parser.feed(decoder.decode(value, { stream: true }));
	}
	// Anything after the last blank line is an incomplete event, which the spec discards.
	yield* parser.feed(decoder.decode());
}
