/**
 * The scenarios' model on the desktop (phase 5 specification, P5-A1): a local provider in Chat Completions' stream
 * (`kind = "openai-compatible"`), which the Rust host reaches through `model_send` as it reaches any local model, that
 * plays the kernel's scenario scripts (`kernel/scenarios/model-scripts.ts`) with the copilot's own test provider, so a
 * file's model makes the same choices here as in the kernel's units and in Chromium.
 *
 * The test provider reads Anthropic's Messages shape and answers in its stream. Each request is read into that shape
 * for it (the system and developer messages as `system`; a person's and Loam's messages as user text; an assistant
 * message as a round; a tool's result as a user message with no text, as Anthropic carries one), and its stream is
 * written back as Chat Completions chunks: its text as one delta, its tool uses as tool calls. A held round (`hang`)
 * holds the response open until the Rust host drops the request, as a stop does. Nothing of a request is logged.
 */
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createScenarioProvider } from '../../../kernel/scenarios/model-scripts.ts';

export const SCENARIO_MODEL = 'scripted-scenarios';

interface Message {
	role?: string;
	content?: unknown;
}

const textOf = (content: unknown): string => {
	if (typeof content === 'string') return content;
	if (Array.isArray(content))
		return content
			.map((part) =>
				typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : ''
			)
			.join('');
	return '';
};

/** A Chat Completions body in the shape the test provider reads (the file's header). */
export function anthropicShape(body: Record<string, unknown>): Record<string, unknown> {
	const messages = (Array.isArray(body.messages) ? body.messages : []) as Message[];
	const system = messages
		.filter((message) => message.role === 'system' || message.role === 'developer')
		.map((message) => textOf(message.content))
		.join('\n');
	return {
		...(system ? { system } : {}),
		messages: messages
			.filter((message) => message.role !== 'system' && message.role !== 'developer')
			.map((message) =>
				message.role === 'tool'
					? { role: 'user', content: [{ type: 'tool_result', content: textOf(message.content) }] }
					: { role: message.role, content: textOf(message.content) }
			),
	};
}

interface Round {
	text: string;
	tools: Array<{ id: string; name: string; input: string }>;
}

/** The test provider's Messages stream, read into what one round said. */
function roundOf(stream: string): Round {
	const round: Round = { text: '', tools: [] };
	for (const event of stream.split('\n\n')) {
		const data = /^data: (.*)$/m.exec(event)?.[1];
		if (!data) continue;
		const parsed = JSON.parse(data) as {
			type?: string;
			index?: number;
			content_block?: { type?: string; id?: string; name?: string };
			delta?: { type?: string; text?: string; partial_json?: string };
		};
		if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use')
			round.tools[parsed.index ?? 0] = {
				id: parsed.content_block.id ?? '',
				name: parsed.content_block.name ?? '',
				input: '',
			};
		if (parsed.type === 'content_block_delta') {
			if (parsed.delta?.type === 'text_delta') round.text += parsed.delta.text ?? '';
			if (parsed.delta?.type === 'input_json_delta') {
				const tool = round.tools[parsed.index ?? 0];
				if (tool) tool.input += parsed.delta.partial_json ?? '';
			}
		}
	}
	return round;
}

const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

function answer(round: Round, response: ServerResponse, turn: number): void {
	const frame = (choices: unknown[], extra: Record<string, unknown> = {}) =>
		chunk({
			id: `chatcmpl-${turn}`,
			object: 'chat.completion.chunk',
			created: 1,
			model: SCENARIO_MODEL,
			choices,
			...extra,
		});
	const tools = round.tools.filter(Boolean);
	if (tools.length > 0) {
		response.write(
			frame([
				{
					index: 0,
					delta: {
						role: 'assistant',
						tool_calls: tools.map((tool, index) => ({
							index,
							id: tool.id,
							type: 'function',
							function: { name: tool.name, arguments: tool.input || '{}' },
						})),
					},
					finish_reason: null,
				},
			])
		);
		response.write(frame([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]));
	} else {
		response.write(
			frame([{ index: 0, delta: { role: 'assistant', content: round.text }, finish_reason: null }])
		);
		response.write(frame([{ index: 0, delta: {}, finish_reason: 'stop' }]));
	}
	response.write(frame([], { usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 } }));
	response.end('data: [DONE]\n\n');
}

export interface ScenarioModelEvent {
	turn: number;
	messages: number;
	outcome: 'tools' | 'text' | 'aborted' | 'error';
	tools?: string[];
	durationMs: number;
}

export interface ScenarioModel {
	/** The provider's endpoint, `http://127.0.0.1:<port>/v1`. */
	url: string;
	/** How many requests it answered or held. */
	readonly requests: number;
	/** Structural metadata for each request (no message content), for failure diagnostics (#2811). */
	readonly trace: readonly ScenarioModelEvent[];
	close(): Promise<void>;
}

export async function startScenarioModel(): Promise<ScenarioModel> {
	const provider = createScenarioProvider();
	let requests = 0;
	const trace: ScenarioModelEvent[] = [];
	const server = createServer((request, response) => {
		let text = '';
		request.setEncoding('utf8');
		request.on('data', (part: string) => {
			text += part;
		});
		request.on('end', async () => {
			requests += 1;
			const turn = requests;
			const began = Date.now();
			const stop = new AbortController();
			// The Rust host drops the request on a stop (`model_cancel`): the held round ends with it.
			response.on('close', () => stop.abort());
			response.writeHead(200, { 'content-type': 'text/event-stream' });
			let messages = 0;
			try {
				const body = JSON.parse(text) as Record<string, unknown>;
				messages = Array.isArray(body.messages) ? body.messages.length : 0;
				const answered = await provider.send(anthropicShape(body), stop.signal);
				let stream = '';
				const decoder = new TextDecoder();
				for await (const part of answered.body) stream += decoder.decode(part, { stream: true });
				if (stop.signal.aborted) {
					trace.push({ turn, messages, outcome: 'aborted', durationMs: Date.now() - began });
					return;
				}
				const round = roundOf(stream);
				const tools = round.tools.filter(Boolean).map((tool) => tool.name);
				trace.push({
					turn,
					messages,
					outcome: tools.length > 0 ? 'tools' : 'text',
					...(tools.length > 0 ? { tools } : {}),
					durationMs: Date.now() - began,
				});
				answer(round, response, turn);
			} catch (cause) {
				trace.push({ turn, messages, outcome: 'error', durationMs: Date.now() - began });
				// The turn's reply carries it, so a test fails with the reason in view.
				if (!response.writableEnded)
					answer(
						{
							text: `Script failed: ${cause instanceof Error ? cause.message : String(cause)}`,
							tools: [],
						},
						response,
						turn
					);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/v1`,
		get requests() {
			return requests;
		},
		get trace() {
			return trace;
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			}),
	};
}
