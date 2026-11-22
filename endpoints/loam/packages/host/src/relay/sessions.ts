/**
 * @fileoverview The relay's state (phase 6 specification, 8.1 steps 15 to 17): each person's requests in flight, bounded
 * by `relay_concurrency_per_person`; the upstream sessions a legacy-era instance issues, each bound to its person and
 * instance, at most four per pair, expired after `relay_session_idle_ms` and `DELETE`d upstream when they expire or are
 * evicted; and cancellation, which aborts only the person's own request through the same binding. In memory only: after
 * a restart no binding exists, and pages recover through `MOUNT_SESSION_UNKNOWN`.
 */

import type { RpcId } from './message.js';

/** How long `close()` waits for the upstream `DELETE`s it sends. */
export const CLOSE_WAIT_MS = 2_000;

/** At most this many upstream sessions per person and instance (step 16). */
export const BINDINGS_PER_PAIR = 4;

export interface Binding {
	/** The id the instance issued, which the page sends back. */
	readonly id: string;
	readonly person: string;
	readonly instance: string;
	/** The version the instance's `initialize` answer named, once read. */
	protocolVersion?: string;
	lastUsed: number;
	inFlight: number;
	timer?: ReturnType<typeof setTimeout>;
}

/** One forwarded request in flight, which a `notifications/cancelled` through the same binding may abort. */
interface Flight {
	person: string;
	instance: string;
	binding: string | undefined;
	id: RpcId;
	controller: AbortController;
}

const flightKey = (person: string, instance: string, binding: string | undefined, id: RpcId) =>
	JSON.stringify([person, instance, binding ?? null, typeof id, id]);

export interface RelayState {
	/** Takes one of `person`'s slots, or none when all are held (`429 MOUNT_LIMIT`). */
	acquire(person: string): (() => void) | undefined;
	/** The binding the page's `Mcp-Session-Id` names for this person and instance, or none: another's is none too. */
	binding(id: string, person: string, instance: string): Binding | undefined;
	/**
	 * Room for a new binding, held until its release: evicts the least recently used idle one (its `DELETE` sent), or
	 * `undefined` when every place is busy or reserved. A reservation counts as a binding, so two `initialize`s at once
	 * cannot both take the fourth place.
	 */
	reserve(person: string, instance: string): (() => void) | undefined;
	/** Binds an id the instance issued on its `initialize` answer; `false` when it is already another person's or pair's. */
	bind(id: string, person: string, instance: string): Binding | false;
	/** Drops a binding, with no `DELETE` (the page's own `DELETE`, or the instance's `404`). */
	drop(id: string): void;
	/** A request through `binding` started: the binding is not idle while it runs. */
	use(binding: Binding): () => void;
	/** Records a forwarded request, so it can be cancelled; returns its release. */
	fly(flight: Omit<Flight, 'controller'>, controller: AbortController): () => void;
	/** Aborts the person's own request through the same binding, if any is in flight; nothing else. */
	cancel(person: string, instance: string, binding: string | undefined, id: RpcId): boolean;
	/** Ends every binding upstream and clears the state. */
	close(): Promise<void>;
	readonly size: number;
}

export function createRelayState(options: {
	concurrency: number;
	idleMs: number;
	/** Sends the upstream `DELETE` for an expired or evicted binding; failures are the instance's. */
	end(binding: Binding): Promise<void>;
	clock?: () => number;
}): RelayState {
	const clock = options.clock ?? Date.now;
	const slots = new Map<string, number>();
	const bindings = new Map<string, Binding>();
	const flights = new Map<string, AbortController>();
	const ending = new Set<Promise<void>>();
	let closed = false;

	const pairOf = (person: string, instance: string) =>
		[...bindings.values()].filter((held) => held.person === person && held.instance === instance);
	const reserved = new Map<string, number>();
	const pairKey = (person: string, instance: string) => JSON.stringify([person, instance]);

	function end(binding: Binding): void {
		if (binding.timer) clearTimeout(binding.timer);
		bindings.delete(binding.id);
		const sent = options.end(binding).catch(() => {});
		ending.add(sent);
		void sent.finally(() => ending.delete(sent));
	}

	/** The idle timer runs only while no request through the binding is in flight. */
	function arm(binding: Binding): void {
		if (binding.timer) clearTimeout(binding.timer);
		binding.timer = undefined;
		if (binding.inFlight > 0) return;
		binding.timer = setTimeout(() => {
			if (bindings.get(binding.id) === binding && binding.inFlight === 0) end(binding);
		}, options.idleMs);
		binding.timer.unref?.();
	}

	return {
		get size() {
			return bindings.size;
		},
		acquire(person) {
			const held = slots.get(person) ?? 0;
			if (held >= options.concurrency) return undefined;
			slots.set(person, held + 1);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const now = (slots.get(person) ?? 1) - 1;
				if (now <= 0) slots.delete(person);
				else slots.set(person, now);
			};
		},
		binding(id, person, instance) {
			const found = bindings.get(id);
			return found && found.person === person && found.instance === instance ? found : undefined;
		},
		reserve(person, instance) {
			const key = pairKey(person, instance);
			const pair = pairOf(person, instance);
			const pending = reserved.get(key) ?? 0;
			if (pair.length + pending >= BINDINGS_PER_PAIR) {
				const idle = pair
					.filter((held) => held.inFlight === 0)
					.sort((a, b) => a.lastUsed - b.lastUsed)[0];
				if (!idle) return undefined;
				end(idle);
			}
			reserved.set(key, pending + 1);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const left = (reserved.get(key) ?? 1) - 1;
				if (left <= 0) reserved.delete(key);
				else reserved.set(key, left);
			};
		},
		bind(id, person, instance) {
			// After `close()` began, no binding is made that nothing would end (the trust review, Opus).
			if (closed) return false;
			const found = bindings.get(id);
			if (found) {
				if (found.person !== person || found.instance !== instance) return false;
				found.lastUsed = clock();
				arm(found);
				return found;
			}
			const binding: Binding = { id, person, instance, lastUsed: clock(), inFlight: 0 };
			bindings.set(id, binding);
			arm(binding);
			return binding;
		},
		drop(id) {
			const found = bindings.get(id);
			if (!found) return;
			if (found.timer) clearTimeout(found.timer);
			bindings.delete(id);
		},
		use(binding) {
			binding.inFlight++;
			binding.lastUsed = clock();
			arm(binding);
			let done = false;
			return () => {
				if (done) return;
				done = true;
				binding.inFlight--;
				binding.lastUsed = clock();
				if (bindings.get(binding.id) === binding) arm(binding);
			};
		},
		fly(flight, controller) {
			const key = flightKey(flight.person, flight.instance, flight.binding, flight.id);
			flights.set(key, controller);
			return () => {
				if (flights.get(key) === controller) flights.delete(key);
			};
		},
		cancel(person, instance, binding, id) {
			// With no binding (the modern era, or a stateless instance) nothing is aborted: the page's own abort ends it.
			if (binding === undefined) return false;
			const controller = flights.get(flightKey(person, instance, binding, id));
			if (!controller) return false;
			controller.abort(new Error('Cancelled by the page'));
			return true;
		},
		async close() {
			closed = true;
			for (const controller of flights.values()) controller.abort(new Error('The relay closed'));
			flights.clear();
			for (const binding of [...bindings.values()]) end(binding);
			// An instance that never answers its `DELETE` does not hold the server's shutdown.
			let timer: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				Promise.allSettled([...ending]),
				new Promise<void>((done) => {
					timer = setTimeout(done, CLOSE_WAIT_MS);
				}),
			]);
			clearTimeout(timer);
		},
	};
}
