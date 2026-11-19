/**
 * @fileoverview The overlay store (phase 1 specification, section 8; phase 4 specification, 6): toasts, modals and,
 * from phase 4, popovers. The kernel holds the state, so a replay reproduces every id and every move; the chrome
 * renders it and runs a toast's timer. Every overlay is `open` here or `closed` in what `whenClosed` answers (6.2);
 * the `parked` state is the dialogs', which step 4 adds beside these kinds.
 *
 * Whose an overlay is, is a kind as well as an id (the step 3 review's R-d): the shell's, an app instance's or an
 * agent's. Every decision reads the kind, never an id compared with `shell`, so no instance id passes for the shell.
 */

import type {
	ModalInputV1,
	OverlayFromV1,
	OverlayReasonV1,
	OverlayRefV1,
	OverlayResultV1,
	OverlayV1,
	PopoverInputV1,
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

/** Whether the open modal is the shell's own, by its owner's kind. */
export const shellModalOpen = (store: Pick<OverlayStore, 'modalOpen' | 'ownerOf'>): boolean => {
	const modal = store.modalOpen();
	return modal !== undefined && store.ownerOf(modal.overlayId)?.kind === 'shell';
};

/** The kinds and their inputs. */
export interface OverlayInputs {
	toast: ToastInputV1;
	modal: ModalInputV1;
	popover: PopoverInputV1;
}

/** What `open` takes besides the input: whose line the shell shows, and when it opened, on the call's clock. */
export interface OverlayOpenOptions {
	from?: OverlayFromV1;
	openedAt?: number;
}

/** The overlays and their waiters, the kernel's own state. */
export interface OverlayStore {
	/**
	 * Every open overlay, or only those of the app instance `instance`. An app's view never says what the person's
	 * settings made of its overlays (step 5's R2): no `hidden`, and a toast's `notification` only on its own sticky one.
	 */
	list(instance?: string): OverlayV1[];
	modalOpen(): OverlayV1 | undefined;
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
	close(
		overlayId: string,
		result: OverlayResultV1['result'],
		reason: OverlayReasonV1,
		value?: number
	): OverlayResultV1 | undefined;
	/** Forget everything, as a reload does; replay calls it between the sessions of one journal. */
	reset(): void;
	/**
	 * Close the app instance `instance`'s overlays on an app switch: its toasts dismissed, its modal cancelled; and
	 * every popover, whoever owns it, since a popover closes on a switch (6.1). The toasts it dismissed; those that land
	 * in the inbox did so when they were shown (step 5), so a switch adds none.
	 */
	closeForSwitch(instance: string | null): OverlayV1[];
	/** Close every overlay, sticky toasts included, with `reason`: a change of person's `person` (6.2). */
	closeAll(reason: OverlayReasonV1): void;
	/** Who owns the overlay, and its result when it closes, or at once if it has; undefined if unknown. */
	whenClosed(
		overlayId: string
	): { owner: OverlayOwner; settled: Promise<OverlayResultV1> } | undefined;
}

/** A detached copy, so no caller holds the store's own record or input (step 1's review). */
const detached = (overlay: OverlayV1): OverlayV1 => structuredClone(overlay);

export function createOverlayStore(): OverlayStore {
	const open = new Map<string, OverlayV1>();
	const owners = new Map<string, OverlayOwner>();
	const opened = new Map<string, number>();
	const closed = new Map<string, { owner: OverlayOwner; result: OverlayResultV1 }>();
	const waiters = new Map<string, Array<(result: OverlayResultV1) => void>>();
	let counter = 0;

	/**
	 * The toasts a new one counts against for the cap (6.1): the shown ones for a shown toast, the hidden for a hidden
	 * one, so a muted app's unseen toasts never push a shown one off (the re-check's improvement 1). The muted app sees
	 * no other app's overlays, so the split is nothing it can read.
	 */
	const toasts = (hidden = false) =>
		[...open.values()].filter(
			(overlay) => overlay.kind === 'toast' && (overlay.hidden === true) === hidden
		);
	let nextHidden = false;

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
			lifetime: kind === 'modal' ? 'session' : 'transient',
		};
		open.set(ref.overlayId, {
			...ref,
			input: structuredClone(input),
			// Never on the shell's own (6.6), whatever an option says.
			...(options.from && owner.kind !== 'shell' ? { from: structuredClone(options.from) } : {}),
		});
		owners.set(ref.overlayId, { ...owner });
		if (options.openedAt !== undefined) opened.set(ref.overlayId, options.openedAt);
		return { ...ref };
	}

	const store: OverlayStore = {
		list(instance) {
			const all = [...open.values()].map(detached);
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
			const modal = [...open.values()].find((overlay) => overlay.kind === 'modal');
			return modal && detached(modal);
		},
		ownerOf(overlayId) {
			const owner = owners.get(overlayId) ?? closed.get(overlayId)?.owner;
			return owner && { ...owner };
		},
		open(owner, kind, input, options) {
			const hidden = kind === 'toast' && nextHidden;
			nextHidden = false;
			if (kind === 'toast') {
				const shown = toasts(hidden);
				const oldest = shown.length >= TOAST_CAP ? shown[0] : undefined;
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
			const shown = toasts();
			if (shown.length >= TOAST_CAP) {
				const evictable = shown.find(
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
			return overlay && detached(overlay);
		},
		openedAt: (overlayId) => opened.get(overlayId),
		close(overlayId, result, reason, value) {
			const overlay = open.get(overlayId);
			const owner = owners.get(overlayId);
			if (!overlay || !owner) return undefined;
			open.delete(overlayId);
			owners.delete(overlayId);
			opened.delete(overlayId);
			const outcome: OverlayResultV1 = {
				overlayId,
				result,
				reason,
				...(value !== undefined ? { value } : {}),
			};
			closed.set(overlayId, { owner, result: outcome });
			for (const old of closed.keys()) {
				if (closed.size <= CLOSED_KEPT) break;
				closed.delete(old);
			}
			for (const resolve of waiters.get(overlayId) ?? []) resolve({ ...outcome });
			waiters.delete(overlayId);
			return { ...outcome };
		},
		reset() {
			open.clear();
			owners.clear();
			opened.clear();
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
				store.close(
					overlay.overlayId,
					overlay.kind === 'modal' ? 'cancel' : 'dismissed',
					'app-switch'
				);
			}
			return dismissed;
		},
		closeAll(reason) {
			for (const overlay of [...open.values()]) {
				store.close(overlay.overlayId, overlay.kind === 'modal' ? 'cancel' : 'dismissed', reason);
			}
		},
		whenClosed(overlayId) {
			const done = closed.get(overlayId);
			if (done) return { owner: { ...done.owner }, settled: Promise.resolve({ ...done.result }) };
			const live = open.get(overlayId);
			const owner = owners.get(overlayId);
			if (!live || !owner) return undefined;
			return {
				owner: { ...owner },
				settled: new Promise((resolve) => {
					waiters.set(overlayId, [...(waiters.get(overlayId) ?? []), resolve]);
				}),
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
