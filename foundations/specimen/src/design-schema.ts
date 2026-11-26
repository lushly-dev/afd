import { z } from 'zod';

export const approvalStatusSchema = z.enum(['proposed', 'approved', 'deprecated']);

export const unmeasuredEntrySchema = z.strictObject({
	area: z.string().min(1),
	reason: z.string().min(1),
	addToMeasure: z.string().min(1),
});

export const designStatesRequestSchema = z.strictObject({
	commands: z.array(z.string().min(1)).optional(),
	scenario: z.string().min(1).optional(),
	consumer: z.string().min(1).optional(),
	includeProposed: z.boolean().optional(),
	limit: z.number().int().min(1).max(500).optional(),
	after: z.string().min(1).optional(),
});

export const designStateEntrySchema = z.strictObject({
	id: z.string().min(1),
	command: z.string().min(1),
	trigger: z.string().min(1),
	pattern: z.string().min(1),
	source: z.enum(['default', 'copied', 'replaced', 'product']),
	approvalStatus: approvalStatusSchema,
	setup: z.string().min(1),
});

export const designStatesResultSchema = z.strictObject({
	defaultsVersion: z.string().min(1),
	states: z.array(designStateEntrySchema),
	next: z.string().min(1).optional(),
	nextSteps: z.array(z.string().min(1)),
	unmeasured: z.array(unmeasuredEntrySchema),
});
