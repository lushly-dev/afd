/**
 * @fileoverview An instance's guard at its frames' boundary (phase 4 specification, section 11): the gate every message a
 * view's frame or a handler frame sends passes before anything reads it (`messageBytes`, and a message with no JSON form,
 * over every limit), the call rate charged once for each `tools/call` the boundary refuses, and the journaled refusal
 * `app-limit-refuse`, so `limit-usage-get` replays as it ran. In the `apps` chunk.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { LIMIT_DEFAULTS, measureJson } from '../limits.js';
import type { FrameAdmit, FrameRefusal } from '../types.js';
import { takeCall } from './call-rate.js';
import type { AppsHost } from './types.js';

/** Why a limit refused, beyond its bound: a value with no JSON form, or too many reads in flight. */
export type LimitReasonV1 = 'json' | 'reads';

export interface LimitGuard {
	/** The gate the chrome's channel calls on each message, first. */
	admit: FrameAdmit;
	/** Charge one call of the instance's rate, for a `tools/call` refused before it reached the port. */
	charge(): void;
	/** Refuse through the journaled `app-limit-refuse`, as the instance, counted for `limit-usage-get`. */
	refuse(
		command: string,
		limit: 'messageBytes' | 'inputBytes' | 'callsPerSecond',
		bound: number,
		extra?: { retryAfterMs?: number; reason?: LimitReasonV1 }
	): Promise<CommandResult<never>>;
}

export function createLimitGuard(
	host: Pick<AppsHost, 'limits' | 'runAs' | 'clock'>,
	instance: string
): LimitGuard {
	const guard: LimitGuard = {
		charge() {
			if (host.limits) takeCall(host.limits, instance, host.clock());
		},
		refuse: (command, limit, bound, extra = {}) =>
			host.runAs<never>(
				'app-limit-refuse',
				{ command: command.slice(0, 256), limit, bound, ...extra },
				undefined,
				{ caller: instance }
			),
		admit(message) {
			const limit = (host.limits?.values() ?? LIMIT_DEFAULTS).messageBytes;
			const measured = measureJson(message, limit);
			if (!measured.over) return undefined;
			const { method, params } = (message ?? {}) as { method?: unknown; params?: unknown };
			const tool =
				method === 'tools/call' ? (params as { name?: unknown } | null)?.name : undefined;
			// A refused `tools/call` still takes its place in the rate: each is charged once, here or at the port.
			if (method === 'tools/call') guard.charge();
			const command =
				typeof tool === 'string' ? tool : typeof method === 'string' ? method : 'message';
			// Journaled, so the count replays; the frame is answered at once, whatever the journal does.
			void guard
				.refuse(command, 'messageBytes', limit, measured.unserializable ? { reason: 'json' } : {})
				.catch(() => undefined);
			const refusal: FrameRefusal = measured.unserializable
				? {
						code: 'VALIDATION_ERROR',
						rpcCode: -32602,
						message: 'A message from the frame has no JSON form, so it was dropped',
						suggestion: 'Send JSON values: no cycle, no BigInt, no function',
						details: { limit },
					}
				: {
						code: 'INPUT_TOO_LARGE',
						rpcCode: -32602,
						message: `A message from the frame is over ${limit} bytes of JSON, so it was dropped`,
						suggestion: 'Send less, or ask an owner to raise loam.limits.messageBytes',
						details: { limit },
					};
			return refusal;
		},
	};
	return guard;
}
