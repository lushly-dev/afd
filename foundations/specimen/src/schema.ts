import { z } from 'zod';

const recordedContextSchema = z.strictObject({
	viewport: z.strictObject({
		width: z.number().int().min(1).max(8192),
		height: z.number().int().min(1).max(8192),
	}),
	container: z
		.strictObject({
			width: z.number().int().min(1).max(8192),
			height: z.number().int().min(1).max(8192).optional(),
		})
		.optional(),
	theme: z.enum(['light', 'dark', 'high-contrast']),
	locale: z.string().min(1),
	reducedMotion: z.enum(['reduce', 'no-preference']),
	motion: z.enum(['natural', 'settled']),
	themeMedia: z.literal('browser-default').optional(),
});
/** New requests need a BCP 47 locale; saved captures keep whatever locale they recorded. */
export const contextSchema = recordedContextSchema.extend({
	locale: z
		.string()
		.min(1)
		.refine((value) => {
			try {
				return Intl.getCanonicalLocales(value).length === 1;
			} catch {
				return false;
			}
		}, 'Locale must be a BCP 47 language tag'),
});
export const captureRequestSchema = z.strictObject({
	id: z.string().min(1),
	checkpoint: z.string().min(1).optional(),
	context: contextSchema.partial().optional(),
	screenshot: z.string().min(1).optional(),
	timeoutMs: z.number().int().min(1).max(60_000).optional(),
});

const completeness = z
	.object({
		status: z.enum(['complete', 'partial', 'unsupported', 'not-requested']),
		scope: z.string(),
		reasons: z.array(z.string()),
	})
	.strict();
const element = z
	.object({
		ref: z.string(),
		tag: z.string(),
		attributes: z.record(z.string(), z.string()),
		box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict(),
		scroll: z
			.object({
				width: z.number(),
				height: z.number(),
				clientWidth: z.number(),
				clientHeight: z.number(),
			})
			.strict(),
		styles: z.record(z.string(), z.string()),
		state: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
	})
	.strict();
export const observationSchema = z
	.object({
		manifest: z
			.object({
				captureVersion: z.string().min(1),
				normalizationVersion: z.string().min(1),
				specimenId: z.string().min(1),
				checkpoint: z.string().min(1),
				source: z
					.object({
						revision: z.string().nullable(),
						digest: z.string().min(1),
						dirty: z.boolean().nullable(),
					})
					.strict(),
				dependencies: z.string().min(1),
				browser: z.object({ name: z.string().min(1), version: z.string().min(1) }).strict(),
				context: recordedContextSchema,
			})
			.strict(),
		channels: z
			.object({
				dom: z.object({ raw: z.string(), normalized: z.string() }).strict(),
				a11y: z.object({ snapshot: z.string(), axe: z.literal('not-run') }).strict(),
				elements: z.array(element),
				console: z.object({ errors: z.array(z.string()), warnings: z.array(z.string()) }).strict(),
				visual: z.object({ path: z.string().nullable() }).strict(),
			})
			.strict(),
		completeness: z
			.object({
				dom: completeness,
				a11y: completeness,
				layout: completeness,
				styles: completeness,
				tokens: completeness,
				events: completeness,
				visual: completeness,
			})
			.strict(),
	})
	.strict();
export const buildOutputSchema = z
	.object({
		directory: z.string(),
		shellBytes: z.number().int().nonnegative(),
		budget: z.number().int().positive(),
		files: z.array(z.string()),
	})
	.strict();
/** A retained story's run request: a capture request without a checkpoint, which is `after-run`. */
export const runRequestSchema = captureRequestSchema.omit({ checkpoint: true });
export const storyRunSchema = z.strictObject({
	id: z.string(),
	outcome: z.strictObject({
		status: z.enum(['passed', 'failed', 'skipped', 'excluded']),
		play: z.enum(['ran', 'none']),
		failures: z.array(
			z.strictObject({ category: z.enum(['render', 'play', 'a11y']), message: z.string() })
		),
		a11y: z.strictObject({
			status: z.enum(['passed', 'warning', 'failed', 'not-run']),
			policy: z.enum(['error', 'todo', 'off', 'disabled', 'manual']),
			reason: z.string().optional(),
			violations: z.array(
				z.strictObject({
					id: z.string(),
					impact: z.string().nullable(),
					help: z.string(),
					targets: z.array(z.string()),
					details: z.array(z.string()),
				})
			),
			incomplete: z.number().int().nonnegative(),
			engine: z.string().optional(),
		}),
	}),
	observation: observationSchema.nullable(),
});
const schemaValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const propertySchema = z.strictObject({
	name: z.string(),
	type: z.string().optional(),
	attribute: z.string().optional(),
	values: z.array(schemaValue).optional(),
	default: z.string().optional(),
	description: z.string().optional(),
});
/** A component's schema from the manifest, enriched by plugins' schema sources. */
export const componentSchemaSchema = z.strictObject({
	tag: z.string(),
	sources: z.array(z.string()),
	properties: z.array(propertySchema),
	attributes: z.array(propertySchema),
	slots: z.array(z.strictObject({ name: z.string(), description: z.string().optional() })),
	events: z.array(
		z.strictObject({
			name: z.string(),
			type: z.string().optional(),
			description: z.string().optional(),
		})
	),
	cssProperties: z.array(
		z.strictObject({
			name: z.string(),
			default: z.string().optional(),
			description: z.string().optional(),
		})
	),
	commands: z.array(
		z.strictObject({
			id: z.string(),
			label: z.string().optional(),
			description: z.string().optional(),
		})
	),
	unknown: z.array(z.string()),
});
export const inspectRequestSchema = captureRequestSchema.pick({
	id: true,
	context: true,
	timeoutMs: true,
});
export const inspectResultSchema = z.strictObject({
	id: z.string(),
	component: z.string().nullable(),
	schema: componentSchemaSchema.nullable(),
	args: z.record(z.string(), z.unknown()),
	context: recordedContextSchema,
	story: z
		.strictObject({
			name: z.string(),
			tags: z.array(z.string()),
			globals: z.record(z.string(), z.unknown()),
			parameters: z.record(z.string(), z.unknown()),
			play: z.boolean(),
			decorators: z.number().int().nonnegative(),
			render: z.enum(['story', 'meta', 'project', 'default']),
			unsupported: z.array(z.string()),
		})
		.optional(),
	limitations: z.array(z.string()),
	plugins: z.array(
		z.strictObject({
			id: z.string(),
			runners: z.array(z.string()),
			themes: z.array(z.string()),
			tokens: z.string().nullable(),
		})
	),
});
export const migrateRequestSchema = z.strictObject({
	files: z.array(z.string().min(1)).min(1).optional(),
	apply: z.boolean().optional(),
});
export const migrationReportSchema = z.strictObject({
	mode: z.enum(['preview', 'apply']),
	files: z.array(
		z.strictObject({
			importPath: z.string(),
			component: z.strictObject({
				status: z.enum(['present', 'proposed', 'manual']),
				tag: z.string().optional(),
				reason: z.string(),
				candidates: z.array(z.string()),
			}),
			retained: z.array(z.string()),
			imports: z.array(
				z.strictObject({
					source: z.string(),
					names: z.array(z.string()),
					typeOnly: z.boolean(),
					reason: z.string(),
				})
			),
			manual: z.array(z.string()),
			diff: z.string().optional(),
			applied: z.boolean(),
		})
	),
	problems: z.array(z.string()),
	summary: z.strictObject({
		files: z.number().int().nonnegative(),
		present: z.number().int().nonnegative(),
		proposed: z.number().int().nonnegative(),
		manual: z.number().int().nonnegative(),
		applied: z.number().int().nonnegative(),
	}),
});
