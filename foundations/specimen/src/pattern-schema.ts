import { z } from 'zod';
import {
	a11yExpectationSchema,
	focusExpectationSchema,
	isAscendingUnique,
	layoutExpectationSchema,
	PACK_TEXT_LIMITS,
	packIdentifier,
	packText,
	patternKeepStatementSchema,
	patternSetupSchema,
	patternStatementSchema,
	patternTargetSchema,
	portableActionSchema,
	portableEventExpectationSchema,
	portableExpectationSchema,
	portableFormExpectationSchema,
	portableScenarioStepSchema,
	portableValidityExpectationSchema,
	standardDomEventSchema,
	TEXT_INVALID,
	TEXT_TOO_LONG,
} from './pack-atoms.js';
import { contextSchema } from './schema.js';

/**
 * Pattern file and guide-link Zod schemas (draft 2020-12 JSON Schema source of truth).
 * Loaded dynamically so projects with no patterns never load Zod at bench creation time.
 */

export {
	a11yExpectationSchema,
	focusExpectationSchema,
	layoutExpectationSchema,
	patternSetupSchema,
	patternTargetSchema,
	portableActionSchema,
	portableEventExpectationSchema,
	portableExpectationSchema,
	portableFormExpectationSchema,
	portableScenarioStepSchema,
	portableValidityExpectationSchema,
	standardDomEventSchema,
};

export const patternMarkers = { TEXT_TOO_LONG, TEXT_INVALID };

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
