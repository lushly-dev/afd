/**
 * @fileoverview The control registry: the controls an application binds on one screen, each
 * with the `rev` the registry issues for it (the specification's section 3).
 */

import type { ControlHandler, ControlState, ControlValue } from './types.js';
import { copyValue, holdsValue, normalizeState, sameState } from './values.js';

/** Options for {@link ControlRegistry}. */
export interface ControlRegistryOptions {
	/** Issues the tokens revs are made of. Tests pass a counter; the default is random. */
	token?: () => string;
}

/** The screen a registry is, and the command its form is for. */
export interface ControlScreen {
	name?: string;
	command?: string;
}

/** A handler's `read` threw. The commands turn it into `INTERNAL_ERROR`. */
export class ControlReadError extends Error {
	constructor(
		readonly id: string,
		readonly reason: string
	) {
		super(`${id} could not be read: ${reason}`);
		this.name = 'ControlReadError';
	}
}

/** What a thrown value says, as an error's message. */
export function thrownMessage(thrown: unknown): string {
	return thrown instanceof Error ? thrown.message : String(thrown);
}

/** One bound control, and what the registry recorded the last time it read it. */
export interface BoundControl {
	readonly id: string;
	readonly handler: ControlHandler;
	/** Unset until the control is first observed. */
	rev?: string;
	/** A copy of the last state read. */
	copy?: ControlState;
	/**
	 * For the last `control-set` to write it: the value it replaced, the value the control held
	 * once written, the value it held when the last writing call ended, and the `rev` the call
	 * returned for it.
	 */
	remembered?: { value: ControlValue; written: ControlValue; left: ControlValue; rev: string };
}

/** What a registry holds for each control at one moment, to put back after a call is written back. */
export type ControlSnapshot = Array<
	Pick<BoundControl, 'rev' | 'copy' | 'remembered'> & { control: BoundControl }
>;

/** The 16 hexadecimal digits of 8 random bytes. */
function randomToken(): string {
	const bytes = new Uint8Array(8);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** What the commands reach a registry through; not part of the package's surface. */
export class ControlStore {
	private readonly bound = new Map<string, BoundControl>();
	private readonly token: () => string;
	private issued = 0;
	screen: ControlScreen = {};

	constructor(options: ControlRegistryOptions) {
		this.token = options.token ?? randomToken;
	}

	/** A `rev` no other in this registry has had: a counter joined to a token. */
	private issue(): string {
		this.issued += 1;
		return `${this.issued.toString(36)}-${this.token()}`;
	}

	register(id: string, handler: ControlHandler): BoundControl {
		if (id === '') throw new Error('A control needs an id that is not empty');
		if (this.bound.has(id)) throw new Error(`A control is already registered as "${id}"`);
		const control: BoundControl = { id, handler };
		this.bound.set(id, control);
		return control;
	}

	unregister(id: string, only?: BoundControl): void {
		if (only !== undefined && this.bound.get(id) !== only) return;
		this.bound.delete(id);
	}

	get(id: string): BoundControl | undefined {
		return this.bound.get(id);
	}

	/** The controls, in the order they were registered. */
	all(): BoundControl[] {
		return [...this.bound.values()];
	}

	/**
	 * Read the control's handler again and compare the state with the copy. If anything
	 * differs, the control gets a new `rev`. A secret has no `rev`: issuing one would let a
	 * caller count, from the revs it is given for other controls, how often the secret changed.
	 *
	 * @param outside - Whether this is a command's first look at the control. What it holds then
	 *   was put there outside any writing call: if that is not what the last one left, a person
	 *   or the application changed it, and what was remembered for a restore is dropped.
	 * @returns The registry's own copy of the state: copy what leaves the registry.
	 * @throws ControlReadError when the handler's `read` throws, or returns what is not a state
	 */
	observe(control: BoundControl, outside = false): ControlState {
		let state: ControlState;
		try {
			state = normalizeState(control.handler.read());
		} catch (thrown) {
			throw new ControlReadError(control.id, thrownMessage(thrown));
		}
		const { copy } = control;
		const changed = copy === undefined || !sameState(copy, state);
		if (changed) control.copy = state;
		const { remembered } = control;
		if (outside && remembered !== undefined && !holdsValue(state, remembered.left)) {
			control.remembered = undefined;
		}
		if (state.secret) control.rev = undefined;
		else if (changed || control.rev === undefined) control.rev = this.issue();
		return control.copy as ControlState;
	}

	/** Observe every registered control, in order. */
	observeAll(outside = false): void {
		for (const control of this.all()) this.observe(control, outside);
	}

	/**
	 * A writing call has ended: what each control holds now is what the call left, so a change
	 * the call itself made is never taken for one made outside it.
	 */
	settle(): void {
		for (const control of this.all()) {
			const { remembered, copy } = control;
			if (remembered !== undefined && copy !== undefined) {
				control.remembered = { ...remembered, left: copyValue(copy.value) };
			}
		}
	}

	/** Each registered control's `rev`, as the last observation left it. */
	revs(): Map<string, string | undefined> {
		return new Map(this.all().map((control) => [control.id, control.rev]));
	}

	/** What the registry holds for each registered control now. */
	snapshot(): ControlSnapshot {
		return this.all().map((control) => ({
			control,
			rev: control.rev,
			copy: control.copy,
			remembered: control.remembered,
		}));
	}

	/**
	 * Put back what a snapshot held, after a call that wrote has been written back: the screen
	 * is as it was, so each control keeps the `rev` it had and what was remembered for it.
	 */
	reinstate(snapshot: ControlSnapshot): void {
		for (const { control, rev, copy, remembered } of snapshot) {
			control.rev = rev;
			control.copy = copy;
			control.remembered = remembered;
		}
	}
}

const stores = new WeakMap<ControlRegistry, ControlStore>();

/**
 * The controls an application binds on one screen. Each has a handler that reads and writes
 * it, and a `rev` the registry issues for the control as it now is: a write must send it back,
 * so an agent never replaces what a person typed without having read it.
 *
 * The registry persists nothing. Make the commands with `createControlCommands` from
 * `@lushly-dev/afd-view-state/controls/commands`.
 *
 * @example
 * ```ts
 * const registry = new ControlRegistry();
 * registry.setScreen({ name: 'Book a workshop seat', command: 'workshop-book' });
 * const unregister = registry.register('attendee-name', handler);
 * ```
 */
export class ControlRegistry {
	constructor(options: ControlRegistryOptions = {}) {
		stores.set(this, new ControlStore(options));
	}

	/** Name the screen and the command its form is for, replacing what was set before. */
	setScreen(screen: ControlScreen): void {
		const next: ControlScreen = {};
		if (screen.name !== undefined) next.name = screen.name;
		if (screen.command !== undefined) next.command = screen.command;
		controlStore(this).screen = next;
	}

	/**
	 * Bind a control. Ids are listed in the order they were registered.
	 *
	 * @returns A function that unregisters this handler, and does nothing once the id has been
	 *   registered again.
	 * @throws Error for an id that is empty or already registered
	 */
	register(id: string, handler: ControlHandler): () => void {
		const store = controlStore(this);
		const control = store.register(id, handler);
		return () => store.unregister(id, control);
	}

	/** Unbind a control. Does nothing for an id that is not registered. */
	unregister(id: string): void {
		controlStore(this).unregister(id);
	}

	/** Whether a control is registered under `id`. */
	has(id: string): boolean {
		return controlStore(this).get(id) !== undefined;
	}
}

/** The store behind a registry, for the commands. */
export function controlStore(registry: ControlRegistry): ControlStore {
	const store = stores.get(registry);
	if (!store) throw new TypeError('Not a ControlRegistry');
	return store;
}
