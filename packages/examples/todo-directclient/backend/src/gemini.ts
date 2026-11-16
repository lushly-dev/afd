/**
 * @fileoverview The copilot's model: Gemini, through `@google/genai`.
 *
 * Each tool is declared with the command's own JSON Schema (`parametersJsonSchema`), from
 * `listTools()`. Gemini's function-call parts are sent back exactly as they came, because
 * Gemini 3 needs their thought signatures in the next request. Transient failures (rate limits,
 * network, timeouts, 5xx) are retried with exponential backoff; every failure reaches the person
 * as a {@link CopilotError} with a plain message, never the provider's raw error.
 */

import {
	type Content,
	type FunctionDeclaration,
	type GenerateContentParameters,
	type GenerateContentResponse,
	GoogleGenAI,
	type Part,
} from '@google/genai';
import {
	CopilotError,
	type CopilotModel,
	type ModelMessage,
	type ModelReply,
	type ModelTool,
} from './copilot.js';

export const GEMINI_MODEL = 'gemini-3-flash-preview';

type ErrorCategory = 'rate_limit' | 'auth' | 'network' | 'timeout' | 'server' | 'empty' | 'unknown';

/** A model failure, sorted into a category with a message for the person. */
export class GeminiError extends CopilotError {
	constructor(
		readonly category: ErrorCategory,
		message: string,
		readonly retryable: boolean
	) {
		super(message);
	}
}

const CATEGORIES: { category: ErrorCategory; match: RegExp; message: string; retry: boolean }[] = [
	{
		category: 'rate_limit',
		match: /429|rate limit|quota/i,
		message: "I'm being rate limited. Wait a moment and try again.",
		retry: true,
	},
	{
		category: 'auth',
		match: /401|403|invalid key|API key/i,
		message: 'Gemini refused the API key. Check GOOGLE_API_KEY in .env.',
		retry: false,
	},
	{
		category: 'network',
		match: /ECONNREFUSED|ENOTFOUND|network|fetch failed/i,
		message: "I can't reach Gemini. Check the network connection and try again.",
		retry: true,
	},
	{
		category: 'timeout',
		match: /timeout|ETIMEDOUT/i,
		message: 'Gemini took too long. Try a simpler request.',
		retry: true,
	},
	{
		category: 'server',
		match: /500|502|503/,
		message: 'Gemini is unavailable for the moment. Try again shortly.',
		retry: true,
	},
];

/** Sort a provider error into a {@link GeminiError}. */
export function categorizeError(error: unknown): GeminiError {
	const text = error instanceof Error ? error.message : String(error);
	const found = CATEGORIES.find(({ match }) => match.test(text));
	return found
		? new GeminiError(found.category, found.message, found.retry)
		: new GeminiError('unknown', 'Something unexpected happened. Try again.', false);
}

/** A tool as Gemini declares it: the MCP input schema, without `$schema`, which it does not read. */
export function toFunctionDeclaration(tool: ModelTool): FunctionDeclaration {
	const { $schema: _schema, ...parameters } = tool.parameters;
	return { name: tool.name, description: tool.description, parametersJsonSchema: parameters };
}

/** The conversation as Gemini contents; a model turn's own parts go back unchanged. */
export function toContents(messages: readonly ModelMessage[]): Content[] {
	return messages.map((message): Content => {
		if (message.role === 'user') return { role: 'user', parts: [{ text: message.text }] };
		if (message.role === 'model') {
			const parts = Array.isArray(message.reply.raw)
				? (message.reply.raw as Part[])
				: [
						...(message.reply.text ? [{ text: message.reply.text }] : []),
						...message.reply.calls.map(({ id, name, args }) => ({
							functionCall: { ...(id !== undefined && { id }), name, args },
						})),
					];
			return { role: 'model', parts };
		}
		return {
			role: 'user',
			// The call's id, when Gemini gave one, tells it which call each response answers
			parts: message.results.map(({ id, name, result }) => ({
				functionResponse: { ...(id !== undefined && { id }), name, response: result },
			})),
		};
	});
}

/** The one Gemini call the adapter makes; tests pass their own. */
export type GenerateContent = (
	request: GenerateContentParameters
) => Promise<GenerateContentResponse>;

export interface GeminiModelOptions {
	apiKey: string;
	/** Default: `models.generateContent` of a `GoogleGenAI` client with `apiKey`. */
	generateContent?: GenerateContent;
	model?: string;
	maxRetries?: number;
	retryDelayMs?: number;
	/** Called before each retry, for the server log. */
	onRetry?: (attempt: number, delayMs: number, error: GeminiError) => void;
}

/** Gemini as a {@link CopilotModel}. */
export class GeminiModel implements CopilotModel {
	private readonly generateContent: GenerateContent;

	constructor(private readonly options: GeminiModelOptions) {
		if (options.generateContent) {
			this.generateContent = options.generateContent;
		} else {
			const client = new GoogleGenAI({ apiKey: options.apiKey });
			this.generateContent = (request) => client.models.generateContent(request);
		}
	}

	async respond(request: {
		system: string;
		messages: readonly ModelMessage[];
		tools: readonly ModelTool[];
		signal?: AbortSignal;
	}): Promise<ModelReply> {
		const response = await this.withRetry(
			() =>
				this.generateContent({
					model: this.options.model ?? GEMINI_MODEL,
					contents: toContents(request.messages),
					config: {
						systemInstruction: request.system,
						tools: [{ functionDeclarations: request.tools.map(toFunctionDeclaration) }],
						...(request.signal && { abortSignal: request.signal }),
					},
				}),
			request.signal
		);
		const candidate = response.candidates?.[0];
		const parts = candidate?.content?.parts ?? [];
		const text = parts
			.filter((part) => typeof part.text === 'string' && !part.thought)
			.map((part) => part.text)
			.join('');
		const calls = parts.flatMap((part) =>
			part.functionCall?.name
				? [
						{
							...(part.functionCall.id !== undefined && { id: part.functionCall.id }),
							name: part.functionCall.name,
							args: part.functionCall.args ?? {},
						},
					]
				: []
		);
		if (text.trim() === '' && calls.length === 0) {
			// A blocked reply, or a function call Gemini could not form, comes back empty
			const reason = candidate?.finishReason ?? response.promptFeedback?.blockReason;
			throw new GeminiError(
				'empty',
				`Gemini gave no answer${reason ? ` (${reason})` : ''}. Try rephrasing the request.`,
				false
			);
		}
		return { text, calls, raw: parts };
	}

	private async withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		const maxRetries = this.options.maxRetries ?? 3;
		const baseDelayMs = this.options.retryDelayMs ?? 1000;
		for (let attempt = 0; ; attempt++) {
			try {
				return await fn();
			} catch (error) {
				// A cancelled turn is not a Gemini failure: let the cancellation through
				if (signal?.aborted) throw error;
				const categorized = categorizeError(error);
				if (!categorized.retryable || attempt >= maxRetries) throw categorized;
				const delayMs = baseDelayMs * 2 ** attempt;
				this.options.onRetry?.(attempt + 1, delayMs, categorized);
				await new Promise((resolve) => setTimeout(resolve, delayMs));
				signal?.throwIfAborted();
			}
		}
	}
}
