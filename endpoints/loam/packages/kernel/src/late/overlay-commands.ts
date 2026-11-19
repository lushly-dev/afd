/**
 * @fileoverview The overlay commands; the store they run on is in `overlays.ts` (phase 1 specification, section 8;
 * phase 4 specification, 6). Phase 4's step 3 adds the toast's `sticky` and `link`, the owner line, agent toasts and
 * `popover-open`, with 6.1's path table for toasts and popovers; dialogs, modals' paths, prompts and the slot are
 * step 4's.
 */

import { type CommandContext, type CommandResult, success } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	type JsonSchema,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import { saysShellName } from '@lushly-dev/loam-manifest';
import type {
	ModalInputV1,
	OverlayAnchorV1,
	OverlayFromV1,
	OverlayRefV1,
	OverlayResultV1,
	OverlayV1,
	PopoverInputV1,
	ToastInputV1,
} from '@lushly-dev/loam-sdk';
import * as z from 'zod/mini';
import { EMPTY_INPUT_JSON, emptyInput } from '../boot-commands.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure, PAGE_DECIDED } from '../errors.js';
import {
	AGENT_OWNER_PREFIX,
	appOwner,
	type OverlayOwner,
	type OverlayStore,
	SHELL,
	TOAST_CAP,
} from '../overlays.js';
import { AGENT_PUSH_RATE, type PushRate } from './push-rate.js';

/** A toast's duration when it names none, in milliseconds. */
const TOAST_DEFAULT_MS = 5000;

/** Most items in a menu popover. */
export const POPOVER_MENU_ITEMS = 12;

const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
const PLAIN_TEXT = 'Plain text';
const TONES = ['info', 'success', 'warning', 'danger'] as const;

const ID = 128;
const scopeInput = z.strictObject({ workspace: text(ID), project: z.optional(text(ID)) });
/** A resource link (documents specification, 9.1), strict: a document's or an app's, with its scope. */
const linkInput = z.union([
	z.strictObject({ kind: z.literal('document'), document: text(ID), scope: scopeInput }),
	z.strictObject({ kind: z.literal('app'), instance: text(64), scope: scopeInput }),
]);

const toastInput = z.strictObject({
	message: text(200).check(z.describe(PLAIN_TEXT)),
	tone: z.optional(z.enum(TONES)),
	durationMs: z.optional(z.number().check(z.int(), z.minimum(1000), z.maximum(30000))),
	sticky: z.optional(z.boolean()),
	link: z.optional(linkInput),
});

const modalInput = z.strictObject({
	title: text(80),
	body: text(1000).check(z.describe(PLAIN_TEXT)),
	confirmLabel: z.optional(text(40)),
	cancelLabel: z.optional(text(40)),
	danger: z.optional(z.boolean()),
});

/** A `data-loam-anchor` value: what a CSS attribute selector can name without escaping. */
const ANCHOR = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const anchorInput = z.strictObject({
	surface: z.enum(['main', 'sidebar', 'inspector', 'panel', 'shell']),
	anchor: z.string().check(z.regex(ANCHOR)),
});
const itemInput = z.strictObject({
	command: text(ID),
	label: text(80).check(z.describe(PLAIN_TEXT)),
	input: z.optional(z.record(z.string(), z.unknown())),
});
const popoverInput = z.union([
	z.strictObject({
		anchor: anchorInput,
		kind: z.literal('info'),
		title: z.optional(text(80)),
		body: text(1000).check(z.describe(PLAIN_TEXT)),
	}),
	z.strictObject({
		anchor: anchorInput,
		kind: z.literal('menu'),
		label: z.optional(text(80)),
		items: z.array(itemInput).check(z.minLength(1), z.maxLength(POPOVER_MENU_ITEMS)),
	}),
]);

const dismissInput = z.strictObject({
	overlayId: text(64),
	result: z.optional(z.enum(['confirm', 'cancel'])),
	reason: z.optional(z.enum(['timeout', 'user', 'anchor'])),
	/** A menu popover's picked item (6.4), with `result: 'confirm'`. */
	item: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(POPOVER_MENU_ITEMS - 1))),
});

const textJson = (maxLength: number): JsonSchema => ({ type: 'string', minLength: 1, maxLength });
const scopeJson: JsonSchema = {
	type: 'object',
	properties: { workspace: textJson(ID), project: textJson(ID) },
	required: ['workspace'],
	additionalProperties: false,
};
const anchorJson: JsonSchema = {
	type: 'object',
	properties: {
		surface: { type: 'string', enum: ['main', 'sidebar', 'inspector', 'panel', 'shell'] },
		anchor: { type: 'string', pattern: ANCHOR.source },
	},
	required: ['surface', 'anchor'],
	additionalProperties: false,
};

/**
 * Whose a call's overlay is (6.1): the calling app's; an agent's, with the push-rate bucket it counts in; the shell's
 * for a person's own gesture; or no one's, for any other path, which opens nothing.
 */
export type Opener =
	| { kind: 'app'; owner: OverlayOwner }
	| { kind: 'agent'; owner: OverlayOwner; bucket: string }
	| { kind: 'shell'; owner: OverlayOwner }
	| { kind: 'none' };

/**
 * The path a call came by (6.1, R8): a port's `caller` is the app's; with none, the agent interface, or any call whose
 * actor is an agent, is the agent's; a human gesture (step 1's `isHumanGesture`) is the shell's; anything else, an MCP
 * caller among them, is no one's. Fail closed: only a person's gesture opens as the shell.
 *
 * An agent's push rate is the agent interface's, per person, whatever agent name the caller passed, since the name is
 * the caller's own; the copilot, whose identity the kernel alone mints, counts apart (the step 3 review's R-b).
 */
export function openerOf(
	context: CommandContext,
	humanGesture: (context: CommandContext) => boolean
): Opener {
	const { caller } = context as KernelFieldContext;
	if (caller !== undefined) return { kind: 'app', owner: appOwner(caller) };
	if (context.interface === 'agent' || context.actor?.kind === 'agent') {
		const person = context.actor?.onBehalfOf ?? 'local';
		return {
			kind: 'agent',
			owner: { kind: 'agent', id: `${AGENT_OWNER_PREFIX}${context.actor?.id ?? 'agent'}` },
			bucket: context.actor?.id === 'copilot' ? `copilot:${person}` : `agents:${person}`,
		};
	}
	return humanGesture(context) ? { kind: 'shell', owner: SHELL } : { kind: 'none' };
}

/** What a menu item is to the popover's owner (6.4): its own palette command, refused, or with input that fails. */
export type ItemVerdict =
	| { kind: 'own' }
	| { kind: 'reserved'; why: string }
	| { kind: 'invalid'; why: string };

export interface OverlayCommandDeps {
	overlays: OverlayStore;
	activeApp(): string | null;
	/** The active tab's owning plugin, which the overlay rules treat as active (documents specification, 5.4). */
	editorOwner?(): Promise<string | null>;
	/** Step 1's `isHumanGesture`, from `late-settings`. Absent: nothing is a human gesture. */
	humanGesture?(context: CommandContext): boolean;
	/** The agents' push rate, which the inbox's `notification-push` shares (6.1, 10.2). Absent: no agent toast counts. */
	pushRate?: PushRate;
	/** An instance's owner line title, unique and never "Loam" (6.6). */
	appTitle?(instance: string): string | undefined;
	/** The signed-in person's name, never an email, for an agent's "for <person>"; null for none (6.6). */
	personLabel?(): string | null;
	/** A menu item's verdict for its owner (6.4). Absent: every item is refused. */
	itemCheck?(owner: OverlayOwner, item: { command: string; input?: unknown }): ItemVerdict;
	/**
	 * Whether the page has `anchor` inside `owner`'s surface (6.3), from the kernel's `overlayAnchors`. Absent, no anchor
	 * resolves: a test or a replay gives a resolver of its own, and a replay answers a refusal from the record.
	 */
	anchorFound?(owner: OverlayOwner, anchor: OverlayAnchorV1): boolean;
}

/** What an owner line shows when no name of the app's may be shown (6.6). */
export const UNNAMED_APP = 'an app';

/**
 * The title an app's owner line shows (6.6): its title as the rail shows it, with its instance id after it when another
 * instance shows the same title. A name that says "Loam" as a word (the manifest's and the deployment's one rule,
 * `saysShellName`, which they refuse but the line never trusts) is never shown: the title falls back to the instance
 * id, then the plugin id, then "an app", and a twin's instance id is left out when it says it.
 */
export function ownerTitle(
	summaries: ReadonlyArray<{ instance: string; title: string; app?: string }>,
	instance: string
): string {
	const own = summaries.find((each) => each.instance === instance);
	const shown = (name: string | undefined): string | undefined => {
		const trimmed = name?.trim();
		return trimmed && !saysShellName(trimmed) ? trimmed : undefined;
	};
	const id = shown(instance);
	const title = shown(own?.title);
	if (title === undefined) return id ?? shown(own?.app) ?? UNNAMED_APP;
	const twin = summaries.some(
		(each) => each.instance !== instance && each.title.trim().toLowerCase() === title.toLowerCase()
	);
	return twin && id !== undefined ? `${title} (${id})` : title;
}

/** No one's path: what opens an overlay is a person, an app or the agent interface (6.1). */
const noOpener = (): CommandResult<never> =>
	kernelFailure(
		'HUMAN_REQUIRED',
		'Only a person, an app or the agent interface opens an overlay',
		'Open it from the shell, an app, or the agent interface'
	);

/** `toast-show`, `modal-open`, `popover-open`, `overlay-dismiss` and `overlay-list`. */
export function createOverlayCommands(deps: OverlayCommandDeps): ZodCommandDefinition[] {
	const { overlays } = deps;
	const now = (context: CommandContext): number => context.clock?.now() ?? Date.now();

	/** Whether an app may open a popover or a modal now: it is active, or owns the active tab (6.1). */
	const isActive = async (owner: OverlayOwner): Promise<boolean> =>
		owner.kind === 'app' &&
		(owner.id === deps.activeApp() || owner.id === (await deps.editorOwner?.()));

	const appLine = (owner: OverlayOwner): OverlayFromV1 => ({
		kind: 'app',
		title: deps.appTitle?.(owner.id) ?? owner.id,
	});
	const human = (context: CommandContext) => deps.humanGesture?.(context) ?? false;

	/**
	 * A full region's wait (F7): until the soonest timed toast times out, on the call's clock; a minute when every one
	 * is sticky, since only a person's dismissal frees a place then.
	 */
	const regionWait = (at: number): number => {
		const ends = overlays
			.list()
			.filter((overlay) => overlay.kind === 'toast' && !(overlay.input as ToastInputV1).sticky)
			.map((overlay) => {
				const opened = overlays.openedAt(overlay.overlayId) ?? at;
				return opened + ((overlay.input as ToastInputV1).durationMs ?? TOAST_DEFAULT_MS) - at;
			});
		return Math.max(1, ends.length > 0 ? Math.min(...ends) : 60_000);
	};

	const toastShow = defineCommandWithSchema<typeof toastInput, OverlayRefV1>({
		name: 'toast-show',
		title: 'Show a toast',
		description:
			'Show a short message that dismisses itself, or with sticky stays until dismissed; at most five stay on screen',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: toastInput,
		jsonSchema: {
			type: 'object',
			properties: {
				message: { ...textJson(200), description: PLAIN_TEXT },
				tone: { type: 'string', enum: [...TONES] },
				durationMs: { type: 'integer', minimum: 1000, maximum: 30000 },
				sticky: { type: 'boolean' },
				link: {
					anyOf: [
						{
							type: 'object',
							properties: {
								kind: { type: 'string', const: 'document' },
								document: textJson(ID),
								scope: scopeJson,
							},
							required: ['kind', 'document', 'scope'],
							additionalProperties: false,
						},
						{
							type: 'object',
							properties: {
								kind: { type: 'string', const: 'app' },
								instance: textJson(64),
								scope: scopeJson,
							},
							required: ['kind', 'instance', 'scope'],
							additionalProperties: false,
						},
					],
				} as unknown as JsonSchema,
			},
			required: ['message'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const opener = openerOf(context, human);
			if (opener.kind === 'none') return noOpener();
			const shown: ToastInputV1 = {
				...(input as ToastInputV1),
				durationMs: input.durationMs ?? TOAST_DEFAULT_MS,
			};
			if (opener.kind !== 'agent') {
				return success(
					overlays.open(
						opener.owner,
						'toast',
						shown,
						opener.kind === 'app'
							? { from: appLine(opener.owner), openedAt: now(context) }
							: { openedAt: now(context) }
					)
				);
			}
			// An agent's toast (6.1, F7): its rate of 5 a minute, then a place that pushes off no shell or `danger` toast.
			const at = now(context);
			const limited = (retryAfterMs: number, why: string): CommandResult<never> =>
				kernelFailure(
					'RATE_LIMITED',
					why,
					'Wait for retryAfterMs, then show it again; the rate is fixed',
					{ retryable: true, details: { limit: AGENT_PUSH_RATE, retryAfterMs } }
				);
			const wait = deps.pushRate?.retryAfter(opener.bucket, AGENT_PUSH_RATE, at);
			if (wait !== undefined)
				return limited(wait, `An agent shows at most ${AGENT_PUSH_RATE} toasts a minute`);
			const ref = overlays.openAgentToast(opener.owner, shown, {
				from: {
					kind: 'agent',
					agent: context.actor?.label ?? context.actor?.id ?? 'agent',
					person: deps.personLabel?.() ?? null,
				},
				openedAt: at,
			});
			if (!ref) {
				return limited(
					regionWait(at),
					`The ${TOAST_CAP} toasts on screen are the shell's or errors, which an agent's toast never pushes off`
				);
			}
			deps.pushRate?.record(opener.bucket, at);
			return success(ref);
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
			// The agent interface's modal is step 4's (6.1's modal column); until then it opens as the shell's.
			const { caller } = context as KernelFieldContext;
			const owner = caller === undefined ? SHELL : appOwner(caller);
			if (owner.kind === 'app' && !(await isActive(owner))) {
				return kernelFailure(
					'OVERLAY_OWNER_INACTIVE',
					`The app '${owner.id}' is not active, so it cannot open a modal`,
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
			// A modal's owner line is step 4's, with the slot (6.6).
			return success(overlays.open(owner, 'modal', input as ModalInputV1));
		},
	});

	const popoverOpen = defineCommandWithSchema<typeof popoverInput, OverlayRefV1>({
		name: 'popover-open',
		title: 'Open a popover',
		description:
			"Show text, or a menu of the app's own commands, beside an element of its surface that has data-loam-anchor; closes on a click outside, Escape or a switch",
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: popoverInput,
		jsonSchema: {
			type: 'object',
			anyOf: [
				{
					type: 'object',
					properties: {
						anchor: anchorJson,
						kind: { type: 'string', const: 'info' },
						title: textJson(80),
						body: { ...textJson(1000), description: PLAIN_TEXT },
					},
					required: ['anchor', 'kind', 'body'],
					additionalProperties: false,
				},
				{
					type: 'object',
					properties: {
						anchor: anchorJson,
						kind: { type: 'string', const: 'menu' },
						label: textJson(80),
						items: {
							type: 'array',
							minItems: 1,
							maxItems: POPOVER_MENU_ITEMS,
							items: {
								type: 'object',
								properties: {
									command: textJson(ID),
									label: { ...textJson(80), description: PLAIN_TEXT },
									input: {
										type: 'object',
										propertyNames: { type: 'string' },
										additionalProperties: {},
									} as unknown as JsonSchema,
								},
								required: ['command', 'label'],
								additionalProperties: false,
							},
						},
					},
					required: ['anchor', 'kind', 'items'],
					additionalProperties: false,
				},
			],
		},
		async handler(input, context) {
			const opener = openerOf(context, human);
			if (opener.kind === 'none') return noOpener();
			if (opener.kind === 'agent') {
				return kernelFailure(
					'HUMAN_REQUIRED',
					'An agent opens toasts only, never a popover',
					'Show a toast with toast-show instead'
				);
			}
			const { owner } = opener;
			const given = input as PopoverInputV1;
			if (owner.kind === 'app' && !(await isActive(owner))) {
				return kernelFailure(
					'OVERLAY_OWNER_INACTIVE',
					`The app '${owner.id}' is not active, so it cannot open a popover`,
					'Show a toast instead, or open the popover when the app is active'
				);
			}
			if ((given.anchor.surface === 'shell') !== (owner.kind === 'shell')) {
				return anchorMissing(given.anchor, 'only the shell anchors in its own surface', false);
			}
			if (given.kind === 'menu') {
				for (const [index, item] of given.items.entries()) {
					const verdict = deps.itemCheck?.(owner, item) ?? {
						kind: 'reserved',
						why: `'${item.command}' cannot be checked`,
					};
					if (verdict.kind === 'own') continue;
					if (verdict.kind === 'invalid') {
						return kernelFailure(
							'VALIDATION_ERROR',
							`Item ${index}'s input does not match '${item.command}': ${verdict.why}`,
							"Give the item the input its command's schema asks for",
							{ details: { item: index, command: item.command } }
						);
					}
					return kernelFailure(
						'OVERLAY_ITEM_RESERVED',
						verdict.why,
						'Let the person run it from the palette',
						{
							details: { item: index, command: item.command },
						}
					);
				}
			}
			if (!(deps.anchorFound?.(owner, given.anchor) ?? false)) {
				return anchorMissing(given.anchor, 'the page has no such element in that surface', true);
			}
			return success(
				overlays.open(owner, 'popover', given, owner.kind === 'app' ? { from: appLine(owner) } : {})
			);
		},
	});

	const overlayDismiss = defineCommandWithSchema<typeof dismissInput, OverlayResultV1>({
		name: 'overlay-dismiss',
		title: 'Dismiss an overlay',
		description: 'Close an open toast, modal or popover; a modal defaults to cancel',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: dismissInput,
		jsonSchema: {
			type: 'object',
			properties: {
				overlayId: textJson(64),
				result: { type: 'string', enum: ['confirm', 'cancel'] },
				reason: { type: 'string', enum: ['timeout', 'user', 'anchor'] },
				item: { type: 'integer', minimum: 0, maximum: POPOVER_MENU_ITEMS - 1 },
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
			const owner = overlays.ownerOf(input.overlayId);
			if (caller !== undefined && (owner?.kind !== 'app' || owner.id !== caller)) {
				return kernelFailure(
					'OVERLAY_NOT_OWNER',
					`Overlay '${input.overlayId}' belongs to another app`,
					'Dismiss only overlays this app opened'
				);
			}
			// `anchor` is the page's word that a popover's anchor left it: the chrome's, a human gesture's, alone.
			if (
				input.reason === 'anchor' &&
				(overlay.kind !== 'popover' || openerOf(context, human).kind !== 'shell')
			) {
				return kernelFailure(
					'VALIDATION_ERROR',
					"reason 'anchor' closes a popover whose anchor left the page, and only the shell says so",
					"Dismiss it with reason 'user', or leave reason out"
				);
			}
			// An agent cancels or dismisses only, never confirms (6.5; F6's cancels are step 4's).
			if (input.result === 'confirm' && openerOf(context, human).kind === 'agent') {
				return kernelFailure(
					'HUMAN_REQUIRED',
					'Only a person confirms an overlay',
					'Ask the person to answer it in the shell'
				);
			}
			if (input.item !== undefined) {
				const items =
					overlay.kind === 'popover' && (overlay.input as PopoverInputV1).kind === 'menu'
						? (overlay.input as Extract<PopoverInputV1, { kind: 'menu' }>).items
						: [];
				if (input.result !== 'confirm' || input.item >= items.length) {
					return kernelFailure(
						'VALIDATION_ERROR',
						'item names a picked entry of an open menu popover, with result confirm',
						'Name an item of the menu by its index, with result confirm, or leave item out'
					);
				}
			}
			const outcome = overlays.close(
				input.overlayId,
				input.result ?? (overlay.kind === 'modal' ? 'cancel' : 'dismissed'),
				input.reason ?? 'user',
				input.item
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

	return [
		toastShow,
		modalOpen,
		popoverOpen,
		overlayDismiss,
		overlayList,
	] as unknown as ZodCommandDefinition[];
}

/** `OVERLAY_ANCHOR_NOT_FOUND` (6.3); when the page decided it, a replay answers it from the record. */
function anchorMissing(anchor: OverlayAnchorV1, why: string, page: boolean): CommandResult<never> {
	return kernelFailure(
		'OVERLAY_ANCHOR_NOT_FOUND',
		`No element with data-loam-anchor="${anchor.anchor}" in the ${anchor.surface} surface: ${why}`,
		'Set data-loam-anchor on the invoker',
		{
			details: {
				surface: anchor.surface,
				anchor: anchor.anchor,
				...(page ? { [PAGE_DECIDED]: true } : {}),
			},
		}
	);
}
