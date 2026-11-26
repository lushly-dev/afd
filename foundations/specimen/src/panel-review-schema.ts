/** Zod input and output schemas for `panel-review` and `panel-calibrate` (Agent-First Design Phase C3). */

import { z } from 'zod';
import { CARD_ID_PATTERN, type EscalationTrigger } from './card-types.js';
import { unmeasuredEntrySchema } from './design-schema.js';
import {
	MAX_CALIBRATION_COUNT,
	MAX_PANEL_SIZE,
	RUN_ID_PATTERN,
	SAMPLE_ID_PATTERN,
} from './panel-review-types.js';
import { isValidWalkTargetUrl } from './panel-validate.js';

const APP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(dateStr: string): boolean {
	if (!APP_DATE_PATTERN.test(dateStr)) return false;
	const [yearStr, monthStr, dayStr] = dateStr.split('-') as [string, string, string];
	const year = Number(yearStr);
	const month = Number(monthStr);
	const day = Number(dayStr);
	if (month < 1 || month > 12 || day < 1 || day > 31) return false;
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() === month - 1 &&
		parsed.getUTCDate() === day
	);
}

const trimmedText = z
	.string()
	.min(1)
	.refine((v) => v.trim().length > 0, 'Expected a non-empty string');

const ESCALATION_TRIGGER_VALUES: readonly [EscalationTrigger, ...EscalationTrigger[]] = [
	'split-3-to-2',
	'conflicts-recorded-decision',
	'no-precedent',
	'guidance-change',
	'irreversible-or-default',
];

export const panelReviewBudgetSchema = z.strictObject({
	maxRounds: z.number().int().min(0).max(20).optional(),
	maxCostUsd: z.number().finite().min(0).max(10000).optional(),
});

export const panelReviewCapturesSchema = z.strictObject({
	before: trimmedText.optional(),
	after: trimmedText.optional(),
});

export const panelReviewRunRequestSchema = z.strictObject({
	action: z.literal('review').optional(),
	change: trimmedText,
	author: trimmedText.optional(),
	jobs: z.array(trimmedText).min(1).max(32),
	target: trimmedText.refine(
		(v) => isValidWalkTargetUrl(v.trim()),
		'target must be a valid http:// or https:// URL'
	),
	appDate: trimmedText.refine(
		(v) => isValidCalendarDate(v.trim()),
		'appDate must be a calendar-valid YYYY-MM-DD date'
	),
	captures: panelReviewCapturesSchema.optional(),
	panelSize: z.number().int().min(1).max(MAX_PANEL_SIZE).optional(),
	budget: panelReviewBudgetSchema.optional(),
	baseline: trimmedText.optional(),
});

export const panelReviewWithdrawRequestSchema = z.strictObject({
	action: z.literal('withdraw'),
	run: trimmedText,
	reason: trimmedText,
});

export const panelReviewRequestSchema = z.union([
	panelReviewRunRequestSchema,
	panelReviewWithdrawRequestSchema,
]);

export const panelReviewOverlapSchema = z.strictObject({
	families: z.array(z.string().min(1)),
	sharedFindings: z.number().int().min(0),
	uniqueFindings: z.number().int().min(0),
});

export const panelReviewProvisionalItemSchema = z.strictObject({
	item: z.string().min(1),
	summary: z.string().min(1),
	decidedBy: z.strictObject({
		kind: z.literal('panel'),
		reviewers: z.array(z.string().min(1)).min(1),
		split: z.string().min(1),
	}),
	provisional: z.literal(true),
});

export const panelReviewEscalatedItemSchema = z.strictObject({
	card: z.string().regex(CARD_ID_PATTERN),
	trigger: z.enum(ESCALATION_TRIGGER_VALUES),
	split: z.string().min(1).optional(),
	question: z.string().min(1),
	evidenceForBothSides: z.strictObject({
		for: z.array(z.string().min(1)),
		against: z.array(z.string().min(1)),
	}),
});

export const panelReviewRunResultSchema = z.strictObject({
	run: z.string().regex(RUN_ID_PATTERN),
	round: z.number().int().min(1),
	panelSize: z.number().int().min(1),
	walks: z.array(z.string().min(1)),
	overlap: panelReviewOverlapSchema,
	provisional: z.array(panelReviewProvisionalItemSchema),
	escalated: z.array(panelReviewEscalatedItemSchema),
	stoppedBy: z.enum(['converged', 'gate-regression', 'budget', 'no-new-findings']).nullable(),
	nextSteps: z.array(z.string().min(1)),
	unmeasured: z.array(unmeasuredEntrySchema),
});

export const panelReviewWithdrawResultSchema = z.strictObject({
	run: z.string().regex(RUN_ID_PATTERN),
	withdrawn: z.literal(true),
	withdrawnCards: z.array(z.string().regex(CARD_ID_PATTERN)),
	withdrawnProvisional: z.number().int().min(0),
	preservedDecidedCards: z.array(z.string().regex(CARD_ID_PATTERN)),
	reason: z.string().min(1),
});

export const panelReviewResultSchema = z.union([
	panelReviewRunResultSchema,
	panelReviewWithdrawResultSchema,
]);

export const panelCalibrateSampleRequestSchema = z.strictObject({
	action: z.literal('sample'),
	count: z.number().int().min(1).max(MAX_CALIBRATION_COUNT).optional(),
	seed: z.number().int().min(0).max(2147483647).optional(),
});

export const panelCalibrateJudgementSchema = z.strictObject({
	item: trimmedText,
	verdict: z.enum(['accept', 'reject']),
	reason: trimmedText.optional(),
});

export const panelCalibrateRecordRequestSchema = z.strictObject({
	action: z.literal('record'),
	sample: trimmedText,
	judgements: z.array(panelCalibrateJudgementSchema).max(MAX_CALIBRATION_COUNT),
});

export const panelCalibrateRequestSchema = z.union([
	panelCalibrateSampleRequestSchema,
	panelCalibrateRecordRequestSchema,
]);

export const panelCalibrateEvidenceSchema = z.strictObject({
	visual: z.string().min(1).optional(),
	walk: z.string().min(1).optional(),
});

export const panelCalibrateItemSchema = z.strictObject({
	item: z.string().min(1),
	summary: z.string().min(1),
	evidence: panelCalibrateEvidenceSchema,
	panelVerdict: z.enum(['accept', 'reject']).optional(),
});

export const panelCalibrateResultSchema = z.strictObject({
	sample: z.string().regex(SAMPLE_ID_PATTERN),
	items: z.array(panelCalibrateItemSchema),
	recorded: z.number().int().min(0).optional(),
	disagreed: z.number().int().min(0).optional(),
	disagreementRate: z.number().min(0).max(1).optional(),
	reopenedCards: z.array(z.string().regex(CARD_ID_PATTERN)).optional(),
	unmeasured: z.array(unmeasuredEntrySchema),
});
