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
const axeFindingSchema = z.strictObject({
	id: z.string(),
	impact: z.string().nullable(),
	help: z.string(),
	targets: z.array(z.string()),
	details: z.array(z.string()),
});
const axeOutcomeShape = {
	status: z.enum(['passed', 'warning', 'failed', 'not-run']),
	policy: z.enum(['error', 'todo', 'off', 'disabled', 'manual']),
	reason: z.string().optional(),
	violations: z.array(axeFindingSchema),
	incomplete: z.number().int().nonnegative(),
	incompleteChecks: z.array(axeFindingSchema),
	exceptions: z.array(
		z.strictObject({
			rule: z.string(),
			target: z.string(),
			reason: z.string(),
			matched: z.array(z.string()),
		})
	),
	engine: z.string().optional(),
};
const axeOutcomeSchema = z.strictObject(axeOutcomeShape);
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
				a11y: z
					.object({ snapshot: z.string(), axe: z.union([z.literal('not-run'), axeOutcomeSchema]) })
					.strict(),
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
export const suiteRequestSchema = z.strictObject({
	filter: z
		.strictObject({
			ids: z.array(z.string().min(1)).optional(),
			file: z.string().min(1).optional(),
			tags: z.array(z.string().min(1)).optional(),
			match: z.string().min(1).optional(),
		})
		.optional(),
	context: captureRequestSchema.shape.context,
	timeoutMs: captureRequestSchema.shape.timeoutMs,
	workers: z.number().int().min(1).max(32).optional(),
	retry: z.boolean().optional(),
	flakeCap: z.number().int().min(0).max(1000).optional(),
	capture: z.enum(['all', 'failed', 'none']).optional(),
});
const storyOutcomeSchema = z.strictObject({
	status: z.enum(['passed', 'failed', 'skipped', 'excluded']),
	play: z.enum(['ran', 'none']),
	failures: z.array(
		z.strictObject({ category: z.enum(['render', 'play', 'a11y']), message: z.string() })
	),
	a11y: axeOutcomeSchema,
});
export const storyRunSchema = z.strictObject({
	id: z.string(),
	outcome: storyOutcomeSchema,
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
export const suiteRunSchema = z.strictObject({
	outcome: z.enum(['passed', 'passed-with-flake', 'failed', 'failed-after-retry']),
	counts: z.strictObject({
		total: z.number().int().nonnegative(),
		passed: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		flaky: z.number().int().nonnegative(),
		skipped: z.number().int().nonnegative(),
		excluded: z.number().int().nonnegative(),
	}),
	retry: z.strictObject({ ran: z.boolean(), reason: z.string().optional() }),
	stories: z.array(
		z.strictObject({
			id: z.string(),
			file: z.string(),
			title: z.string(),
			name: z.string(),
			flakeId: z.string(),
			status: z.enum(['passed', 'failed', 'flaky', 'skipped', 'excluded']),
			attempts: z.array(storyOutcomeSchema),
			observation: observationSchema.nullable(),
		})
	),
	workers: z.number().int().positive(),
	elapsedMs: z.number().nonnegative(),
	sourcesChanged: z.boolean(),
});

export const a11yRequestSchema = z.strictObject({
	id: z.string().min(1).optional(),
	filter: suiteRequestSchema.shape.filter,
	checkpoint: z.string().min(1).optional(),
	context: captureRequestSchema.shape.context,
	timeoutMs: captureRequestSchema.shape.timeoutMs,
	workers: suiteRequestSchema.shape.workers,
});
export const a11yRunSchema = z.strictObject({
	reports: z.array(
		z.strictObject({
			...axeOutcomeShape,
			id: z.string(),
			checkpoint: z.string(),
			failures: z.array(
				z.strictObject({ category: z.enum(['render', 'play']), message: z.string() })
			),
		})
	),
	counts: z.strictObject({
		total: z.number().int().nonnegative(),
		passed: z.number().int().nonnegative(),
		warning: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		notRun: z.number().int().nonnegative(),
	}),
	workers: z.number().int().positive(),
	elapsedMs: z.number().nonnegative(),
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
