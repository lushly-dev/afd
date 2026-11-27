/**
 * @fileoverview The idempotency step's store (`spec/idempotency.md`, S12): the interface a host may
 * supply, and the default, which keeps everything in memory for this process only.
 *
 * Browser-safe: no Node.js built-ins.
 */

import type { CommandResult } from '@lushly-dev/afd-core';

/** A value, or a promise of it: a host store may be asynchronous. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * What the store holds for one scope (`spec/idempotency.md`, K5: the caller's principal binding,
 * the command and the key).
 */
export interface IdempotencyRecord {
	/** The identity of the reservation this record was made for (S5, S12). */
	readonly reservation: string;
	/** The call's digest (S4). */
	readonly digest: string;
	/** When the key was reserved, on the server's clock. */
	readonly reservedAt: number;
	/** When the record stops answering repeats: `reservedAt + ttlMs` (S8). Inclusive. */
	readonly expiresAt: number;
	/**
	 * When a reservation still unsettled stops being live and is treated as never settled: the
	 * call's deadline plus `leaseMs`, or `reservedAt + leaseMs` for a call without one (S7).
	 * Inclusive.
	 */
	readonly leaseEndsAt: number;
	/**
	 * `reserved` while the handler runs; `stored` once its result is kept; `unknown` once nobody
	 * can say whether it was applied (S6).
	 */
	readonly state: 'reserved' | 'stored' | 'unknown';
	/** The handler's result, when `state` is `stored`. */
	readonly result?: CommandResult;
}

/** A reservation to make: the record's times and digest, without its identity or state. */
export type IdempotencyReservationRequest = Pick<
	IdempotencyRecord,
	'digest' | 'reservedAt' | 'expiresAt' | 'leaseEndsAt'
>;

/** What `reserve` did: reserved the key, or found it held and reports the record. */
export type IdempotencyReserveOutcome =
	| { readonly reserved: true; readonly reservation: string }
	| { readonly reserved: false; readonly record: IdempotencyRecord };

/** How a reservation is settled: with the result to keep, or as never settled (S6). */
export type IdempotencySettlement =
	| { readonly kind: 'result'; readonly result: CommandResult }
	| { readonly kind: 'unknown' };

/**
 * The store of the idempotency step (S12). Each method is atomic for its scope. A store shared by
 * several processes gives the step's promise across them (S13); the default does not.
 */
export interface IdempotencyStore {
	/**
	 * Reserve the key of `scope` for `request`, unless a record that has not expired at `now` holds
	 * it: then report that record, changing nothing. Of two calls for one scope that find nothing,
	 * exactly one reserves. Returns the new reservation's identity, unique to it.
	 */
	reserve(
		scope: string,
		request: IdempotencyReservationRequest,
		now: number
	): MaybePromise<IdempotencyReserveOutcome>;
	/**
	 * Settle `reservation` as `settlement` says. Does nothing when the scope no longer holds that
	 * reservation (it was released, or the key was reserved again).
	 */
	complete(
		scope: string,
		reservation: string,
		settlement: IdempotencySettlement
	): MaybePromise<void>;
	/**
	 * Remove `reservation`, so a repeat runs. Does nothing when the scope no longer holds that
	 * reservation.
	 */
	release(scope: string, reservation: string): MaybePromise<void>;
	/** The record of `scope` that has not expired at `now`, if any. */
	get(scope: string, now: number): MaybePromise<IdempotencyRecord | undefined>;
}

/** Options of {@link InMemoryIdempotencyStore}. */
export interface InMemoryIdempotencyStoreOptions {
	/**
	 * Scopes held before expired records are swept on the next reservation (default 10,000). A
	 * sweep removes only expired records, so the store can hold more live ones than this; the next
	 * sweep then waits until it holds twice as many as the last one left.
	 */
	sweepAt?: number;
}

let reservations = 0;

/** A reservation identity unique in this process. */
function nextReservation(): string {
	reservations += 1;
	const random =
		typeof globalThis.crypto?.randomUUID === 'function'
			? globalThis.crypto.randomUUID()
			: Math.random().toString(36).slice(2);
	return `${reservations}-${random}`;
}

/**
 * A copy of `result` a caller cannot change through the one it holds: a structured clone, else
 * its JSON (what a result carries over MCP), else, for a value neither can copy, the result itself.
 */
function kept(result: CommandResult): CommandResult {
	try {
		return structuredClone(result);
	} catch {
		try {
			return JSON.parse(JSON.stringify(result)) as CommandResult;
		} catch {
			return result;
		}
	}
}

/**
 * The default store: in memory, for this process only. A restart forgets every key, and a
 * repeat that reaches another process finds nothing there (S13). A host that needs the promise
 * across restarts or processes supplies a store that gives it.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
	private readonly records = new Map<string, IdempotencyRecord>();
	private readonly sweepAt: number;
	/** The size at which the next reservation sweeps. */
	private nextSweepAt: number;

	constructor(options: InMemoryIdempotencyStoreOptions = {}) {
		const { sweepAt = 10_000 } = options;
		if (!Number.isSafeInteger(sweepAt) || sweepAt < 1) {
			throw new RangeError('sweepAt must be a positive integer');
		}
		this.sweepAt = sweepAt;
		this.nextSweepAt = sweepAt;
	}

	/** How many scopes the store holds, expired ones included until a sweep. */
	get size(): number {
		return this.records.size;
	}

	reserve(
		scope: string,
		request: IdempotencyReservationRequest,
		now: number
	): IdempotencyReserveOutcome {
		const held = this.get(scope, now);
		if (held) return { reserved: false, record: held };
		if (this.records.size >= this.nextSweepAt) {
			this.sweep(now);
			// Amortized: a store full of live keys does not scan them on every reservation.
			this.nextSweepAt = Math.max(this.sweepAt, 2 * this.records.size);
		}
		const reservation = nextReservation();
		this.records.set(scope, { ...request, reservation, state: 'reserved' });
		return { reserved: true, reservation };
	}

	complete(scope: string, reservation: string, settlement: IdempotencySettlement): void {
		const record = this.records.get(scope);
		if (record?.reservation !== reservation) return;
		this.records.set(
			scope,
			settlement.kind === 'result'
				? { ...record, state: 'stored', result: kept(settlement.result) }
				: { ...record, state: 'unknown' }
		);
	}

	release(scope: string, reservation: string): void {
		if (this.records.get(scope)?.reservation === reservation) this.records.delete(scope);
	}

	get(scope: string, now: number): IdempotencyRecord | undefined {
		const record = this.records.get(scope);
		if (!record) return undefined;
		if (now > record.expiresAt) {
			this.records.delete(scope);
			return undefined;
		}
		return record.state === 'stored' && record.result
			? { ...record, result: kept(record.result) }
			: record;
	}

	/** Remove every record that has expired at `now`. */
	private sweep(now: number): void {
		for (const [scope, record] of this.records) {
			if (now > record.expiresAt) this.records.delete(scope);
		}
	}
}
