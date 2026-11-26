import { z } from 'zod';
import { isValidIsoClock } from './browser/clock-parse.js';
import {
	CARD_ID_PATTERN,
	CARD_OWNER_VALUES,
	CARD_SCOPE_VALUES,
	CARD_SEVERITY_VALUES,
	CARD_STATUS_VALUES,
	CARD_TRIGGER_VALUES,
	REFUSAL_SCOPE_VALUES,
	RELEASE_ID_PATTERN,
} from './card-types.js';

const trimmedText = z
	.string()
	.min(1)
	.refine((v) => v.trim().length > 0, 'Expected a non-empty string');

export const refusalScopeSchema = z.enum(REFUSAL_SCOPE_VALUES);
export const cardScopeSchema = z.enum(CARD_SCOPE_VALUES);
export const cardOwnerSchema = z.enum(CARD_OWNER_VALUES);
export const cardSeveritySchema = z.enum(CARD_SEVERITY_VALUES);
export const cardTriggerSchema = z.enum(CARD_TRIGGER_VALUES);
export const cardStatusSchema = z.enum(CARD_STATUS_VALUES);

export const meantToFixSchema = z.strictObject({
	job: trimmedText,
	target: trimmedText,
});

export const cardUnmeasuredEntrySchema = z.strictObject({
	area: z.string().min(1),
	reason: z.string().min(1),
	addToMeasure: z.string().min(1),
});

export const cardVisualSchema = z.strictObject({
	kind: z.enum(['captures', 'transcript', 'diff']),
	before: z.string().min(1).optional(),
	after: z.string().min(1).optional(),
	context: z
		.strictObject({
			state: z.string().min(1).optional(),
			viewport: z.string().min(1).optional(),
			theme: z.string().min(1).optional(),
			modality: z.enum(['pointer', 'keyboard', 'screen-reader', 'low-vision']).optional(),
		})
		.optional(),
	summary: z.string().min(1),
});

export const cardWhySchema = z.strictObject({
	findings: z.array(
		z.strictObject({
			summary: z.string().min(1),
			evidence: z.enum(['observed', 'hypothesis']),
		})
	),
	evidenceForBothSides: z
		.strictObject({
			for: z.array(z.string()),
			against: z.array(z.string()),
		})
		.optional(),
	reviewerCount: z.number().int().min(0),
	split: z.string().min(1),
	trigger: cardTriggerSchema,
});

export const cardEffectSchema = z.strictObject({
	gatesBefore: z.strictObject({
		passed: z.number().int().min(0),
		failed: z.number().int().min(0),
	}),
	gatesAfter: z.strictObject({
		passed: z.number().int().min(0),
		failed: z.number().int().min(0),
	}),
	checksSummary: z.string().min(1).optional(),
	regression: z.boolean(),
});

export const cardRiskSchema = z.strictObject({
	affects: z.array(z.string()),
	undoable: z.boolean(),
});

export const cardPatternActionSchema = z.union([
	z.strictObject({
		kind: z.literal('fork'),
		library: z.string().min(1),
		pattern: z.string().min(1),
		patternPath: z.string().min(1),
		source: z.string().min(1).optional(),
		bind: z.boolean().optional(),
		configPath: z.string().min(1).optional(),
	}),
	z.strictObject({
		kind: z.literal('merge'),
		library: z.string().min(1),
		pattern: z.string().min(1),
		patternPath: z.string().min(1),
		upstreamLibrary: z.string().min(1),
		upstreamPattern: z.string().min(1),
		upstreamVersion: z.string().min(1),
		upstreamDigests: z.record(z.string(), z.string()),
		upstreamPath: z.string().min(1),
		stagedPattern: z.record(z.string(), z.unknown()),
	}),
]);

export const designCardSummarySchema = z.strictObject({
	card: z.string().regex(CARD_ID_PATTERN),
	run: z.string().min(1).optional(),
	what: z.string().min(1),
	owner: cardOwnerSchema,
	touches: z.array(z.string()),
	severity: cardSeveritySchema,
	visual: cardVisualSchema,
	why: cardWhySchema,
	effect: cardEffectSchema,
	risk: cardRiskSchema,
	status: cardStatusSchema,
});

export const designCardRecordSchema = designCardSummarySchema.extend({
	scope: cardScopeSchema,
	changeSignature: z.string().min(1).optional(),
	patternAction: cardPatternActionSchema.optional(),
	decision: z.string().min(1).optional(),
	createdAt: z.string().min(1).optional(),
});

export const designCardListRequestSchema = z.strictObject({
	scope: z.enum(['all', 'release', 'guidance', 'interface']).optional(),
	card: trimmedText.optional(),
	status: z.enum(['open', 'deferred', 'changes-requested', 'withdrawn', 'all']).optional(),
	severity: cardSeveritySchema.optional(),
	includeProvisional: z.boolean().optional(),
	includeDecided: z.boolean().optional(),
	limit: z.number().int().min(1).max(200).optional(),
	after: trimmedText.optional(),
});

export const designCardListResultSchema = z.strictObject({
	page: z.string().min(1),
	cards: z.array(designCardSummarySchema),
	total: z.number().int().min(0),
	more: z.number().int().min(0),
	next: z.string().min(1).optional(),
	unmeasured: z.array(cardUnmeasuredEntrySchema),
});

export const designReleaseRequestSchema = z.strictObject({
	release: trimmedText.refine(
		(v) => RELEASE_ID_PATTERN.test(v.trim()),
		'Release id must match /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/'
	),
	decisions: z
		.array(trimmedText)
		.min(1)
		.refine(
			(ids) => new Set(ids.map((id) => id.trim())).size === ids.length,
			'Decision ids must be unique'
		),
	scope: z.enum(['all', 'release', 'guidance', 'interface']).optional(),
	releasedAt: trimmedText
		.refine(
			(v) => isValidIsoClock(v.trim()),
			'releasedAt must be a calendar-valid ISO-8601 timestamp with timezone'
		)
		.optional(),
});

export const designReleaseManifestSchema = z.strictObject({
	version: z.literal(1),
	release: z.string().regex(RELEASE_ID_PATTERN),
	scope: z.enum(['all', 'release', 'guidance', 'interface']),
	releasedAt: z.string().min(1),
	decisions: z.array(z.string().min(1)).min(1),
	releasedBy: z.strictObject({
		kind: z.enum(['person', 'test']),
		id: z.string().min(1).optional(),
		channel: z.enum(['review-page', 'cli', 'mcp-relay']).optional(),
	}),
});

export const designReleaseResultSchema = z.strictObject({
	release: z.string().min(1),
	manifestPath: z.string().min(1),
	releasedAt: z.string().min(1),
	decisions: z.array(z.string().min(1)).min(1),
	nextSteps: z.array(z.string().min(1)),
	unmeasured: z.array(cardUnmeasuredEntrySchema),
});
