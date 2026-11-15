/**
 * @fileoverview Intake: a box of donated packets, entered as one batch and worked through row
 * by row. A row fails by itself; the batch succeeds when some rows fail.
 */

import type { Alternative } from '@lushly-dev/afd-core';
import { defineCommand, success, type ZodCommandDefinition } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { nowOf, plural, refuse } from '../refusals.js';
import {
	donationCancelOutput,
	donationCorrectOutput,
	donationMatchOutput,
	donationOutput,
	donationSettleOutput,
} from '../schemas.js';
import type { Donation, DonationRow, LibraryStore, RowOutcome } from '../store.js';
import {
	donationData,
	donationPlan,
	file,
	labelError,
	matchLabel,
	settleStatus,
	takeIn,
	yearError,
} from './donation-rows.js';

const donationNotFound = (id: string) =>
	refuse(
		'NOT_FOUND',
		`The library has no donation ${id}`,
		'Check the id that donation-import returned, or enter the box with donation-import',
		{ id }
	);

const rowRef = {
	donationId: z.string().describe('The donation id, from donation-import'),
	index: z.number().int().min(0).describe("The row's index in the batch, from 0"),
};

export function donationCommands(store: LibraryStore): ZodCommandDefinition[] {
	/** The donation and its row, or the refusal for a missing one. */
	function findRow(donationId: string, index: number) {
		const donation = store.donation(donationId);
		if (!donation) return { ok: false, refusal: donationNotFound(donationId) } as const;
		const row = donation.rows[index];
		if (!row) {
			return {
				ok: false,
				refusal: refuse(
					'NOT_FOUND',
					`${donation.id} has no row ${index}; its rows are 0 to ${donation.rows.length - 1}`,
					`Call donation-get with id ${donation.id} to see its rows`,
					{ donationId: donation.id, index }
				),
			} as const;
		}
		if (donation.status === 'cancelled') {
			return {
				ok: false,
				refusal: refuse(
					'CONFLICT',
					`${donation.id} was taken back`,
					`Call donation-get with id ${donation.id} to see it; enter the box again with donation-import`,
					{ donationId: donation.id, status: donation.status }
				),
			} as const;
		}
		return { ok: true, donation, row } as const;
	}

	const lentFrom = (row: DonationRow) =>
		refuse(
			'CONFLICT',
			`Packets from lot ${row.lotId}, which row ${row.index + 1} made, have been lent`,
			`Call loan-list with varietyId ${row.varietyId} to see who has them; the row stays as it is`,
			{ index: row.index, lotId: row.lotId }
		);

	const donationImport = defineCommand({
		name: 'donation-import',
		category: 'intake',
		description:
			'Imports a box of donated packets as one batch, row by row. A row whose label matches a variety at a confidence of 0.9 or more makes a lot; one below waits for a person (donation-match, donation-settle); a row that cannot go in fails by itself (donation-correct). The batch succeeds when some rows fail',
		expose: { mcp: true },
		mutation: true,
		undoable: true,
		approval: 'not-required',
		input: z.object({
			donor: z.string().optional().describe('Who handed the box in'),
			rows: z
				.array(
					z.object({
						label: z.string().min(1).describe('The label as written on the packet'),
						packets: z.number().int().min(1),
						harvestYear: z
							.number()
							.int()
							.optional()
							.describe('The year the seed was harvested; last year when absent'),
					})
				)
				.min(1),
		}),
		output: donationOutput,
		errors: ['VALIDATION_ERROR'],
		async handler(input, context) {
			const now = nowOf(context);
			const lastYear = new Date(now).getUTCFullYear() - 1;
			const donation: Donation = {
				id: store.nextId('don-'),
				...(input.donor && { donor: input.donor }),
				status: 'in-progress',
				rows: input.rows.map((row, index) => ({
					index,
					label: row.label,
					packets: row.packets,
					harvestYear: row.harvestYear ?? lastYear,
					outcome: 'unsettled',
				})),
			};
			store.donations.push(donation);
			for (const row of donation.rows) takeIn(store, donation, row, now);
			settleStatus(donation);
			const data = donationData(store, donation);
			const { total, successCount, unsettledCount, failureCount } = data.summary;
			return success(data, {
				reasoning: `Took in ${successCount} of ${plural(total, 'row')}${unsettledCount ? `; ${unsettledCount} wait for a person to choose the variety` : ''}${failureCount ? `; ${failureCount} could not be taken in` : ''}`,
				confidence: successCount / total,
				plan: donationPlan(store, donation),
				...(failureCount > 0 && {
					warnings: [
						{
							code: 'PARTIAL_SUCCESS',
							message: `${failureCount} of ${plural(total, 'row')} could not be taken in`,
							severity: 'warning',
							details: { failureCount, failedIndexes: data.failed.map((row) => row.index) },
						},
					],
				}),
				undoCommand: 'donation-cancel',
				undoArgs: { id: donation.id },
			});
		},
	});

	const donationGet = defineCommand({
		name: 'donation-get',
		category: 'intake',
		description:
			'Get a donation batch: each row and its outcome, and the batch worked through as a plan',
		expose: { mcp: true },
		input: z.object({ id: z.string().describe('The donation id') }),
		output: donationOutput,
		errors: ['NOT_FOUND'],
		async handler(input) {
			const donation = store.donation(input.id);
			if (!donation) return donationNotFound(input.id);
			return success(donationData(store, donation), { plan: donationPlan(store, donation) });
		},
	});

	const donationCancel = defineCommand({
		name: 'donation-cancel',
		category: 'intake',
		description:
			'Removes a whole batch and the lots it made, as for a box entered twice. Undone by entering the box again',
		expose: { mcp: true },
		mutation: true,
		approval: 'not-required',
		input: z.object({ id: z.string().describe('The donation id') }),
		output: donationCancelOutput,
		errors: ['NOT_FOUND', 'CONFLICT'],
		async handler(input) {
			const donation = store.donation(input.id);
			if (!donation) return donationNotFound(input.id);
			if (donation.status === 'cancelled') {
				return refuse(
					'CONFLICT',
					`${donation.id} was taken back already`,
					`Call donation-get with id ${donation.id} to see it`,
					{ id: donation.id, status: donation.status }
				);
			}
			const filed = donation.rows.filter((row) => row.lotId && store.lot(row.lotId));
			const lent = filed.find((row) => store.hasLentFrom(row.lotId as string));
			if (lent) return lentFrom(lent);
			for (const row of filed) {
				store.removeLot(row.lotId as string);
				delete row.lotId;
			}
			donation.status = 'cancelled';
			return success(
				{ id: donation.id, cancelled: true, lotsRemoved: filed.length },
				{ reasoning: `Took back ${donation.id} and removed ${plural(filed.length, 'lot')}` }
			);
		},
	});

	const donationMatch = defineCommand({
		name: 'donation-match',
		category: 'intake',
		description:
			"Finds the variety a row's label most likely is, how sure the match is and why, with the other varieties it could be as alternatives",
		expose: { mcp: true },
		input: z.object(rowRef),
		output: donationMatchOutput,
		errors: ['NOT_FOUND', 'CONFLICT'],
		async handler(input) {
			const found = findRow(input.donationId, input.index);
			if (!found.ok) return found.refusal;
			const { donation, row } = found;
			if (row.outcome === 'failed' || row.outcome === 'left-out') {
				return refuse(
					'CONFLICT',
					row.outcome === 'failed'
						? `Row ${row.index + 1} failed, so there is nothing to match`
						: `Row ${row.index + 1} was left out of the batch`,
					row.outcome === 'failed'
						? `Call donation-correct with donationId ${donation.id} and index ${row.index} to put it right`
						: `Call donation-get with id ${donation.id} to see the rows`,
					{ index: row.index, outcome: row.outcome }
				);
			}
			const match = matchLabel(store, row.label);
			const offers =
				match.kind === 'match' ? [match] : match.kind === 'unclear' ? match.offers : [];
			const [best, ...rest] = offers;
			if (!best) {
				return refuse(
					'NOT_FOUND',
					`Nothing the library keeps matches ${row.label} now`,
					`Call donation-settle with donationId ${donation.id}, index ${row.index} and a varietyId from variety-list`,
					{ index: row.index }
				);
			}
			const variety = store.varietyRef(best.varietyId);
			const alternatives: Alternative<{ variety: { id: string; name: string }; label: string }>[] =
				rest.map((offer) => ({
					data: { variety: store.varietyRef(offer.varietyId), label: row.label },
					reason: offer.reason,
					confidence: offer.confidence,
					label: store.varietyRef(offer.varietyId).name,
				}));
			return success(
				{ variety, label: row.label },
				{
					confidence: best.confidence,
					reasoning: `The label says ${row.label}. ${variety.name}: ${best.reason}`,
					sources: [
						{
							type: 'catalogue',
							id: variety.id,
							title: `${variety.name}, in the library catalogue`,
						},
					],
					...(alternatives.length > 0 && { alternatives }),
				}
			);
		},
	});

	const donationSettle = defineCommand({
		name: 'donation-settle',
		category: 'intake',
		description:
			'Sets the variety of a row to the one a person chose: a row waiting for a person makes its lot, and a row already filed moves to the other variety',
		expose: { mcp: true },
		mutation: true,
		approval: 'not-required',
		input: z.object({ ...rowRef, varietyId: z.string().describe('The variety chosen') }),
		output: donationSettleOutput,
		errors: ['NOT_FOUND', 'CONFLICT'],
		async handler(input, context) {
			const found = findRow(input.donationId, input.index);
			if (!found.ok) return found.refusal;
			const { donation, row } = found;
			const variety = store.variety(input.varietyId);
			if (!variety) {
				return refuse(
					'NOT_FOUND',
					`The library has no variety ${input.varietyId}`,
					'Call variety-list to find the variety',
					{ varietyId: input.varietyId }
				);
			}
			if (variety.retired) {
				return refuse(
					'CONFLICT',
					`${variety.name} is retired, and the library no longer keeps it`,
					'Call variety-list to choose another variety',
					{ varietyId: variety.id }
				);
			}
			if (row.outcome === 'failed' || row.outcome === 'left-out') {
				return refuse(
					'CONFLICT',
					row.outcome === 'failed'
						? `Row ${row.index + 1} failed, so it cannot be filed until it is put right`
						: `Row ${row.index + 1} was left out of the batch`,
					row.outcome === 'failed'
						? `Call donation-correct with donationId ${donation.id} and index ${row.index}`
						: `Call donation-get with id ${donation.id} to see the rows`,
					{ index: row.index, outcome: row.outcome }
				);
			}
			const lot = row.lotId ? store.lot(row.lotId) : undefined;
			if (lot) {
				if (store.hasLentFrom(lot.id)) return lentFrom(row);
				lot.varietyId = variety.id;
				row.varietyId = variety.id;
				row.note = `Moved to ${variety.name}`;
			} else {
				file(store, donation, row, variety.id, nowOf(context));
				row.note = `Filed under ${variety.name}, as the volunteer chose`;
			}
			settleStatus(donation);
			return success(
				{ index: row.index, varietyId: variety.id, lotId: row.lotId as string },
				{ reasoning: `Row ${row.index + 1} is filed under ${variety.name}` }
			);
		},
	});

	const donationCorrect = defineCommand({
		name: 'donation-correct',
		category: 'intake',
		description:
			'Updates a failed row with a new label, packet count or harvest year, and tries it again; or leaves it out of the batch with leaveOut: true',
		expose: { mcp: true },
		mutation: true,
		approval: 'not-required',
		input: z.object({
			...rowRef,
			label: z.string().min(1).optional(),
			packets: z.number().int().min(1).optional(),
			harvestYear: z.number().int().optional(),
			leaveOut: z.boolean().optional().describe('Leave the row out of the batch'),
		}),
		output: donationCorrectOutput,
		errors: ['NOT_FOUND', 'INVALID_INPUT', 'CONFLICT'],
		async handler(input, context) {
			const found = findRow(input.donationId, input.index);
			if (!found.ok) return found.refusal;
			const { donation, row } = found;
			if (row.outcome !== 'failed') {
				const how = {
					succeeded: `To put it right, call donation-settle to file it under another variety, or donation-cancel with id ${donation.id} to take the batch back and enter the box again`,
					unsettled: `Call donation-match with donationId ${donation.id} and index ${row.index}, then donation-settle with the variety chosen`,
					'left-out': `Enter the row again in a new batch with donation-import`,
				}[row.outcome];
				return refuse(
					'CONFLICT',
					row.outcome === 'succeeded'
						? `Row ${row.index + 1} went in already, so it is not corrected here`
						: row.outcome === 'unsettled'
							? `Row ${row.index + 1} waits for a person to choose its variety`
							: `Row ${row.index + 1} was left out of the batch`,
					how,
					{ index: row.index, outcome: row.outcome }
				);
			}
			if (input.leaveOut) {
				row.outcome = 'left-out';
				delete row.error;
				row.note = 'Left out of the batch';
				settleStatus(donation);
				return success(
					{ index: row.index, outcome: row.outcome },
					{ reasoning: `Row ${row.index + 1} is left out of the batch` }
				);
			}
			const changes = [
				input.label !== undefined && `Label corrected to ${input.label}`,
				input.packets !== undefined && `Packets corrected to ${input.packets}`,
				input.harvestYear !== undefined && `Harvest year corrected to ${input.harvestYear}`,
			].filter((change): change is string => typeof change === 'string');
			if (changes.length === 0) {
				return refuse(
					'INVALID_INPUT',
					'The correction changes nothing',
					`Call donation-correct with a label, packets or harvestYear, or with leaveOut: true`,
					{ index: row.index }
				);
			}
			const now = nowOf(context);
			const corrected = {
				index: row.index,
				label: input.label ?? row.label,
				packets: input.packets ?? row.packets,
				harvestYear: input.harvestYear ?? row.harvestYear,
			};
			// A correction that is still wrong is refused, and the row stays as it was.
			const badYear = yearError(corrected, now);
			if (badYear) {
				return refuse(
					'INVALID_INPUT',
					badYear.message,
					`Call donation-correct again with a harvest year of ${new Date(now).getUTCFullYear()} or earlier`,
					{ index: row.index, harvestYear: corrected.harvestYear }
				);
			}
			const match = matchLabel(store, corrected.label);
			if (match.kind === 'none') {
				return refuse(
					'NOT_FOUND',
					labelError(corrected, match.retired).message,
					'Call donation-correct again with a label from variety-list, or with leaveOut: true to leave the row out',
					{ index: row.index, label: corrected.label }
				);
			}
			Object.assign(row, corrected);
			row.note = changes.join('; ');
			takeIn(store, donation, row, now);
			settleStatus(donation);
			// takeIn just changed it, which the narrowing above does not know.
			const outcome = row.outcome as RowOutcome;
			return success(
				{ index: row.index, outcome, ...(row.lotId && { lotId: row.lotId }) },
				{
					reasoning:
						outcome === 'succeeded'
							? `Row ${row.index + 1} went in: ${row.note}`
							: `Row ${row.index + 1} now waits for a person to choose its variety`,
				}
			);
		},
	});

	return [
		donationImport,
		donationGet,
		donationCancel,
		donationMatch,
		donationSettle,
		donationCorrect,
	];
}
