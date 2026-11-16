/**
 * @fileoverview The `/chat` backend: the copilot behind request IDs, error handling and metrics.
 *
 * One message is one turn: the model reads the message, calls the to-do commands through
 * DirectClient (`copilot.ts`) and answers. The server knows nothing of the model; tests drive
 * {@link createChatBackend} with a scripted one.
 */

import { PublicError } from './chat-http.js';
import { type Copilot, CopilotError, type CopilotMode, type CopilotTurn } from './copilot.js';

/** One turn's answer, with its request ID for the server log. */
export interface ChatResponse extends CopilotTurn {
	requestId: string;
}

/** The chat backend the HTTP server calls (see `ChatBackend` in `chat-http.ts`). */
export interface Chat {
	processChat(message: string, mode: CopilotMode): Promise<ChatResponse>;
	isConfigured(): boolean;
	getMetrics(): Record<string, unknown>;
}

/** Percentile of sorted values, or 0 when there are none. */
function percentile(sorted: readonly number[], fraction: number): number {
	return sorted.length > 0 ? (sorted[Math.floor(sorted.length * fraction)] ?? 0) : 0;
}

/**
 * Build the chat backend around a copilot, or without one (no API key): then every message is
 * refused with a message saying how to configure it.
 */
export function createChatBackend(
	copilot: Copilot | undefined,
	log: (line: string) => void = console.error
): Chat {
	let counter = 0;
	const metrics = {
		requestCount: 0,
		successCount: 0,
		errorCount: 0,
		toolCallCount: 0,
		errorsByType: {} as Record<string, number>,
	};
	// The last 100 turn latencies, for the percentiles
	const latencies: number[] = [];
	const fail = (type: string) => {
		metrics.errorCount++;
		metrics.errorsByType[type] = (metrics.errorsByType[type] ?? 0) + 1;
	};

	return {
		isConfigured: () => copilot !== undefined,

		getMetrics() {
			const sorted = [...latencies].sort((a, b) => a - b);
			return {
				...metrics,
				avgLatencyMs: sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
				p50LatencyMs: percentile(sorted, 0.5),
				p95LatencyMs: percentile(sorted, 0.95),
				p99LatencyMs: percentile(sorted, 0.99),
			};
		},

		async processChat(message, mode) {
			const requestId = `req-${Date.now()}-${++counter}`;
			metrics.requestCount++;
			if (!copilot) {
				fail('config');
				throw new PublicError('Gemini is not configured. Set GOOGLE_API_KEY in .env.');
			}
			const start = performance.now();
			try {
				const turn = await copilot.run(message, mode);
				metrics.successCount++;
				metrics.toolCallCount += turn.toolExecutions.length;
				latencies.push(performance.now() - start);
				if (latencies.length > 100) latencies.shift();
				return { ...turn, requestId };
			} catch (error) {
				if (error instanceof CopilotError) {
					fail('category' in error ? String(error.category) : 'copilot');
					log(`[${requestId}] ${error.message}`);
					throw new PublicError(error.message);
				}
				fail('unknown');
				throw error;
			}
		},
	};
}
