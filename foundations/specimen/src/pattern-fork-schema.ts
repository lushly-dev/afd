/** Zod input and output schemas for `specimen-pattern-fork`, `specimen-pattern-compare`, and `specimen-pattern-merge`. */

import { z } from 'zod';
import { CARD_ID_PATTERN } from './card-types.js';
import { unmeasuredEntrySchema } from './design-schema.js';
import {
	PACK_TEXT_LIMITS,
	packIdentifier,
	packText,
	patternDerivedFromSchema,
	waivedKeepEntrySchema,
} from './pack-atoms.js';

export const patternStatementSectionSchema = z.enum(['useWhen', 'avoidWhen', 'keep', 'customize']);

export const patternCompareStatusSchema = z.enum([
	'unchanged',
	'changed-here',
	'changed-upstream',
	'changed-both',
	'dropped-here',
	'added-upstream',
	'declined',
]);

export const patternForkRequestSchema = z.strictObject({
	source: packIdentifier('qualifiedPattern'),
	target: packIdentifier('pattern').optional(),
	bind: z.boolean().optional(),
});

export const patternForkResultSchema = z.strictObject({
	pattern: packIdentifier('pattern'),
	path: z.string().min(1),
	approvalStatus: z.literal('proposed'),
	derivedFrom: patternDerivedFromSchema,
	bindingStatus: z.enum(['pending-approval', 'unbound']),
	card: z.string().regex(CARD_ID_PATTERN),
	nextSteps: z.array(z.string().min(1)),
});

export const patternCompareRequestSchema = z.strictObject({
	pattern: packIdentifier('pattern').optional(),
	upstreamVersion: packIdentifier('version').optional(),
	onlyChanged: z.boolean().optional(),
});

const patternCompareSourceSchema = z.strictObject({
	library: packIdentifier('library'),
	pattern: packIdentifier('pattern'),
	baseVersion: packIdentifier('version'),
	currentVersion: packIdentifier('version'),
});

export const patternCompareStatementSchema = z.strictObject({
	id: packIdentifier('id'),
	section: patternStatementSectionSchema,
	status: patternCompareStatusSchema,
	waiverReason: packText(PACK_TEXT_LIMITS.statement).optional(),
	localText: packText(PACK_TEXT_LIMITS.statement).optional(),
	upstreamText: packText(PACK_TEXT_LIMITS.statement).optional(),
});

export const patternCompareSingleResultSchema = z.strictObject({
	pattern: packIdentifier('pattern'),
	source: patternCompareSourceSchema,
	statements: z.array(patternCompareStatementSchema),
	waivers: z.array(waivedKeepEntrySchema),
	nextSteps: z.array(z.string().min(1)),
	unmeasured: z.array(unmeasuredEntrySchema),
});

export const patternCompareBulkResultSchema = z.strictObject({
	patterns: z.array(
		z.strictObject({
			pattern: packIdentifier('pattern'),
			source: patternCompareSourceSchema,
			counts: z.strictObject({
				changedHere: z.number().int().nonnegative(),
				changedUpstream: z.number().int().nonnegative(),
				changedBoth: z.number().int().nonnegative(),
				droppedHere: z.number().int().nonnegative(),
				addedUpstream: z.number().int().nonnegative(),
				declined: z.number().int().nonnegative(),
			}),
			waivers: z.number().int().nonnegative(),
		})
	),
	nextSteps: z.array(z.string().min(1)),
	unmeasured: z.array(unmeasuredEntrySchema),
});

export const patternCompareResultSchema = z.union([
	patternCompareSingleResultSchema,
	patternCompareBulkResultSchema,
]);

const nonBlankPackText = (max: number) =>
	packText(max).refine((value) => value.trim().length > 0, 'Expected non-whitespace text');

const mergeWaiverEntrySchema = z.strictObject({
	id: packIdentifier('id'),
	reason: nonBlankPackText(PACK_TEXT_LIMITS.statement),
});

export const patternMergeResolutionSchema = z.strictObject({
	id: packIdentifier('id'),
	text: nonBlankPackText(PACK_TEXT_LIMITS.statement),
	gate: packIdentifier('gate').optional(),
	setup: packIdentifier('setup').optional(),
});

export const patternMergeRequestSchema = z
	.strictObject({
		pattern: packIdentifier('pattern'),
		upstreamVersion: packIdentifier('version').optional(),
		accept: z.array(packIdentifier('id')).max(256).optional(),
		decline: z.array(packIdentifier('id')).max(256).optional(),
		waivers: z.array(mergeWaiverEntrySchema).max(64).optional(),
		resolutions: z.array(patternMergeResolutionSchema).max(256).optional(),
	})
	.refine(
		(value) => (value.accept?.length ?? 0) + (value.decline?.length ?? 0) > 0,
		'Provide at least one statement id in accept or decline.'
	);

export const patternMergeResultSchema = z.strictObject({
	pattern: packIdentifier('pattern'),
	card: z.string().regex(CARD_ID_PATTERN),
	upstreamVersion: packIdentifier('version'),
	upstreamDigests: z.record(z.string().min(1), z.string().regex(/^sha256:[0-9a-f]{64}$/)),
	accepted: z.array(packIdentifier('id')),
	declined: z.array(packIdentifier('id')),
	stagedStatus: z.literal('proposed'),
	nextSteps: z.array(z.string().min(1)),
});
