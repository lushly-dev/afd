import { z } from 'zod';

const coverageLevelSchema = z.enum(['verified', 'asserted', 'represented', 'missing', 'unknown']);
const coverageCountsSchema = z.strictObject({
	verified: z.number(),
	asserted: z.number(),
	represented: z.number(),
	missing: z.number(),
	unknown: z.number(),
});

export const coverageRunSchema = z.strictObject({
	obligations: z.string().min(1),
	complete: z.boolean(),
	components: z.array(
		z.strictObject({
			tag: z.string().min(1),
			sources: z.array(z.string()),
			cases: z.number(),
			obligations: z.array(
				z.strictObject({
					id: z.string().min(1),
					kind: z.enum(['default', 'property', 'slot', 'event', 'command', 'form']),
					level: coverageLevelSchema,
					evidence: z.array(
						z.strictObject({
							specimen: z.string(),
							checkpoint: z.string(),
							target: z.string(),
							expectations: z.array(z.string()).optional(),
						})
					),
					evidenceCount: z.number(),
					reason: z.string().optional(),
					waiver: z.string().optional(),
				})
			),
			counts: coverageCountsSchema,
			openEnded: z.array(z.string()),
			unknownToSchema: z.array(z.string()),
			jobs: z
				.strictObject({
					reachedBy: z.array(
						z.strictObject({
							key: z.string().min(1),
							name: z.string().min(1),
							step: z.number().int().positive(),
						})
					),
					unreached: z.array(z.string().min(1)),
					reason: z.string().min(1).optional(),
				})
				.optional(),
		})
	),
	counts: coverageCountsSchema,
	waived: z.number(),
	waivers: z.strictObject({
		version: z.string().nullable(),
		unused: z.array(
			z.strictObject({ component: z.string(), obligation: z.string(), reason: z.string() })
		),
	}),
	invalidClaims: z.array(
		z.strictObject({
			specimen: z.string(),
			target: z.string(),
			obligation: z.string(),
			reason: z.string(),
		})
	),
	guides: z
		.strictObject({
			obligations: z.string().min(1),
			complete: z.boolean(),
			statements: z.array(
				z.strictObject({
					id: z.string().min(1),
					kind: z.enum(['usage', 'a11y', 'rule']),
					tag: z.string().optional(),
					file: z.string(),
					level: z.enum(['verified', 'authored']),
					evidence: z.array(
						z.strictObject({
							specimen: z.string(),
							checkpoint: z.string(),
							target: z.string(),
							expectations: z.array(z.string()),
						})
					),
					evidenceCount: z.number(),
				})
			),
			counts: z.strictObject({ verified: z.number(), authored: z.number() }),
			invalidClaims: z.array(
				z.strictObject({
					specimen: z.string(),
					target: z.string(),
					obligation: z.string(),
					reason: z.string(),
				})
			),
		})
		.optional(),
	cases: z.strictObject({
		total: z.number(),
		passed: z.number(),
		failed: z.array(z.strictObject({ id: z.string(), message: z.string() })),
		skipped: z.number(),
	}),
	workers: z.number(),
	elapsedMs: z.number(),
});
