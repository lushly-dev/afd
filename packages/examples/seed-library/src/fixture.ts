/**
 * @fileoverview The library's fixture: members, varieties, lots and the records the
 * scenarios start from (`scenarios/fixtures/library.json`, with `steward.json` over it).
 *
 * Nothing in the application creates a member, a variety or a lot's starting count, so a
 * fixture is the only way in for them.
 */

import { z } from 'zod';

const germination = z.strictObject({
	estimate: z.number().min(0).max(1),
	basis: z.enum(['tested', 'age']),
});

const member = z.strictObject({
	id: z.string(),
	name: z.string(),
	number: z.string(),
	canBeTold: z.boolean(),
});

const variety = z.strictObject({
	id: z.string(),
	name: z.string(),
	kind: z.enum(['vegetable', 'flower']),
	rare: z.boolean(),
	retired: z.boolean().optional(),
	retiredAt: z.string().optional(),
});

const lot = z.strictObject({
	id: z.string(),
	varietyId: z.string(),
	harvestYear: z.number().int(),
	packets: z.number().int().min(0),
	source: z.enum(['donation', 'return']),
	germination,
});

const loan = z.strictObject({
	id: z.string(),
	memberId: z.string(),
	varietyId: z.string(),
	lotId: z.string(),
	lentAt: z.string(),
	status: z.enum(['out', 'returned', 'cancelled']),
	returnedAt: z.string().optional(),
});

const waiting = z.strictObject({
	memberId: z.string(),
	varietyId: z.string(),
});

const request = z.strictObject({
	id: z.string(),
	memberId: z.string(),
	varietyId: z.string(),
	askedAt: z.string(),
	expiresAt: z.string(),
	status: z.enum(['pending', 'approved', 'declined', 'expired', 'withdrawn']),
	summary: z.string(),
	decidedAt: z.string().optional(),
	reason: z.string().optional(),
	loanId: z.string().optional(),
});

const substitute = z.strictObject({
	for: z.string(),
	offer: z.string(),
	confidence: z.number().min(0).max(1),
	reason: z.string(),
});

const labelMatch = z.strictObject({
	label: z.string(),
	offers: z.array(
		z.strictObject({
			varietyId: z.string(),
			confidence: z.number().min(0).max(1),
			reason: z.string(),
		})
	),
});

const evidence = z.strictObject({
	type: z.string(),
	id: z.string(),
	title: z.string(),
	location: z.string().optional(),
});

/** A whole fixture, after `steward.json` is merged over `library.json`. */
export const libraryFixtureSchema = z.strictObject({
	$schema: z.string().optional(),
	app: z.literal('seed-library'),
	now: z.string(),
	rules: z
		.strictObject({
			approvalLastsHours: z.number().positive().max(24).optional(),
			oldSeedBelow: z.number().min(0).max(1).optional(),
			matchAppliesFrom: z.number().min(0).max(1).optional(),
		})
		.optional(),
	members: z.array(member).default([]),
	varieties: z.array(variety).default([]),
	lots: z.array(lot).default([]),
	loans: z.array(loan).default([]),
	waiting: z.array(waiting).default([]),
	requests: z.array(request).default([]),
	substitutes: z.array(substitute).default([]),
	labelMatches: z.array(labelMatch).default([]),
	evidence: z.array(evidence).default([]),
});

export type LibraryFixture = z.output<typeof libraryFixtureSchema>;
export type LibraryFixtureInput = z.input<typeof libraryFixtureSchema>;
export type MemberRecord = z.output<typeof member>;
export type VarietyRecord = z.output<typeof variety>;
export type LotRecord = z.output<typeof lot>;
export type LoanRecord = z.output<typeof loan>;
export type WaitingRecord = z.output<typeof waiting>;
export type RequestRecord = z.output<typeof request>;
export type SubstituteRecord = z.output<typeof substitute>;
export type LabelMatchRecord = z.output<typeof labelMatch>;
export type EvidenceRecord = z.output<typeof evidence>;
export type Germination = z.output<typeof germination>;
