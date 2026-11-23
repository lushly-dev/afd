/**
 * Deterministic page clock for `pin.clock`: fixes `Date` (`new Date()`, `Date()`, `Date.now()`)
 * and pauses wall-clock timer drift (`setTimeout`/`setInterval` with positive delays) while
 * keeping zero-delay macrotask yields alive and letting Specimen's own runtime (axe) use real
 * timers when needed.
 */

import { parseIsoClockMs } from './clock-parse.js';

export interface PinnedClockController {
	readonly iso: string;
	now(): number;
	advance(ms: number): void;
	withRealTimers<T>(fn: () => Promise<T>): Promise<T>;
	restore(): void;
}

/** Validate and parse a calendar-valid ISO-8601 instant with explicit timezone (`Z` or `±HH:MM`). */
export function parsePinnedClock(iso: string): number {
	const ms = parseIsoClockMs(iso);
	if (ms === null) {
		throw new Error(
			`Invalid pin.clock '${iso}': expected a calendar-valid ISO-8601 timestamp with timezone, such as 2026-03-02T09:00:00Z.`
		);
	}
	return ms;
}

interface ScheduledTimer {
	id: number;
	fireAt: number;
	interval: number | null;
	callback: (...args: unknown[]) => void;
	args: unknown[];
	cancelled: boolean;
}

/**
 * Install a pinned clock on `globalThis` (usually `window`), returning a controller that can
 * advance virtual time deterministically, temporarily bypass timer freezing for third-party
 * checks (axe-core), and restore exact original globals on disposal.
 */
export function installPinnedClock(
	iso: string,
	target: typeof globalThis = globalThis
): PinnedClockController {
	let virtualNow = parsePinnedClock(iso);
	const RealDate = target.Date;
	// Preserve exact unbound original references so `restore()` keeps identity and properties
	// (such as Node's `setTimeout[util.promisify.custom]`).
	const origSetTimeout = target.setTimeout;
	const origClearTimeout = target.clearTimeout;
	const origSetInterval = target.setInterval;
	const origClearInterval = target.clearInterval;
	const realSetTimeout = origSetTimeout.bind(target);
	const realClearTimeout = origClearTimeout.bind(target);
	const realSetInterval = origSetInterval.bind(target);
	const realClearInterval = origClearInterval.bind(target);

	let nextId = 1;
	let realTimersDepth = 0;
	let restored = false;
	const virtualTimers = new Map<number, ScheduledTimer>();
	const realHandles = new Map<number, ReturnType<typeof setTimeout>>();

	function toCallback(handler: TimerHandler): (...args: unknown[]) => void {
		if (typeof handler === 'function') return handler as (...args: unknown[]) => void;
		// String timer handlers are refused rather than eval'd.
		throw new Error('String timer callbacks are not supported under pin.clock.');
	}

	function scheduleTimer(
		handler: TimerHandler,
		delay: number | undefined,
		interval: boolean,
		args: unknown[]
	): number {
		const cb = toCallback(handler);
		const numericDelay = delay === undefined ? 0 : Number(delay);
		const ms = Number.isFinite(numericDelay) && numericDelay > 0 ? numericDelay : 0;

		if (realTimersDepth > 0 || (!interval && ms === 0)) {
			const id = nextId++;
			const handle = interval
				? realSetInterval(() => cb(...args), ms)
				: realSetTimeout(() => {
						realHandles.delete(id);
						cb(...args);
					}, ms);
			realHandles.set(id, handle);
			return id;
		}

		const id = nextId++;
		const step = interval ? Math.max(1, ms) : ms;
		virtualTimers.set(id, {
			id,
			fireAt: virtualNow + step,
			interval: interval ? step : null,
			callback: cb,
			args,
			cancelled: false,
		});
		return id;
	}

	function cancelTimer(id: number | undefined): void {
		if (typeof id !== 'number') return;
		const virtual = virtualTimers.get(id);
		if (virtual) {
			virtual.cancelled = true;
			virtualTimers.delete(id);
			return;
		}
		const handle = realHandles.get(id);
		if (handle !== undefined) {
			realHandles.delete(id);
			realClearTimeout(handle);
			realClearInterval(handle);
			return;
		}
		realClearTimeout(id as unknown as ReturnType<typeof setTimeout>);
		realClearInterval(id as unknown as ReturnType<typeof setInterval>);
	}

	const pinnedNow = (): number => virtualNow;

	// Proxy preserves `new Date()`, `Date()` (non-constructor), `Date.now()`, `instanceof Date`, and statics.
	const PinnedDate = new Proxy(RealDate, {
		construct(_target, args, newTarget) {
			if (args.length === 0) {
				return Reflect.construct(RealDate, [virtualNow], newTarget);
			}
			return Reflect.construct(RealDate, args, newTarget);
		},
		apply() {
			return new RealDate(virtualNow).toString();
		},
		get(orig, prop, receiver) {
			if (prop === 'now') return pinnedNow;
			return Reflect.get(orig, prop, receiver);
		},
	});

	target.Date = PinnedDate;
	target.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
		scheduleTimer(handler, timeout, false, args)) as typeof setTimeout;
	target.clearTimeout = ((id?: number) => cancelTimer(id)) as typeof clearTimeout;
	target.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
		scheduleTimer(handler, timeout, true, args)) as typeof setInterval;
	target.clearInterval = ((id?: number) => cancelTimer(id)) as typeof clearInterval;

	return {
		iso,
		now: pinnedNow,
		advance(ms: number) {
			if (!Number.isFinite(ms) || ms < 0) {
				throw new Error(`Clock advance must be a non-negative finite number; received ${ms}.`);
			}
			const limit = virtualNow + ms;
			let steps = 0;
			const maxSteps = 10_000;
			while (true) {
				let next: ScheduledTimer | undefined;
				for (const timer of virtualTimers.values()) {
					if (timer.cancelled || timer.fireAt > limit) continue;
					if (
						!next ||
						timer.fireAt < next.fireAt ||
						(timer.fireAt === next.fireAt && timer.id < next.id)
					) {
						next = timer;
					}
				}
				if (!next) break;
				if (++steps > maxSteps) {
					throw new Error(
						`Pinned clock exceeded ${maxSteps} timer firings while advancing ${ms}ms.`
					);
				}
				virtualNow = next.fireAt;
				if (next.interval !== null) {
					next.fireAt += next.interval;
				} else {
					virtualTimers.delete(next.id);
				}
				next.callback(...next.args);
			}
			virtualNow = limit;
		},
		async withRealTimers<T>(fn: () => Promise<T>): Promise<T> {
			realTimersDepth++;
			try {
				return await fn();
			} finally {
				realTimersDepth--;
			}
		},
		restore() {
			if (restored) return;
			restored = true;
			for (const handle of realHandles.values()) {
				realClearTimeout(handle);
				realClearInterval(handle);
			}
			realHandles.clear();
			virtualTimers.clear();
			target.Date = RealDate;
			target.setTimeout = origSetTimeout;
			target.clearTimeout = origClearTimeout;
			target.setInterval = origSetInterval;
			target.clearInterval = origClearInterval;
		},
	};
}
