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
