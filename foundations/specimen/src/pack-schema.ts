import { z } from 'zod';

/** The component pack format's version. It stays 0 until the format is fixed as 1. */
export const PACK_FORMAT_VERSION = 0;

/**
 * Identifier patterns. A reader may put a value that matches one of these outside the part of an
 * answer labelled as content, so each admits only a short ASCII alphabet with no spaces. Every
 * pattern is ASCII-only and means the same in ECMAScript and in Rust's `regex` crate.
 */
export const PACK_PATTERNS = {
	library: /^[a-z][a-z0-9-]{0,63}$/,
	tag: /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/,
	prefix: /^[a-z][a-z0-9._]*-$/,
	element: /^[a-z][a-z0-9._-]*$/,
	id: /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/,
	version:
		/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
	digest: /^sha256:[0-9a-f]{64}$/,
	revision: /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/,
	package: /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/,
	specifier: /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:\/[A-Za-z0-9._~-]+)*$/,
	story: /^[a-z0-9][a-z0-9._-]*$/,
	attribute: /^[a-z][a-z0-9_.:-]*$/,
	property: /^[A-Za-z_$][A-Za-z0-9_$]*$/,
	slot: /^(?:|[A-Za-z][A-Za-z0-9_.:-]*)$/,
	event: /^[A-Za-z][A-Za-z0-9_.:-]*$/,
	command: /^(?:--)?[a-z][a-z0-9-]*$/,
	cssProperty: /^--[A-Za-z0-9_-]+$/,
	state: /^[a-z][a-z0-9-]*$/,
	role: /^[a-z]+$/,
	axeRule: /^[a-z0-9-]+$/,
} as const;

/** Longest identifier of each kind, in characters. */
const IDENTIFIER_MAX: Record<keyof typeof PACK_PATTERNS, number> = {
	library: 64,
	tag: 100,
	prefix: 32,
	element: 100,
	id: 128,
	version: 64,
	digest: 71,
	revision: 64,
	package: 214,
	specifier: 256,
	story: 200,
	attribute: 100,
	property: 100,
	slot: 100,
	event: 100,
	command: 100,
	cssProperty: 100,
	state: 64,
	role: 32,
	axeRule: 64,
};

/** Longest text of each kind, in Unicode code points. */
export const PACK_TEXT_LIMITS = {
	summary: 160,
	statement: 240,
	title: 80,
	value: 200,
	detail: 8000,
	example: 4000,
} as const;

/** Marks a text issue so a check can name it apart from a shape problem. */
export const TEXT_TOO_LONG = 'pack-text-too-long';
export const TEXT_INVALID = 'pack-text-invalid';

// A one-line text has no control character (C0, DEL or C1) and no bidirectional embedding,
// override or isolate; a multi-line text may also hold tabs and line feeds.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const SINGLE_LINE = /^[^\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]*$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const MULTI_LINE = /^[^\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]*$/;

/** An identifier field of this kind. Guide files use the same fields as the pack. */
export const packIdentifier = (kind: keyof typeof PACK_PATTERNS) =>
	z.string().max(IDENTIFIER_MAX[kind]).regex(PACK_PATTERNS[kind]);

/** A text field of at most `max` code points, refusing control characters. */
export const packText = (max: number, lines: 'single' | 'multi' = 'single', min = 1) => {
	const allowed = lines === 'single' ? SINGLE_LINE : MULTI_LINE;
	return z
		.string()
		.min(min)
		.superRefine((value, context) => {
			if ([...value].length > max)
				context.addIssue({
					code: 'custom',
					message: `Longer than ${max} characters`,
					params: { pack: TEXT_TOO_LONG },
				});
			if (!allowed.test(value) || !value.isWellFormed())
				context.addIssue({
					code: 'custom',
					message:
						lines === 'single'
							? 'Contains a control character, a line break or a lone surrogate'
							: 'Contains a control character or a lone surrogate',
					params: { pack: TEXT_INVALID },
				});
		})
		.meta({ maxLength: max, pattern: allowed.source });
};

const format = z.literal(PACK_FORMAT_VERSION);

/** Where a fact came from. The first three are Specimen's coverage levels. */
export const basisSchema = z.enum(['verified', 'observed', 'declared', 'authored']);
const apiBasis = z.enum(['verified', 'observed', 'declared']);
const statementBasis = z.enum(['verified', 'authored']);
const roleBasis = z.enum(['observed', 'authored']);
const observed = z.literal('observed');
const themesBasis = z.enum(['declared', 'observed']);

// Numbers are safe integers (Zod's `int`), which JavaScript and Rust both hold and write alike.
const scalar = z.union([
	packText(PACK_TEXT_LIMITS.value, 'single', 0),
	z.number().int(),
	z.boolean(),
	z.null(),
]);

const statement = z.strictObject({
	id: packIdentifier('id'),
	text: packText(PACK_TEXT_LIMITS.statement),
	basis: statementBasis,
});

const attribute = z.strictObject({
	name: packIdentifier('attribute'),
	property: packIdentifier('property').optional(),
	type: packText(PACK_TEXT_LIMITS.statement).optional(),
	description: packText(PACK_TEXT_LIMITS.statement).optional(),
	values: z
		.array(z.strictObject({ value: scalar, basis: apiBasis }))
		.max(64)
		.optional(),
	default: scalar.optional(),
	rules: z.array(packIdentifier('id')).max(16).optional(),
	basis: apiBasis,
});

const slot = z.strictObject({
	name: packIdentifier('slot'),
	description: packText(PACK_TEXT_LIMITS.statement).optional(),
	accepts: z.array(packIdentifier('element')).max(32).optional(),
	basis: apiBasis,
});

const event = z.strictObject({
	name: packIdentifier('event'),
	description: packText(PACK_TEXT_LIMITS.statement).optional(),
	detail: packText(PACK_TEXT_LIMITS.statement).optional(),
	basis: apiBasis,
});

const command = z.strictObject({
	name: packIdentifier('command'),
	description: packText(PACK_TEXT_LIMITS.statement).optional(),
	basis: apiBasis,
});

const cssProperty = z.strictObject({
	name: packIdentifier('cssProperty'),
	description: packText(PACK_TEXT_LIMITS.statement).optional(),
	default: packText(PACK_TEXT_LIMITS.value).optional(),
	basis: apiBasis,
});

const gapSection = z.enum(['attributes', 'slots', 'events', 'commands', 'cssProperties']);

const gap = z
	.strictObject({
		kind: z.enum(['summary', 'usage', 'a11y-statement', 'role', 'example', 'unobserved']),
		section: gapSection.optional(),
		name: z
			.string()
			.max(100)
			.regex(/^(?:|(?:--)?[A-Za-z][A-Za-z0-9_.:-]*)$/)
			.optional(),
	})
	.refine(
		(value) =>
			value.kind === 'unobserved'
				? value.section !== undefined && value.name !== undefined
				: value.section === undefined && value.name === undefined,
		'An unobserved gap names its section and member; no other gap does'
	)
	.meta({
		anyOf: [
			{ properties: { kind: { const: 'unobserved' } }, required: ['section', 'name'] },
			{
				properties: { kind: { not: { const: 'unobserved' } } },
				not: { anyOf: [{ required: ['section'] }, { required: ['name'] }] },
			},
		],
	});

/** One component's record: `data/<library>/components/<tag>.json`. */
export const packComponentSchema = z
	.strictObject({
		format,
		tag: packIdentifier('tag'),
		summary: packText(PACK_TEXT_LIMITS.summary).optional(),
		status: z.enum(['stable', 'preview', 'deprecated']),
		replacedBy: packIdentifier('tag').optional(),
		import: packIdentifier('specifier').optional(),
		api: z.strictObject({
			attributes: z.array(attribute).max(256),
			slots: z.array(slot).max(64),
			events: z.array(event).max(64),
			commands: z.array(command).max(64),
			cssProperties: z.array(cssProperty).max(256),
			form: z.strictObject({ associated: z.boolean(), basis: apiBasis }).optional(),
		}),
		a11y: z.strictObject({
			role: z
				.array(
					z.strictObject({
						state: packIdentifier('state'),
						role: packIdentifier('role'),
						name: packText(PACK_TEXT_LIMITS.summary).optional(),
						basis: roleBasis,
					})
				)
				.max(16),
			statements: z.array(statement).max(64),
			axe: z
				.strictObject({
					violations: z.number().int().min(0),
					exceptions: z.array(packIdentifier('axeRule')).max(32),
					basis: observed,
				})
				.optional(),
		}),
		usage: z.array(statement).max(64),
		rules: z.array(packIdentifier('id')).max(64),
		examples: z
			.array(
				z.strictObject({
					from: packIdentifier('story'),
					html: packText(PACK_TEXT_LIMITS.example, 'multi'),
					basis: observed,
				})
			)
			.max(16),
		detail: packText(PACK_TEXT_LIMITS.detail, 'multi').optional(),
		gaps: z.array(gap).max(64),
		/** The themes it renders as intended; absent when nothing has said or seen. */
		themes: z
			.strictObject({
				supported: z
					.array(z.enum(['dark', 'high-contrast', 'light']))
					.min(1)
					.max(3),
				basis: themesBasis,
				reason: packText(PACK_TEXT_LIMITS.statement).optional(),
			})
			.optional(),
	})
	.refine(
		(value) => value.replacedBy === undefined || value.status === 'deprecated',
		'Only a deprecated component names its replacement'
	)
	.meta({
		anyOf: [
			{ not: { required: ['replacedBy'] } },
			{ properties: { status: { const: 'deprecated' } } },
		],
	});

/** What a shared rule applies to: tags, or any component with one of the attributes. */
export const packAppliesToSchema = z
	.strictObject({
		tags: z.array(packIdentifier('tag')).min(1).max(256).optional(),
		attributes: z.array(packIdentifier('attribute')).min(1).max(64).optional(),
	})
	.refine(
		(value) => value.tags !== undefined || value.attributes !== undefined,
		'A rule applies to at least one tag or attribute'
	)
	.meta({ minProperties: 1 });

/** A library's shared rules, each stated once: `rules/<library>.json`. */
export const packRulesSchema = z.strictObject({
	format,
	library: packIdentifier('library'),
	rules: z
		.array(
			z.strictObject({
				id: packIdentifier('id'),
				text: packText(PACK_TEXT_LIMITS.statement),
				appliesTo: packAppliesToSchema,
				basis: statementBasis,
			})
		)
		.max(512),
});

/** The exported form's catalog and stamp: `data/<library>/library.json`. */
export const packLibrarySchema = z.strictObject({
	format,
	library: packIdentifier('library'),
	title: packText(PACK_TEXT_LIMITS.title),
	package: z.strictObject({ name: packIdentifier('package'), version: packIdentifier('version') }),
	prefix: packIdentifier('prefix'),
	revision: packIdentifier('revision').optional(),
	digest: packIdentifier('digest'),
	rules: packIdentifier('digest'),
	components: z
		.array(
			z.strictObject({
				tag: packIdentifier('tag'),
				summary: packText(PACK_TEXT_LIMITS.summary).optional(),
				status: z.enum(['stable', 'preview', 'deprecated']),
				digest: packIdentifier('digest'),
			})
		)
		.max(990),
});

export type PackComponent = z.infer<typeof packComponentSchema>;
export type PackRules = z.infer<typeof packRulesSchema>;
export type PackLibrary = z.infer<typeof packLibrarySchema>;
export type PackBasis = z.infer<typeof basisSchema>;

/** JSON Schema (draft 2020-12) for each file kind, as committed under `schema/pack/`. */
export function packJsonSchemas(): Record<'component' | 'rules' | 'library', unknown> {
	const draft = (schema: z.ZodType, title: string) => ({
		title,
		...(z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>),
	});
	return {
		component: draft(packComponentSchema, 'Specimen component pack: component record'),
		rules: draft(packRulesSchema, 'Specimen component pack: shared rules'),
		library: draft(packLibrarySchema, 'Specimen component pack: library catalog'),
	};
}
