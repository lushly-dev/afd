/**
 * @fileoverview The ports' runtime halves (phase 5 specification, 3.2 and 4.2). Every message they send is one the
 * kernel's half defines; anything else is refused there. The model port's `fetch` keeps only a request's body:
 * its URL and headers, the placeholder key among them, never leave the runtime, and the trusted host builds the
 * request.
 */

import type {
	AgentPortV1,
	CommandResultLike,
	CopilotProviderV1,
	ModelPortV1,
	PortLike,
	ToolDescriptorV1,
} from './types.js';

/** The agent port's runtime half: `call`, `listCommands` and `confirmation`, each answered by id. */
export class AgentPort implements AgentPortV1 {
	#next = 1;
	readonly #pending = new Map<number, (result: unknown) => void>();

	constructor(private readonly port: PortLike) {
		port.onmessage = ({ data }) => {
			const { id, result } = (data ?? {}) as { id?: number; result?: unknown };
			if (typeof id !== 'number') return;
			this.#pending.get(id)?.(result);
			this.#pending.delete(id);
		};
	}

	#ask(message: Record<string, unknown>): Promise<unknown> {
		const id = this.#next++;
		return new Promise((resolve) => {
			this.#pending.set(id, resolve);
			this.port.postMessage({ id, ...message });
		});
	}

	call(name: string, input: unknown): Promise<CommandResultLike> {
		return this.#ask({ key: 'call', name, input: input ?? {} }) as Promise<CommandResultLike>;
	}

	async listCommands(): Promise<ToolDescriptorV1[]> {
		const listed = await this.#ask({ key: 'listCommands' });
		return Array.isArray(listed) ? (listed as ToolDescriptorV1[]) : [];
	}

	confirmation(notification: string): Promise<CommandResultLike> {
		return this.#ask({ key: 'confirmation', notification }) as Promise<CommandResultLike>;
	}

	unit(unit: string, text: string): Promise<CommandResultLike> {
		return this.#ask({ key: 'unit', unit, text }) as Promise<CommandResultLike>;
	}

	/** Any message, for the tests that check the kernel's half refuses it. */
	raw(message: Record<string, unknown>): Promise<unknown> {
		return this.#ask(message);
	}
}

interface Sink {
	controller: ReadableStreamDefaultController<Uint8Array>;
}

interface OpenedStream {
	stream: string;
	readable: ReadableStream<Uint8Array>;
}

interface Answer {
	resolve(opened: OpenedStream): void;
	reject(error: Error): void;
}

/** The model port's runtime half: `send({ provider, body })` gives a stream id, and its chunks arrive by id. */
export class ModelPort implements ModelPortV1 {
	#next = 1;
	readonly #answers = new Map<number, Answer>();
	readonly #streams = new Map<string, Sink>();
	readonly #status = new Map<string, (status: number) => void>();

	constructor(private readonly port: PortLike) {
		port.onmessage = ({ data }) => {
			const message = (data ?? {}) as {
				id?: number;
				key?: string;
				stream?: string;
				chunk?: Uint8Array;
				status?: number;
				code?: string;
				error?: { code?: string; message?: string };
			};
			if (typeof message.id === 'number') {
				const answer = this.#answers.get(message.id);
				this.#answers.delete(message.id);
				if (!answer) return;
				if (message.error || typeof message.stream !== 'string') {
					const error = new Error(message.error?.message ?? 'The model port refused the request');
					(error as Error & { code?: string }).code = message.error?.code ?? 'COPILOT_PORT_REFUSED';
					answer.reject(error);
				} else {
					const stream = message.stream;
					// Register the sink before resolving so chunks or `done` delivered before the next microtask
					// are buffered in the stream rather than dropped (#2811).
					const readable = new ReadableStream<Uint8Array>({
						start: (controller) => {
							this.#streams.set(stream, { controller });
						},
						cancel: () => {
							this.port.postMessage({ key: 'cancel', stream });
							this.#streams.delete(stream);
						},
					});
					answer.resolve({ stream, readable });
				}
				return;
			}
			const sink = message.stream ? this.#streams.get(message.stream) : undefined;
			if (!sink || !message.stream) return;
			if (message.key === 'chunk' && message.chunk) sink.controller.enqueue(message.chunk);
			if (message.key === 'done') {
				this.#streams.delete(message.stream);
				this.#status.get(message.stream)?.(message.status ?? 200);
				this.#status.delete(message.stream);
				if ((message.status ?? 200) >= 400) {
					const code = message.code ?? 'MODEL_REFUSED';
					sink.controller.enqueue(
						new TextEncoder().encode(
							`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: code, message: code } })}\n\n`
						)
					);
				}
				sink.controller.close();
			}
		};
	}

	fetchFor(provider: CopilotProviderV1, options: { unit?: string } = {}): typeof fetch {
		return async (input, init) => {
			const request = new Request(input as RequestInfo, init);
			const body = JSON.parse(await request.text()) as Record<string, unknown>;
			const id = this.#next++;
			const { stream, readable } = await new Promise<OpenedStream>((resolve, reject) => {
				this.#answers.set(id, { resolve, reject });
				this.port.postMessage({
					id,
					key: 'send',
					provider: provider.id,
					body,
					...(options.unit !== undefined ? { unit: options.unit } : {}),
				});
			});
			const abort = () => {
				const sink = this.#streams.get(stream);
				if (!sink) return;
				this.port.postMessage({ key: 'cancel', stream });
				this.#streams.delete(stream);
				try {
					sink.controller.error(new DOMException('Aborted', 'AbortError'));
				} catch {}
			};
			const signal = init?.signal ?? undefined;
			if (signal?.aborted) abort();
			else signal?.addEventListener('abort', abort, { once: true });
			// The answer's status is the provider's, known before its first chunk only to the trusted host; a stream
			// that ends in an error carries an `error` event, which the provider adapter reads as a failure.
			return new Response(readable, {
				status: 200,
				headers: { 'content-type': 'text/event-stream' },
			});
		};
	}
}
