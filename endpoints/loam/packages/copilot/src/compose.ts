/**
 * @fileoverview The unit composer (phase 5 specification, 7.3; D147): one subagent per unit, in a fresh context that
 * holds Loam's fixed prompt, the unit's instructions as the server's claim and the unit's parts as content (5.2),
 * with no history, no other unit and no tools. The kernel builds that context and the model port's half refuses a
 * unit's request that sends anything else, so the runtime only relays it. Its requests go through the model port tagged with the unit, so the
 * kernel counts them toward the unit (at most 4 rounds and 8,192 output tokens) and never toward the turn's rounds
 * (4.4). Its text goes back to the kernel, which sends it to the unit's submit; the session's model is told only the
 * unit's id and state, so neither the unit's parts nor the submit's result reach the parent.
 */

import { type AnyTextAdapter, chat, maxIterations } from '@tanstack/ai';
import { sessionNonce } from './context.js';
import type { CommandResultLike } from './types.js';

/** The key on a result the agent port's half answers for a unit: what the composer is given, which the parent never is. */
export const UNIT_COMPOSE_KEY = 'dev.loam/compose';

/** 7.3's bounds on one unit's composer. The kernel's half enforces the rounds and tokens; these set its requests. */
export const COMPOSER_LIMITS = Object.freeze({ rounds: 4, outputTokens: 8_192, text: 32_768 });

/**
 * A unit as the kernel hands it to the composer: its id and the composer's whole context, which the kernel built (Loam's
 * prompt; the server's instructions as its claim and the unit's parts as content, under a value of its own) and which
 * the model port's half refuses a unit's request to depart from.
 */
export interface UnitComposeV1 {
	unit: string;
	system: string;
	message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** The unit a result carries for the composer, or undefined for any other result. */
export function composeOf(result: CommandResultLike): UnitComposeV1 | undefined {
	const compose = result[UNIT_COMPOSE_KEY];
	if (
		!isRecord(compose) ||
		typeof compose.unit !== 'string' ||
		typeof compose.system !== 'string' ||
		typeof compose.message !== 'string'
	)
		return undefined;
	return { unit: compose.unit, system: compose.system, message: compose.message };
}

/**
 * A queue that runs its work one piece at a time, in the order given: a session's composers, since the model port takes
 * one request at a time and a model may call several units' tools in one round, which TanStack may run in parallel.
 */
export function oneAtATime(): <T>(work: () => Promise<T>) => Promise<T> {
	let last: Promise<unknown> = Promise.resolve();
	return (work) => {
		const mine = last.then(work);
		last = mine.catch(() => {});
		return mine;
	};
}

/**
 * Compose one unit's text in a fresh context. Any failure, an abort included, gives `''`, which the kernel records as
 * a failed unit; a text past 32,768 characters is the kernel's to refuse.
 */
export async function composeUnit(
	adapter: AnyTextAdapter,
	compose: UnitComposeV1,
	signal: AbortSignal
): Promise<string> {
	const abortController = new AbortController();
	if (signal.aborted) return '';
	signal.addEventListener('abort', () => abortController.abort(), { once: true });
	let text = '';
	// A thread and a run of its own, never the session's: TanStack needs both, and the composer shares nothing.
	const fresh = sessionNonce();
	// No tools are given, so one round answers; the kernel's half counts at most four and refuses any other body.
	try {
		const stream = chat({
			adapter,
			messages: [{ role: 'user', content: compose.message }],
			threadId: `unit-${fresh}`,
			runId: `unit-run-${fresh}`,
			systemPrompts: [compose.system],
			abortController,
			agentLoopStrategy: maxIterations(COMPOSER_LIMITS.rounds),
			modelOptions: { max_tokens: COMPOSER_LIMITS.outputTokens },
		} as never) as AsyncIterable<{ type: string; delta?: unknown }>;
		for await (const event of stream) {
			if (event.type === 'RUN_ERROR') return '';
			if (event.type === 'TEXT_MESSAGE_CONTENT' && typeof event.delta === 'string')
				text += event.delta;
		}
	} catch {
		return '';
	}
	return abortController.signal.aborted ? '' : text;
}
