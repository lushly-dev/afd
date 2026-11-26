import { z } from 'zod';
import { unmeasuredEntrySchema } from './design-schema.js';

const DECISION_ID_PATTERN = /^dec-[0-9a-hjkmnp-tv-z]{12}$/;
const trimmedNonEmpty = z.string().trim().min(1);

export const designObserveStatusSchema = z.enum([
	'improved',
	'unchanged',
	'regressed',
	'insufficient-data',
]);

export const designObserveRequestSchema = z.strictObject({
	decision: trimmedNonEmpty.regex(
		DECISION_ID_PATTERN,
		'Expected a decision id matching dec-<12 lowercase alphanumeric chars>.'
	),
	journal: trimmedNonEmpty,
	beforeJournal: trimmedNonEmpty.optional(),
});

export const designObserveMetricsSummarySchema = z.strictObject({
	runs: z.number().int().min(0),
	completionRate: z.number().finite().min(0).max(1),
	unexpectedFailures: z.number().int().min(0),
	repeats: z.number().int().min(0),
	outsideSteps: z.number().int().min(0),
});

export const designObserveMetricsSchema = designObserveMetricsSummarySchema.extend({
	before: designObserveMetricsSummarySchema.optional(),
});

export const designObserveResultSchema = z.strictObject({
	decision: trimmedNonEmpty,
	releasedAt: trimmedNonEmpty,
	meantToFix: z
		.strictObject({
			job: trimmedNonEmpty,
			target: trimmedNonEmpty,
		})
		.optional(),
	status: designObserveStatusSchema,
	metrics: designObserveMetricsSchema,
	note: trimmedNonEmpty,
	unmeasured: z.array(unmeasuredEntrySchema).min(1),
});
