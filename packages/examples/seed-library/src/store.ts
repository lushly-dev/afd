/**
 * @fileoverview The library's records, in memory: what the commands read and change.
 *
 * Ids are deterministic: a counter per prefix, started past the highest id the fixture holds
 * (`loan-1` in the fixture, so the next loan is `loan-2`). Timestamps come from the caller's
 * clock, so a run against a fixture gives the same results every time.
 */

import type {
	EvidenceRecord,
	Germination,
	LabelMatchRecord,
	LibraryFixture,
	LoanRecord,
	LotRecord,
	MemberRecord,
	RequestRecord,
	SubstituteRecord,
	VarietyRecord,
	WaitingRecord,
} from './fixture.js';

/** A lot, with what made it when the application did. */
export interface Lot extends LotRecord {
	/** The donation and row that made it. */
	donationId?: string;
	rowIndex?: number;
	/** The return whose saved seed made it. */
	returnOf?: string;
}

export interface Loan extends LoanRecord {
	/** The lot the return's saved seed made, while it exists. */
	returnLotId?: string;
}

export interface Request extends RequestRecord {
	withdrawnAt?: string;
}

export type RowOutcome = 'succeeded' | 'unsettled' | 'failed' | 'left-out';

export interface RowError {
	code: string;
	message: string;
	suggestion: string;
}

export interface DonationRow {
	index: number;
	label: string;
	packets: number;
	harvestYear: number;
	outcome: RowOutcome;
	varietyId?: string;
	lotId?: string;
	error?: RowError;
	/** What a person did to the row, for the batch's plan. */
	note?: string;
}

export type DonationStatus = 'in-progress' | 'complete' | 'needs-attention' | 'cancelled';

export interface Donation {
	id: string;
	donor?: string;
	status: DonationStatus;
	rows: DonationRow[];
}

export interface Rules {
	approvalLastsHours: number;
	oldSeedBelow: number;
	matchAppliesFrom: number;
}

const DEFAULT_RULES: Rules = { approvalLastsHours: 24, oldSeedBelow: 0.5, matchAppliesFrom: 0.9 };

/** An ISO 8601 timestamp without milliseconds when they are zero, as the fixtures write them. */
export function iso(ms: number): string {
	return new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
}

/** The estimate for a lot nobody has tested: 0.9 in its first year, 0.05 less a year after. */
export function ageEstimate(harvestYear: number, now: number): Germination {
	const age = Math.max(0, new Date(now).getUTCFullYear() - harvestYear);
	const estimate = Math.max(0.05, 0.9 - 0.05 * age);
	return { estimate: Math.round(estimate * 100) / 100, basis: 'age' };
}

export class LibraryStore {
	rules: Rules = { ...DEFAULT_RULES };
	members = new Map<string, MemberRecord>();
	varieties = new Map<string, VarietyRecord>();
	lots: Lot[] = [];
	loans: Loan[] = [];
	waiting: WaitingRecord[] = [];
	requests: Request[] = [];
	donations: Donation[] = [];
	substitutes: SubstituteRecord[] = [];
	labelMatches: LabelMatchRecord[] = [];
	evidence: EvidenceRecord[] = [];

	/**
	 * Whether the records can be read. A list refuses with `SERVICE_UNAVAILABLE` while it is
	 * false, which is how a test shows the half of jobs 6 and 17 a fixture cannot.
	 */
	available = true;

	private counters = new Map<string, number>();

	/** Replace every record with the fixture's. */
	load(fixture: LibraryFixture): void {
		this.rules = { ...DEFAULT_RULES, ...fixture.rules };
		this.members = new Map(fixture.members.map((member) => [member.id, { ...member }]));
		this.varieties = new Map(fixture.varieties.map((variety) => [variety.id, { ...variety }]));
		this.lots = fixture.lots.map((lot) => ({ ...lot, germination: { ...lot.germination } }));
		this.loans = fixture.loans.map((loan) => ({ ...loan }));
		this.waiting = fixture.waiting.map((entry) => ({ ...entry }));
		this.requests = fixture.requests.map((request) => ({ ...request }));
		this.donations = [];
		this.substitutes = fixture.substitutes.map((entry) => ({ ...entry }));
		this.labelMatches = fixture.labelMatches.map((entry) => ({
			...entry,
			offers: entry.offers.map((offer) => ({ ...offer })),
		}));
		this.evidence = fixture.evidence.map((entry) => ({ ...entry }));
		this.available = true;
		this.counters = new Map();
		for (const { id } of [...this.lots, ...this.loans, ...this.requests]) this.count(id);
	}

	/** The next id with this prefix: `nextId('loan-')` is `loan-2` after `loan-1`. */
	nextId(prefix: string): string {
		const next = (this.counters.get(prefix) ?? 0) + 1;
		this.counters.set(prefix, next);
		return `${prefix}${next}`;
	}

	private count(id: string): void {
		const match = /^(.*?)(\d+)$/.exec(id);
		if (!match) return;
		const [, prefix = '', digits = '0'] = match;
		this.counters.set(prefix, Math.max(this.counters.get(prefix) ?? 0, Number(digits)));
	}

	member(id: string): MemberRecord | undefined {
		return this.members.get(id);
	}

	variety(id: string): VarietyRecord | undefined {
		return this.varieties.get(id);
	}

	lot(id: string): Lot | undefined {
		return this.lots.find((lot) => lot.id === id);
	}

	loan(id: string): Loan | undefined {
		return this.loans.find((loan) => loan.id === id);
	}

	request(id: string): Request | undefined {
		return this.requests.find((request) => request.id === id);
	}

	donation(id: string): Donation | undefined {
		return this.donations.find((donation) => donation.id === id);
	}

	memberRef(id: string): { id: string; name: string; number: string } {
		const member = this.members.get(id);
		return { id, name: member?.name ?? id, number: member?.number ?? '' };
	}

	varietyRef(id: string): { id: string; name: string } {
		return { id, name: this.varieties.get(id)?.name ?? id };
	}

	lotsOf(varietyId: string): Lot[] {
		return this.lots.filter((lot) => lot.varietyId === varietyId);
	}

	packetsAvailable(varietyId: string): number {
		return this.lotsOf(varietyId).reduce((sum, lot) => sum + lot.packets, 0);
	}

	/** The lot a loan comes from: the newest harvest with a packet, the better estimate first. */
	freshestLot(varietyId: string): Lot | undefined {
		return this.lotsOf(varietyId)
			.filter((lot) => lot.packets > 0)
			.sort(
				(a, b) => b.harvestYear - a.harvestYear || b.germination.estimate - a.germination.estimate
			)[0];
	}

	/** Whether a packet of the lot went out on a loan that was not taken back. */
	hasLentFrom(lotId: string): boolean {
		return this.loans.some((loan) => loan.lotId === lotId && loan.status !== 'cancelled');
	}

	/** Lend one packet of the variety from its freshest lot. */
	lend(memberId: string, varietyId: string, now: number): { loan: Loan; lot: Lot } | undefined {
		const lot = this.freshestLot(varietyId);
		if (!lot) return undefined;
		lot.packets -= 1;
		const loan: Loan = {
			id: this.nextId('loan-'),
			memberId,
			varietyId,
			lotId: lot.id,
			lentAt: iso(now),
			status: 'out',
		};
		this.loans.push(loan);
		return { loan, lot };
	}

	/** Put a loan's packet back on its lot, where the lot still exists. */
	unlend(loan: Loan): void {
		const lot = this.lot(loan.lotId);
		if (lot) lot.packets += 1;
		loan.status = 'cancelled';
	}

	addLot(lot: Lot): Lot {
		this.lots.push(lot);
		return lot;
	}

	removeLot(id: string): void {
		this.lots = this.lots.filter((lot) => lot.id !== id);
	}

	/** Mark every waiting request whose hold has run out as expired. */
	expireRequests(now: number): void {
		for (const request of this.requests) {
			if (request.status === 'pending' && Date.parse(request.expiresAt) <= now) {
				request.status = 'expired';
			}
		}
	}

	/** When a closed request closed: its decision, its withdrawal, or the end of its hold. */
	closedAt(request: Request): number | undefined {
		switch (request.status) {
			case 'approved':
			case 'declined':
				return request.decidedAt ? Date.parse(request.decidedAt) : undefined;
			case 'withdrawn':
				return request.withdrawnAt ? Date.parse(request.withdrawnAt) : undefined;
			case 'expired':
				return Date.parse(request.expiresAt);
			default:
				return undefined;
		}
	}

	/** The members waiting for a variety, in the order they joined. */
	waitingFor(varietyId: string): WaitingRecord[] {
		return this.waiting.filter((entry) => entry.varietyId === varietyId);
	}

	/** Whether a loan of this variety to this member is held for the steward. */
	needsSteward(memberId: string, varietyId: string): boolean {
		const variety = this.varieties.get(varietyId);
		return this.members.has(memberId) && variety?.rare === true && !variety.retired;
	}

	/** "Lend one packet of Glass Gem corn to Ines Marlow" */
	requestSummary(memberId: string, varietyId: string): string {
		return `Lend one packet of ${this.varietyRef(varietyId).name} to ${this.memberRef(memberId).name}`;
	}

	/**
	 * Record the request for a held loan, or find the one already waiting for this member and
	 * variety. The request waits as long as the latest hold, so the expiry a refusal shows is
	 * the request's.
	 */
	recordRequest(memberId: string, varietyId: string, expiresAt: string, now: number): Request {
		this.expireRequests(now);
		const waiting = this.requests.find(
			(request) =>
				request.status === 'pending' &&
				request.memberId === memberId &&
				request.varietyId === varietyId
		);
		if (waiting) {
			waiting.expiresAt = expiresAt;
			return waiting;
		}
		const request: Request = {
			id: this.nextId('req-'),
			memberId,
			varietyId,
			askedAt: iso(now),
			expiresAt,
			status: 'pending',
			summary: this.requestSummary(memberId, varietyId),
		};
		this.requests.push(request);
		return request;
	}
}
