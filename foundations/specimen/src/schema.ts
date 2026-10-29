import { z } from 'zod';

export const contextSchema = z.strictObject({
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
	theme: z.enum(['light', 'dark']),
	locale: z.string().min(1),
	reducedMotion: z.enum(['reduce', 'no-preference']),
	motion: z.enum(['natural', 'settled']),
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
	})
	.strict();
export const observationSchema = z
	.object({
		manifest: z
			.object({
				captureVersion: z.string().min(1),
				normalizationVersion: z.string().min(1),
				specimenId: z.string().min(1),
				checkpoint: z.string().min(1),
				source: z
					.object({
						revision: z.string().nullable(),
						digest: z.string().min(1),
						dirty: z.boolean().nullable(),
					})
					.strict(),
				dependencies: z.string().min(1),
				browser: z.object({ name: z.string().min(1), version: z.string().min(1) }).strict(),
				context: contextSchema,
			})
			.strict(),
		channels: z
			.object({
				dom: z.object({ raw: z.string(), normalized: z.string() }).strict(),
				a11y: z.object({ snapshot: z.string(), axe: z.literal('not-run') }).strict(),
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
