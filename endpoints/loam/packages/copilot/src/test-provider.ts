/**
 * @fileoverview The test provider (phase 5 specification, Jobs and scenarios): `kind = "test"`, the only provider a
 * static deployment may name (4.2). It sits on the trusted side of the model port, where a real provider's endpoint
 * would be, and answers in Anthropic's Messages stream, so every model byte still crosses the port and TanStack's
 * own adapter reads it. A turn whose text begins `script:<name>` plays that script, one entry per model round; any
 * other text answers "No script" with no tool call. It imports nothing of TanStack, so a page can hold it.
 */

/** One model round of a script. */
export type ScriptRoundV1 =
	/** The model answers with text and ends the turn. */
	| { text: string | readonly string[] }
	/** The model calls these tools, and the next round reads their results. */
	| { tools: ReadonlyArray<{ name: string; input: Record<string, unknown> }> }
	/** The model holds its answer until the stream is cancelled: a turn that runs until it is stopped. */
	| { hang: true };

export type ModelScriptV1 = ReadonlyArray<ScriptRoundV1>;

export interface TestProviderOptionsV1 {
	scripts: Readonly<Record<string, ModelScriptV1>>;
	/** Between two chunks. Default 1 ms. */
	delayMs?: number;
}

export interface TestProviderV1 {
	/** The provider's answer to a request body: its status and its stream. */
	send(
		body: Record<string, unknown>,
		signal: AbortSignal
	): Promise<{ status: number; body: AsyncIterable<Uint8Array> }>;
	/** Every body it was sent, in order: what the model was given (P5-A7). */
	readonly bodies: ReadonlyArray<Record<string, unknown>>;
}

/** The text that names no script. */
export const NO_SCRIPT = 'No script';

type Message = { role?: string; content?: unknown };

const textOf = (content: unknown): string | undefined => {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return undefined;
	const parts = content.filter((part) => (part as { type?: string })?.type === 'text') as Array<{
		text?: string;
	}>;
	if (parts.length === 0) return undefined;
	return parts.map((part) => part.text ?? '').join('');
};

/** The person's text of this turn, and which model round this is: assistant messages since that text. */
function position(body: Record<string, unknown>): { text: string; round: number } {
	const messages = (Array.isArray(body.messages) ? body.messages : []) as Message[];
	let at = -1;
	let text = '';
	messages.forEach((message, index) => {
		if (message.role !== 'user') return;
		const found = textOf(message.content);
		if (found !== undefined) {
			at = index;
			text = found;
		}
	});
	const round = messages.slice(at + 1).filter((message) => message.role === 'assistant').length;
	return { text, round };
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

let messages = 0;

function rendered(round: ScriptRoundV1 | undefined, text?: string): string[] {
	const id = `msg_test_${++messages}`;
	const out = [
		sse('message_start', {
			type: 'message_start',
			message: {
				id,
				type: 'message',
				role: 'assistant',
				model: 'test',
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 10, output_tokens: 1 },
			},
		}),
	];
	const tools = round && 'tools' in round ? round.tools : undefined;
	if (tools) {
		tools.forEach((tool, index) => {
			out.push(
				sse('content_block_start', {
					type: 'content_block_start',
					index,
					content_block: {
						type: 'tool_use',
						id: `toolu_${id}_${index}`,
						name: tool.name,
						input: {},
					},
				}),
				sse('content_block_delta', {
					type: 'content_block_delta',
					index,
					delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) },
				}),
				sse('content_block_stop', { type: 'content_block_stop', index })
			);
		});
	} else {
		const pieces =
			text !== undefined
				? [text]
				: round && 'text' in round
					? typeof round.text === 'string'
						? [round.text]
						: [...round.text]
					: ['Done.'];
		out.push(
			sse('content_block_start', {
				type: 'content_block_start',
				index: 0,
				content_block: { type: 'text', text: '' },
			})
		);
		for (const piece of pieces)
			out.push(
				sse('content_block_delta', {
					type: 'content_block_delta',
					index: 0,
					delta: { type: 'text_delta', text: piece },
				})
			);
		out.push(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
	}
	out.push(
		sse('message_delta', {
			type: 'message_delta',
			delta: { stop_reason: tools ? 'tool_use' : 'end_turn', stop_sequence: null },
			usage: { output_tokens: 5 },
		}),
		sse('message_stop', { type: 'message_stop' })
	);
	return out;
}

const wait = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});

export function createTestProvider(options: TestProviderOptionsV1): TestProviderV1 {
	const bodies: Record<string, unknown>[] = [];
	const delay = options.delayMs ?? 1;
	return {
		bodies,
		async send(body, signal) {
			bodies.push(structuredClone(body));
			// The last 50 only: a page's transport keeps no unbounded copy of what the model was sent.
			if (bodies.length > 50) bodies.splice(0, bodies.length - 50);
			const { text, round } = position(body);
			const name = /^script:([a-z0-9-]{1,64})/.exec(text)?.[1];
			const script = name ? options.scripts[name] : undefined;
			const step = script?.[round];
			const encoder = new TextEncoder();
			async function* stream(): AsyncGenerator<Uint8Array> {
				if (step && 'hang' in step) {
					// The stream opens and then holds, so the turn runs until it is stopped.
					yield encoder.encode(rendered(undefined, '')[0] as string);
					await new Promise<void>((resolve) => {
						if (signal.aborted) return resolve();
						signal.addEventListener('abort', () => resolve(), { once: true });
					});
					return;
				}
				const chunks = script ? rendered(step) : rendered(undefined, NO_SCRIPT);
				for (const chunk of chunks) {
					if (signal.aborted) return;
					await wait(delay, signal);
					yield encoder.encode(chunk);
				}
			}
			return { status: 200, body: stream() };
		},
	};
}
