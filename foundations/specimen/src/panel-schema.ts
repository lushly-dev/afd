import { z } from 'zod';
import { MAX_WALK_ACTIONS, MODALITY_VALUES, WALK_ID_PATTERN } from './panel-types.js';
import { isValidWalkTargetUrl } from './panel-validate.js';

const trimmedText = z
	.string()
	.transform((value) => value.trim())
	.refine((value) => value.length > 0, 'Expected a non-empty string');

const walkTargetSchema = trimmedText.refine(
	isValidWalkTargetUrl,
	'Expected a valid http:// or https:// URL'
);

const appDateSchema = trimmedText.refine((value) => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [y, m, d] = value.split('-').map(Number) as [number, number, number];
	if (m < 1 || m > 12 || d < 1 || d > 31) return false;
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}, 'Expected a valid calendar date in YYYY-MM-DD format');

export const modalitySchema = z.enum(MODALITY_VALUES);

export const walkUnmeasuredEntrySchema = z.strictObject({
	area: z.string().min(1),
	reason: z.string().min(1),
	addToMeasure: z.string().min(1),
});

export const walkFindingSchema = z.strictObject({
	summary: z.string().min(1),
	evidence: z.enum(['observed', 'hypothesis']),
	where: z.string().min(1),
});

export const walkPathMetricsSchema = z.strictObject({
	done: z.boolean(),
	failed: z.number().int().min(0),
	repeats: z.number().int().min(0),
	outside: z.number().int().min(0),
	deviations: z.number().int().min(0),
});

export const walkPairwiseComparisonSchema = z.strictObject({
	baselineWalk: z.string().regex(WALK_ID_PATTERN),
	method: z.literal('blind-pairwise-report'),
	worse: z.enum(['current', 'baseline', 'same']),
	why: z.string().min(1),
});

export const walkJournalEntrySchema = z.strictObject({
	command: z.string().min(1),
	recordId: z.string().optional(),
	mutation: z.boolean().optional(),
	success: z.boolean(),
	expectedRefusal: z.boolean().optional(),
	undo: z.boolean().optional(),
	readOnly: z.boolean().optional(),
});

export const panelWalkRequestSchema = z.strictObject({
	job: trimmedText,
	persona: trimmedText,
	modality: modalitySchema,
	target: walkTargetSchema,
	appDate: appDateSchema.optional(),
	maxActions: z.number().int().min(1).max(MAX_WALK_ACTIONS).optional(),
	baselineWalk: trimmedText.optional(),
	requestedTools: z.array(trimmedText).min(1).optional(),
});

export const panelWalkResultSchema = z.strictObject({
	walk: z.string().regex(WALK_ID_PATTERN),
	job: z.string().min(1),
	persona: z.string().min(1),
	modality: modalitySchema,
	ending: z.enum(['done', 'stopped']),
	actions: z.number().int().min(0),
	path: walkPathMetricsSchema,
	findings: z.array(walkFindingSchema),
	comparison: walkPairwiseComparisonSchema.optional(),
	unmeasured: z.array(walkUnmeasuredEntrySchema),
});

export const panelWalkRecordSchema = z.strictObject({
	version: z.literal(1),
	walk: z.string().regex(WALK_ID_PATTERN),
	recordedUtc: z.string().min(1),
	target: walkTargetSchema,
	appDate: appDateSchema.optional(),
	viewport: z.strictObject({
		width: z.number().int().min(1),
		height: z.number().int().min(1),
	}),
	allowedTools: z.array(z.string().min(1)),
	prompt: z.string(),
	endingLine: z.string().min(1),
	transcript: z.string(),
	journal: z.array(walkJournalEntrySchema),
	expectedSteps: z.array(z.string()),
	result: panelWalkResultSchema,
});

export const personaDefinitionSchema = z.strictObject({
	id: trimmedText,
	modality: modalitySchema,
	name: trimmedText.optional(),
	stance: trimmedText.optional(),
	card: trimmedText.optional(),
});

export const panelConfigSchema = z.strictObject({
	personas: z.array(personaDefinitionSchema).optional(),
	jobs: z.array(trimmedText).optional(),
	scenariosDir: trimmedText.optional(),
	driver: trimmedText.optional(),
});
