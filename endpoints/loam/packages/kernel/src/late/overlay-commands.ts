/**
 * @fileoverview The overlay commands; the store they run on is in `overlays.ts` (phase 1 specification,
 * section 8).
 */

import { type CommandContext, success } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	type JsonSchema,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type {
	ModalInputV1,
	OverlayRefV1,
	OverlayResultV1,
	OverlayV1,
	ToastInputV1,
} from '@lushly-dev/loam-sdk';
import * as z from 'zod/mini';
import { EMPTY_INPUT_JSON, emptyInput } from '../boot-commands.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { type OverlayStore, SHELL_OWNER } from '../overlays.js';

/** A toast's duration when it names none, in milliseconds. */
const TOAST_DEFAULT_MS = 5000;

const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
const PLAIN_TEXT = 'Plain text';

const toastInput = z.strictObject({
	message: text(200).check(z.describe(PLAIN_TEXT)),
	tone: z.optional(z.enum(['info', 'success', 'warning', 'danger'])),
	durationMs: z.optional(z.number().check(z.int(), z.minimum(1000), z.maximum(30000))),
});

const modalInput = z.strictObject({
	title: text(80),
	body: text(1000).check(z.describe(PLAIN_TEXT)),
	confirmLabel: z.optional(text(40)),
	cancelLabel: z.optional(text(40)),
	danger: z.optional(z.boolean()),
});

const dismissInput = z.strictObject({
	overlayId: text(64),
	result: z.optional(z.enum(['confirm', 'cancel'])),
	reason: z.optional(z.enum(['timeout', 'user'])),
});

const textJson = (maxLength: number): JsonSchema => ({ type: 'string', minLength: 1, maxLength });

const ownerOf = (context: CommandContext): string =>
	(context as KernelFieldContext).caller ?? SHELL_OWNER;

export interface OverlayCommandDeps {
	overlays: OverlayStore;
	activeApp(): string | null;
}

/** `toast-show`, `modal-open`, `overlay-dismiss` and `overlay-list`. */
export function createOverlayCommands(deps: OverlayCommandDeps): ZodCommandDefinition[] {
	const { overlays } = deps;

	const toastShow = defineCommandWithSchema<typeof toastInput, OverlayRefV1>({
		name: 'toast-show',
		title: 'Show a toast',
		description: 'Show a short message that dismisses itself; at most five stay on screen',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: toastInput,
		jsonSchema: {
			type: 'object',
			properties: {
				message: { ...textJson(200), description: PLAIN_TEXT },
				tone: { type: 'string', enum: ['info', 'success', 'warning', 'danger'] },
				durationMs: { type: 'integer', minimum: 1000, maximum: 30000 },
			},
			required: ['message'],
			additionalProperties: false,
		},
		async handler(input, context) {
			return success(
				overlays.open(ownerOf(context), 'toast', {
					...(input as ToastInputV1),
					durationMs: input.durationMs ?? TOAST_DEFAULT_MS,
				})
			);
		},
	});

	const modalOpen = defineCommandWithSchema<typeof modalInput, OverlayRefV1>({
		name: 'modal-open',
		title: 'Open a modal',
		description: 'Ask a question in a modal dialog with a confirm and a cancel button, as text',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: modalInput,
		jsonSchema: {
			type: 'object',
			properties: {
				title: textJson(80),
				body: { ...textJson(1000), description: PLAIN_TEXT },
				confirmLabel: textJson(40),
				cancelLabel: textJson(40),
				danger: { type: 'boolean' },
			},
			required: ['title', 'body'],
			additionalProperties: false,
		},
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

	const overlayDismiss = defineCommandWithSchema<typeof dismissInput, OverlayResultV1>({
		name: 'overlay-dismiss',
		title: 'Dismiss an overlay',
		description: 'Close an open toast or modal; a modal defaults to cancel',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: dismissInput,
		jsonSchema: {
			type: 'object',
			properties: {
				overlayId: textJson(64),
				result: { type: 'string', enum: ['confirm', 'cancel'] },
				reason: { type: 'string', enum: ['timeout', 'user'] },
			},
			required: ['overlayId'],
			additionalProperties: false,
		},
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

	const overlayList = defineCommandWithSchema<typeof emptyInput, { overlays: OverlayV1[] }>({
		name: 'overlay-list',
		description: 'List the open overlays; an app sees only its own',
		category: 'overlay',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler(_input, context) {
			return success({ overlays: overlays.list((context as KernelFieldContext).caller) });
		},
	});

	return [toastShow, modalOpen, overlayDismiss, overlayList] as unknown as ZodCommandDefinition[];
}
