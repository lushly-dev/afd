/**
 * @fileoverview The `data` of each command's result, as zod schemas (`output` on each
 * definition). The shapes and values are the ones `seed-library.md` drafts in "Drafted
 * commands" and "States". Objects are strict, so a field the design does not name is an error.
 */

import { z } from 'zod';

const id = z.string().min(1);
const timestamp = z.iso.datetime();
const count = z.number().int().min(0);

export const germinationSchema = z.strictObject({
	estimate: z.number().min(0).max(1),
	basis: z.enum(['tested', 'age']),
});

export const memberRefSchema = z.strictObject({ id, name: z.string(), number: z.string() });
export const varietyRefSchema = z.strictObject({ id, name: z.string() });

export const varietyKind = z.enum(['vegetable', 'flower']);
export const loanStatus = z.enum(['out', 'returned', 'cancelled']);
export const requestStatus = z.enum(['pending', 'approved', 'declined', 'expired', 'withdrawn']);
export const donationStatus = z.enum(['in-progress', 'complete', 'needs-attention', 'cancelled']);
export const rowOutcome = z.enum(['succeeded', 'unsettled', 'failed', 'left-out']);

// ── Varieties and lots ──────────────────────────────────────────────────────────

export const varietyListOutput = z.strictObject({
	varieties: z.array(
		z.strictObject({
			id,
			name: z.string(),
			kind: varietyKind,
			rare: z.boolean(),
			packetsAvailable: count,
			/** The freshest lot's, absent when the variety has no packets. */
			germination: germinationSchema.optional(),
			retired: z.boolean(),
		})
	),
	total: count,
});

export const varietyGetOutput = z.strictObject({
	id,
	name: z.string(),
	kind: varietyKind,
	rare: z.boolean(),
	packetsAvailable: count,
	waiting: z.array(z.strictObject({ member: memberRefSchema, position: z.number().int().min(1) })),
	retired: z.boolean(),
	retiredAt: timestamp.optional(),
});

export const varietyRetireOutput = z.strictObject({
	id,
	retired: z.boolean(),
	retiredAt: timestamp,
	packetsWithdrawn: count,
});

export const lotListOutput = z.strictObject({
	lots: z.array(
		z.strictObject({
			id,
			harvestYear: z.number().int(),
			packets: count,
			source: z.enum(['donation', 'return']),
			germination: germinationSchema,
		})
	),
	total: count,
});

export const substituteSuggestOutput = z.strictObject({
	variety: z.strictObject({ id, name: z.string(), packetsAvailable: count }),
});

// ── Members, loans and the waiting list ─────────────────────────────────────────

export const memberListOutput = z.strictObject({
	members: z.array(memberRefSchema),
	total: count,
});

export const loanCreateOutput = z.strictObject({
	id,
	status: loanStatus,
	lentAt: timestamp,
	lot: z.strictObject({ id, harvestYear: z.number().int(), germination: germinationSchema }),
});

export const loanCancelOutput = z.strictObject({ id, status: loanStatus });

export const loanReturnOutput = z.strictObject({
	id,
	status: loanStatus,
	returnedAt: timestamp,
	lot: z.strictObject({ id, packets: z.number().int().min(1) }).optional(),
});

export const loanReopenOutput = z.strictObject({
	id,
	status: loanStatus,
	lotRemoved: id.optional(),
});

export const loanListOutput = z.strictObject({
	loans: z.array(
		z.strictObject({
			id,
			member: memberRefSchema,
			variety: varietyRefSchema,
			lentAt: timestamp,
			status: loanStatus,
		})
	),
	total: count,
});

export const waitlistJoinOutput = z.strictObject({ position: z.number().int().min(1) });
export const waitlistLeaveOutput = z.strictObject({ left: z.boolean() });

// ── The steward's requests ──────────────────────────────────────────────────────

export const requestListOutput = z.strictObject({
	requests: z.array(
		z.strictObject({
			id,
			member: memberRefSchema,
			variety: varietyRefSchema,
			summary: z.string(),
			askedAt: timestamp,
			expiresAt: timestamp,
			status: requestStatus,
			packetsAvailable: count,
		})
	),
	total: count,
});

export const requestWithdrawOutput = z.strictObject({ id, status: requestStatus });

export const requestDecideOutput = z.strictObject({
	id,
	status: requestStatus,
	decidedAt: timestamp,
	loanId: id.optional(),
	memberTold: z.boolean(),
});

export const requestReopenOutput = z.strictObject({
	id,
	status: requestStatus,
	expiresAt: timestamp,
	loanCancelled: id.optional(),
});

export const requestClearOutput = z.strictObject({ removed: count });

// ── Donations ───────────────────────────────────────────────────────────────────

const row = {
	index: z.number().int().min(0),
	label: z.string(),
	packets: z.number().int().min(1),
	harvestYear: z.number().int(),
};

export const rowErrorSchema = z.strictObject({
	code: z.string(),
	message: z.string(),
	suggestion: z.string(),
});

export const donationOutput = z.strictObject({
	id,
	status: donationStatus,
	succeeded: z.array(z.strictObject({ ...row, varietyId: id, lotId: id.optional() })),
	unsettled: z.array(z.strictObject(row)),
	failed: z.array(z.strictObject({ ...row, error: rowErrorSchema })),
	summary: z.strictObject({
		total: count,
		successCount: count,
		unsettledCount: count,
		failureCount: count,
		leftOutCount: count,
	}),
});

export const donationCancelOutput = z.strictObject({
	id,
	cancelled: z.boolean(),
	lotsRemoved: count,
});

export const donationMatchOutput = z.strictObject({ variety: varietyRefSchema, label: z.string() });

export const donationSettleOutput = z.strictObject({
	index: z.number().int().min(0),
	varietyId: id,
	lotId: id,
});

export const donationCorrectOutput = z.strictObject({
	index: z.number().int().min(0),
	outcome: rowOutcome,
	lotId: id.optional(),
});

export type DonationData = z.output<typeof donationOutput>;
