import { z } from 'zod';
import {
	PACK_TEXT_LIMITS,
	packIdentifier,
	packText,
	TEXT_INVALID,
	TEXT_TOO_LONG,
} from './pack-schema.js';
import { contextSchema } from './schema.js';

/**
 * Pattern file and guide-link Zod schemas (draft 2020-12 JSON Schema source of truth).
 * Loaded dynamically so projects with no patterns never load Zod at bench creation time.
 */

export const patternMarkers = { TEXT_TOO_LONG, TEXT_INVALID };

const isAscendingUnique = (values: readonly string[]): boolean => {
	for (let index = 1; index < values.length; index++) {
		if ((values[index - 1] as string) >= (values[index] as string)) return false;
	}
	return true;
};

const isUnique = (values: readonly string[]): boolean => new Set(values).size === values.length;

/** Inclusive viewport bounds (CSS pixels) and/or supported themes for an implementation. */
export const implementationContextsSchema = z
	.strictObject({
		viewport: z
			.strictObject({
				minWidth: z.number().int().min(1).max(8192).optional(),
				maxWidth: z.number().int().min(1).max(8192).optional(),
				minHeight: z.number().int().min(1).max(8192).optional(),
				maxHeight: z.number().int().min(1).max(8192).optional(),
			})
			.refine(
				(value) =>
					value.minWidth !== undefined ||
					value.maxWidth !== undefined ||
					value.minHeight !== undefined ||
					value.maxHeight !== undefined,
				'Viewport bounds must specify at least one of minWidth, maxWidth, minHeight, or maxHeight'
			)
			.refine(
				(value) =>
					value.minWidth === undefined ||
					value.maxWidth === undefined ||
					value.maxWidth >= value.minWidth,
				{ message: 'maxWidth must be >= minWidth', path: ['maxWidth'] }
			)
			.refine(
				(value) =>
					value.minHeight === undefined ||
					value.maxHeight === undefined ||
					value.maxHeight >= value.minHeight,
				{ message: 'maxHeight must be >= minHeight', path: ['maxHeight'] }
			)
			.meta({ minProperties: 1 })
			.optional(),
		themes: z
			.array(z.enum(['dark', 'high-contrast', 'light']))
			.min(1)
			.max(3)
			.refine(
				isAscendingUnique,
				'Themes must be unique and in ascending order (dark, high-contrast, light)'
			)
			.meta({ uniqueItems: true })
			.optional(),
		reason: packText(PACK_TEXT_LIMITS.statement),
	})
	.refine(
		(value) => value.viewport !== undefined || value.themes !== undefined,
		'Implementation contexts must specify at least one of viewport or themes'
	)
	.meta({
		anyOf: [{ required: ['viewport'] }, { required: ['themes'] }],
	});

/** Same-library pattern id or cross-library `{ library, pattern }` link on a component guide. */
export const guidePatternClaimSchema = z.union([
	packIdentifier('pattern'),
	z.strictObject({
		library: packIdentifier('library'),
		pattern: packIdentifier('pattern'),
	}),
]);

/** Setup binding on a native specimen or play-free retained story. */
export const patternSetupBindingSchema = z.strictObject({
	library: packIdentifier('library').optional(),
	pattern: packIdentifier('pattern'),
	setup: packIdentifier('setup'),
});

const roleSetSchema = z.union([
	packIdentifier('role'),
	z
		.array(packIdentifier('role'))
		.min(1)
		.max(8)
		.refine(isUnique, 'Target roles must be unique')
		.meta({ uniqueItems: true }),
]);

export const patternTargetSchema = z
	.strictObject({
		role: roleSetSchema,
		name: packText(PACK_TEXT_LIMITS.summary).optional(),
		nameStartsWith: packText(PACK_TEXT_LIMITS.summary).optional(),
		nameContains: packText(PACK_TEXT_LIMITS.summary).optional(),
	})
	.refine((value) => {
		const count =
			Number(value.name !== undefined) +
			Number(value.nameStartsWith !== undefined) +
			Number(value.nameContains !== undefined);
		return count <= 1;
	}, 'Specify at most one of name, nameStartsWith, or nameContains')
	.meta({
		not: {
			anyOf: [
				{ required: ['name', 'nameStartsWith'] },
				{ required: ['name', 'nameContains'] },
				{ required: ['nameStartsWith', 'nameContains'] },
			],
		},
	});

export const patternSetupSchema = z.strictObject({
	text: packText(PACK_TEXT_LIMITS.statement),
	targets: z
		.record(packIdentifier('alias'), patternTargetSchema)
		.refine((record) => {
			const count = Object.keys(record).length;
			return count >= 1 && count <= 16;
		}, 'A setup must declare between 1 and 16 targets')
		.meta({ minProperties: 1, maxProperties: 16 }),
});

const timeoutMsSchema = z.number().int().min(1).max(60_000);

export const portableActionSchema = z.union([
	z.strictObject({ click: packIdentifier('alias') }),
	z.strictObject({ focus: packIdentifier('alias') }),
	z.strictObject({ hover: packIdentifier('alias') }),
	z.strictObject({
		fill: packIdentifier('alias'),
		value: packText(PACK_TEXT_LIMITS.statement, 'multi', 0),
	}),
	z.strictObject({
		press: packText(64, 'single', 1),
		target: packIdentifier('alias').optional(),
	}),
]);

export const standardDomEventSchema = z.enum(['input', 'change', 'submit', 'reset']);

export const portableEventExpectationSchema = z.strictObject({
	event: standardDomEventSchema,
	target: packIdentifier('alias').optional(),
	since: packIdentifier('stepId'),
	timeoutMs: timeoutMsSchema.optional(),
	absent: z.boolean().optional(),
});

export const portableFormExpectationSchema = z.strictObject({
	target: packIdentifier('alias'),
	form: z.strictObject({
		name: packText(PACK_TEXT_LIMITS.summary),
		value: packText(PACK_TEXT_LIMITS.value, 'multi', 0).nullable(),
	}),
	timeoutMs: timeoutMsSchema.optional(),
});

export const portableValidityExpectationSchema = z.strictObject({
	target: packIdentifier('alias'),
	validity: z.strictObject({ valid: z.boolean() }),
	timeoutMs: timeoutMsSchema.optional(),
});

export const a11yExpectationSchema = z.strictObject({
	target: packIdentifier('alias'),
	a11y: z
		.strictObject({
			role: roleSetSchema.optional(),
			name: packText(PACK_TEXT_LIMITS.summary, 'single', 0).optional(),
			nameNonEmpty: z.boolean().optional(),
			nameContains: packText(PACK_TEXT_LIMITS.summary).optional(),
			expanded: z.boolean().optional(),
			selected: z.boolean().optional(),
			checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
			pressed: z.union([z.boolean(), z.literal('mixed')]).optional(),
			disabled: z.boolean().optional(),
			invalid: z.union([z.boolean(), z.literal('grammar'), z.literal('spelling')]).optional(),
			readonly: z.boolean().optional(),
			required: z.boolean().optional(),
			level: z.number().int().min(1).max(6).optional(),
		})
		.refine(
			(value) => Object.keys(value).length > 0,
			'An a11y expectation must assert at least one property'
		)
		.refine(
			(value) =>
				value.name === undefined ||
				(value.nameNonEmpty === undefined && value.nameContains === undefined),
			'a11y.name is mutually exclusive with nameNonEmpty and nameContains'
		)
		.meta({
			minProperties: 1,
			not: {
				anyOf: [{ required: ['name', 'nameNonEmpty'] }, { required: ['name', 'nameContains'] }],
			},
		}),
	timeoutMs: timeoutMsSchema.optional(),
});

export const focusExpectationSchema = z.strictObject({
	target: packIdentifier('alias'),
	focus: z.boolean(),
	timeoutMs: timeoutMsSchema.optional(),
});

export const layoutExpectationSchema = z.strictObject({
	target: packIdentifier('alias'),
	layout: z
		.strictObject({
			minHeight: z.number().positive().max(8192).optional(),
			minWidth: z.number().positive().max(8192).optional(),
			noOverflow: z.boolean().optional(),
			noOuterMargin: z.boolean().optional(),
		})
		.refine(
			(value) => Object.keys(value).length > 0,
			'A layout expectation must assert at least one property'
		)
		.meta({ minProperties: 1 }),
	timeoutMs: timeoutMsSchema.optional(),
});

export const portableExpectationSchema = z.union([
	portableEventExpectationSchema,
	portableFormExpectationSchema,
	portableValidityExpectationSchema,
	a11yExpectationSchema,
	focusExpectationSchema,
	layoutExpectationSchema,
]);

export const portableScenarioStepSchema = z.union([
	z.strictObject({ id: packIdentifier('stepId'), action: portableActionSchema }),
	z.strictObject({ id: packIdentifier('stepId'), expect: portableExpectationSchema }),
]);

const patternGateContextSchema = z.strictObject({
	viewport: contextSchema.shape.viewport.optional(),
	container: contextSchema.shape.container,
	theme: contextSchema.shape.theme.optional(),
	locale: contextSchema.shape.locale.optional(),
	reducedMotion: contextSchema.shape.reducedMotion.optional(),
	motion: contextSchema.shape.motion.optional(),
});

export const patternGateSchema = z.strictObject({
	setup: packIdentifier('setup'),
	context: patternGateContextSchema.optional(),
	scenario: z.array(portableScenarioStepSchema).min(1).max(32),
});

const patternStatementSchema = z.strictObject({
	id: packIdentifier('id'),
	text: packText(PACK_TEXT_LIMITS.statement),
});

const patternKeepStatementSchema = z.strictObject({
	id: packIdentifier('id'),
	text: packText(PACK_TEXT_LIMITS.statement),
	gate: packIdentifier('gate').optional(),
});

const patternFacetsSchema = z
	.record(
		packIdentifier('facetKey'),
		z
			.array(packIdentifier('facetValue'))
			.min(1)
			.max(16)
			.refine(isAscendingUnique, 'Facet values must be unique and sorted in ascending order')
			.meta({ uniqueItems: true })
	)
	.refine((value) => Object.keys(value).length <= 8, 'A pattern may declare at most 8 facet keys')
	.meta({ maxProperties: 8 });

export const patternFileSchema = z
	.strictObject({
		pattern: packIdentifier('pattern'),
		summary: packText(PACK_TEXT_LIMITS.summary).optional(),
		status: z.enum(['stable', 'preview', 'deprecated']).optional(),
		replacedBy: z.union([packIdentifier('pattern'), packIdentifier('qualifiedPattern')]).optional(),
		scope: z.enum(['control', 'composition']),
		facets: patternFacetsSchema.optional(),
		useWhen: z.array(patternStatementSchema).max(32).optional(),
		avoidWhen: z.array(patternStatementSchema).max(32).optional(),
		keep: z.array(patternKeepStatementSchema).max(64).optional(),
		customize: z.array(patternStatementSchema).max(32).optional(),
		setups: z
			.record(packIdentifier('setup'), patternSetupSchema)
			.refine((value) => Object.keys(value).length <= 16, 'A pattern may declare at most 16 setups')
			.meta({ maxProperties: 16 })
			.optional(),
		gates: z
			.record(packIdentifier('gate'), patternGateSchema)
			.refine((value) => Object.keys(value).length <= 64, 'A pattern may declare at most 64 gates')
			.meta({ maxProperties: 64 })
			.optional(),
	})
	.refine(
		(value) => value.replacedBy === undefined || value.status === 'deprecated',
		'Only a deprecated pattern names its replacement'
	)
	.meta({
		anyOf: [
			{ not: { required: ['replacedBy'] } },
			{ properties: { status: { const: 'deprecated' } }, required: ['status'] },
		],
	});

export type PatternFileInput = z.input<typeof patternFileSchema>;

/** JSON Schema (draft 2020-12) for `pattern.json`, as committed under `schema/pattern.schema.json`. */
export function patternJsonSchema(): unknown {
	return {
		title: 'Specimen pattern file',
		...(z.toJSONSchema(patternFileSchema, { io: 'input' }) as Record<string, unknown>),
	};
}
