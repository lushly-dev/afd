/**
 * @fileoverview The desk: members, loans, returns and the waiting list.
 */

import type { Warning } from '@lushly-dev/afd-core';
import { defineCommand, success, type ZodCommandDefinition } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { LibraryErrors, matches, nowOf, plural, refuse, unavailable } from '../refusals.js';
import {
	loanCancelOutput,
	loanCreateOutput,
	loanListOutput,
	loanReopenOutput,
	loanReturnOutput,
	loanStatus,
	memberListOutput,
	waitlistJoinOutput,
	waitlistLeaveOutput,
} from '../schemas.js';
import { ageEstimate, iso, type LibraryStore, type Loan } from '../store.js';

const memberNotFound = (id: string) =>
	refuse('NOT_FOUND', `The library has no member ${id}`, 'Call member-list to find the member', {
		memberId: id,
	});

const varietyNotFound = (id: string) =>
	refuse('NOT_FOUND', `The library has no variety ${id}`, 'Call variety-list to find the variety', {
		varietyId: id,
	});

const loanNotFound = (id: string) =>
	refuse(
		'NOT_FOUND',
		`The library has no loan ${id}`,
		"Call loan-list to find the member's loans",
		{
			id,
		}
	);

const memberAndVariety = {
	memberId: z.string().describe('The member id, from member-list'),
	varietyId: z.string().describe('The variety id, from variety-list'),
};

export function loanCommands(store: LibraryStore): ZodCommandDefinition[] {
	const memberList = defineCommand({
		name: 'member-list',
		category: 'desk',
		description: "Search the library's members by name or member number",
		expose: { mcp: true },
		input: z.object({
			query: z.string().optional().describe('Part of the name or the member number, any case'),
		}),
		output: memberListOutput,
		errors: ['SERVICE_UNAVAILABLE'],
		async handler(input) {
			if (!store.available) return unavailable('members', 'member-list');
			const members = [...store.members.values()]
				.filter((member) => matches(input.query, member.name, member.number))
				.map(({ id, name, number }) => ({ id, name, number }));
			return success(
				{ members, total: members.length },
				{
					reasoning:
						members.length === 0
							? `No member matches${input.query ? ` "${input.query}"` : ''}`
							: `Found ${plural(members.length, 'member')}`,
				}
			);
		},
	});

	const loanCreate = defineCommand({
		name: 'loan-create',
		category: 'desk',
		description:
			"Creates a loan of one packet of a variety to a member, from its freshest lot. A loan of a rare variety is held for the steward's agreement and recorded as a request in request-list",
		expose: { mcp: true },
		mutation: true,
		undoable: true,
		// Held, whoever asks, for a rare variety; and for a call that names no actor.
		approval: (input, context) =>
			!context.actor || store.needsSteward(input.memberId, input.varietyId)
				? 'required'
				: 'not-required',
		input: z.object(memberAndVariety),
		output: loanCreateOutput,
		errors: ['NOT_FOUND', LibraryErrors.OUT_OF_STOCK, 'CONFLICT', 'APPROVAL_REQUIRED'],
		async handler(input, context) {
			const member = store.member(input.memberId);
			if (!member) return memberNotFound(input.memberId);
			const variety = store.variety(input.varietyId);
			if (!variety) return varietyNotFound(input.varietyId);
			if (variety.retired) {
				return refuse(
					'CONFLICT',
					`${variety.name} is retired, and the library no longer lends it`,
					'Call variety-list to choose another variety',
					{ varietyId: variety.id, retired: true }
				);
			}
			const lent = store.lend(member.id, variety.id, nowOf(context));
			if (!lent) {
				return refuse(
					LibraryErrors.OUT_OF_STOCK,
					`${variety.name} has no packets left`,
					`Call substitute-suggest with varietyId ${variety.id} for a close substitute, or waitlist-join to put the member on the waiting list`,
					{ varietyId: variety.id, packetsAvailable: 0 }
				);
			}
			const { loan, lot } = lent;
			const { estimate, basis } = lot.germination;
			const warnings: Warning[] =
				estimate < store.rules.oldSeedBelow
					? [
							{
								code: 'OLD_SEED',
								message: `This packet of ${variety.name} is from ${lot.harvestYear}; about ${Math.round(estimate * 100)}% of its seed is expected to germinate, judged by its ${basis === 'tested' ? 'test' : 'age'}`,
								severity: 'caution',
								details: { lotId: lot.id, estimate, basis },
							},
						]
					: [];
			return success(
				{
					id: loan.id,
					status: loan.status,
					lentAt: loan.lentAt,
					lot: { id: lot.id, harvestYear: lot.harvestYear, germination: { ...lot.germination } },
				},
				{
					reasoning: `Lent ${member.name} one packet of ${variety.name}, from the ${lot.harvestYear} lot`,
					...(warnings.length > 0 && { warnings }),
					undoCommand: 'loan-cancel',
					undoArgs: { id: loan.id },
				}
			);
		},
	});

	const loanCancel = defineCommand({
		name: 'loan-cancel',
		category: 'desk',
		description: 'Cancels a loan made by mistake and returns its packet to the shelf',
		expose: { mcp: true },
		mutation: true,
		approval: 'not-required',
		input: z.object({ id: z.string().describe('The loan id') }),
		output: loanCancelOutput,
		errors: ['NOT_FOUND', 'CONFLICT'],
		async handler(input) {
			const loan = store.loan(input.id);
			if (!loan) return loanNotFound(input.id);
			if (loan.status !== 'out') {
				return refuse(
					'CONFLICT',
					loan.status === 'cancelled'
						? `${loan.id} was taken back already`
						: `${loan.id} was returned, so it cannot be taken back`,
					loan.status === 'cancelled'
						? `Call loan-list with memberId ${loan.memberId} to see the member's loans`
						: `Call loan-list with memberId ${loan.memberId} to see the member's loans; loan-reopen takes a return back`,
					{ id: loan.id, status: loan.status }
				);
			}
			store.unlend(loan);
			return success(
				{ id: loan.id, status: loan.status },
				{
					reasoning: `Took back ${loan.id}: the packet of ${store.varietyRef(loan.varietyId).name} is back on the shelf`,
				}
			);
		},
	});

	const loanReturn = defineCommand({
		name: 'loan-return',
		category: 'desk',
		description:
			'Records that a loan came back, and adds the seed the member saved from it as a new lot of the variety',
		expose: { mcp: true },
		mutation: true,
		undoable: true,
		approval: 'not-required',
		input: z.object({
			id: z.string().describe('The loan id'),
			savedSeed: z
				.object({
					packets: z.number().int().min(1).describe('Packets of saved seed brought back'),
					harvestYear: z.number().int().describe('The year the seed was saved'),
				})
				.optional(),
		}),
		output: loanReturnOutput,
		errors: ['NOT_FOUND', 'CONFLICT'],
		async handler(input, context) {
			const loan = store.loan(input.id);
			if (!loan) return loanNotFound(input.id);
			if (loan.status === 'returned') {
				return refuse(
					'CONFLICT',
					`${loan.id} was already returned, on ${loan.returnedAt?.slice(0, 10) ?? 'an earlier day'}`,
					`If the return was wrong, call loan-reopen with id ${loan.id} to take it back, then record it again with loan-return`,
					{ id: loan.id, status: loan.status }
				);
			}
			if (loan.status === 'cancelled') {
				return refuse(
					'CONFLICT',
					`${loan.id} was taken back, so there is nothing to return`,
					`Call loan-list with memberId ${loan.memberId} to find the loan that came back`,
					{ id: loan.id, status: loan.status }
				);
			}
			const now = nowOf(context);
			loan.status = 'returned';
			loan.returnedAt = iso(now);
			let lot: { id: string; packets: number } | undefined;
			if (input.savedSeed) {
				const made = store.addLot({
					id: store.nextId(`${loan.lotId}-r`),
					varietyId: loan.varietyId,
					harvestYear: input.savedSeed.harvestYear,
					packets: input.savedSeed.packets,
					source: 'return',
					germination: ageEstimate(input.savedSeed.harvestYear, now),
					returnOf: loan.id,
				});
				loan.returnLotId = made.id;
				lot = { id: made.id, packets: made.packets };
			}
			return success(
				{ id: loan.id, status: loan.status, returnedAt: loan.returnedAt, ...(lot && { lot }) },
				{
					reasoning: lot
						? `Recorded the return of ${loan.id}; its ${plural(lot.packets, 'packet')} of saved seed are lot ${lot.id}`
						: `Recorded the return of ${loan.id}`,
					undoCommand: 'loan-reopen',
					undoArgs: { id: loan.id },
				}
			);
		},
	});

	const loanReopen = defineCommand({
		name: 'loan-reopen',
		category: 'desk',
		description:
			'Take back a return recorded by mistake: the loan is out again and the lot its saved seed made is removed',
		expose: { mcp: true },
		mutation: true,
		approval: 'not-required',
		input: z.object({ id: z.string().describe('The loan id') }),
		output: loanReopenOutput,
		errors: ['NOT_FOUND', 'CONFLICT'],
		async handler(input) {
			const loan = store.loan(input.id);
			if (!loan) return loanNotFound(input.id);
			if (loan.status !== 'returned') {
				return refuse(
					'CONFLICT',
					loan.status === 'out'
						? `${loan.id} is out, so there is no return to take back`
						: `${loan.id} was taken back, so there is no return to take back`,
					loan.status === 'out'
						? `Call loan-return with id ${loan.id} to record its return`
						: `Call loan-list with memberId ${loan.memberId} to see the member's loans`,
					{ id: loan.id, status: loan.status }
				);
			}
			const lotId = loan.returnLotId;
			if (lotId && store.hasLentFrom(lotId)) {
				return refuse(
					'CONFLICT',
					`Packets of lot ${lotId}, which the return made, have been lent`,
					`Call loan-list with varietyId ${loan.varietyId} to see who has them; the return stays recorded`,
					{ id: loan.id, lotId }
				);
			}
			if (lotId) store.removeLot(lotId);
			loan.status = 'out';
			delete loan.returnedAt;
			delete loan.returnLotId;
			return success(
				{ id: loan.id, status: loan.status, ...(lotId && { lotRemoved: lotId }) },
				{
					reasoning: lotId
						? `${loan.id} is out again, and lot ${lotId} is removed`
						: `${loan.id} is out again`,
				}
			);
		},
	});

	const loanList = defineCommand({
		name: 'loan-list',
		category: 'desk',
		description: 'List loans, by variety, member or status, with who has each and since when',
		expose: { mcp: true },
		input: z.object({
			varietyId: z.string().optional(),
			memberId: z.string().optional(),
			status: loanStatus.optional(),
		}),
		output: loanListOutput,
		errors: ['SERVICE_UNAVAILABLE'],
		async handler(input) {
			if (!store.available) return unavailable('loans', 'loan-list');
			const loans = store.loans
				.filter((loan: Loan) => !input.varietyId || loan.varietyId === input.varietyId)
				.filter((loan) => !input.memberId || loan.memberId === input.memberId)
				.filter((loan) => !input.status || loan.status === input.status)
				.map((loan) => ({
					id: loan.id,
					member: store.memberRef(loan.memberId),
					variety: store.varietyRef(loan.varietyId),
					lentAt: loan.lentAt,
					status: loan.status,
				}));
			return success(
				{ loans, total: loans.length },
				{
					reasoning:
						loans.length === 0 ? 'No loan matches' : `Found ${plural(loans.length, 'loan')}`,
				}
			);
		},
	});

	const waitlistJoin = defineCommand({
		name: 'waitlist-join',
		category: 'desk',
		description:
			'Put a member on the waiting list for a variety that has run out, and say their place on it',
		expose: { mcp: true },
		mutation: true,
		undoable: true,
		approval: 'not-required',
		input: z.object(memberAndVariety),
		output: waitlistJoinOutput,
		errors: ['NOT_FOUND', 'ALREADY_EXISTS', 'CONFLICT'],
		async handler(input) {
			const member = store.member(input.memberId);
			if (!member) return memberNotFound(input.memberId);
			const variety = store.variety(input.varietyId);
			if (!variety) return varietyNotFound(input.varietyId);
			const waiting = store.waitingFor(variety.id);
			const place = waiting.findIndex((entry) => entry.memberId === member.id);
			if (place >= 0) {
				return refuse(
					'ALREADY_EXISTS',
					`${member.name} is already waiting for ${variety.name}, at position ${place + 1}`,
					`To take them off the list, call waitlist-leave with memberId ${member.id} and varietyId ${variety.id}`,
					{ memberId: member.id, varietyId: variety.id, position: place + 1 }
				);
			}
			if (variety.retired) {
				return refuse(
					'CONFLICT',
					`${variety.name} is retired, so nobody waits for it`,
					'Call variety-list to choose another variety',
					{ varietyId: variety.id, retired: true }
				);
			}
			const packets = store.packetsAvailable(variety.id);
			if (packets > 0) {
				return refuse(
					'CONFLICT',
					`${variety.name} has ${plural(packets, 'packet')} on the shelf; the waiting list is for seed that has run out`,
					`Lend a packet with loan-create, memberId ${member.id} and varietyId ${variety.id}`,
					{ varietyId: variety.id, packetsAvailable: packets }
				);
			}
			store.waiting.push({ memberId: member.id, varietyId: variety.id });
			const position = waiting.length + 1;
			return success(
				{ position },
				{
					reasoning: `${member.name} is number ${position} on the waiting list for ${variety.name}`,
					undoCommand: 'waitlist-leave',
					undoArgs: { memberId: member.id, varietyId: variety.id },
				}
			);
		},
	});

	const waitlistLeave = defineCommand({
		name: 'waitlist-leave',
		category: 'desk',
		description: 'Take a member off the waiting list for a variety',
		expose: { mcp: true },
		mutation: true,
		approval: 'not-required',
		input: z.object(memberAndVariety),
		output: waitlistLeaveOutput,
		errors: ['NOT_FOUND'],
		async handler(input) {
			const index = store.waiting.findIndex(
				(entry) => entry.memberId === input.memberId && entry.varietyId === input.varietyId
			);
			if (index < 0) {
				return refuse(
					'NOT_FOUND',
					`${store.memberRef(input.memberId).name} is not waiting for ${store.varietyRef(input.varietyId).name}`,
					`Call variety-get with id ${input.varietyId} to see who is waiting`,
					{ memberId: input.memberId, varietyId: input.varietyId }
				);
			}
			store.waiting.splice(index, 1);
			return success(
				{ left: true },
				{
					reasoning: `${store.memberRef(input.memberId).name} is off the waiting list for ${store.varietyRef(input.varietyId).name}`,
				}
			);
		},
	});

	return [
		memberList,
		loanCreate,
		loanCancel,
		loanReturn,
		loanReopen,
		loanList,
		waitlistJoin,
		waitlistLeave,
	];
}
