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
		accessibility: z.object({ role: z.string(), name: z.string() }).strict().optional(),
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
const eventsChannelSchema = z.strictObject({
	declared: z.array(z.strictObject({ type: z.string(), target: z.string().optional() })),
	history: z.array(
		z.strictObject({
			type: z.string(),
			target: z.string().nullable(),
			step: z.string().nullable(),
			composed: z.boolean(),
			bubbles: z.boolean(),
			trusted: z.boolean(),
			detail: z.unknown(),
		})
	),
});
const pluginVersionsSchema = z.array(
	z.object({ id: z.string().min(1), version: z.string().min(1).nullable() }).strict()
);
export const observationSchema = z
	.object({
		manifest: z
			.object({
				captureVersion: z.string().min(1),
				normalizationVersion: z.string().min(1),
				specimenId: z.string().min(1),
				capturedUtc: z.string().min(1),
				bench: z
					.object({
						name: z.string().min(1),
						version: z.string().min(1),
						plugins: pluginVersionsSchema,
					})
					.strict(),
				driver: z.object({ name: z.literal('host'), emulates: z.array(z.string()) }).strict(),
				checkpoint: z
					.object({
						name: z.string().min(1),
						actionMode: z.enum(['none', 'real-input', 'play']),
						ready: z
							.object({
								steps: z.array(z.string()),
								outcome: z.enum(['ready', 'elements-undefined']),
								deadlineMs: z.number().positive(),
							})
							.strict(),
						baseline: z
							.object({
								clock: z.literal('real'),
								random: z.object({ source: z.literal('seeded'), seed: z.number() }).strict(),
								storage: z.literal('empty'),
							})
							.strict(),
					})
					.strict(),
				source: z
					.object({
						revision: z.string().nullable(),
						digest: z.string().min(1),
						dirty: z.boolean().nullable(),
					})
					.strict(),
				dependencies: z.string().min(1),
				browser: z
					.object({
						name: z.string().min(1),
						version: z.string().min(1),
						platform: z.string().min(1),
						build: z.string().min(1).nullable(),
					})
					.strict(),
				context: recordedContextSchema.extend({
					pixelRatio: z.number().positive(),
					observed: z
						.object({
							width: z.number(),
							height: z.number(),
							media: z.boolean(),
							colorScheme: z.enum(['light', 'dark']),
							contrast: z.enum(['more', 'less', 'custom', 'no-preference']),
							reducedMotion: z.enum(['reduce', 'no-preference']),
							language: z.string(),
							devicePixelRatio: z.number(),
						})
						.strict(),
					resources: z
						.object({
							fonts: z.array(
								z
									.object({
										family: z.string(),
										weight: z.string(),
										style: z.string(),
										status: z.string(),
									})
									.strict()
							),
							remote: z.array(z.object({ url: z.string(), status: z.number() }).strict()),
						})
						.strict(),
				}),
			})
			.strict(),
		channels: z
			.object({
				dom: z.object({ raw: z.string(), normalized: z.string() }).strict(),
				a11y: z
					.object({ snapshot: z.string(), axe: z.union([z.literal('not-run'), axeOutcomeSchema]) })
					.strict(),
				events: eventsChannelSchema,
				evidence: z
					.object({
						expectations: z.array(
							z
								.object({
									id: z.string(),
									kind: z.enum(['event', 'state', 'form', 'validity', 'play']),
									target: z.string().nullable(),
									event: z.string().optional(),
									detail: z.unknown().optional(),
								})
								.strict()
						),
						claims: z.array(
							z
								.object({
									target: z.string(),
									ref: z.string().nullable(),
									obligation: z.string(),
									checkpoint: z.string(),
									expectations: z.array(z.string()),
									source: z.enum(['declared', 'play']),
									checked: z.boolean().optional(),
								})
								.strict()
						),
						commands: z.array(z.string()),
						formData: z.array(z.string()),
						validity: z.array(z.string()),
						attributesSet: z.array(z.string()),
					})
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
		z.strictObject({
			category: z.enum(['render', 'play', 'a11y', 'settled-a11y', 'error']),
			message: z.string(),
		})
	),
	a11y: axeOutcomeSchema,
	settled: axeOutcomeSchema.optional(),
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

const metricSummarySchema = z
	.strictObject({ min: z.number(), median: z.number(), max: z.number() })
	.nullable();
const profileRequestShape = {
	id: z.string().min(1).optional(),
	filter: suiteRequestSchema.shape.filter,
	runs: z.number().int().min(1).max(7).optional(),
	checkpoint: z.string().min(1).optional(),
	context: captureRequestSchema.shape.context,
	timeoutMs: captureRequestSchema.shape.timeoutMs,
};
export const profileRequestSchema = z.strictObject(profileRequestShape);
export const baselineRequestSchema = z.strictObject({
	...profileRequestShape,
	notes: z.array(z.string().min(1)).optional(),
});
const profileFindingSchema = z.strictObject({
	code: z.string(),
	metric: z.string(),
	current: z.number(),
	allowed: z.number(),
	message: z.string(),
});
export const profileRunSchema = z.strictObject({
	reports: z.array(
		z.strictObject({
			id: z.string(),
			checkpoint: z.string(),
			runs: z.number().int().positive(),
			viewport: z.string().nullable(),
			browser: z.string().nullable(),
			samples: z.array(
				z.strictObject({
					firstContentfulPaintMs: z.number().nullable(),
					domContentLoadedMs: z.number(),
					loadMs: z.number(),
					readyMs: z.number(),
					captureMs: z.number(),
					totalElements: z.number(),
					customElements: z.number(),
					shadowHosts: z.number(),
					requestCount: z.number(),
					transferSizeBytes: z.number(),
					usedJSHeapSizeBytes: z.number(),
					consoleErrors: z.number(),
					consoleWarnings: z.number(),
				})
			),
			summary: z
				.strictObject({
					paints: z.strictObject({ firstContentfulPaintMs: metricSummarySchema }),
					timings: z.strictObject({
						domContentLoadedMs: metricSummarySchema,
						loadMs: metricSummarySchema,
						readyMs: metricSummarySchema,
						captureMs: metricSummarySchema,
					}),
					dom: z.strictObject({
						totalElements: metricSummarySchema,
						customElements: metricSummarySchema,
						shadowHosts: metricSummarySchema,
					}),
					resources: z.strictObject({
						requestCount: metricSummarySchema,
						transferSizeBytes: metricSummarySchema,
					}),
					memory: z.strictObject({ usedJSHeapSizeBytes: metricSummarySchema }),
					console: z.strictObject({
						errorCount: z.number().int().nonnegative(),
						warningCount: z.number().int().nonnegative(),
					}),
				})
				.nullable(),
			flags: z.array(
				z.strictObject({
					code: z.string(),
					severity: z.enum(['warning', 'high']),
					message: z.string(),
				})
			),
			comparison: z
				.strictObject({
					status: z.enum(['passed', 'warnings', 'failed', 'not-comparable']),
					reason: z.string().optional(),
					baseline: z.strictObject({
						capturedAt: z.string(),
						runs: z.number(),
						runner: z.string().nullable(),
					}),
					errors: z.array(profileFindingSchema),
					warnings: z.array(profileFindingSchema),
				})
				.nullable(),
			provenance: z.strictObject({
				runner: z.string(),
				capturedAt: z.string(),
				source: z
					.strictObject({ revision: z.string().nullable(), dirty: z.boolean().nullable() })
					.nullable(),
			}),
			error: z.string().optional(),
		})
	),
	counts: z.strictObject({
		total: z.number().int().nonnegative(),
		passed: z.number().int().nonnegative(),
		warnings: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		notComparable: z.number().int().nonnegative(),
		noBaseline: z.number().int().nonnegative(),
		errored: z.number().int().nonnegative(),
	}),
	orphanedBaselines: z.array(z.string()),
	elapsedMs: z.number().nonnegative(),
});

export const suggestRequestSchema = z.strictObject({
	component: z.string().min(1),
	gaps: z.array(z.string().min(1)).optional(),
	timeoutMs: suiteRequestSchema.shape.timeoutMs,
	workers: suiteRequestSchema.shape.workers,
});
export const suggestRunSchema = z.strictObject({
	component: z.string(),
	status: z.literal('unverified'),
	file: z.string(),
	source: z.string(),
	entries: z.array(
		z.strictObject({
			id: z.string(),
			title: z.string(),
			module: z.string(),
			exportName: z.string(),
			component: z.string(),
		})
	),
	suggestions: z.array(
		z.strictObject({
			obligation: z.string(),
			exportName: z.string(),
			note: z.string().optional(),
			placeholder: z.boolean().optional(),
		})
	),
	skipped: z.array(z.strictObject({ obligation: z.string(), reason: z.string() })),
	elapsedMs: z.number(),
});
export const contractRequestSchema = z.strictObject({
	component: z.string().min(1).optional(),
	filter: suiteRequestSchema.shape.filter,
	timeoutMs: suiteRequestSchema.shape.timeoutMs,
	workers: suiteRequestSchema.shape.workers,
});
export const contractRunSchema = z.strictObject({
	rules: z.string().min(1),
	valid: z.boolean(),
	findings: z.array(
		z.strictObject({
			code: z.string().min(1),
			severity: z.enum(['error', 'warning']),
			message: z.string(),
			suggestion: z.string(),
			component: z.string().optional(),
			file: z.string().optional(),
			attribute: z.string().optional(),
		})
	),
	counts: z.strictObject({ errors: z.number(), warnings: z.number() }),
	stats: z.strictObject({ components: z.number(), storyFiles: z.number(), scoped: z.boolean() }),
	cases: z.strictObject({
		total: z.number(),
		passed: z.number(),
		failed: z.array(z.strictObject({ id: z.string(), message: z.string() })),
	}),
	workers: z.number(),
	elapsedMs: z.number(),
});
export const coverageRequestSchema = z.strictObject({
	component: z.string().min(1).optional(),
	filter: suiteRequestSchema.shape.filter,
	timeoutMs: suiteRequestSchema.shape.timeoutMs,
	workers: suiteRequestSchema.shape.workers,
});
const coverageLevelSchema = z.enum(['verified', 'asserted', 'represented', 'missing', 'unknown']);
const coverageCountsSchema = z.strictObject({
	verified: z.number(),
	asserted: z.number(),
	represented: z.number(),
	missing: z.number(),
	unknown: z.number(),
});
export const coverageRunSchema = z.strictObject({
	obligations: z.string().min(1),
	complete: z.boolean(),
	components: z.array(
		z.strictObject({
			tag: z.string().min(1),
			sources: z.array(z.string()),
			cases: z.number(),
			obligations: z.array(
				z.strictObject({
					id: z.string().min(1),
					kind: z.enum(['default', 'property', 'slot', 'event', 'command', 'form']),
					level: coverageLevelSchema,
					evidence: z.array(
						z.strictObject({
							specimen: z.string(),
							checkpoint: z.string(),
							target: z.string(),
							expectations: z.array(z.string()).optional(),
						})
					),
					evidenceCount: z.number(),
					reason: z.string().optional(),
					waiver: z.string().optional(),
				})
			),
			counts: coverageCountsSchema,
			openEnded: z.array(z.string()),
			unknownToSchema: z.array(z.string()),
		})
	),
	counts: coverageCountsSchema,
	waived: z.number(),
	waivers: z.strictObject({
		version: z.string().nullable(),
		unused: z.array(
			z.strictObject({ component: z.string(), obligation: z.string(), reason: z.string() })
		),
	}),
	invalidClaims: z.array(
		z.strictObject({
			specimen: z.string(),
			target: z.string(),
			obligation: z.string(),
			reason: z.string(),
		})
	),
	guides: z
		.strictObject({
			obligations: z.string().min(1),
			complete: z.boolean(),
			statements: z.array(
				z.strictObject({
					id: z.string().min(1),
					kind: z.enum(['usage', 'a11y', 'rule']),
					tag: z.string().optional(),
					file: z.string(),
					level: z.enum(['verified', 'authored']),
					evidence: z.array(
						z.strictObject({
							specimen: z.string(),
							checkpoint: z.string(),
							target: z.string(),
							expectations: z.array(z.string()),
						})
					),
					evidenceCount: z.number(),
				})
			),
			counts: z.strictObject({ verified: z.number(), authored: z.number() }),
			invalidClaims: z.array(
				z.strictObject({
					specimen: z.string(),
					target: z.string(),
					obligation: z.string(),
					reason: z.string(),
				})
			),
		})
		.optional(),
	cases: z.strictObject({
		total: z.number(),
		passed: z.number(),
		failed: z.array(z.strictObject({ id: z.string(), message: z.string() })),
		skipped: z.number(),
	}),
	workers: z.number(),
	elapsedMs: z.number(),
});
export const matrixRequestSchema = z.strictObject({
	id: z.string().min(1),
	// Each axis's values are what the same context field accepts.
	axes: z
		.strictObject({
			theme: z.array(contextSchema.shape.theme).min(1).optional(),
			viewport: z.array(contextSchema.shape.viewport).min(1).optional(),
			container: z.array(contextSchema.shape.container.unwrap()).min(1).optional(),
			locale: z.array(contextSchema.shape.locale).min(1).optional(),
			reducedMotion: z.array(contextSchema.shape.reducedMotion).min(1).optional(),
			motion: z.array(contextSchema.shape.motion).min(1).optional(),
		})
		.refine((axes) => Object.keys(axes).length > 0, 'Give at least one axis.'),
	checkpoint: z.string().min(1).optional(),
	context: captureRequestSchema.shape.context,
	timeoutMs: captureRequestSchema.shape.timeoutMs,
	workers: suiteRequestSchema.shape.workers,
	observations: z.boolean().optional(),
});
export const matrixRunSchema = z.strictObject({
	id: z.string(),
	checkpoint: z.string(),
	axes: z.array(z.string()),
	cells: z.array(
		z.strictObject({
			context: z.record(z.string(), z.unknown()),
			status: z.enum(['captured', 'unavailable']),
			reason: z.string().optional(),
			diff: z
				.strictObject({
					status: z.enum(['changed', 'no-change-observed', 'insufficient-evidence']),
					channels: z.array(z.string()),
					differences: z.number().int().nonnegative(),
					limitations: z.array(z.string()),
				})
				.nullable(),
			observation: observationSchema.optional(),
		})
	),
	counts: z.strictObject({
		total: z.number().int().nonnegative(),
		captured: z.number().int().nonnegative(),
		unavailable: z.number().int().nonnegative(),
		changed: z.number().int().nonnegative(),
		unchanged: z.number().int().nonnegative(),
		insufficient: z.number().int().nonnegative(),
	}),
	elapsedMs: z.number().nonnegative(),
});

const themeEnum = contextSchema.shape.theme;
/** What an entry declares of its themes: `SpecimenEntry.themes`. */
export const themeSupportSchema = z.strictObject({
	supported: z.array(themeEnum).min(1),
	basis: z.literal('declared'),
	reason: z.string().min(1).optional(),
});
export const themesRequestSchema = z.strictObject({
	id: z.string().min(1).optional(),
	filter: suiteRequestSchema.shape.filter,
	themes: z
		.array(themeEnum)
		.min(2)
		.refine((themes) => new Set(themes).size === themes.length, 'Name each theme once.')
		.optional(),
	checkpoint: z.string().min(1).optional(),
	context: captureRequestSchema.shape.context,
	threshold: z.number().min(0).max(1).optional(),
	timeoutMs: captureRequestSchema.shape.timeoutMs,
	workers: suiteRequestSchema.shape.workers,
});
const themeStatus = z.enum([
	'follows',
	'declared',
	'pinned',
	'undeclared',
	'contradicted',
	'unavailable',
]);
export const themesRunSchema = z.strictObject({
	themes: z.array(themeEnum),
	checkpoint: z.string(),
	threshold: z.number().min(0).max(1),
	valid: z.boolean(),
	reports: z.array(
		z.strictObject({
			id: z.string(),
			title: z.string(),
			component: z.string().optional(),
			status: themeStatus,
			declared: themeSupportSchema.nullable(),
			frames: z.array(
				z.strictObject({
					theme: themeEnum,
					rendered: themeEnum.nullable(),
					changed: z.number().min(0).max(1).nullable(),
					reason: z.string().optional(),
				})
			),
			reason: z.string().optional(),
		})
	),
	counts: z.strictObject({
		total: z.number().int().nonnegative(),
		follows: z.number().int().nonnegative(),
		declared: z.number().int().nonnegative(),
		pinned: z.number().int().nonnegative(),
		undeclared: z.number().int().nonnegative(),
		contradicted: z.number().int().nonnegative(),
		unavailable: z.number().int().nonnegative(),
	}),
	workers: z.number().int().positive(),
	elapsedMs: z.number().nonnegative(),
});

/** A component's schema from the manifest, enriched by plugins' schema sources. */
export const componentSchemaSchema = z.strictObject({
	tag: z.string(),
	sources: z.array(z.string()),
	module: z.string().optional(),
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
			projectPolicy: z.string().nullable(),
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
	helpers: z.boolean().optional(),
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
					native: z.string().optional(),
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
