import { z } from 'zod';
import {
	PACK_TEXT_LIMITS,
	packAppliesToSchema,
	packIdentifier,
	packText,
	TEXT_INVALID,
	TEXT_TOO_LONG,
} from './pack-schema.js';

/**
 * Authored guidance, as a library's guide files state it. These are separate from the pack's
 * records: a guide carries no basis, since a statement's basis is decided when the pack is built.
 * This module loads Zod, so only a project with a `guides` key imports it.
 */
const statement = z.strictObject({
	id: packIdentifier('id'),
	text: packText(PACK_TEXT_LIMITS.statement),
	/** The attributes, properties, slots, events, CSS properties or commands the statement names. */
	members: z.array(z.string().min(1).max(100).regex(/^\S+$/)).min(1).max(32).optional(),
});

/** How a text check marks its issue, for the loader, which does not import Zod itself. */
export const guideMarkers = { TEXT_TOO_LONG, TEXT_INVALID };

/** One component's guidance. */
export const guideComponentSchema = z
	.strictObject({
		tag: packIdentifier('tag'),
		summary: packText(PACK_TEXT_LIMITS.summary).optional(),
		status: z.enum(['stable', 'preview', 'deprecated']).optional(),
		replacedBy: packIdentifier('tag').optional(),
		usage: z.array(statement).max(64).optional(),
		a11y: z.array(statement).max(64).optional(),
		/**
		 * Its roles in states a capture does not show, such as an open popup's. A role a capture
		 * observes in the default state takes the place of the one written here.
		 */
		roles: z
			.array(
				z.strictObject({
					state: packIdentifier('state'),
					role: packIdentifier('role'),
					/** How it gets its accessible name, such as `from the label attribute`. */
					name: packText(PACK_TEXT_LIMITS.summary).optional(),
				})
			)
			.max(16)
			.optional(),
		detail: packText(PACK_TEXT_LIMITS.detail, 'multi').optional(),
	})
	.refine(
		(value) => value.replacedBy === undefined || value.status === 'deprecated',
		'Only a deprecated component names its replacement'
	)
	.refine(
		(value) => new Set(value.roles?.map((item) => item.state)).size === (value.roles?.length ?? 0),
		{ message: 'Give one role per state; a record keeps one', path: ['roles'] }
	)
	.meta({
		anyOf: [
			{ not: { required: ['replacedBy'] } },
			{ properties: { status: { const: 'deprecated' } }, required: ['status'] },
		],
	});

/** Rules stated once, each saying what it applies to: tags, or any component with an attribute. */
export const guideRulesSchema = z.strictObject({
	rules: z
		.array(
			z.strictObject({
				id: packIdentifier('id'),
				text: packText(PACK_TEXT_LIMITS.statement),
				appliesTo: packAppliesToSchema,
			})
		)
		.max(512),
});

export type GuideComponent = z.infer<typeof guideComponentSchema>;
export type GuideRules = z.infer<typeof guideRulesSchema>;

/** JSON Schema (draft 2020-12) for each guide file kind, as committed under `schema/guide/`. */
export function guideJsonSchemas(): Record<'component' | 'rules', unknown> {
	const draft = (schema: z.ZodType, title: string) => ({
		title,
		...(z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>),
	});
	return {
		component: draft(guideComponentSchema, 'Specimen guide: one component'),
		rules: draft(guideRulesSchema, 'Specimen guide: shared rules'),
	};
}
