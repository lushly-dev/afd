import { z } from 'zod';
import {
	PACK_FORMAT_VERSION,
	PACK_TEXT_LIMITS,
	packFacetsSchema,
	packIdentifier,
	packImplementationContextsSchema,
	packPatternGateSchema,
	packPatternRef,
	packText,
	patternKeepStatementSchema,
	patternSetupSchema,
	patternStatementSchema,
} from './pack-atoms.js';

export {
	IDENTIFIER_INVALID,
	PACK_FORMAT_VERSION,
	PACK_PATTERNS,
	PACK_TEXT_LIMITS,
	packIdentifier,
	packPatternRef,
	packText,
	SUPPORTED_PACK_FORMAT_VERSIONS,
	TEXT_INVALID,
	TEXT_TOO_LONG,
} from './pack-atoms.js';

const formatV1 = z.literal(1);
const formatV2 = z.literal(PACK_FORMAT_VERSION);

/** Where a fact came from. The first three are Specimen's coverage levels. */
export const basisSchema = z.enum(['verified', 'observed', 'declared', 'authored']);
const apiBasis = z.enum(['verified', 'observed', 'declared']);
const statementBasis = z.enum(['verified', 'authored']);
const roleBasis = z.enum(['observed', 'authored']);
const observed = z.literal('observed');
const themesBasis = z.enum(['declared', 'observed']);
const statusEnum = z.enum(['stable', 'preview', 'deprecated']);
const patternScopeEnum = z.enum(['control', 'composition']);

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

/** Per-`keep` statement basis in Pack Format 2 (the three packable bases). */
export const packKeepBasisSchema = z
	.strictObject({
		id: packIdentifier('id'),
		basis: z.enum(['verified', 'ungated', 'out-of-context']),
		reason: packText(PACK_TEXT_LIMITS.statement).optional(),
	})
	.refine(
		(value) =>
			value.basis === 'out-of-context' ? value.reason !== undefined : value.reason === undefined,
		'An out-of-context keep basis carries a reason; no other basis does'
	)
	.meta({
		anyOf: [
			{ properties: { basis: { const: 'out-of-context' } }, required: ['reason'] },
			{
				properties: { basis: { not: { const: 'out-of-context' } } },
				not: { required: ['reason'] },
			},
		],
	});

/** Component-to-pattern implementation link in Pack Format 2 (`spec.md` §6.3). */
export const packComponentPatternSchema = z.strictObject({
	library: packIdentifier('library'),
	pattern: packIdentifier('pattern'),
	contexts: packImplementationContextsSchema.optional(),
	keep: z.array(packKeepBasisSchema).max(64),
});

const componentFieldsBase = {
	tag: packIdentifier('tag'),
	summary: packText(PACK_TEXT_LIMITS.summary).optional(),
	status: statusEnum,
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
};

const replacedByMeta = {
	anyOf: [
		{ not: { required: ['replacedBy'] } },
		{ properties: { status: { const: 'deprecated' } } },
	],
};

/** Format 1 component record (fixed; rejects unknown keys including `patterns`). */
export const packComponentV1Schema = z
	.strictObject({
		format: formatV1,
		...componentFieldsBase,
	})
	.refine(
		(value) => value.replacedBy === undefined || value.status === 'deprecated',
		'Only a deprecated component names its replacement'
	)
	.meta(replacedByMeta);

/** One component's record (format 2): `data/<library>/components/<tag>.json`. */
export const packComponentSchema = z
	.strictObject({
		format: formatV2,
		...componentFieldsBase,
		/** Patterns this component implements; omitted when none. */
		patterns: z.array(packComponentPatternSchema).max(16).optional(),
	})
	.refine(
		(value) => value.replacedBy === undefined || value.status === 'deprecated',
		'Only a deprecated component names its replacement'
	)
	.meta(replacedByMeta);

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

const rulesFields = {
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
};

/** Format 1 shared rules file. */
export const packRulesV1Schema = z.strictObject({
	format: formatV1,
	...rulesFields,
});

/** A library's shared rules, each stated once (format 2): `rules/<library>.json`. */
export const packRulesSchema = z.strictObject({
	format: formatV2,
	...rulesFields,
});

const packPatternImplementationSchema = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('component'),
		tag: packIdentifier('tag'),
		linkage: z.literal('instance'),
	}),
	z.strictObject({
		kind: z.literal('copy'),
		name: packIdentifier('copyName'),
		linkage: z.literal('copy'),
	}),
]);

/** One pattern's record (format 2): `data/<library>/patterns/<pattern>.json`. */
export const packPatternSchema = z
	.strictObject({
		format: formatV2,
		pattern: packIdentifier('pattern'),
		summary: packText(PACK_TEXT_LIMITS.summary).optional(),
		status: statusEnum,
		replacedBy: packPatternRef().optional(),
		scope: patternScopeEnum,
		facets: packFacetsSchema,
		useWhen: z.array(patternStatementSchema).max(32),
		avoidWhen: z.array(patternStatementSchema).max(32),
		keep: z.array(patternKeepStatementSchema).max(64),
		customize: z.array(patternStatementSchema).max(32),
		setups: z
			.record(packIdentifier('setup'), patternSetupSchema)
			.refine((value) => Object.keys(value).length <= 16, 'A pattern may declare at most 16 setups')
			.meta({ maxProperties: 16 }),
		gates: z
			.record(packIdentifier('gate'), packPatternGateSchema)
			.refine((value) => Object.keys(value).length <= 64, 'A pattern may declare at most 64 gates')
			.meta({ maxProperties: 64 }),
		implementations: z.array(packPatternImplementationSchema).max(256),
	})
	.refine(
		(value) => value.replacedBy === undefined || value.status === 'deprecated',
		'Only a deprecated pattern names its replacement'
	)
	.meta(replacedByMeta);

/** One complete saved copy record (format 2, Slice 2): `data/<library>/patterns/<pattern>/<name>.json`. */
export const packCopySchema = z
	.strictObject({
		format: formatV2,
		pattern: packIdentifier('pattern'),
		name: packIdentifier('copyName'),
		status: statusEnum,
		replacedBy: packIdentifier('copyName').optional(),
		html: packText(PACK_TEXT_LIMITS.copyHtml, 'multi', 1),
		css: packText(PACK_TEXT_LIMITS.copyCss, 'multi', 0),
		dependencies: z.array(packIdentifier('tag')).max(64),
		tokens: z.array(packIdentifier('cssProperty')).max(256),
		themeStylesheet: packText(PACK_TEXT_LIMITS.value, 'single', 1).optional(),
		setup: packIdentifier('setup').optional(),
		contexts: packImplementationContextsSchema.optional(),
		revision: packIdentifier('digest'),
		fingerprint: packIdentifier('digest'),
		changeNote: packText(PACK_TEXT_LIMITS.statement).optional(),
		origin: z.strictObject({
			id: packIdentifier('story'),
			checkpoint: packText(PACK_TEXT_LIMITS.summary).optional(),
		}),
		keep: z.array(packKeepBasisSchema).max(64),
	})
	.refine(
		(value) => value.replacedBy === undefined || value.status === 'deprecated',
		'Only a deprecated copy names its replacement'
	)
	.meta(replacedByMeta);

const catalogPatternEntrySchema = z
	.strictObject({
		pattern: packIdentifier('pattern'),
		summary: packText(PACK_TEXT_LIMITS.summary).optional(),
		status: statusEnum,
		replacedBy: packPatternRef().optional(),
		scope: patternScopeEnum,
		facets: packFacetsSchema,
		digest: packIdentifier('digest'),
	})
	.refine(
		(value) => value.replacedBy === undefined || value.status === 'deprecated',
		'Only a deprecated pattern names its replacement'
	)
	.meta(replacedByMeta);

const catalogCopyEntrySchema = z
	.strictObject({
		pattern: packIdentifier('pattern'),
		name: packIdentifier('copyName'),
		status: statusEnum,
		replacedBy: packIdentifier('copyName').optional(),
		revision: packIdentifier('digest'),
		fingerprint: packIdentifier('digest'),
		digest: packIdentifier('digest'),
	})
	.refine(
		(value) => value.replacedBy === undefined || value.status === 'deprecated',
		'Only a deprecated copy names its replacement'
	)
	.meta(replacedByMeta);

const libraryFieldsBase = {
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
				status: statusEnum,
				digest: packIdentifier('digest'),
			})
		)
		.max(990),
};

/** Format 1 catalog (fixed; no `patterns` or `copies`). */
export const packLibraryV1Schema = z.strictObject({
	format: formatV1,
	...libraryFieldsBase,
});

/** The exported form's catalog and stamp (format 2): `data/<library>/library.json`. */
export const packLibrarySchema = z.strictObject({
	format: formatV2,
	...libraryFieldsBase,
	patterns: z.array(catalogPatternEntrySchema).max(256),
	copies: z.array(catalogCopyEntrySchema).max(512),
});

export type PackKeepBasis = z.infer<typeof packKeepBasisSchema>;
export type PackComponentPattern = z.infer<typeof packComponentPatternSchema>;
export type PackComponent = z.infer<typeof packComponentSchema>;
export type PackComponentV1 = z.infer<typeof packComponentV1Schema>;
export type PackRules = z.infer<typeof packRulesSchema>;
export type PackRulesV1 = z.infer<typeof packRulesV1Schema>;
export type PackPattern = z.infer<typeof packPatternSchema>;
export type PackCopy = z.infer<typeof packCopySchema>;
export type PackLibrary = z.infer<typeof packLibrarySchema>;
export type PackLibraryV1 = z.infer<typeof packLibraryV1Schema>;
export type PackBasis = z.infer<typeof basisSchema>;

/** JSON Schema (draft 2020-12) for each format 2 file kind, as committed under `schema/pack/`. */
export function packJsonSchemas(): Record<
	'component' | 'rules' | 'library' | 'pattern' | 'copy',
	unknown
> {
	const draft = (schema: z.ZodType, title: string) => ({
		title,
		...(z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>),
	});
	return {
		component: draft(packComponentSchema, 'Specimen component pack: component record'),
		rules: draft(packRulesSchema, 'Specimen component pack: shared rules'),
		library: draft(packLibrarySchema, 'Specimen component pack: library catalog'),
		pattern: draft(packPatternSchema, 'Specimen component pack: pattern record'),
		copy: draft(packCopySchema, 'Specimen component pack: saved copy record'),
	};
}
