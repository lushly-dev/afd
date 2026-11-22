/**
 * @fileoverview The overlay store (phase 1 specification, section 8; phase 4 specification, 6): toasts, modals,
 * popovers, and from phase 4's step 4 dialogs, prompts and the global strip. The kernel holds the state, so a replay
 * reproduces every id and every move; the chrome renders it and runs a toast's timer. Every overlay is `open` or, a
 * dialog only, `parked` here, or `closed` in what `whenClosed` answers (6.2). The slot is one modal or prompt,
 * shell-wide.
 *
 * Whose an overlay is, is a kind as well as an id (the step 3 review's R-d): the shell's, an app instance's or an
 * agent's. Every decision reads the kind, never an id compared with `shell`, so no instance id passes for the shell.
 */

import type {
	DialogInputV1,
	GlobalInputV1,
	ModalInputV1,
	OverlayFromV1,
	OverlayReasonV1,
	OverlayRefV1,
	OverlayResultV1,
	OverlayV1,
	PopoverInputV1,
	PromptInputV1,
	ScopeV1,
	ToastInputV1,
} from '@lushly-dev/loam-sdk';

import { SHELL_OWNER } from './overlay-owner.js';

export { SHELL_OWNER };

/** Most toasts on screen; a further one dismisses the oldest. */
export const TOAST_CAP = 5;

/** How many closed overlays still answer `waitOverlay`, so one that closes first is not lost. */
const CLOSED_KEPT = 64;

/** An agent's overlay owner: `agent:<id>` (phase 4 specification, 6.1). */
export const AGENT_OWNER_PREFIX = 'agent:';

/** Whose an overlay is: the kind decides, the id names it (`shell`, the instance, or `agent:<id>`). */
export type OverlayOwner =
	| { kind: 'shell'; id: typeof SHELL_OWNER }
	| { kind: 'app'; id: string }
	| { kind: 'agent'; id: string };

/** The shell's own owner. */
export const SHELL: OverlayOwner = Object.freeze({ kind: 'shell', id: SHELL_OWNER });

/** An app instance as an owner. */
export const appOwner = (instance: string): OverlayOwner => ({ kind: 'app', id: instance });

/** Whether `owner` is the app instance `instance`, never the shell or an agent of the same name. */
export const isApp = (owner: OverlayOwner | undefined, instance: string): boolean =>
	owner?.kind === 'app' && owner.id === instance;

/** Whether the slot holds the shell's own modal or prompt, by its owner's kind. */
export const shellModalOpen = (store: Pick<OverlayStore, 'modalOpen' | 'ownerOf'>): boolean => {
	const modal = store.modalOpen();
	return modal !== undefined && store.ownerOf(modal.overlayId)?.kind === 'shell';
};

/** The kinds and their inputs. */
export interface OverlayInputs {
	toast: ToastInputV1;
	modal: ModalInputV1;
	popover: PopoverInputV1;
	dialog: DialogInputV1;
	prompt: PromptInputV1;
	global: GlobalInputV1;
}

/** The kinds that hold the slot (6.1): one of them at a time, shell-wide. */
export const SLOT_KINDS: ReadonlySet<string> = new Set(['modal', 'prompt']);

/** The answer a kind closes with when no one chose one: a question cancels, anything else is dismissed. */
export const unanswered = (kind: string): 'cancel' | 'dismissed' =>
	kind === 'modal' || kind === 'prompt' || kind === 'dialog' ? 'cancel' : 'dismissed';

/**
 * What the kernel's own prompts carry (6.1), set by the kernel alone: the command asked for, and who raised it; from
 * step 6, which of its prompts it is (7.1 to 7.3), and a confirmation's input as it will run.
 */
export interface OverlayFor {
	command: string;
	caller?: string;
	kind?: 'input' | 'confirmation' | 'close';
	input?: unknown;
	/** The palette's input prompt: the scope it opened in, which its fill runs in (7.1). */
	scope?: ScopeV1;
	/** The close prompt: the tab whose close it asks about (7.3), and its document. */
	tab?: string;
	document?: string;
}

/** What `open` takes besides the input: whose line the shell shows, and when it opened, on the call's clock. */
export interface OverlayOpenOptions {
	from?: OverlayFromV1;
	openedAt?: number;
	/** The kernel's own prompts only (6.1); never from an input. */
	for?: OverlayFor;
	/** The scope an app's question was opened in (D83): its element's mount is bound to it. */
	scope?: ScopeV1;
}

/** The overlays and their waiters, the kernel's own state. */
export interface OverlayStore {
	/**
	 * Every open or parked overlay, or only those of the app instance `instance`. An app's view never says what the
	 * person's settings made of its overlays (step 5's R2): no `hidden`, and a toast's `notification` only on its own
	 * sticky one.
	 */
	list(instance?: string): OverlayV1[];
	/** What holds the slot: the open modal or prompt (6.1). */
	modalOpen(): OverlayV1 | undefined;
	/** How many dialogs, open or parked, `owner` holds, for `OVERLAY_LIMIT` (6.1). */
	dialogsOf(owner: OverlayOwner): number;
	/** What a kernel prompt carries (6.1), on an open or recently closed overlay. */
	forOf(overlayId: string): OverlayFor | undefined;
	/** Set the global strip `input.id`, replacing one of the same id; or close it with `null` (6.1). */
	setGlobal(id: string, input: GlobalInputV1 | null): OverlayRefV1 | undefined;
	/** Whose the open or recently closed overlay is. */
	ownerOf(overlayId: string): OverlayOwner | undefined;
	open<K extends keyof OverlayInputs>(
		owner: OverlayOwner,
		kind: K,
		input: OverlayInputs[K],
		options?: OverlayOpenOptions
	): OverlayRefV1;
	/**
	 * An agent's toast (6.1, F7): with the region full, it dismisses the oldest toast that is neither the shell's nor
	 * `danger`, and opens nothing when every toast is one of those, answering undefined.
	 */
	openAgentToast(
		owner: OverlayOwner,
		input: ToastInputV1,
		options?: OverlayOpenOptions
	): OverlayRefV1 | undefined;
	/**
	 * A toast that also landed in the inbox (6.1): its notice's id on the open record, so a sticky toast's "Open inbox"
	 * opens the inbox at it (6.7). Nothing for an overlay that is not an open toast.
	 */
	land(overlayId: string, notification: string): void;
	/**
	 * The next toast `open` makes is a muted app's (3.7; step 5's R2): held and timed as any toast, so the app sees the
	 * same course, but the shell does not show it. The shell's list marks it `hidden`; the app's never does. Set at
	 * once before the call that opens it and cleared after; `open` takes it.
	 */
	hideNext(on: boolean): void;
	get(overlayId: string): OverlayV1 | undefined;
	/** When an open toast opened, on the call's clock, for a full region's `retryAfterMs`. */
	openedAt(overlayId: string): number | undefined;
	/** `byPerson`: a person's own gesture closed it, which a view's cooldown counts (#1054); anyone else's does not. */
	close(
		overlayId: string,
		result: OverlayResultV1['result'],
		reason: OverlayReasonV1,
		value?: unknown,
		byPerson?: boolean
	): OverlayResultV1 | undefined;
	/** Whether a person's own gesture closed the overlay, of those recently closed. */
	closedByPerson(overlayId: string): boolean;
	/** Forget everything, as a reload does; replay calls it between the sessions of one journal. */
	reset(): void;
	/**
	 * Close the app instance `instance`'s overlays on an app switch: its toasts dismissed, its modal and prompt
	 * cancelled, its dialogs parked (`park`) or, with `cancelOnLeave`, cancelled; and every popover, whoever owns it,
	 * since a popover closes on a switch (6.1). The toasts it dismissed; those that land in the inbox did so when they
	 * were shown (step 5), so a switch adds none.
	 */
	closeForSwitch(instance: string | null): OverlayV1[];
	/** Open the app instance `instance`'s parked dialogs again (`restore`), as it becomes active (6.1, 6.2). */
	restore(instance: string): void;
	/**
	 * Close every app's question opened in a scope other than `to`, parked dialogs included (`app-switch`): its element
	 * was bound to that scope (D83), so it is never restored in another. Answers how many it closed.
	 */
	closeOutOfScope(to: ScopeV1): number;
	/** How many changes of person this store has closed everything for: a waiting open checks it (the review's 3). */
	people(): number;
	/** The moves an overlay made, in order, while open or recently closed (6.2). */
	movesOf(overlayId: string): OverlayReasonV1[];
	/**
	 * Close every overlay, sticky toasts, parked dialogs and the global strip included, with `reason`: a change of
	 * person's `person` (6.2).
	 */
	closeAll(reason: OverlayReasonV1): void;
	/** Who owns the overlay, and its result when it closes, or at once if it has; undefined if unknown. */
	whenClosed(overlayId: string):
		| {
				owner: OverlayOwner;
				settled: Promise<OverlayResultV1>;
				/**
				 * Whether a person's own gesture closed it, as the close recorded it: never read later from the bounded history
				 * (phase 4's step 6, sixth round, B4).
				 */
				byPerson: Promise<boolean>;
		  }
		| undefined;
}

/** A detached copy, so no caller holds the store's own record or input (step 1's review). */
const detached = <T>(value: T): T => structuredClone(value);

interface Closed {
	owner: OverlayOwner;
	result: OverlayResultV1;
	moves: OverlayReasonV1[];
	for?: OverlayFor;
	byPerson: boolean;
}

export function createOverlayStore(): OverlayStore {
	const open = new Map<string, OverlayV1>();
	const owners = new Map<string, OverlayOwner>();
	const opened = new Map<string, number>();
	const parked = new Set<string>();
	const fors = new Map<string, OverlayFor>();
	const moves = new Map<string, OverlayReasonV1[]>();
	const globals = new Map<string, string>();
	const scopes = new Map<string, ScopeV1>();
	let people = 0;
	const closed = new Map<string, Closed>();
	const waiters = new Map<string, Array<(result: OverlayResultV1, byPerson: boolean) => void>>();
	let counter = 0;

	/**
	 * The toasts a new one counts against for the cap (6.1): the shown ones for a shown toast, the hidden for a hidden
	 * one, so a muted app's unseen toasts never push a shown one off (step 5's re-check, improvement 1). The muted app
	 * sees no other app's overlays, so the split is nothing it can read from its own calls.
	 */
	const toasts = (hidden = false) =>
		[...open.values()].filter(
			(overlay) => overlay.kind === 'toast' && (overlay.hidden === true) === hidden
		);
	let nextHidden = false;
	const move = (overlayId: string, reason: OverlayReasonV1) =>
		moves.set(overlayId, [...(moves.get(overlayId) ?? []), reason]);
	/** A detached copy with its state and `for`, as the list shows it. */
	const shown = (overlay: OverlayV1): OverlayV1 => {
		const copy = detached(overlay);
		if (parked.has(overlay.overlayId)) copy.state = 'parked';
		const asked = fors.get(overlay.overlayId);
		if (asked) copy.for = detached(asked);
		const scope = scopes.get(overlay.overlayId);
		if (scope) copy.scope = { ...scope };
		return copy;
	};

	function add(
		owner: OverlayOwner,
		kind: keyof OverlayInputs,
		input: OverlayInputs[keyof OverlayInputs],
		options: OverlayOpenOptions = {}
	): OverlayRefV1 {
		const ref: OverlayRefV1 = {
			overlayId: `ovl-${++counter}`,
			owner: owner.id,
			kind,
			lifetime: kind === 'toast' || kind === 'popover' ? 'transient' : 'session',
		};
		open.set(ref.overlayId, {
			...ref,
			input: detached(input),
			// Never on the shell's own (6.6), whatever an option says.
			...(options.from && owner.kind !== 'shell' ? { from: detached(options.from) } : {}),
		});
		owners.set(ref.overlayId, { ...owner });
		if (options.openedAt !== undefined) opened.set(ref.overlayId, options.openedAt);
		// Only the shell's own prompts carry `for` (6.1).
		if (options.for && owner.kind === 'shell' && kind === 'prompt') {
			fors.set(ref.overlayId, detached(options.for));
		}
		if (options.scope && (owner.kind === 'app' || owner.kind === 'agent'))
			scopes.set(ref.overlayId, { ...options.scope });
		return { ...ref };
	}

	const store: OverlayStore = {
		list(instance) {
			const all = [...open.values()].map(shown);
			if (instance === undefined) return all;
			return all
				.filter((overlay) => isApp(owners.get(overlay.overlayId), instance))
				.map((overlay) => {
					delete overlay.hidden;
					if (!(overlay.input as ToastInputV1).sticky) delete overlay.notification;
					return overlay;
				});
		},
		modalOpen() {
			const held = [...open.values()].find((overlay) => SLOT_KINDS.has(overlay.kind));
			return held && shown(held);
		},
		dialogsOf(owner) {
			return [...open.values()].filter((overlay) => {
				const each = owners.get(overlay.overlayId);
				return overlay.kind === 'dialog' && each?.kind === owner.kind && each.id === owner.id;
			}).length;
		},
		forOf(overlayId) {
			const asked = fors.get(overlayId) ?? closed.get(overlayId)?.for;
			return asked && detached(asked);
		},
		setGlobal(id, input) {
			const held = globals.get(id);
			// Replaced by its id's next, or withdrawn when its condition ends.
			if (held !== undefined) store.close(held, 'dismissed', input ? 'replaced' : 'withdrawn');
			if (!input) return undefined;
			const ref = add(SHELL, 'global', input);
			globals.set(id, ref.overlayId);
			return ref;
		},
		ownerOf(overlayId) {
			const owner = owners.get(overlayId) ?? closed.get(overlayId)?.owner;
			return owner && { ...owner };
		},
		open(owner, kind, input, options) {
			const hidden = kind === 'toast' && nextHidden;
			nextHidden = false;
			if (kind === 'toast') {
				const shownToasts = toasts(hidden);
				const oldest = shownToasts.length >= TOAST_CAP ? shownToasts[0] : undefined;
				if (oldest) store.close(oldest.overlayId, 'dismissed', 'cap');
			}
			if (kind === 'popover') {
				// One on screen (6.1's "one per invoker", the review's I10): the platform shows one `auto` popover at a
				// time, so a new one replaces any other here, never as a dismissal the person did not make.
				for (const overlay of [...open.values()]) {
					if (overlay.kind === 'popover') store.close(overlay.overlayId, 'dismissed', 'replaced');
				}
			}
			const ref = add(owner, kind, input, options);
			if (hidden) (open.get(ref.overlayId) as OverlayV1).hidden = true;
			return ref;
		},
		openAgentToast(owner, input, options) {
			const shownToasts = toasts();
			if (shownToasts.length >= TOAST_CAP) {
				const evictable = shownToasts.find(
					(overlay) =>
						owners.get(overlay.overlayId)?.kind !== 'shell' &&
						(overlay.input as ToastInputV1).tone !== 'danger'
				);
				if (!evictable) return undefined;
				store.close(evictable.overlayId, 'dismissed', 'cap');
			}
			return add(owner, 'toast', input, options);
		},
		land(overlayId, notification) {
			const overlay = open.get(overlayId);
			if (overlay?.kind === 'toast') overlay.notification = notification;
		},
		hideNext(on) {
			nextHidden = on;
		},
		get(overlayId) {
			const overlay = open.get(overlayId);
			return overlay && shown(overlay);
		},
		openedAt: (overlayId) => opened.get(overlayId),
		closedByPerson: (overlayId) => closed.get(overlayId)?.byPerson === true,
		close(overlayId, result, reason, value, byPerson) {
			const overlay = open.get(overlayId);
			const owner = owners.get(overlayId);
			if (!overlay || !owner) return undefined;
			open.delete(overlayId);
			owners.delete(overlayId);
			opened.delete(overlayId);
			parked.delete(overlayId);
			scopes.delete(overlayId);
			if (overlay.kind === 'global') globals.delete((overlay.input as GlobalInputV1).id);
			const asked = fors.get(overlayId);
			fors.delete(overlayId);
			const moved = [...(moves.get(overlayId) ?? []), reason];
			moves.delete(overlayId);
			const outcome: OverlayResultV1 = {
				overlayId,
				result,
				reason,
				...(value !== undefined ? { value: detached(value) } : {}),
			};
			closed.set(overlayId, {
				owner,
				result: outcome,
				moves: moved,
				byPerson: byPerson === true,
				...(asked ? { for: asked } : {}),
			});
			for (const old of closed.keys()) {
				if (closed.size <= CLOSED_KEPT) break;
				closed.delete(old);
			}
			for (const resolve of waiters.get(overlayId) ?? [])
				resolve(detached(outcome), byPerson === true);
			waiters.delete(overlayId);
			return detached(outcome);
		},
		reset() {
			// A reload is a new page: a waiting open from before it opens nothing either.
			people++;
			open.clear();
			owners.clear();
			opened.clear();
			parked.clear();
			scopes.clear();
			fors.clear();
			moves.clear();
			globals.clear();
			closed.clear();
			waiters.clear();
			counter = 0;
		},
		closeForSwitch(instance) {
			const dismissed: OverlayV1[] = [];
			for (const overlay of [...open.values()]) {
				const mine = instance !== null && isApp(owners.get(overlay.overlayId), instance);
				if (!mine && overlay.kind !== 'popover') continue;
				if (overlay.kind === 'toast') dismissed.push(detached(overlay));
				if (overlay.kind === 'dialog' && (overlay.input as DialogInputV1).cancelOnLeave !== true) {
					// Parked, not closed (6.1, 6.2): it stays its app's, and comes back when the app does.
					if (!parked.has(overlay.overlayId)) {
						parked.add(overlay.overlayId);
						move(overlay.overlayId, 'park');
					}
					continue;
				}
				store.close(overlay.overlayId, unanswered(overlay.kind), 'app-switch');
			}
			return dismissed;
		},
		restore(instance) {
			for (const overlayId of [...parked]) {
				if (!isApp(owners.get(overlayId), instance)) continue;
				parked.delete(overlayId);
				move(overlayId, 'restore');
			}
		},
		closeOutOfScope(to) {
			let count = 0;
			for (const [overlayId, scope] of [...scopes]) {
				if (owners.get(overlayId)?.kind !== 'app') continue;
				const same =
					scope.workspace === to.workspace &&
					(scope.project === undefined || scope.project === to.project);
				if (same) continue;
				const overlay = open.get(overlayId);
				if (overlay && store.close(overlayId, unanswered(overlay.kind), 'app-switch')) count++;
			}
			return count;
		},
		people: () => people,
		movesOf(overlayId) {
			return [...(moves.get(overlayId) ?? closed.get(overlayId)?.moves ?? [])];
		},
		closeAll(reason) {
			if (reason === 'person') people++;
			for (const overlay of [...open.values()]) {
				store.close(overlay.overlayId, unanswered(overlay.kind), reason);
			}
		},
		whenClosed(overlayId) {
			const done = closed.get(overlayId);
			if (done)
				return {
					owner: { ...done.owner },
					settled: Promise.resolve(detached(done.result)),
					byPerson: Promise.resolve(done.byPerson),
				};
			const live = open.get(overlayId);
			const owner = owners.get(overlayId);
			if (!live || !owner) return undefined;
			let gesture: (byPerson: boolean) => void = () => {};
			const byPerson = new Promise<boolean>((resolve) => {
				gesture = resolve;
			});
			return {
				owner: { ...owner },
				settled: new Promise((resolve) => {
					waiters.set(overlayId, [
						...(waiters.get(overlayId) ?? []),
						(result, person) => {
							gesture(person);
							resolve(result);
						},
					]);
				}),
				byPerson,
			};
		},
	};
	return store;
}

/**
 * Whether a toast also lands in the inbox (6.1, 3.7's `loam.notifications.toastSticky`): a sticky one always; else
 * every toast with `'always'`, a `danger` one with `'danger'`, the default, and none with `'never'`. The inbox's
 * `toast-show` (step 5, `late/notifications.ts`) decides by it.
 */
export function landsInInbox(
	input: Pick<ToastInputV1, 'sticky' | 'tone'>,
	toastSticky: 'never' | 'danger' | 'always' = 'danger'
): boolean {
	if (input.sticky === true) return true;
	return toastSticky === 'always' || (toastSticky === 'danger' && input.tone === 'danger');
}
