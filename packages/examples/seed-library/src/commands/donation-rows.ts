/**
 * @fileoverview How a donation's rows are worked through: matching a label to a variety,
 * filing a row as a lot, and reporting the batch as data and as a plan.
 */

import type { PlanStep } from '@lushly-dev/afd-core';
import { plural } from '../refusals.js';
import type { DonationData } from '../schemas.js';
import {
	ageEstimate,
	type Donation,
	type DonationRow,
	type LibraryStore,
	type RowError,
} from '../store.js';

/** What a label matches: one variety for sure, several to choose from, or nothing. */
export type LabelMatch =
	| { kind: 'match'; varietyId: string; confidence: number; reason: string }
	| { kind: 'unclear'; offers: Array<{ varietyId: string; confidence: number; reason: string }> }
	| { kind: 'none'; retired?: string };

export function matchLabel(store: LibraryStore, label: string): LabelMatch {
	const wanted = label.trim().toLowerCase();
	const named = [...store.varieties.values()].find(
		(variety) => variety.name.toLowerCase() === wanted
	);
	if (named) {
		return named.retired
			? { kind: 'none', retired: named.name }
			: {
					kind: 'match',
					varietyId: named.id,
					confidence: 1,
					reason: 'The label names the variety',
				};
	}
	const entry = store.labelMatches.find((match) => match.label.toLowerCase() === wanted);
	const offers = (entry?.offers ?? [])
		.filter((offer) => {
			const variety = store.variety(offer.varietyId);
			return variety !== undefined && !variety.retired;
		})
		.sort((a, b) => b.confidence - a.confidence);
	const [best] = offers;
	if (!best) return { kind: 'none' };
	if (best.confidence >= store.rules.matchAppliesFrom) return { kind: 'match', ...best };
	return { kind: 'unclear', offers };
}

/** Why a row cannot be taken in as it stands, or undefined when it can be tried. */
export function yearError(
	row: { index: number; harvestYear: number },
	now: number
): RowError | undefined {
	const thisYear = new Date(now).getUTCFullYear();
	if (row.harvestYear <= thisYear) return undefined;
	return {
		code: 'INVALID_INPUT',
		message: `The harvest year ${row.harvestYear} is in the future`,
		suggestion: `Call donation-correct for row ${row.index + 1} with a harvest year of ${thisYear} or earlier`,
	};
}

export function labelError(row: { index: number; label: string }, retired?: string): RowError {
	return {
		code: 'NOT_FOUND',
		message: retired
			? `${retired} is retired, and the library no longer keeps it`
			: `The library does not keep a variety called ${row.label}`,
		suggestion: `Call donation-correct for row ${row.index + 1} with a label from variety-list, or with leaveOut: true to leave the row out`,
	};
}

/** Work one row through: file it under a variety, leave it for a person, or fail it. */
export function takeIn(
	store: LibraryStore,
	donation: Donation,
	row: DonationRow,
	now: number
): void {
	delete row.error;
	delete row.varietyId;
	delete row.lotId;
	const badYear = yearError(row, now);
	if (badYear) {
		row.outcome = 'failed';
		row.error = badYear;
		return;
	}
	const match = matchLabel(store, row.label);
	if (match.kind === 'none') {
		row.outcome = 'failed';
		row.error = labelError(row, match.retired);
		return;
	}
	if (match.kind === 'unclear') {
		row.outcome = 'unsettled';
		return;
	}
	file(store, donation, row, match.varietyId, now);
}

/** Make the row's lot under a variety. */
export function file(
	store: LibraryStore,
	donation: Donation,
	row: DonationRow,
	varietyId: string,
	now: number
): void {
	const lot = store.addLot({
		id: `lot-${donation.id}-${row.index}`,
		varietyId,
		harvestYear: row.harvestYear,
		packets: row.packets,
		source: 'donation',
		germination: ageEstimate(row.harvestYear, now),
		donationId: donation.id,
		rowIndex: row.index,
	});
	row.outcome = 'succeeded';
	row.varietyId = varietyId;
	row.lotId = lot.id;
}

export function settleStatus(donation: Donation): void {
	if (donation.status === 'cancelled') return;
	donation.status = donation.rows.some(
		(row) => row.outcome === 'unsettled' || row.outcome === 'failed'
	)
		? 'needs-attention'
		: 'complete';
}

export function donationData(store: LibraryStore, donation: Donation): DonationData {
	const base = ({ index, label, packets, harvestYear }: DonationRow) => ({
		index,
		label,
		packets,
		harvestYear,
	});
	const of = (outcome: DonationRow['outcome']) =>
		donation.rows.filter((row) => row.outcome === outcome);
	const succeeded = of('succeeded').map((row) => ({
		...base(row),
		varietyId: row.varietyId as string,
		...(row.lotId && store.lot(row.lotId) && { lotId: row.lotId }),
	}));
	const unsettled = of('unsettled').map(base);
	const failed = of('failed').map((row) => ({ ...base(row), error: row.error as RowError }));
	return {
		id: donation.id,
		status: donation.status,
		succeeded,
		unsettled,
		failed,
		summary: {
			total: donation.rows.length,
			successCount: succeeded.length,
			unsettledCount: unsettled.length,
			failureCount: failed.length,
			leftOutCount: of('left-out').length,
		},
	};
}

export function donationPlan(store: LibraryStore, donation: Donation): PlanStep[] {
	return donation.rows.map((row): PlanStep => {
		const step = {
			id: `row-${row.index}`,
			action: `Take in row ${row.index + 1}: ${row.label}, ${plural(row.packets, 'packet')}`,
		};
		switch (row.outcome) {
			case 'succeeded':
				return { ...step, status: 'complete', ...(row.note && { description: row.note }) };
			case 'unsettled':
				return {
					...step,
					status: 'pending',
					description: `Waits for a person to choose the variety: no match reached ${store.rules.matchAppliesFrom}`,
				};
			case 'failed':
				return {
					...step,
					status: 'failed',
					...(row.error && { error: { code: row.error.code, message: row.error.message } }),
				};
			default:
				return { ...step, status: 'skipped', description: row.note ?? 'Left out of the batch' };
		}
	});
}
