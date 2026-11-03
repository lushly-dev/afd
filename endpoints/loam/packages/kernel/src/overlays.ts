/**
 * @fileoverview Toast and modal, the two overlay kinds phase 1 builds (phase 1 specification,
 * section 8). The kernel holds the state, so a replay reproduces every id and dismissal; the chrome
 * renders it and runs a toast's timer.
 */

import type {
	ModalInputV1,
	OverlayRefV1,
	OverlayResultV1,
	OverlayV1,
	ToastInputV1,
} from '@lushly-dev/loam-sdk';

/** The owner of an overlay a person or an agent opened. */
export const SHELL_OWNER = 'shell';

/** Most toasts on screen; a further one dismisses the oldest. */
export const TOAST_CAP = 5;

/** How many closed overlays still answer `waitOverlay`, so one that closes first is not lost. */
const CLOSED_KEPT = 64;

type DismissReason = OverlayResultV1['reason'];

/** The overlays and their waiters, the kernel's own state. */
export interface OverlayStore {
	list(owner?: string): OverlayV1[];
	modalOpen(): OverlayV1 | undefined;
	open(owner: string, kind: 'toast', input: ToastInputV1): OverlayRefV1;
	open(owner: string, kind: 'modal', input: ModalInputV1): OverlayRefV1;
	get(overlayId: string): OverlayV1 | undefined;
	close(
		overlayId: string,
		result: OverlayResultV1['result'],
		reason: DismissReason
	): OverlayResultV1 | undefined;
	/** Forget everything, as a reload does; replay calls it between the sessions of one journal. */
	reset(): void;
	/** Close `owner`'s overlays on an app switch: its toasts dismissed, its modal cancelled. */
	closeForSwitch(owner: string): void;
	/** Who owns the overlay, and its result when it closes, or at once if it has; undefined if unknown. */
	whenClosed(overlayId: string): { owner: string; settled: Promise<OverlayResultV1> } | undefined;
}

export function createOverlayStore(): OverlayStore {
	const open = new Map<string, OverlayV1>();
	const closed = new Map<string, { owner: string; result: OverlayResultV1 }>();
	const waiters = new Map<string, Array<(result: OverlayResultV1) => void>>();
	let counter = 0;

	const store: OverlayStore = {
		list(owner) {
			const all = [...open.values()].map((overlay) => ({ ...overlay }));
			return owner === undefined ? all : all.filter((overlay) => overlay.owner === owner);
		},
		modalOpen() {
			return [...open.values()].find((overlay) => overlay.kind === 'modal');
		},
		open(owner: string, kind: 'toast' | 'modal', input: ToastInputV1 | ModalInputV1) {
			if (kind === 'toast') {
				const toasts = [...open.values()].filter((overlay) => overlay.kind === 'toast');
				const oldest = toasts.length >= TOAST_CAP ? toasts[0] : undefined;
				if (oldest) store.close(oldest.overlayId, 'dismissed', 'cap');
			}
			const ref: OverlayRefV1 = {
				overlayId: `ovl-${++counter}`,
				owner,
				kind,
				lifetime: kind === 'toast' ? 'transient' : 'session',
			};
			open.set(ref.overlayId, { ...ref, input });
			return ref;
		},
		get: (overlayId) => open.get(overlayId),
		close(overlayId, result, reason) {
			const overlay = open.get(overlayId);
			if (!overlay) return undefined;
			open.delete(overlayId);
			const outcome: OverlayResultV1 = { overlayId, result, reason };
			closed.set(overlayId, { owner: overlay.owner, result: outcome });
			for (const old of closed.keys()) {
				if (closed.size <= CLOSED_KEPT) break;
				closed.delete(old);
			}
			for (const resolve of waiters.get(overlayId) ?? []) resolve(outcome);
			waiters.delete(overlayId);
			return outcome;
		},
		reset() {
			open.clear();
			closed.clear();
			waiters.clear();
			counter = 0;
		},
		closeForSwitch(owner) {
			for (const overlay of [...open.values()]) {
				if (overlay.owner !== owner) continue;
				store.close(
					overlay.overlayId,
					overlay.kind === 'modal' ? 'cancel' : 'dismissed',
					'app-switch'
				);
			}
		},
		whenClosed(overlayId) {
			const done = closed.get(overlayId);
			if (done) return { owner: done.owner, settled: Promise.resolve(done.result) };
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
