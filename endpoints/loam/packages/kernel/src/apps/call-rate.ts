/**
 * @fileoverview An instance's call rate (phase 4 specification, section 11): `loam.limits.callsPerSecond`, with a burst
 * of 200, as a token bucket per instance. In the `apps` chunk, beside the port that takes it; the buckets live on the
 * kernel's limits, so a reload forgets them with the hour's refusals.
 */

import type { KernelLimits } from '../limits.js';

/** The calls an instance may make at once before `callsPerSecond` holds it (section 11's burst). */
export const CALL_BURST = 200;

/**
 * Take one call of `instance`'s rate at `now`: undefined when it may run, else the milliseconds until it may. The check
 * and the count are one step, with no await between them, so two calls never both take the last place. A replay takes
 * nothing, since its refusals are its journal's.
 */
export function takeCall(limits: KernelLimits, instance: string, now: number): number | undefined {
	if (limits.paused()) return undefined;
	const rate = limits.values().callsPerSecond;
	const held = limits.rates.get(instance) ?? { tokens: CALL_BURST, at: now };
	const tokens = Math.min(CALL_BURST, held.tokens + (Math.max(0, now - held.at) * rate) / 1000);
	if (tokens >= 1) {
		limits.rates.set(instance, { tokens: tokens - 1, at: now });
		return undefined;
	}
	limits.rates.set(instance, { tokens, at: now });
	return Math.max(1, Math.ceil(((1 - tokens) * 1000) / rate));
}
