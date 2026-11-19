/**
 * @fileoverview Phase 4's overlays II (its 6.1 to 6.6, step 4): `dialog-open`, `modal-open` and `prompt-open` on every
 * path of 6.1's table, the slot (one modal or prompt, shell-wide), a dialog's limit of three, an app's own `element`,
 * and the internal `overlay-global-set`. A prompt's value is checked here too, when it opens and when it is answered,
 * against a schema of plain fields: no pattern, since an app gives the shell no regular expression (section 17).
 */

import { type CommandContext, type CommandResult, success } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	type JsonSchema,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type {
	DialogInputV1,
	GlobalInputV1,
	ModalInputV1,
	OverlayActionV1,
	OverlayFromV1,
	OverlayRefV1,
	PromptFieldV1,
	PromptInputV1,
	PromptSchemaV1,
} from '@lushly-dev/loam-sdk';
import * as z from 'zod/mini';
import { kernelFailure } from '../errors.js';
import type { OverlayOwner, OverlayStore } from '../overlays.js';
import type { Opener } from './overlay-commands.js';

/** Most dialogs, open or parked, one owner holds (6.1). */
export const DIALOG_LIMIT = 3;
/** Most actions an overlay offers (6.4). */
export const ACTION_LIMIT = 3;
/** Most fields an object prompt asks for. */
export const PROMPT_FIELDS = 12;
/** A prompt's value, as JSON, at most. */
export const PROMPT_VALUE_BYTES = 16_384;

/** An action's id, and what `overlay-dismiss`'s `result` takes: `confirm`, `cancel` or an action's id. */
export const ACTION_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** A custom element's name, as an app's registry defines it. */
const ELEMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
/** A prompt's field key, and a global strip's id. */
const KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
const PLAIN_TEXT = 'Plain text';
const textJson = (maxLength: number): JsonSchema => ({ type: 'string', minLength: 1, maxLength });

const actionInput = z.strictObject({
	id: z.string().check(z.regex(ACTION_ID)),
	label: text(40).check(z.describe(PLAIN_TEXT)),
	tone: z.optional(z.enum(['primary', 'danger'])),
	default: z.optional(z.boolean()),
});
const actionsInput = z.optional(
	z.array(actionInput).check(z.minLength(1), z.maxLength(ACTION_LIMIT))
);
const elementInput = z.optional(z.string().check(z.maxLength(64), z.regex(ELEMENT)));

const bound = z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(10_000)));
const fieldInput = z.strictObject({
	type: z.enum(['string', 'number', 'integer', 'boolean']),
	title: z.optional(text(80)),
	description: z.optional(text(200)),
	enum: z.optional(
		z
			.array(z.union([z.string().check(z.maxLength(200)), z.number()]))
			.check(z.minLength(1), z.maxLength(50))
	),
	minLength: bound,
	maxLength: bound,
	minimum: z.optional(z.number()),
	maximum: z.optional(z.number()),
});
const schemaInput = z.union([
	fieldInput,
	z.strictObject({
		type: z.literal('object'),
		properties: z.record(z.string().check(z.regex(KEY)), fieldInput),
		required: z.optional(z.array(z.string().check(z.regex(KEY))).check(z.maxLength(PROMPT_FIELDS))),
	}),
]);

const dialogInput = z.strictObject({
	title: text(80),
	body: z.optional(text(1000).check(z.describe(PLAIN_TEXT))),
	actions: actionsInput,
	element: elementInput,
	cancelOnLeave: z.optional(z.boolean()),
});
const modalInput = z.strictObject({
	title: text(80),
	body: text(1000).check(z.describe(PLAIN_TEXT)),
	confirmLabel: z.optional(text(40)),
	cancelLabel: z.optional(text(40)),
	danger: z.optional(z.boolean()),
	actions: actionsInput,
	element: elementInput,
});
const promptInput = z.strictObject({
	title: text(80),
	body: z.optional(text(1000).check(z.describe(PLAIN_TEXT))),
	schema: z.optional(schemaInput),
	value: z.optional(z.unknown()),
	confirmLabel: z.optional(text(40)),
	cancelLabel: z.optional(text(40)),
	danger: z.optional(z.boolean()),
});
const globalInput = z.strictObject({
	id: z.string().check(z.regex(KEY)),
	message: z.optional(text(200).check(z.describe(PLAIN_TEXT))),
	tone: z.optional(z.enum(['info', 'warning', 'danger'])),
});

const actionJson: JsonSchema = {
	type: 'array',
	minItems: 1,
	maxItems: ACTION_LIMIT,
	items: {
		type: 'object',
		properties: {
			id: { type: 'string', pattern: ACTION_ID.source },
			label: { ...textJson(40), description: PLAIN_TEXT },
			tone: { type: 'string', enum: ['primary', 'danger'] },
			default: { type: 'boolean' },
		},
		required: ['id', 'label'],
		additionalProperties: false,
	},
};
const elementJson: JsonSchema = { type: 'string', maxLength: 64, pattern: ELEMENT.source };
const fieldJson: JsonSchema = {
	type: 'object',
	properties: {
		type: { type: 'string', enum: ['string', 'number', 'integer', 'boolean'] },
		title: textJson(80),
		description: textJson(200),
		enum: {
			type: 'array',
			minItems: 1,
			maxItems: 50,
			items: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }] },
		} as unknown as JsonSchema,
		minLength: { type: 'integer', minimum: 0, maximum: 10_000 },
		maxLength: { type: 'integer', minimum: 0, maximum: 10_000 },
		minimum: { type: 'number' },
		maximum: { type: 'number' },
	},
	required: ['type'],
	additionalProperties: false,
};

/** Where an action list breaks 6.4's rules past its shape: a repeated id, two defaults, or `dismissed`. */
function actionsFault(actions: readonly OverlayActionV1[] | undefined): string | undefined {
	if (!actions) return undefined;
	const ids = actions.map((action) => action.id);
	if (new Set(ids).size !== ids.length) return 'Each action needs an id of its own';
	if (ids.includes('dismissed'))
		return "'dismissed' is not an action: it is how an overlay closes unanswered";
	if (actions.filter((action) => action.default).length > 1)
		return 'At most one action is the default';
	return undefined;
}

/** Why `value` does not fit `field`, or undefined when it does. */
function fieldFault(field: PromptFieldV1, value: unknown, name: string): string | undefined {
	if (field.enum && !field.enum.includes(value as string | number)) {
		return `${name} must be one of its choices`;
	}
	switch (field.type) {
		case 'boolean':
			return typeof value === 'boolean' ? undefined : `${name} must be true or false`;
		case 'string': {
			if (typeof value !== 'string') return `${name} must be text`;
			if (field.minLength !== undefined && value.length < field.minLength)
				return `${name} needs at least ${field.minLength} characters`;
			if (field.maxLength !== undefined && value.length > field.maxLength)
				return `${name} takes at most ${field.maxLength} characters`;
			return undefined;
		}
		default: {
			if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} must be a number`;
			if (field.type === 'integer' && !Number.isInteger(value))
				return `${name} must be a whole number`;
			if (field.minimum !== undefined && value < field.minimum)
				return `${name} must be at least ${field.minimum}`;
			if (field.maximum !== undefined && value > field.maximum)
				return `${name} must be at most ${field.maximum}`;
			return undefined;
		}
	}
}

/**
 * Why a prompt's `value` does not fit its `schema` (6.4), or undefined when it does. With no schema, the value is one
 * line of text of up to 1,000 characters. An object's value has only its fields, each it requires among them.
 */
export function promptValueFault(
	schema: PromptSchemaV1 | undefined,
	value: unknown
): string | undefined {
	let size: number;
	try {
		size = JSON.stringify(value)?.length ?? 0;
	} catch {
		return 'The value must be plain data';
	}
	if (size > PROMPT_VALUE_BYTES)
		return `The value takes at most ${PROMPT_VALUE_BYTES} characters as JSON`;
	if (!schema) {
		return typeof value === 'string' && value.length <= 1000 && !/[\r\n]/.test(value)
			? undefined
			: 'The value is one line of text, of up to 1,000 characters';
	}
	if (schema.type !== 'object') return fieldFault(schema, value, 'The value');
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return 'The value is an object of the prompt’s fields';
	}
	const given = value as Record<string, unknown>;
	for (const key of Object.keys(given)) {
		if (!Object.hasOwn(schema.properties, key)) return `'${key}' is not one of the prompt's fields`;
	}
	for (const [key, field] of Object.entries(schema.properties)) {
		if (given[key] === undefined) {
			if (schema.required?.includes(key)) return `'${key}' is required`;
			continue;
		}
		const fault = fieldFault(field, given[key], `'${key}'`);
		if (fault) return fault;
	}
	return undefined;
}

/** Where a prompt's schema breaks its rules past its shape. */
function schemaFault(schema: PromptSchemaV1 | undefined): string | undefined {
	if (schema?.type !== 'object') return undefined;
	const keys = Object.keys(schema.properties);
	if (keys.length === 0 || keys.length > PROMPT_FIELDS)
		return `An object prompt has 1 to ${PROMPT_FIELDS} fields`;
	const missing = schema.required?.find((key) => !keys.includes(key));
	return missing === undefined ? undefined : `'${missing}' is required but is not a field`;
}

export interface OverlaySlotDeps {
	overlays: OverlayStore;
	/** 6.1's path of a call, from `overlay-commands.ts`. */
	openerOf(context: CommandContext): Opener;
	/** Whether an app is active, or owns the active tab (6.1). */
	isActive(owner: OverlayOwner): Promise<boolean>;
	/** An app's owner line (6.6). */
	appLine(owner: OverlayOwner): OverlayFromV1;
	/** Whether the instance is a view, which renders no element of its own in the shell (6.4). */
	isView(instance: string): boolean;
}

type OverlayKindOpened = 'dialog' | 'modal' | 'prompt';

/** `dialog-open`, `modal-open`, `prompt-open` and the internal `overlay-global-set`. */
export function createOverlaySlotCommands(
	deps: OverlaySlotDeps
): Record<'dialogOpen' | 'modalOpen' | 'promptOpen' | 'globalSet', ZodCommandDefinition> {
	const { overlays } = deps;

	/**
	 * 6.1's table for a dialog, a modal or a prompt: a person's gesture is the shell's; an active app's port, or the
	 * active tab owner's, the app's; an inactive app's `OVERLAY_OWNER_INACTIVE`; the agent interface, the copilot among
	 * it, and any other path `HUMAN_REQUIRED`.
	 */
	async function admit(
		kind: OverlayKindOpened,
		context: CommandContext
	): Promise<{ owner: OverlayOwner } | CommandResult<never>> {
		const opener = deps.openerOf(context);
		if (opener.kind === 'agent') {
			return kernelFailure(
				'HUMAN_REQUIRED',
				`An agent opens toasts only, never a ${kind}`,
				'Show a toast with toast-show, or push a notification for the person to answer'
			);
		}
		if (opener.kind === 'none') {
			return kernelFailure(
				'HUMAN_REQUIRED',
				`Only a person or an app opens a ${kind}`,
				'Open it from the shell or an app'
			);
		}
		if (opener.owner.kind === 'app' && !(await deps.isActive(opener.owner))) {
			return kernelFailure(
				'OVERLAY_OWNER_INACTIVE',
				`The app '${opener.owner.id}' is not active, so it cannot open a ${kind}`,
				`Show a toast instead, or open the ${kind} when the app is active`
			);
		}
		return { owner: opener.owner };
	}

	/** An `element` is a native app's own (6.4): a view's is `OVERLAY_ELEMENT_VIEW`, and the shell has none to show. */
	function elementFault(
		owner: OverlayOwner,
		input: { element?: string; actions?: OverlayActionV1[] }
	): CommandResult<never> | undefined {
		const fault = actionsFault(input.actions);
		if (fault)
			return kernelFailure(
				'VALIDATION_ERROR',
				fault,
				'Give each action its own id, and one default at most'
			);
		if (input.element === undefined) return undefined;
		if (owner.kind === 'app' && deps.isView(owner.id)) {
			return kernelFailure(
				'OVERLAY_ELEMENT_VIEW',
				'A view cannot show an element of its own in the shell',
				'Use text, actions or a prompt'
			);
		}
		if (owner.kind !== 'app') {
			return kernelFailure(
				'VALIDATION_ERROR',
				"element names a native app's own element, which the shell's overlays do not show",
				'Use text, actions or a prompt'
			);
		}
		return undefined;
	}

	const busy = (): CommandResult<never> | undefined =>
		overlays.modalOpen()
			? kernelFailure(
					'OVERLAY_MODAL_BUSY',
					'A modal or a prompt is already open',
					'Wait for it to close, or dismiss it with overlay-dismiss',
					{ retryable: true }
				)
			: undefined;

	const lineFor = (owner: OverlayOwner) =>
		owner.kind === 'app' ? { from: deps.appLine(owner) } : {};

	const dialogOpen = defineCommandWithSchema<typeof dialogInput, OverlayRefV1>({
		name: 'dialog-open',
		title: 'Open a dialog',
		description:
			'Open a non-modal dialog with text, up to three actions and a native app’s own element; parked while its app is not active, at most three per app',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: dialogInput,
		jsonSchema: {
			type: 'object',
			properties: {
				title: textJson(80),
				body: { ...textJson(1000), description: PLAIN_TEXT },
				actions: actionJson,
				element: elementJson,
				cancelOnLeave: { type: 'boolean' },
			},
			required: ['title'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const admitted = await admit('dialog', context);
			if (!('owner' in admitted)) return admitted;
			const { owner } = admitted;
			const given = input as DialogInputV1;
			const fault = elementFault(owner, given);
			if (fault) return fault;
			if (overlays.dialogsOf(owner) >= DIALOG_LIMIT) {
				return kernelFailure(
					'OVERLAY_LIMIT',
					`At most ${DIALOG_LIMIT} dialogs are open at once, parked ones included`,
					'Close one first',
					{ details: { limit: DIALOG_LIMIT } }
				);
			}
			return success(overlays.open(owner, 'dialog', given, lineFor(owner)));
		},
	});

	const modalOpen = defineCommandWithSchema<typeof modalInput, OverlayRefV1>({
		name: 'modal-open',
		title: 'Open a modal',
		description:
			'Ask a question in a modal dialog with a confirm and a cancel button, or up to three actions, as text',
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
				actions: actionJson,
				element: elementJson,
			},
			required: ['title', 'body'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const admitted = await admit('modal', context);
			if (!('owner' in admitted)) return admitted;
			const { owner } = admitted;
			const given = input as ModalInputV1;
			const refused = elementFault(owner, given) ?? busy();
			if (refused) return refused;
			return success(overlays.open(owner, 'modal', given, lineFor(owner)));
		},
	});

	const promptOpen = defineCommandWithSchema<typeof promptInput, OverlayRefV1>({
		name: 'prompt-open',
		title: 'Open a prompt',
		description:
			'Ask the person for a value in a modal prompt: one line of text, or the plain fields a schema names',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: promptInput,
		jsonSchema: {
			type: 'object',
			properties: {
				title: textJson(80),
				body: { ...textJson(1000), description: PLAIN_TEXT },
				schema: {
					anyOf: [
						fieldJson,
						{
							type: 'object',
							properties: {
								type: { type: 'string', const: 'object' },
								properties: {
									type: 'object',
									propertyNames: { type: 'string', pattern: KEY.source },
									additionalProperties: fieldJson,
								},
								required: {
									type: 'array',
									maxItems: PROMPT_FIELDS,
									items: { type: 'string', pattern: KEY.source },
								},
							},
							required: ['type', 'properties'],
							additionalProperties: false,
						},
					],
				} as unknown as JsonSchema,
				value: {},
				confirmLabel: textJson(40),
				cancelLabel: textJson(40),
				danger: { type: 'boolean' },
			},
			required: ['title'],
			additionalProperties: false,
		} as unknown as JsonSchema,
		async handler(input, context) {
			const admitted = await admit('prompt', context);
			if (!('owner' in admitted)) return admitted;
			const given = input as PromptInputV1;
			const fault =
				schemaFault(given.schema) ??
				(given.value === undefined ? undefined : promptValueFault(given.schema, given.value));
			if (fault) {
				return kernelFailure(
					'VALIDATION_ERROR',
					fault,
					'Give the prompt a schema of plain fields and a value that fits it'
				);
			}
			const refused = busy();
			if (refused) return refused;
			return success(overlays.open(admitted.owner, 'prompt', given, lineFor(admitted.owner)));
		},
	});

	const globalSet = defineCommandWithSchema<typeof globalInput, { overlay: OverlayRefV1 | null }>({
		name: 'overlay-global-set',
		title: 'Set a global strip',
		description:
			'The shell’s strip under the title bar, one per id, kept across switches until its condition ends; no message closes it',
		category: 'overlay',
		mutation: true,
		executionTime: 'instant',
		input: globalInput,
		jsonSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', pattern: KEY.source },
				message: { ...textJson(200), description: PLAIN_TEXT },
				tone: { type: 'string', enum: ['info', 'warning', 'danger'] },
			},
			required: ['id'],
			additionalProperties: false,
		},
		async handler(input, context) {
			// The kernel's own (6.1): internal, so no list offers it, and only the shell's own path sets it, never an agent.
			if (deps.openerOf(context).kind !== 'shell') {
				return kernelFailure(
					'HUMAN_REQUIRED',
					'Only the shell sets its global strip',
					'Show a toast with toast-show instead'
				);
			}
			const { id, message, tone } = input;
			const strip: GlobalInputV1 | null =
				message === undefined ? null : { id, message, ...(tone ? { tone } : {}) };
			return success({ overlay: overlays.setGlobal(id, strip) ?? null });
		},
	});

	return { dialogOpen, modalOpen, promptOpen, globalSet } as unknown as Record<
		'dialogOpen' | 'modalOpen' | 'promptOpen' | 'globalSet',
		ZodCommandDefinition
	>;
}
