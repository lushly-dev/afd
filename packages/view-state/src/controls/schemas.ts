/**
 * @fileoverview The input and output schemas of the four `control-*` commands, on Zod Mini, and
 * their JSON Schemas written out, so nothing converts them at run time. `commands.test.ts`
 * holds each literal equal to `zodToJsonSchema` of its schema.
 */

import type { JsonSchema } from '@lushly-dev/afd-server/define';
import * as z from 'zod/mini';

// ─── Shared parts ────────────────────────────────────────────────────────────

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

const choiceSchema = z.object({ value: z.string(), label: z.string() });

const controlSchema = z.object({
	id: z.string(),
	rev: z.optional(z.string()),
	group: z.optional(z.string()),
	kind: z.enum(['text', 'number', 'boolean', 'choice', 'choices']),
	label: z.string(),
	description: z.optional(z.string()),
	value: z.optional(valueSchema),
	format: z.optional(z.enum(['email', 'date', 'time', 'color'])),
	required: z.optional(z.boolean()),
	disabled: z.optional(z.boolean()),
	readOnly: z.optional(z.boolean()),
	hidden: z.optional(z.boolean()),
	secret: z.optional(z.boolean()),
	min: z.optional(z.number()),
	max: z.optional(z.number()),
	maxLength: z.optional(z.number()),
	choices: z.optional(z.array(choiceSchema)),
	choiceCount: z.optional(z.number()),
	error: z.optional(z.string()),
});

const VALUE_JSON = {
	anyOf: [
		{ type: 'string' },
		{ type: 'number' },
		{ type: 'boolean' },
		{ type: 'array', items: { type: 'string' } },
	],
} as unknown as JsonSchema;

const CHOICE_JSON: JsonSchema = {
	type: 'object',
	properties: { value: { type: 'string' }, label: { type: 'string' } },
	required: ['value', 'label'],
	additionalProperties: false,
};

const CONTROL_JSON: JsonSchema = {
	type: 'object',
	properties: {
		id: { type: 'string' },
		rev: { type: 'string' },
		group: { type: 'string' },
		kind: { type: 'string', enum: ['text', 'number', 'boolean', 'choice', 'choices'] },
		label: { type: 'string' },
		description: { type: 'string' },
		value: VALUE_JSON,
		format: { type: 'string', enum: ['email', 'date', 'time', 'color'] },
		required: { type: 'boolean' },
		disabled: { type: 'boolean' },
		readOnly: { type: 'boolean' },
		hidden: { type: 'boolean' },
		secret: { type: 'boolean' },
		min: { type: 'number' },
		max: { type: 'number' },
		maxLength: { type: 'number' },
		choices: { type: 'array', items: CHOICE_JSON },
		choiceCount: { type: 'number' },
		error: { type: 'string' },
	},
	required: ['id', 'kind', 'label'],
	additionalProperties: false,
};

const CONTROLS_JSON: JsonSchema = { type: 'array', items: CONTROL_JSON };
const IDS_JSON: JsonSchema = { type: 'array', items: { type: 'string' } };

// ─── control-list ────────────────────────────────────────────────────────────

const GROUP_DESCRIPTION = 'Only the controls of this part of the screen';
const LIST_LIMIT_DESCRIPTION = 'The most controls to return';
const LIST_OFFSET_DESCRIPTION = 'How many controls to skip';

export const listInput = z.object({
	group: z.optional(z.string().check(z.describe(GROUP_DESCRIPTION))),
	limit: z._default(
		z.int().check(z.minimum(1), z.maximum(100), z.describe(LIST_LIMIT_DESCRIPTION)),
		50
	),
	offset: z._default(z.int().check(z.minimum(0), z.describe(LIST_OFFSET_DESCRIPTION)), 0),
});

export const LIST_INPUT_JSON: JsonSchema = {
	type: 'object',
	properties: {
		group: { type: 'string', description: GROUP_DESCRIPTION },
		limit: {
			default: 50,
			type: 'integer',
			minimum: 1,
			maximum: 100,
			description: LIST_LIMIT_DESCRIPTION,
		},
		offset: {
			default: 0,
			type: 'integer',
			minimum: 0,
			maximum: Number.MAX_SAFE_INTEGER,
			description: LIST_OFFSET_DESCRIPTION,
		},
	},
};

export const listOutput = z.object({
	screen: z.optional(z.string()),
	command: z.optional(z.string()),
	controls: z.array(controlSchema),
	total: z.number(),
	more: z.number(),
});

export const LIST_OUTPUT_JSON: JsonSchema = {
	type: 'object',
	properties: {
		screen: { type: 'string' },
		command: { type: 'string' },
		controls: CONTROLS_JSON,
		total: { type: 'number' },
		more: { type: 'number' },
	},
	required: ['controls', 'total', 'more'],
	additionalProperties: false,
};

// ─── control-set ─────────────────────────────────────────────────────────────

const VALUES_DESCRIPTION =
	'The controls to set, all or none: each with its id, a value of its kind and its rev';
const SET_ID_DESCRIPTION = "The control's id, as control-list gives it, not its label";
const SET_VALUE_DESCRIPTION =
	'A value of its kind: text, a number, true or false, a choice by its value or its label, or a list of choices';
const SET_REV_DESCRIPTION = 'The rev control-list or an earlier result gave for the control';

export const setInput = z.object({
	values: z
		.array(
			z.object({
				id: z.string().check(z.describe(SET_ID_DESCRIPTION)),
				value: valueSchema.check(z.describe(SET_VALUE_DESCRIPTION)),
				rev: z.string().check(z.describe(SET_REV_DESCRIPTION)),
			})
		)
		.check(z.minLength(1), z.maxLength(50), z.describe(VALUES_DESCRIPTION)),
});

export const SET_INPUT_JSON: JsonSchema = {
	type: 'object',
	properties: {
		values: {
			minItems: 1,
			maxItems: 50,
			description: VALUES_DESCRIPTION,
			type: 'array',
			items: {
				type: 'object',
				properties: {
					id: { type: 'string', description: SET_ID_DESCRIPTION },
					value: { ...VALUE_JSON, description: SET_VALUE_DESCRIPTION } as unknown as JsonSchema,
					rev: { type: 'string', description: SET_REV_DESCRIPTION },
				},
				required: ['id', 'value', 'rev'],
			},
		},
	},
	required: ['values'],
};

export const setOutput = z.object({
	changed: z.array(
		z.object({
			id: z.string(),
			value: valueSchema,
			previous: valueSchema,
			rev: z.string(),
			error: z.optional(z.string()),
		})
	),
	unchanged: z.array(z.string()),
	affected: z.array(controlSchema),
	missing: z.array(z.string()),
});

export const SET_OUTPUT_JSON: JsonSchema = {
	type: 'object',
	properties: {
		changed: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					value: VALUE_JSON,
					previous: VALUE_JSON,
					rev: { type: 'string' },
					error: { type: 'string' },
				},
				required: ['id', 'value', 'previous', 'rev'],
				additionalProperties: false,
			},
		},
		unchanged: IDS_JSON,
		affected: CONTROLS_JSON,
		missing: IDS_JSON,
	},
	required: ['changed', 'unchanged', 'affected', 'missing'],
	additionalProperties: false,
};

// ─── control-restore ─────────────────────────────────────────────────────────

const RESTORE_DESCRIPTION = "The id and rev of each control, as control-set's result gave them";

export const restoreInput = z.object({
	controls: z
		.array(z.object({ id: z.string(), rev: z.string() }))
		.check(z.minLength(1), z.maxLength(50), z.describe(RESTORE_DESCRIPTION)),
});

export const RESTORE_INPUT_JSON: JsonSchema = {
	type: 'object',
	properties: {
		controls: {
			minItems: 1,
			maxItems: 50,
			description: RESTORE_DESCRIPTION,
			type: 'array',
			items: {
				type: 'object',
				properties: { id: { type: 'string' }, rev: { type: 'string' } },
				required: ['id', 'rev'],
			},
		},
	},
	required: ['controls'],
};

const SKIP_REASONS = ['not-on-screen', 'secret', 'changed', 'not-editable', 'not-shown'] as const;

export const restoreOutput = z.object({
	restored: z.array(z.object({ id: z.string(), value: valueSchema, rev: z.string() })),
	skipped: z.array(z.object({ id: z.string(), reason: z.enum(SKIP_REASONS) })),
	affected: z.array(controlSchema),
	missing: z.array(z.string()),
});

export const RESTORE_OUTPUT_JSON: JsonSchema = {
	type: 'object',
	properties: {
		restored: {
			type: 'array',
			items: {
				type: 'object',
				properties: { id: { type: 'string' }, value: VALUE_JSON, rev: { type: 'string' } },
				required: ['id', 'value', 'rev'],
				additionalProperties: false,
			},
		},
		skipped: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					reason: { type: 'string', enum: [...SKIP_REASONS] },
				},
				required: ['id', 'reason'],
				additionalProperties: false,
			},
		},
		affected: CONTROLS_JSON,
		missing: IDS_JSON,
	},
	required: ['restored', 'skipped', 'affected', 'missing'],
	additionalProperties: false,
};

// ─── control-choices ─────────────────────────────────────────────────────────

const CHOICES_ID_DESCRIPTION = "The control's id, as control-list gives it";
const SEARCH_DESCRIPTION =
	'Keep only the choices whose label contains this, without regard to case';
const CHOICES_LIMIT_DESCRIPTION = 'The most choices to return';
const CHOICES_OFFSET_DESCRIPTION = 'How many choices to skip';

export const choicesInput = z.object({
	id: z.string().check(z.describe(CHOICES_ID_DESCRIPTION)),
	search: z.optional(z.string().check(z.describe(SEARCH_DESCRIPTION))),
	limit: z._default(
		z.int().check(z.minimum(1), z.maximum(50), z.describe(CHOICES_LIMIT_DESCRIPTION)),
		20
	),
	offset: z._default(z.int().check(z.minimum(0), z.describe(CHOICES_OFFSET_DESCRIPTION)), 0),
});

export const CHOICES_INPUT_JSON: JsonSchema = {
	type: 'object',
	properties: {
		id: { type: 'string', description: CHOICES_ID_DESCRIPTION },
		search: { type: 'string', description: SEARCH_DESCRIPTION },
		limit: {
			default: 20,
			type: 'integer',
			minimum: 1,
			maximum: 50,
			description: CHOICES_LIMIT_DESCRIPTION,
		},
		offset: {
			default: 0,
			type: 'integer',
			minimum: 0,
			maximum: Number.MAX_SAFE_INTEGER,
			description: CHOICES_OFFSET_DESCRIPTION,
		},
	},
	required: ['id'],
};

export const choicesOutput = z.object({
	id: z.string(),
	choices: z.array(choiceSchema),
	total: z.number(),
	more: z.number(),
});

export const CHOICES_OUTPUT_JSON: JsonSchema = {
	type: 'object',
	properties: {
		id: { type: 'string' },
		choices: { type: 'array', items: CHOICE_JSON },
		total: { type: 'number' },
		more: { type: 'number' },
	},
	required: ['id', 'choices', 'total', 'more'],
	additionalProperties: false,
};
