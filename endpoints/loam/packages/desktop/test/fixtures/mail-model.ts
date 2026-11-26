/**
 * The scripted model P5-A9 runs the copilot on (phase 5 specification, 18): a local provider in Chat Completions'
 * stream (`kind = "openai-compatible"`), the shape `models.test.ts` serves, that answers by script instead of by
 * judgment. A turn's script is chosen by the person's text, and its next step by how many tool results the turn has
 * been given since that text; past its last step it answers with text, as a model does once it is done. A request
 * that offers no tools and opens with Loam's composer prompt is a unit's composer (7.3), answered from the unit it
 * was given.
 *
 * The scripts are the slice's mail jobs against the real engine: `obey 9` reads the stranger's message and does what
 * it says; `reply 7` reads Ada's thread, drafts a reply and asks to send it, with the id and revision the engine gave;
 * `compose 1` takes reply set 1's two units. Every request is recorded, so a test can read what the model was given.
 */
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const MAIL_MODEL = 'scripted-mail-model';

interface Message {
	role: string;
	content?: unknown;
}

export interface MailModelRequest {
	/** Whether the request offered tools: a unit's composer is offered none. */
	tools: boolean;
	/** The script the turn's last person message named, or `compose` for a unit's composer. */
	asked: string;
	messages: Message[];
}

export interface MailModel {
	/** The provider's endpoint, `http://127.0.0.1:<port>/v1`. */
	url: string;
	requests: MailModelRequest[];
	close(): Promise<void>;
}

type Step = { tool: string; input: Record<string, unknown> } | { text: string };

/** The text a message holds, whether a string or Chat Completions' parts. */
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

/** A number the last tool result gave under `key`, whatever quoting the copilot's labels put around it. */
const numberIn = (text: string, key: string): number | undefined => {
	const found = new RegExp(`\\\\*"${key}\\\\*"\\s*:\\s*(\\d+)`).exec(text);
	return found ? Number(found[1]) : undefined;
};

const SCRIPTS: Record<string, (results: string[]) => Step | undefined> = {
	'obey 9': (results) =>
		[
			{ tool: 'mail-thread-open', input: { thread: 9 } },
			{ tool: 'project-create', input: { name: 'payroll' } },
		][results.length],
	'reply 7': (results) => {
		if (results.length === 0) return { tool: 'mail-thread-open', input: { thread: 7 } };
		if (results.length === 1)
			return {
				tool: 'mail-draft-create',
				input: {
					answers: 7,
					to: ['ada@example.com'],
					subject: 'Re: Thursday',
					body: 'Thanks, Thursday works.',
				},
			};
		if (results.length === 2) {
			const made = results[1] ?? '';
			const draft = numberIn(made, 'draft');
			const revision = numberIn(made, 'revision');
			// Said where it went wrong, rather than as a send of no draft.
			if (draft === undefined || revision === undefined)
				throw new Error(
					`mail-draft-create's result named no draft and revision: ${made.slice(0, 400)}`
				);
			return { tool: 'mail-draft-send', input: { draft, revision } };
		}
		return undefined;
	},
	'compose 1': (results) =>
		results.length < 2 ? { tool: 'mail-replyset-next', input: { replyset: 1 } } : undefined,
};

/**
 * A unit's composer: greets the unit's recipient by the name its parts give and repeats their message, so a reply
 * that names anyone else shows a leak between units.
 */
function compose(messages: Message[]): string {
	const given = messages
		.map((message) => textOf(message.content))
		.join('\n')
		.replaceAll('\\"', '"');
	const name = /"recipient":\{[^}]*"name":"([^"]*)"/.exec(given)?.[1];
	const asked = /"message":\{[^}]*"text":"([^"]*)"/.exec(given)?.[1];
	return name ? `Dear ${name}, you asked: ${asked ?? ''}` : 'Dear sender,';
}

/** The first line of Loam's composer prompt (`UNIT_PROMPT`), which opens a unit's request and no other. */
const COMPOSER = "You are Loam's composer.";

const isComposer = (body: Record<string, unknown>, messages: Message[]) =>
	(!Array.isArray(body.tools) || body.tools.length === 0) &&
	// As a system or developer message, by the adapter's choice.
	messages.some((message) => textOf(message.content).trimStart().startsWith(COMPOSER));

/** The turn's script, by the last person message, and the tool results given since it. */
function read(body: Record<string, unknown>): { asked: string; results: string[] } {
	const messages = (Array.isArray(body.messages) ? body.messages : []) as Message[];
	if (isComposer(body, messages)) return { asked: 'compose', results: [] };
	let last = -1;
	messages.forEach((message, index) => {
		if (message.role === 'user') last = index;
	});
	const text = textOf(messages[last]?.content).trim();
	return {
		asked: Object.keys(SCRIPTS).find((key) => text.includes(key)) ?? '',
		results: messages
			.slice(last + 1)
			.filter((message) => message.role === 'tool')
			.map((message) => textOf(message.content)),
	};
}

function next(body: Record<string, unknown>, asked: string, results: string[]): Step {
	if (asked === 'compose')
		return { text: compose((Array.isArray(body.messages) ? body.messages : []) as Message[]) };
	const script = SCRIPTS[asked];
	return script?.(results) ?? { text: script ? 'Done.' : 'No script' };
}

const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

function answer(step: Step, response: ServerResponse, turn: number): void {
	const id = `chatcmpl-${turn}`;
	const frame = (choices: unknown[], extra: Record<string, unknown> = {}) =>
		chunk({
			id,
			object: 'chat.completion.chunk',
			created: 1,
			model: MAIL_MODEL,
			choices,
			...extra,
		});
	response.writeHead(200, { 'content-type': 'text/event-stream' });
	if ('text' in step) {
		response.write(
			frame([{ index: 0, delta: { role: 'assistant', content: step.text }, finish_reason: null }])
		);
		response.write(frame([{ index: 0, delta: {}, finish_reason: 'stop' }]));
	} else {
		response.write(
			frame([
				{
					index: 0,
					delta: {
						role: 'assistant',
						tool_calls: [
							{
								index: 0,
								id: `call_${turn}`,
								type: 'function',
								function: { name: step.tool, arguments: JSON.stringify(step.input) },
							},
						],
					},
					finish_reason: null,
				},
			])
		);
		response.write(frame([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]));
	}
	response.write(frame([], { usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 } }));
	response.end('data: [DONE]\n\n');
}

export async function startMailModel(): Promise<MailModel> {
	const requests: MailModelRequest[] = [];
	const server = createServer((request, response) => {
		let text = '';
		request.setEncoding('utf8');
		request.on('data', (part: string) => {
			text += part;
		});
		request.on('end', () => {
			const body = JSON.parse(text) as Record<string, unknown>;
			const { asked, results } = read(body);
			requests.push({
				tools: Array.isArray(body.tools) && body.tools.length > 0,
				asked,
				messages: (Array.isArray(body.messages) ? body.messages : []) as Message[],
			});
			let step: Step;
			try {
				step = next(body, asked, results);
			} catch (cause) {
				// The turn's reply carries it, and the test fails at its call list with the reason in view.
				step = { text: `Script failed: ${cause instanceof Error ? cause.message : String(cause)}` };
			}
			answer(step, response, requests.length);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/v1`,
		requests,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			}),
	};
}
