/**
 * @fileoverview The push rate (phase 4 specification, 6.1 and 10.2): pushes a minute per source, 5 for an agent and
 * 10 for an app. An agent's toasts count against it now; the inbox's `notification-push` (step 5) shares the same
 * object, so an agent's toasts and notices are one rate. Read on the call's clock, so a replay decides the same.
 */

/** The window a rate counts over. */
export const PUSH_WINDOW_MS = 60_000;

/** Pushes a minute: an agent's, and an app's (10.2). */
export const AGENT_PUSH_RATE = 5;
export const APP_PUSH_RATE = 10;

export interface PushRate {
	/** The milliseconds until `source` may push again, or undefined when it may now. Counts nothing. */
	retryAfter(source: string, limit: number, now: number): number | undefined;
	/** Count a push that went through. */
	record(source: string, now: number): void;
	/** Forget every count, as a reload does. */
	reset(): void;
}

export function createPushRate(): PushRate {
	const pushes = new Map<string, number[]>();
	const recent = (source: string, now: number): number[] => {
		const kept = (pushes.get(source) ?? []).filter((at) => at > now - PUSH_WINDOW_MS && at <= now);
		if (kept.length === 0) pushes.delete(source);
		else pushes.set(source, kept);
		return kept;
	};
	return {
		retryAfter(source, limit, now) {
			const kept = recent(source, now);
			if (kept.length < limit) return undefined;
			// The push that frees a place is the one `limit` back from the newest.
			return Math.max(1, (kept[kept.length - limit] as number) + PUSH_WINDOW_MS - now);
		},
		record(source, now) {
			pushes.set(source, [...recent(source, now), now]);
		},
		reset: () => pushes.clear(),
	};
}
