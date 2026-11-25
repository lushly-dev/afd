import { z } from 'zod';

const reviewDiffChannelSchema = z.enum(['dom', 'a11y', 'layout', 'styles', 'state', 'events']);
const reviewSetIdSchema = z.string().regex(/^set-[0-9a-f]{12}$/);
const reviewDecisionIdSchema = z.string().regex(/^dec-[0-9a-hjkmnp-tv-z]{12}$/);

export const reviewRequestSchema = z.strictObject({
	before: z.string().trim().min(1),
	after: z.string().trim().min(1),
	ids: z
		.array(z.string().trim().min(1))
		.min(1)
		.refine((ids) => new Set(ids).size === ids.length, 'Review ids must be unique')
		.optional(),
});

const reviewSetSummarySchema = z.strictObject({
	set: reviewSetIdSchema,
	label: z.string().min(1).optional(),
	revision: z.string().min(1).nullable(),
	dirty: z.boolean().nullable(),
});

const reviewCaptureRefSchema = z.strictObject({
	key: z.string().min(1),
	before: z.string().min(1).optional(),
	after: z.string().min(1),
});

const reviewDecisionRefSchema = z.strictObject({
	decision: reviewDecisionIdSchema,
	reason: z.string().min(1),
});

export const reviewOpenItemSchema = z.strictObject({
	item: z.string().min(1),
	kind: z.enum(['changed', 'incomplete-check', 'insufficient-evidence']),
	ids: z.array(z.string().min(1)).min(1),
	cause: z
		.strictObject({
			channel: reviewDiffChannelSchema,
			target: z.string().optional(),
			property: z.string().optional(),
			left: z.unknown().optional(),
			right: z.unknown().optional(),
		})
		.optional(),
	check: z.string().min(1).optional(),
	limitation: z.string().min(1).optional(),
	question: z.string().min(1),
	options: z.tuple([z.literal('accept'), z.literal('reject')]),
	captures: z.array(reviewCaptureRefSchema),
	decisions: z.array(reviewDecisionRefSchema),
	note: z.string().min(1).optional(),
});

export const reviewBlockingItemSchema = z.strictObject({
	kind: z.enum(['axe-failed', 'unavailable', 'rejected']),
	ids: z.array(z.string().min(1)).min(1),
	item: z.string().min(1).optional(),
	reason: z.string().min(1).optional(),
	violations: z.array(z.string()).optional(),
});

export const reviewResultSchema = z.strictObject({
	before: reviewSetSummarySchema,
	after: reviewSetSummarySchema,
	open: z.array(reviewOpenItemSchema),
	blocking: z.array(reviewBlockingItemSchema),
	settled: z.strictObject({
		unchanged: z.number().int().nonnegative(),
		kept: z.number().int().nonnegative(),
		answered: z.number().int().nonnegative(),
	}),
	page: z.string().min(1),
});
