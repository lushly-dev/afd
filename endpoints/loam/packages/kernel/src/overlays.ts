/**
 * @fileoverview The overlay store (phase 1 specification, section 8; phase 4 specification, 6): toasts, modals and,
 * from phase 4, popovers. The kernel holds the state, so a replay reproduces every id and every move; the chrome
 * renders it and runs a toast's timer. Every overlay is `open` here or `closed` in what `whenClosed` answers (6.2);
 * the `parked` state is the dialogs', which step 4 adds beside these kinds.
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
	list(owner?: string): OverlayV1[];
	modalOpen(): OverlayV1 | undefined;
	open<K extends keyof OverlayInputs>(
		owner: string,
		kind: K,
		input: OverlayInputs[K],
		options?: OverlayOpenOptions
	): OverlayRefV1;
	/**
	 * An agent's toast (6.1, F7): with the region full, it dismisses the oldest toast that is neither the shell's nor
	 * `danger`, and opens nothing when every toast is one of those, answering undefined.
	 */
	openAgentToast(
		owner: string,
		input: ToastInputV1,
		options?: OverlayOpenOptions
	): OverlayRefV1 | undefined;
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
	 * Close `owner`'s overlays on an app switch: its toasts dismissed, its modal cancelled; and every popover, whoever
	 * owns it, since a popover closes on a switch (6.1). The toasts it dismissed, for the inbox's seam (step 5).
	 */
	closeForSwitch(owner: string): OverlayV1[];
	/** Who owns the overlay, and its result when it closes, or at once if it has; undefined if unknown. */
	whenClosed(overlayId: string): { owner: string; settled: Promise<OverlayResultV1> } | undefined;
}

/** A detached copy, so no caller holds the store's own record or input (step 1's review). */
const detached = (overlay: OverlayV1): OverlayV1 => structuredClone(overlay);

export function createOverlayStore(): OverlayStore {
	const open = new Map<string, OverlayV1>();
	const opened = new Map<string, number>();
	const closed = new Map<string, { owner: string; result: OverlayResultV1 }>();
	const waiters = new Map<string, Array<(result: OverlayResultV1) => void>>();
	let counter = 0;

	const toasts = () => [...open.values()].filter((overlay) => overlay.kind === 'toast');

	function add(
		owner: string,
		kind: keyof OverlayInputs,
		input: OverlayInputs[keyof OverlayInputs],
		options: OverlayOpenOptions = {}
	): OverlayRefV1 {
		const ref: OverlayRefV1 = {
			overlayId: `ovl-${++counter}`,
			owner,
			kind,
			lifetime: kind === 'modal' ? 'session' : 'transient',
		};
		open.set(ref.overlayId, {
			...ref,
			input: structuredClone(input),
			...(options.from ? { from: structuredClone(options.from) } : {}),
		});
		if (options.openedAt !== undefined) opened.set(ref.overlayId, options.openedAt);
		return { ...ref };
	}

	const store: OverlayStore = {
		list(owner) {
			const all = [...open.values()].map(detached);
			return owner === undefined ? all : all.filter((overlay) => overlay.owner === owner);
		},
		modalOpen() {
			const modal = [...open.values()].find((overlay) => overlay.kind === 'modal');
			return modal && detached(modal);
		},
		open(owner, kind, input, options) {
			if (kind === 'toast') {
				const shown = toasts();
				const oldest = shown.length >= TOAST_CAP ? shown[0] : undefined;
				if (oldest) store.close(oldest.overlayId, 'dismissed', 'cap');
			}
			if (kind === 'popover') {
				// One per invoker (6.1): the same owner's popover on the same anchor is replaced.
				const { surface, anchor } = (input as PopoverInputV1).anchor;
				for (const overlay of [...open.values()]) {
					if (overlay.kind !== 'popover' || overlay.owner !== owner) continue;
					const held = (overlay.input as PopoverInputV1).anchor;
					if (held.surface === surface && held.anchor === anchor)
						store.close(overlay.overlayId, 'dismissed', 'replaced');
				}
			}
			return add(owner, kind, input, options);
		},
		openAgentToast(owner, input, options) {
			const shown = toasts();
			if (shown.length >= TOAST_CAP) {
				const evictable = shown.find(
					(overlay) =>
						overlay.owner !== SHELL_OWNER && (overlay.input as ToastInputV1).tone !== 'danger'
				);
				if (!evictable) return undefined;
				store.close(evictable.overlayId, 'dismissed', 'cap');
			}
			return add(owner, 'toast', input, options);
		},
		get(overlayId) {
			const overlay = open.get(overlayId);
			return overlay && detached(overlay);
		},
		openedAt: (overlayId) => opened.get(overlayId),
		close(overlayId, result, reason, value) {
			const overlay = open.get(overlayId);
			if (!overlay) return undefined;
			open.delete(overlayId);
			opened.delete(overlayId);
			const outcome: OverlayResultV1 = {
				overlayId,
				result,
				reason,
				...(value !== undefined ? { value } : {}),
			};
			closed.set(overlayId, { owner: overlay.owner, result: outcome });
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
			opened.clear();
			closed.clear();
			waiters.clear();
			counter = 0;
		},
		closeForSwitch(owner) {
			const dismissed: OverlayV1[] = [];
			for (const overlay of [...open.values()]) {
				if (overlay.owner !== owner && overlay.kind !== 'popover') continue;
				if (overlay.kind === 'toast') dismissed.push(detached(overlay));
				store.close(
					overlay.overlayId,
					overlay.kind === 'modal' ? 'cancel' : 'dismissed',
					'app-switch'
				);
			}
			return dismissed;
		},
		whenClosed(overlayId) {
			const done = closed.get(overlayId);
			if (done) return { owner: done.owner, settled: Promise.resolve({ ...done.result }) };
			const live = open.get(overlayId);
			if (!live) return undefined;
			return {
				owner: live.owner,
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
 * every toast with `'always'`, a `danger` one with `'danger'`, the default, and none with `'never'`. The seam the
 * inbox (step 5) pushes through; nothing calls it before then.
 */
export function landsInInbox(
	input: Pick<ToastInputV1, 'sticky' | 'tone'>,
	toastSticky: 'never' | 'danger' | 'always' = 'danger'
): boolean {
	if (input.sticky === true) return true;
	return toastSticky === 'always' || (toastSticky === 'danger' && input.tone === 'danger');
}
