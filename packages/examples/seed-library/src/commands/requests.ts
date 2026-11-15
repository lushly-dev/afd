/**
 * @fileoverview The steward's requests: the loans of rare seed that were held for the
 * steward's agreement.
 *
 * A request is written by the approval middleware's hook when `loan-create` is held (see
 * `app.ts`). `request-decide` makes the loan itself: the held call is never retried.
 */

import type { PlanStep, Warning } from '@lushly-dev/afd-core';
import { defineCommand, success, type ZodCommandDefinition } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { LibraryErrors, nowOf, plural, refuse, unavailable } from '../refusals.js';
import {
	requestClearOutput,
	requestDecideOutput,
	requestListOutput,
	requestReopenOutput,
	requestStatus,
	requestWithdrawOutput,
} from '../schemas.js';
import { iso, type LibraryStore, type Request } from '../store.js';

/** The question a screen asks before it calls `request-clear` (bench task T4). */
export const REQUEST_CLEAR_PROMPT =
	"Remove every closed request from before this date? They hold members' names against what they asked for, and they cannot be brought back. Requests still waiting are not touched.";

const requestNotFound = (id: string) =>
	refuse('NOT_FOUND', `The library has no request ${id}`, 'Call request-list to see the requests', {
		id,
	});

const askAgain = (request: Request) =>
	`The member has to ask again: call loan-create with memberId ${request.memberId} and varietyId ${request.varietyId}`;

export function requestCommands(store: LibraryStore): ZodCommandDefinition[] {
	const requestList = defineCommand({
		name: 'request-list',
		category: 'requests',
		description:
			"List the requests for rare seed, oldest first: who asked for what, until when the request waits, and how many packets there are to give. Filter by status ('closed' is every status but pending) or member",
		expose: { mcp: true },
		input: z.object({
			status: z
				.union([requestStatus, z.literal('closed')])
				.optional()
				.describe("A request's status, or 'closed' for every status but pending"),
			memberId: z.string().optional(),
		}),
		output: requestListOutput,
		errors: ['SERVICE_UNAVAILABLE'],
		async handler(input, context) {
			if (!store.available) return unavailable('requests', 'request-list');
			store.expireRequests(nowOf(context));
			const requests = store.requests
				.filter((request) =>
					input.status === undefined
						? true
						: input.status === 'closed'
							? request.status !== 'pending'
							: request.status === input.status
				)
				.filter((request) => !input.memberId || request.memberId === input.memberId)
				.map((request) => ({
					id: request.id,
					member: store.memberRef(request.memberId),
					variety: store.varietyRef(request.varietyId),
					summary: request.summary,
					askedAt: request.askedAt,
					expiresAt: request.expiresAt,
					status: request.status,
					packetsAvailable: store.packetsAvailable(request.varietyId),
				}));
			return success(
				{ requests, total: requests.length },
				{
					reasoning:
						requests.length === 0
							? `No request is ${input.status === undefined ? 'on record' : input.status}`
							: `Found ${plural(requests.length, 'request')}`,
				}
			);
		},
	});

	const requestWithdraw = defineCommand({
		name: 'request-withdraw',
		category: 'requests',
		description:
			'Withdraws a waiting request, for a member who no longer wants the seed, and stops it waiting for the steward. Undone by asking again with loan-create',
		expose: { mcp: true },
		mutation: true,
		approval: 'not-required',
		input: z.object({ id: z.string().describe('The request id') }),
		output: requestWithdrawOutput,
		errors: ['NOT_FOUND', 'CONFLICT'],
		async handler(input, context) {
			const now = nowOf(context);
			store.expireRequests(now);
			const request = store.request(input.id);
			if (!request) return requestNotFound(input.id);
			if (request.status !== 'pending') {
				return refuse(
					'CONFLICT',
					`${request.id} is ${request.status}, not waiting`,
					`Call request-list with memberId ${request.memberId} to see the member's requests`,
					{ id: request.id, status: request.status }
				);
			}
			request.status = 'withdrawn';
			request.withdrawnAt = iso(now);
			return success(
				{ id: request.id, status: request.status },
				{ reasoning: `Withdrew ${request.id}: ${request.summary}` }
			);
		},
	});

	const requestDecide = defineCommand({
		name: 'request-decide',
		category: 'requests',
		description:
			"Approve or decline a waiting request. Approving checks the shelf, makes the loan and tells the member. Only a person with the steward's role may call it",
		expose: { mcp: true },
		mutation: true,
		undoable: true,
		approval: 'not-required',
		input: z.object({
			id: z.string().describe('The request id'),
			decision: z.enum(['approve', 'decline']),
			reason: z.string().max(500).optional().describe('Why, for the member to see'),
		}),
		output: requestDecideOutput,
		errors: [
			'NOT_FOUND',
			'CONFLICT',
			LibraryErrors.OUT_OF_STOCK,
			LibraryErrors.REQUEST_EXPIRED,
			'FORBIDDEN',
		],
		async handler(input, context) {
			const now = nowOf(context);
			store.expireRequests(now);
			const request = store.request(input.id);
			if (!request) return requestNotFound(input.id);
			if (request.status === 'expired') {
				return refuse(
					LibraryErrors.REQUEST_EXPIRED,
					`${request.id} expired at ${request.expiresAt}, before it was decided`,
					askAgain(request),
					{ id: request.id, expiresAt: request.expiresAt }
				);
			}
			if (request.status === 'withdrawn') {
				return refuse('CONFLICT', `${request.id} was withdrawn at the desk`, askAgain(request), {
					id: request.id,
					status: request.status,
				});
			}
			if (request.status !== 'pending') {
				return refuse(
					'CONFLICT',
					`${request.id} was already ${request.status}`,
					`To take the decision back, call request-reopen with id ${request.id}, then decide it again`,
					{ id: request.id, status: request.status }
				);
			}
			const member = store.memberRef(request.memberId);
			const variety = store.variety(request.varietyId);
			const memberTold = store.member(request.memberId)?.canBeTold ?? false;
			let loanId: string | undefined;
			if (input.decision === 'approve') {
				if (!variety || variety.retired) {
					return refuse(
						'CONFLICT',
						`${store.varietyRef(request.varietyId).name} is retired, and the library no longer lends it`,
						`Call request-decide with id ${request.id} and decision decline`,
						{ id: request.id, varietyId: request.varietyId }
					);
				}
				const lent = store.lend(request.memberId, request.varietyId, now);
				if (!lent) {
					return refuse(
						LibraryErrors.OUT_OF_STOCK,
						`No packets of ${variety.name} are left`,
						`Call waitlist-join with memberId ${request.memberId} and varietyId ${request.varietyId}, then request-decide with decision decline`,
						{ varietyId: request.varietyId, packetsAvailable: 0 }
					);
				}
				loanId = lent.loan.id;
			}
			request.status = input.decision === 'approve' ? 'approved' : 'declined';
			request.decidedAt = iso(now);
			if (loanId) request.loanId = loanId;
			if (input.reason) request.reason = input.reason;

			const approving = input.decision === 'approve';
			const plan: PlanStep[] = [
				{
					id: 'check-shelf',
					action: 'Check the shelf',
					status: approving ? 'complete' : 'skipped',
				},
				{
					id: 'make-loan',
					action: 'Make the loan',
					status: approving ? 'complete' : 'skipped',
					...(approving && { dependsOn: ['check-shelf'] }),
				},
				{
					id: 'tell-member',
					action: 'Tell the member',
					status: memberTold ? 'complete' : 'failed',
					...(approving && { dependsOn: ['make-loan'] }),
					...(!memberTold && {
						error: {
							code: 'MEMBER_NOT_TOLD',
							message: `The library has no way to reach ${member.name}`,
						},
					}),
				},
			];
			const warnings: Warning[] = memberTold
				? []
				: [
						{
							code: 'MEMBER_NOT_TOLD',
							message: `${approving ? 'The loan is made' : 'The request is declined'}, but ${member.name} could not be told: the library has no way to reach them`,
							severity: 'warning',
							details: { memberId: request.memberId },
						},
					];
			return success(
				{
					id: request.id,
					status: request.status,
					decidedAt: request.decidedAt,
					...(loanId && { loanId }),
					memberTold,
				},
				{
					reasoning: approving
						? `Approved ${request.id}: lent ${member.name} one packet of ${store.varietyRef(request.varietyId).name} (${loanId})`
						: `Declined ${request.id}${input.reason ? `: ${input.reason}` : ''}`,
					plan,
					...(warnings.length > 0 && { warnings }),
					undoCommand: 'request-reopen',
					undoArgs: { id: request.id },
				}
			);
		},
	});

	const requestReopen = defineCommand({
		name: 'request-reopen',
		category: 'requests',
		description:
			"Takes a decision back and sets the request waiting again for a fresh day; the loan an approval made is cancelled. Only a person with the steward's role may call it",
		expose: { mcp: true },
		mutation: true,
		approval: 'not-required',
		input: z.object({ id: z.string().describe('The request id') }),
		output: requestReopenOutput,
		errors: ['NOT_FOUND', 'CONFLICT', 'FORBIDDEN'],
		async handler(input, context) {
			const now = nowOf(context);
			store.expireRequests(now);
			const request = store.request(input.id);
			if (!request) return requestNotFound(input.id);
			if (request.status === 'pending') {
				return refuse(
					'CONFLICT',
					`${request.id} is waiting, so there is no decision to take back`,
					`Call request-decide with id ${request.id} to decide it`,
					{ id: request.id, status: request.status }
				);
			}
			if (request.status === 'expired' || request.status === 'withdrawn') {
				return refuse(
					'CONFLICT',
					`${request.id} ${request.status === 'expired' ? 'expired' : 'was withdrawn'}; only a decision can be taken back`,
					askAgain(request),
					{ id: request.id, status: request.status }
				);
			}
			// One request waits for a member and a variety, however it came to wait.
			const waiting = store.requests.find(
				(other) =>
					other.status === 'pending' &&
					other.memberId === request.memberId &&
					other.varietyId === request.varietyId
			);
			if (waiting) {
				return refuse(
					'CONFLICT',
					`${waiting.id} already waits for the same member and variety`,
					`Decide ${waiting.id} with request-decide, or take it back with request-withdraw, then reopen ${request.id}`,
					{ id: request.id, waiting: waiting.id }
				);
			}
			const loan = request.loanId ? store.loan(request.loanId) : undefined;
			if (loan?.status === 'returned') {
				return refuse(
					'CONFLICT',
					`The loan ${loan.id} that ${request.id} made was returned`,
					`Call loan-reopen with id ${loan.id} to take the return back first`,
					{ id: request.id, loanId: loan.id }
				);
			}
			let loanCancelled: string | undefined;
			if (loan?.status === 'out') {
				store.unlend(loan);
				loanCancelled = loan.id;
			}
			request.status = 'pending';
			request.expiresAt = iso(now + store.rules.approvalLastsHours * 3_600_000);
			delete request.decidedAt;
			delete request.reason;
			delete request.loanId;
			return success(
				{
					id: request.id,
					status: request.status,
					expiresAt: request.expiresAt,
					...(loanCancelled && { loanCancelled }),
				},
				{
					reasoning: `${request.id} waits again, until ${request.expiresAt}${loanCancelled ? `; ${loanCancelled} is cancelled and its packet is back on the shelf` : ''}`,
				}
			);
		},
	});

	const requestClear = defineCommand({
		name: 'request-clear',
		category: 'requests',
		description:
			"Remove every closed request (decided, expired or withdrawn) that closed before a date. They hold members' names against what they asked for. Cannot be undone. Only a person with the steward's role may call it",
		expose: { mcp: true },
		mutation: true,
		destructive: true,
		confirmPrompt: REQUEST_CLEAR_PROMPT,
		approval: 'not-required',
		input: z.object({
			closedBefore: z
				.union([z.iso.date(), z.iso.datetime()])
				.describe('A date (2030-03-05) or a time: requests that closed before it are removed'),
		}),
		output: requestClearOutput,
		errors: ['CONFIRMATION_REQUIRED', 'FORBIDDEN'],
		async handler(input, context) {
			store.expireRequests(nowOf(context));
			const cutoff = Date.parse(input.closedBefore);
			const before = store.requests.length;
			store.requests = store.requests.filter((request) => {
				const closedAt = store.closedAt(request);
				return closedAt === undefined || closedAt >= cutoff;
			});
			const removed = before - store.requests.length;
			return success(
				{ removed },
				{
					reasoning: `Removed ${plural(removed, 'closed request')} from before ${input.closedBefore}`,
				}
			);
		},
	});

	return [requestList, requestWithdraw, requestDecide, requestReopen, requestClear];
}
