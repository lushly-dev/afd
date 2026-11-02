/**
 * @fileoverview Toast and modal, the two overlay kinds phase 1 builds (phase 1 specification,
 * section 8). The kernel holds the state, so a replay reproduces every id and dismissal; the chrome
 * renders it and runs a toast's timer.
 */

import { type CommandContext, success } from '@lushly-dev/afd-core';
import { defineCommand, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type {
	ModalInputV1,
	OverlayRefV1,
	OverlayResultV1,
	OverlayV1,
	ToastInputV1,
} from '@lushly-dev/loam-sdk';
import { z } from 'zod';
import type { KernelFieldContext } from './context-fields.js';
import { kernelFailure } from './errors.js';

/** The owner of an overlay a person or an agent opened. */
export const SHELL_OWNER = 'shell';

/** Most toasts on screen; a further one dismisses the oldest. */
export const TOAST_CAP = 5;

/** A toast's duration when it names none, in milliseconds. */
const TOAST_DEFAULT_MS = 5000;

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

const toastInput = z.strictObject({
	message: z.string().min(1).max(200).describe('Plain text'),
	tone: z.enum(['info', 'success', 'warning', 'danger']).optional(),
	durationMs: z.number().int().min(1000).max(30000).optional(),
});

const modalInput = z.strictObject({
	title: z.string().min(1).max(80),
	body: z.string().min(1).max(1000).describe('Plain text'),
	confirmLabel: z.string().min(1).max(40).optional(),
	cancelLabel: z.string().min(1).max(40).optional(),
	danger: z.boolean().optional(),
});

const dismissInput = z.strictObject({
	overlayId: z.string().min(1).max(64),
	result: z.enum(['confirm', 'cancel']).optional(),
	reason: z.enum(['timeout', 'user']).optional(),
});

const empty = z.strictObject({});

const ownerOf = (context: CommandContext): string =>
	(context as KernelFieldContext).caller ?? SHELL_OWNER;

export interface OverlayCommandDeps {
	overlays: OverlayStore;
	activeApp(): string | null;
}

/** `toast-show`, `modal-open`, `overlay-dismiss` and `overlay-list`. */
export function createOverlayCommands(deps: OverlayCommandDeps): ZodCommandDefinition[] {
	const { overlays } = deps;

	const toastShow = defineCommand<typeof toastInput, OverlayRefV1>({
		name: 'toast-show',
		title: 'Show a toast',
		description: 'Show a short message that dismisses itself; at most five stay on screen',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: toastInput,
		async handler(input, context) {
			return success(
				overlays.open(ownerOf(context), 'toast', {
					...(input as ToastInputV1),
					durationMs: input.durationMs ?? TOAST_DEFAULT_MS,
				})
			);
		},
	});

	const modalOpen = defineCommand<typeof modalInput, OverlayRefV1>({
		name: 'modal-open',
		title: 'Open a modal',
		description: 'Ask a question in a modal dialog with a confirm and a cancel button, as text',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: modalInput,
		async handler(input, context) {
			const owner = ownerOf(context);
			if (owner !== SHELL_OWNER && owner !== deps.activeApp()) {
				return kernelFailure(
					'OVERLAY_OWNER_INACTIVE',
					`The app '${owner}' is not active, so it cannot open a modal`,
					'Show a toast instead, or open the modal when the app is active'
				);
			}
			if (overlays.modalOpen()) {
				return kernelFailure(
					'OVERLAY_MODAL_BUSY',
					'A modal is already open',
					'Wait for it to close, or dismiss it with overlay-dismiss',
					{ retryable: true }
				);
			}
			return success(overlays.open(owner, 'modal', input as ModalInputV1));
		},
	});

	const overlayDismiss = defineCommand<typeof dismissInput, OverlayResultV1>({
		name: 'overlay-dismiss',
		title: 'Dismiss an overlay',
		description: 'Close an open toast or modal; a modal defaults to cancel',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: dismissInput,
		async handler(input, context) {
			const overlay = overlays.get(input.overlayId);
			if (!overlay) {
				return kernelFailure(
					'OVERLAY_NOT_FOUND',
					`Overlay '${input.overlayId}' is not open`,
					'List the open overlays with overlay-list'
				);
			}
			const { caller } = context as KernelFieldContext;
			if (caller !== undefined && overlay.owner !== caller) {
				return kernelFailure(
					'OVERLAY_NOT_OWNER',
					`Overlay '${input.overlayId}' belongs to another app`,
					'Dismiss only overlays this app opened'
				);
			}
			const outcome = overlays.close(
				input.overlayId,
				input.result ?? (overlay.kind === 'modal' ? 'cancel' : 'dismissed'),
				input.reason ?? 'user'
			);
			return success(outcome as OverlayResultV1);
		},
	});

	const overlayList = defineCommand<typeof empty, { overlays: OverlayV1[] }>({
		name: 'overlay-list',
		description: 'List the open overlays; an app sees only its own',
		category: 'overlay',
		mutation: false,
		executionTime: 'instant',
		input: empty,
		async handler(_input, context) {
			return success({ overlays: overlays.list((context as KernelFieldContext).caller) });
		},
	});

	return [toastShow, modalOpen, overlayDismiss, overlayList] as unknown as ZodCommandDefinition[];
}
