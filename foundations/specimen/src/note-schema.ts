import { z } from 'zod';

const MAX_NOTE_TEXT_LENGTH = 4_000;
const MAX_NOTE_REASON_LENGTH = 2_000;
const MAX_NOTE_ASSIGNEE_LENGTH = 200;
const MAX_NOTE_RESOLVE_IDS = 100;

const noteTimeoutMsSchema = z.number().int().min(1).max(60_000).optional();
const notePinSchema = z.strictObject({
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
});
const noteAccessibleSchema = z.strictObject({
	role: z.string().min(1).optional(),
	name: z.string().min(1).optional(),
	from: z.string().min(1).optional(),
});
const noteIdentitySchema = z.strictObject({
	strongest: z.enum(['role-name', 'component-position', 'ref']),
	roleName: z.strictObject({ role: z.string().min(1), name: z.string().min(1) }).optional(),
	componentPosition: z
		.strictObject({ tag: z.string().min(1), index: z.number().int().positive() })
		.optional(),
	ref: z.string().min(1),
});

export const noteOutcomeSchema = z.enum([
	'fixed',
	'declined',
	'duplicate',
	'obsolete',
	'withdrawn',
]);

export const noteStateSchema = z.enum(['open', 'resolved']);

export const noteListStateSchema = z.enum(['open', 'resolved', 'all']);

export const noteSubjectSchema = z.strictObject({
	specimen: z.string().min(1),
	checkpoint: z.string().min(1).optional(),
	context: z.record(z.string(), z.string()),
	accessible: noteAccessibleSchema,
	identity: noteIdentitySchema,
});

export const noteEvidenceSchema = z.strictObject({
	revision: z.string().min(1).optional(),
	capture: z.string().min(1).optional(),
});

export const noteResolutionSchema = z.strictObject({
	outcome: noteOutcomeSchema,
	reason: z.string().min(1).max(MAX_NOTE_REASON_LENGTH),
	evidence: noteEvidenceSchema.optional(),
});

export const noteHistoryEntrySchema = z.strictObject({
	change: z.enum(['moved', 'resolved', 'reopened']),
	reason: z.string().min(1).max(MAX_NOTE_REASON_LENGTH),
	outcome: noteOutcomeSchema.optional(),
	evidence: noteEvidenceSchema.optional(),
	at: z.string().min(1).optional(),
});

export const noteSchema = z.strictObject({
	id: z.string().regex(/^note-[0-9a-z]{12}$/),
	text: z.string().min(1).max(MAX_NOTE_TEXT_LENGTH),
	subject: noteSubjectSchema,
	pin: notePinSchema,
	state: noteStateSchema,
	orphaned: z.boolean(),
	assignee: z.string().min(1).max(MAX_NOTE_ASSIGNEE_LENGTH).optional(),
	resolution: noteResolutionSchema.optional(),
	history: z.array(noteHistoryEntrySchema),
});

export const noteAddRequestSchema = z
	.strictObject({
		point: z.string().min(1).optional(),
		pointer: z.string().optional(),
		text: z.string().max(MAX_NOTE_TEXT_LENGTH),
		assignee: z.string().min(1).max(MAX_NOTE_ASSIGNEE_LENGTH).optional(),
		timeoutMs: noteTimeoutMsSchema,
	})
	.refine(
		(value) => (value.point !== undefined) !== (value.pointer !== undefined),
		'Provide either point or pointer, not both.'
	);

export const noteListRequestSchema = z.strictObject({
	specimen: z.string().min(1).optional(),
	state: noteListStateSchema.optional(),
	assignee: z.string().min(1).max(MAX_NOTE_ASSIGNEE_LENGTH).optional(),
	orphaned: z.boolean().optional(),
	limit: z.number().int().min(1).max(100).optional(),
	after: z.string().min(1).optional(),
});

export const noteCheckRequestSchema = z.strictObject({
	specimen: z.string().min(1).optional(),
	timeoutMs: noteTimeoutMsSchema,
});

export const noteMoveRequestSchema = z
	.strictObject({
		id: z.string().min(1),
		point: z.string().min(1).optional(),
		pointer: z.string().optional(),
		reason: z.string().max(MAX_NOTE_REASON_LENGTH).optional(),
		timeoutMs: noteTimeoutMsSchema,
	})
	.refine(
		(value) => (value.point !== undefined) !== (value.pointer !== undefined),
		'Provide either point or pointer, not both.'
	);

export const noteResolveRequestSchema = z
	.strictObject({
		id: z.string().min(1).optional(),
		ids: z.array(z.string().min(1)).min(1).max(MAX_NOTE_RESOLVE_IDS).optional(),
		outcome: noteOutcomeSchema,
		reason: z.string().max(MAX_NOTE_REASON_LENGTH).optional(),
		evidence: noteEvidenceSchema.optional(),
	})
	.refine(
		(value) => (value.id !== undefined) !== (value.ids !== undefined),
		'Provide either id or ids, not both.'
	);

export const noteReopenRequestSchema = z.strictObject({
	id: z.string().min(1),
	reason: z.string().max(MAX_NOTE_REASON_LENGTH).optional(),
});

export const noteResultSchema = z.strictObject({
	note: noteSchema,
});

export const noteListResultSchema = z.strictObject({
	notes: z.array(noteSchema),
	next: z.string().min(1).optional(),
});

export const noteCheckResultSchema = z.strictObject({
	checked: z.number().int().nonnegative(),
	orphaned: z.array(z.string().min(1)),
	weakened: z.array(z.string().min(1)),
	unchecked: z.array(
		z.strictObject({
			specimen: z.string().min(1),
			reason: z.enum(['render-failed', 'specimen-missing']),
			notes: z.array(z.string().min(1)),
		})
	),
	restored: z.array(z.string().min(1)),
});

export const noteResolveResultSchema = z.strictObject({
	resolved: z.array(noteSchema),
	skipped: z.array(
		z.strictObject({
			id: z.string().min(1),
			code: z.enum(['NOTE_ALREADY_RESOLVED', 'NOTE_NOT_FOUND']),
			reason: z.string().min(1),
		})
	),
});
