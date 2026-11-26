import { z } from 'zod';
import { meantToFixSchema, refusalScopeSchema } from './card-schema.js';
import { CARD_CHOSEN_VALUES, CARD_ID_PATTERN } from './card-types.js';
import { isValidSubjectGlob } from './decision-validate.js';

const trimmedText = z
	.string()
	.min(1)
	.refine((v) => v.trim().length > 0, 'Expected a non-empty string');

const compareDiffChannelSchema = z.enum(['dom', 'a11y', 'layout', 'styles', 'state', 'events']);
const decisionIdSchema = z.string().regex(/^dec-[0-9a-hjkmnp-tv-z]{12}$/);
const decisionSetIdSchema = z.string().regex(/^set-[0-9a-f]{12}$/);
const decisionEvidenceDirSchema = z.string().regex(/^specimens\/evidence\/set-[0-9a-f]{12}\/$/);
const decisionPathSchema = z
	.string()
	.regex(/^specimens\/decisions\/dec-[0-9a-hjkmnp-tv-z]{12}\.json$/);

export const decisionActorSchema = z.strictObject({
	kind: z.enum(['person', 'panel', 'script', 'test']),
	id: z.string().min(1).optional(),
	channel: z.enum(['review-page', 'cli', 'mcp-relay']).optional(),
	reviewers: z.array(z.string().min(1)).optional(),
	split: z.string().min(1).optional(),
});

export const decisionSubjectsSchema = z.strictObject({
	specimens: z.array(z.string().min(1)).optional(),
	files: z
		.array(z.string().min(1).refine(isValidSubjectGlob, 'Subject file glob pattern is invalid'))
		.optional(),
	tokens: z.array(z.string().min(1)).optional(),
});

const decisionEvidenceRefSchema = z.strictObject({
	set: decisionSetIdSchema,
	dir: decisionEvidenceDirSchema,
});

const decisionEvidenceCaptureSchema = z.strictObject({
	key: z.string().min(1),
	id: z.string().min(1),
	status: z.enum(['captured', 'unavailable']),
	hash: z.string().min(1).nullable(),
	checkpoint: z.string().min(1).optional(),
	axe: z.enum(['passed', 'warning', 'failed', 'not-run']),
	violations: z.array(z.string()).optional(),
	screenshot: z.string().min(1).nullable(),
	reason: z.string().min(1).optional(),
});

export const decisionAnswerEntrySchema = z.strictObject({
	item: z.string().min(1),
	kind: z.enum(['changed', 'incomplete-check', 'insufficient-evidence']).optional(),
	id: z.string().min(1).optional(),
	ids: z.array(z.string().min(1)).optional(),
	check: z.string().min(1).optional(),
	cause: z
		.strictObject({
			channel: compareDiffChannelSchema,
			target: z.string().optional(),
			property: z.string().optional(),
			left: z.unknown().optional(),
			right: z.unknown().optional(),
		})
		.optional(),
	fingerprint: z.string(),
});

const decisionPanelProvenanceSchema = z.strictObject({
	reviewers: z.array(trimmedText).min(1),
	split: trimmedText,
});

export const decisionRecordRequestSchema = z
	.strictObject({
		slug: z.string().min(1).optional(),
		question: z.string().min(1).optional(),
		set: z.string().min(1).optional(),
		supersedes: z
			.union([
				z.string().min(1),
				z
					.array(z.string().min(1))
					.min(1)
					.refine(
						(ids) => new Set(ids).size === ids.length,
						'Superseded decision ids must be unique'
					),
			])
			.optional(),
		items: z
			.array(z.string().min(1))
			.min(1)
			.refine((items) => new Set(items).size === items.length, 'Review item ids must be unique')
			.optional(),
		card: trimmedText.optional(),
		cards: z
			.array(trimmedText)
			.min(1)
			.refine(
				(ids) => new Set(ids.map((id) => id.trim())).size === ids.length,
				'Card ids must be unique'
			)
			.optional(),
		chosen: z.string().min(1),
		reason: z.string().optional(),
		subjects: decisionSubjectsSchema.optional(),
		refusalScope: refusalScopeSchema.optional(),
		regressionAccepted: z.boolean().optional(),
		meantToFix: meantToFixSchema.optional(),
		remediation: trimmedText.optional(),
		provisional: z.boolean().optional(),
		panel: decisionPanelProvenanceSchema.optional(),
		changeAuthor: trimmedText.optional(),
	})
	.superRefine((value, ctx) => {
		const hasCard = value.card !== undefined;
		const hasCards = value.cards !== undefined;
		const hasSet = value.set !== undefined;
		const hasSupersedes = value.supersedes !== undefined;
		const hasItems = value.items !== undefined;

		if (hasCard && hasCards) {
			ctx.addIssue({ code: 'custom', message: 'Provide either card or cards, not both.' });
			return;
		}
		if (hasCard || hasCards) {
			if (hasSet || hasItems) {
				ctx.addIssue({
					code: 'custom',
					message: 'Card mode cannot be combined with set or items.',
				});
			}
			if (value.subjects !== undefined) {
				ctx.addIssue({
					code: 'custom',
					path: ['subjects'],
					message: 'Card mode cannot carry subjects.',
				});
			}
			if (Array.isArray(value.supersedes)) {
				ctx.addIssue({
					code: 'custom',
					path: ['supersedes'],
					message: 'Card mode supersedes accepts a single decision id.',
				});
			}
			if (!(CARD_CHOSEN_VALUES as readonly string[]).includes(value.chosen)) {
				ctx.addIssue({
					code: 'custom',
					path: ['chosen'],
					message: `Card mode requires chosen to be one of ${CARD_CHOSEN_VALUES.join(', ')}.`,
				});
			}
			if (value.refusalScope !== undefined && value.chosen !== 'reject') {
				ctx.addIssue({
					code: 'custom',
					path: ['refusalScope'],
					message: 'refusalScope is only valid when chosen is "reject".',
				});
			}
			if (value.regressionAccepted !== undefined && value.chosen !== 'approve') {
				ctx.addIssue({
					code: 'custom',
					path: ['regressionAccepted'],
					message: 'regressionAccepted is only valid when chosen is "approve".',
				});
			}
			return;
		}

		if (value.refusalScope !== undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['refusalScope'],
				message: 'refusalScope applies only in card mode.',
			});
		}
		if (value.regressionAccepted !== undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['regressionAccepted'],
				message: 'regressionAccepted applies only in card mode.',
			});
		}
		if (value.meantToFix !== undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['meantToFix'],
				message: 'meantToFix applies only in card mode.',
			});
		}
		if (value.remediation !== undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['remediation'],
				message: 'remediation applies only in card mode.',
			});
		}

		if (!hasSet && !hasSupersedes && !hasItems) {
			ctx.addIssue({
				code: 'custom',
				message:
					'Provide set (new choice), supersedes (supersede choice), items (review answer), or card/cards (card mode).',
			});
			return;
		}
		if (hasSet && !hasSupersedes && !hasItems) {
			if (value.slug === undefined) {
				ctx.addIssue({
					code: 'custom',
					path: ['slug'],
					message: 'slug is required when recording a new choice from a set.',
				});
			}
			if (value.question === undefined) {
				ctx.addIssue({
					code: 'custom',
					path: ['question'],
					message: 'question is required when recording a new choice from a set.',
				});
			}
			return;
		}
		if (hasSupersedes) {
			const supersedeIds = Array.isArray(value.supersedes)
				? value.supersedes
				: [value.supersedes as string];
			if (hasItems) {
				if (value.chosen !== 'accept') {
					ctx.addIssue({
						code: 'custom',
						path: ['chosen'],
						message: 'Superseding choices from review items requires chosen: "accept".',
					});
				}
				if (value.subjects !== undefined) {
					ctx.addIssue({
						code: 'custom',
						path: ['subjects'],
						message: 'Accepting review items preserves each superseded choice’s existing subjects.',
					});
				}
				if (hasSet) {
					ctx.addIssue({
						code: 'custom',
						path: ['set'],
						message: 'Accepting review items cites the accepted item’s after set.',
					});
				}
			}
			if (supersedeIds.length > 1) {
				if (value.slug !== undefined) {
					ctx.addIssue({
						code: 'custom',
						path: ['slug'],
						message: 'Cannot override slug when superseding multiple choices.',
					});
				}
				if (value.question !== undefined) {
					ctx.addIssue({
						code: 'custom',
						path: ['question'],
						message: 'Cannot override question when superseding multiple choices.',
					});
				}
				if (value.subjects !== undefined) {
					ctx.addIssue({
						code: 'custom',
						path: ['subjects'],
						message: 'Cannot override subjects when superseding multiple choices.',
					});
				}
			}
			return;
		}
		// Mode 3: items without supersedes
		if (hasSet) {
			ctx.addIssue({
				code: 'custom',
				path: ['set'],
				message: 'set cannot be combined with items without supersedes.',
			});
		}
		if (value.subjects !== undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['subjects'],
				message: 'Review answers cannot carry subjects.',
			});
		}
		if (value.chosen !== 'accept' && value.chosen !== 'reject') {
			ctx.addIssue({
				code: 'custom',
				path: ['chosen'],
				message: 'Review answers require chosen to be "accept" or "reject".',
			});
		}
	});

export const decisionRecordSingleResultSchema = z.strictObject({
	decision: decisionIdSchema,
	kind: z.enum(['choice', 'answer', 'card']),
	path: decisionPathSchema,
	chosen: z.string().min(1),
	card: z.string().regex(CARD_ID_PATTERN).optional(),
	kept: z.array(z.string().min(1)).optional(),
	supersedes: decisionIdSchema.optional(),
	superseded: decisionIdSchema.optional(),
	answers: z.array(decisionAnswerEntrySchema).optional(),
	evidence: decisionEvidenceRefSchema.optional(),
	evidenceDir: decisionEvidenceDirSchema.optional(),
	subjects: decisionSubjectsSchema.optional(),
	refusalScope: refusalScopeSchema.optional(),
	regressionAccepted: z.boolean().optional(),
	meantToFix: meantToFixSchema.optional(),
	appliedPatterns: z.array(z.string().min(1)).optional(),
	provisional: z.literal(true).optional(),
});

export const decisionRecordResultSchema = z.union([
	decisionRecordSingleResultSchema,
	z.strictObject({
		decisions: z.array(decisionRecordSingleResultSchema).min(1),
	}),
]);

export const decisionGetRequestSchema = z.strictObject({
	decision: z.string().min(1),
});

export const decisionGetResultSchema = z.union([
	z.strictObject({
		decision: decisionIdSchema,
		id: decisionIdSchema,
		kind: z.literal('choice'),
		slug: z.string().min(1),
		status: z.enum(['current', 'superseded']),
		question: z.string().min(1),
		variants: z.array(z.string().min(1)).min(1),
		chosen: z.string().min(1),
		kept: z.array(z.string().min(1)),
		discarded: z.array(z.string().min(1)),
		discardedAt: z.record(z.string(), z.string()).optional(),
		reason: z.string().min(1),
		evidence: z.strictObject({
			set: decisionSetIdSchema,
			dir: decisionEvidenceDirSchema,
			captures: z.array(decisionEvidenceCaptureSchema),
		}),
		subjects: decisionSubjectsSchema,
		answers: z.array(decisionAnswerEntrySchema).optional(),
		supersedes: decisionIdSchema.optional(),
		decidedAt: z.string().min(1),
		decidedBy: decisionActorSchema,
	}),
	z.strictObject({
		decision: decisionIdSchema,
		id: decisionIdSchema,
		kind: z.literal('answer'),
		slug: z.string().min(1).optional(),
		question: z.string().min(1).optional(),
		chosen: z.enum(['accept', 'reject']),
		reason: z.string().min(1),
		answers: z.array(decisionAnswerEntrySchema).min(1),
		provisional: z.literal(true).optional(),
		decidedAt: z.string().min(1),
		decidedBy: decisionActorSchema,
	}),
	z.strictObject({
		decision: decisionIdSchema,
		id: decisionIdSchema,
		kind: z.literal('card'),
		card: z.string().regex(CARD_ID_PATTERN),
		question: z.string().min(1),
		chosen: z.enum(CARD_CHOSEN_VALUES),
		reason: z.string().min(1),
		refusalScope: refusalScopeSchema.optional(),
		regressionAccepted: z.boolean().optional(),
		meantToFix: meantToFixSchema.optional(),
		supersedes: decisionIdSchema.optional(),
		remediation: z.string().min(1).optional(),
		changeSignature: z.string().min(1).optional(),
		appliedPatterns: z.array(z.string().min(1)).optional(),
		decidedAt: z.string().min(1),
		decidedBy: decisionActorSchema,
	}),
]);

export const decisionListRequestSchema = z.strictObject({
	kind: z.enum(['choice', 'card', 'answer', 'all']).optional(),
	released: z.boolean().optional(),
	limit: z.number().int().min(1).max(200).optional(),
	after: trimmedText.optional(),
});

export const decisionListResultSchema = z.strictObject({
	decisions: z.array(
		z.strictObject({
			decision: decisionIdSchema,
			question: z.string().min(1),
			chosen: z.string().min(1),
			stale: z.array(z.string().min(1)),
			kind: z.enum(['choice', 'card', 'answer']).optional(),
			card: z.string().regex(CARD_ID_PATTERN).optional(),
			released: z.boolean().optional(),
			release: z.string().min(1).optional(),
			refusalScope: refusalScopeSchema.optional(),
			meantToFix: meantToFixSchema.optional(),
		})
	),
	undecided: z.array(
		z.strictObject({
			set: decisionSetIdSchema,
			ids: z.array(z.string().min(1)),
		})
	),
	total: z.number().int().min(0).optional(),
	next: z.string().min(1).optional(),
});

export const decisionCheckRequestSchema = z.strictObject({
	files: z.array(z.string().min(1)).optional(),
	specimens: z.array(z.string().min(1)).optional(),
	tokens: z.array(z.string().min(1)).optional(),
});

export const decisionCheckResultSchema = z.strictObject({
	decisions: z.array(
		z.strictObject({
			decision: decisionIdSchema,
			question: z.string().min(1),
			chosen: z.string().min(1),
			reason: z.string().min(1),
			supersedes: decisionIdSchema.optional(),
			matched: z.strictObject({
				files: z.array(z.string().min(1)).optional(),
				specimens: z.array(z.string().min(1)).optional(),
				tokens: z.array(z.string().min(1)).optional(),
			}),
		})
	),
});
