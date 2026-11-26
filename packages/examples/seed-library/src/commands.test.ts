/**
 * What the scenarios cannot show: the trust metadata, who may decide, the held loan's
 * request, a list that cannot be read, the undo offers, and several decisions in one batch.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDirectClient } from '@lushly-dev/afd-client';
import type { Actor, CommandResult } from '@lushly-dev/afd-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSeedLibrary, HOLD_MS, type SeedLibrary } from './app.js';
import { REQUEST_CLEAR_PROMPT } from './commands/requests.js';
import { VARIETY_RETIRE_PROMPT } from './commands/varieties.js';
import type { LibraryFixtureInput } from './fixture.js';

const FIXTURES = new URL('../scenarios/fixtures/', import.meta.url);
const TASKS = new URL(
	'../../../../docs/features/complete/agent-first-design/bench/tasks/',
	import.meta.url
);
const read = (url: URL) => readFileSync(fileURLToPath(url), 'utf8');
const libraryFixture = JSON.parse(read(new URL('library.json', FIXTURES))) as LibraryFixtureInput;
const stewardFixture = {
	...libraryFixture,
	...(JSON.parse(read(new URL('steward.json', FIXTURES))) as Partial<LibraryFixtureInput>),
} as LibraryFixtureInput;

const STEWARD: Actor = { kind: 'human', id: 'steward', label: 'The steward' };
const VOLUNTEER: Actor = { kind: 'human', id: 'vol-ana', label: 'Ana, at the desk' };
const AGENT_FOR_STEWARD: Actor = { kind: 'agent', id: 'assistant', onBehalfOf: 'steward' };

const DRAFTED = [
	'variety-list',
	'variety-get',
	'variety-retire',
	'lot-list',
	'substitute-suggest',
	'member-list',
	'loan-create',
	'loan-cancel',
	'loan-return',
	'loan-reopen',
	'loan-list',
	'waitlist-join',
	'waitlist-leave',
	'request-list',
	'request-withdraw',
	'request-decide',
	'request-reopen',
	'request-clear',
	'donation-import',
	'donation-get',
	'donation-cancel',
	'donation-match',
	'donation-settle',
	'donation-correct',
];
const QUERIES = [
	'variety-list',
	'variety-get',
	'lot-list',
	'substitute-suggest',
	'member-list',
	'loan-list',
	'request-list',
	'donation-get',
	'donation-match',
];
const UNDOABLE = [
	'loan-create',
	'loan-return',
	'waitlist-join',
	'request-decide',
	'donation-import',
];

let library: SeedLibrary;
let call: <T = unknown>(
	command: string,
	input: Record<string, unknown>,
	actor?: Actor
) => Promise<CommandResult<T>>;

function start(fixture: LibraryFixtureInput) {
	library = createSeedLibrary({ fixture });
	const registry = library.createRegistry();
	call = (command, input, actor = STEWARD) =>
		registry.execute(command, input, { actor, clock: library.clock });
}

describe('the drafted commands and their trust metadata', () => {
	const { commands } = createSeedLibrary();
	const named = (name: string) => commands.find((command) => command.name === name);

	it('defines the 24 drafted commands, each with an output schema and its refusals', () => {
		expect(commands.map((command) => command.name)).toEqual(DRAFTED);
		for (const command of commands) {
			expect(command.outputSchema, command.name).toBeDefined();
			expect(command.errors?.length, command.name).toBeGreaterThan(0);
			expect(command.expose?.mcp, command.name).toBe(true);
		}
	});

	it('marks every command but a query as a mutation, each with an approval policy', () => {
		for (const command of commands) {
			expect(command.mutation ?? false, command.name).toBe(!QUERIES.includes(command.name));
			// afd validate's MISSING_APPROVAL_POLICY: a mutation must declare its policy.
			if (command.mutation) expect(command.approval, command.name).toBeDefined();
		}
		expect(typeof named('loan-create')?.approval).toBe('function');
	});

	it('marks the two that cannot be undone destructive, with the prompts the tasks give', () => {
		expect(
			commands.filter((command) => command.destructive).map((command) => command.name)
		).toEqual(['variety-retire', 'request-clear']);
		expect(named('variety-retire')?.confirmPrompt).toBe(VARIETY_RETIRE_PROMPT);
		expect(named('request-clear')?.confirmPrompt).toBe(REQUEST_CLEAR_PROMPT);
		// Each task quotes its prompt once, as a block quote.
		const quoted = (file: string) =>
			read(new URL(file, TASKS))
				.split('\n')
				.filter((line) => line.startsWith('> '))
				.map((line) => line.slice(2).trim())
				.join(' ');
		expect(quoted('t3-a-variety.md')).toBe(VARIETY_RETIRE_PROMPT);
		expect(quoted('t4-the-stewards-requests.md')).toBe(REQUEST_CLEAR_PROMPT);
	});

	it('declares undoable exactly the commands that return an undo', () => {
		expect(commands.filter((command) => command.undoable).map((command) => command.name)).toEqual(
			UNDOABLE
		);
	});
});

describe('only a person with the steward role decides', () => {
	beforeEach(() => start(stewardFixture));

	it.each([
		['a volunteer', VOLUNTEER],
		['an agent acting for the steward', AGENT_FOR_STEWARD],
		['a call with no actor', undefined],
		["the scenario runner's test actor", { kind: 'test' } as Actor],
	])('refuses %s, and names the next command', async (_who, actor) => {
		const registry = library.createRegistry();
		const steps: Array<[string, Record<string, unknown>]> = [
			['request-decide', { id: 'req-1', decision: 'approve' }],
			['request-reopen', { id: 'req-5' }],
			['request-clear', { closedBefore: '2030-03-05' }],
			['variety-retire', { id: 'var-nigella' }],
		];
		for (const [command, input] of steps) {
			const result = await registry.execute(command, input, {
				...(actor && { actor }),
				clock: library.clock,
			});
			expect(result.error?.code, command).toBe('FORBIDDEN');
			expect(result.error?.suggestion, command).toMatch(/request-list|variety-get/);
		}
		expect(library.store.request('req-1')?.status).toBe('pending');
		expect(library.store.variety('var-nigella')?.retired).toBeFalsy();
	});

	it('reopens a decision only while no other request waits for the same member and variety', async () => {
		expect((await call('request-decide', { id: 'req-1', decision: 'decline' })).success).toBe(true);
		await call('loan-create', { memberId: 'mem-ines', varietyId: 'var-glassgem' }, VOLUNTEER);
		const asked = library.store.requests.find(
			(request) => request.status === 'pending' && request.memberId === 'mem-ines'
		);
		expect(asked?.id).toBe('req-6');
		const reopened = await call('request-reopen', { id: 'req-1' });
		expect(reopened.error?.code).toBe('CONFLICT');
		expect(reopened.error?.suggestion).toContain('request-withdraw');
		expect(library.store.request('req-1')?.status).toBe('declined');
		await call('request-withdraw', { id: 'req-6' }, VOLUNTEER);
		expect((await call('request-reopen', { id: 'req-1' })).success).toBe(true);
	});

	it('lets the steward decide, and lets a volunteer withdraw a request', async () => {
		expect((await call('request-decide', { id: 'req-1', decision: 'approve' })).success).toBe(true);
		const withdrawn = await call('request-withdraw', { id: 'req-2' }, VOLUNTEER);
		expect(withdrawn).toMatchObject({ success: true, data: { status: 'withdrawn' } });
	});
});

describe('a loan of rare seed is held and recorded as a request', () => {
	beforeEach(() => start(libraryFixture));

	it('holds it whoever asks, says where it waits, and keeps the token back', async () => {
		for (const actor of [VOLUNTEER, STEWARD, AGENT_FOR_STEWARD]) {
			const held = await call(
				'loan-create',
				{ memberId: 'mem-ines', varietyId: 'var-glassgem' },
				actor
			);
			expect(held.error?.code).toBe('APPROVAL_REQUIRED');
			expect(held.error?.details).toEqual({
				expiresAt: '2030-03-10T10:00:00.000Z',
				summary:
					'Lend one packet of Glass Gem corn to Ines Marlow. It waits for the steward, in request-list',
			});
			expect(held.error?.suggestion).toContain('request-list');
		}
		expect(library.store.packetsAvailable('var-glassgem')).toBe(2);
	});

	it('records one request for a member and a variety, waiting as long as the hold', async () => {
		await call('loan-create', { memberId: 'mem-ines', varietyId: 'var-glassgem' }, VOLUNTEER);
		library.clock.advance(60 * 60 * 1000);
		await call('loan-create', { memberId: 'mem-ines', varietyId: 'var-glassgem' }, VOLUNTEER);
		await call('loan-create', { memberId: 'mem-tobias', varietyId: 'var-glassgem' }, VOLUNTEER);
		const listed = await call<{ requests: Array<Record<string, unknown>> }>('request-list', {
			status: 'pending',
		});
		expect(listed.data?.requests).toMatchObject([
			{
				id: 'req-1',
				member: { id: 'mem-ines' },
				summary: 'Lend one packet of Glass Gem corn to Ines Marlow',
				askedAt: '2030-03-09T10:00:00Z',
				expiresAt: new Date(Date.parse('2030-03-09T11:00:00Z') + HOLD_MS)
					.toISOString()
					.replace('.000Z', 'Z'),
			},
			{ id: 'req-2', member: { id: 'mem-tobias' } },
		]);
	});

	it('lets the request expire with its hold', async () => {
		await call('loan-create', { memberId: 'mem-ines', varietyId: 'var-glassgem' }, VOLUNTEER);
		library.clock.advance(HOLD_MS);
		const decided = await call('request-decide', { id: 'req-1', decision: 'approve' });
		expect(decided.error?.code).toBe('REQUEST_EXPIRED');
		expect(decided.error?.suggestion).toContain('loan-create');
	});

	it('lends rare seed only through request-decide, even when a DirectClient approves the hold', async () => {
		const asked: string[] = [];
		const desk = createDirectClient(library.createRegistry(), {
			actor: VOLUNTEER,
			clock: library.clock,
			onApprovalNeeded: (request) => {
				asked.push(request.summary);
				return true;
			},
		});
		const result = await desk.call('loan-create', {
			memberId: 'mem-ines',
			varietyId: 'var-glassgem',
		});
		expect(asked).toHaveLength(1);
		expect(result.error?.code).toBe('FORBIDDEN');
		expect(result.error?.suggestion).toContain('request-list');
		expect(result.error?.suggestion).toContain('request-decide');
		expect(library.store.packetsAvailable('var-glassgem')).toBe(2);
		expect(library.store.loans.filter((loan) => loan.varietyId === 'var-glassgem')).toEqual([]);
		expect(library.store.requests.map((request) => request.status)).toEqual(['pending']);
		// The steward's approval is then the one loan.
		expect((await call('request-decide', { id: 'req-1', decision: 'approve' })).success).toBe(true);
		expect(library.store.packetsAvailable('var-glassgem')).toBe(1);
	});

	it('holds a call that names no actor, and says why', async () => {
		const registry = library.createRegistry();
		const plain = await registry.execute(
			'loan-create',
			{ memberId: 'mem-ines', varietyId: 'var-borlotti' },
			{ clock: library.clock }
		);
		expect(plain.error?.code).toBe('APPROVAL_REQUIRED');
		expect(plain.error?.details?.summary).toContain('names no actor');
		expect(library.store.requests).toHaveLength(0);
		const rare = await registry.execute(
			'loan-create',
			{ memberId: 'mem-ines', varietyId: 'var-glassgem' },
			{ clock: library.clock }
		);
		expect(rare.error?.details?.summary).toContain('waits for the steward');
		expect(library.store.requests).toHaveLength(1);
		expect(library.store.packetsAvailable('var-borlotti')).toBe(6);
	});

	it('does not hold a loan of seed that is not rare', async () => {
		const lent = await call(
			'loan-create',
			{ memberId: 'mem-ines', varietyId: 'var-borlotti' },
			VOLUNTEER
		);
		expect(lent).toMatchObject({ success: true, data: { id: 'loan-2', status: 'out' } });
		expect(library.store.requests).toHaveLength(0);
	});
});

describe('a list that cannot be read says so, apart from an empty one', () => {
	beforeEach(() => start(libraryFixture));

	it.each([
		['variety-list', 'variety-list'],
		['member-list', 'member-list'],
		['loan-list', 'loan-list'],
		['request-list', 'request-list'],
	])('%s refuses with SERVICE_UNAVAILABLE, retryable', async (command) => {
		library.store.available = false;
		const result = await call(command, {});
		expect(result.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true });
		expect(result.error?.suggestion).toContain(command);
	});
});

describe('every undo offer runs, and puts the state back', () => {
	beforeEach(() => start(stewardFixture));

	const shelf = (varietyId: string) => library.store.packetsAvailable(varietyId);
	const lots = (varietyId: string) => library.store.lotsOf(varietyId).map((lot) => lot.id);

	it.each<[string, Record<string, unknown>, (done: CommandResult) => void]>([
		[
			'loan-create',
			{ memberId: 'mem-ines', varietyId: 'var-borlotti' },
			(done) => {
				expect(shelf('var-borlotti')).toBe(6);
				expect(library.store.loan((done.data as { id: string }).id)?.status).toBe('cancelled');
				expect(library.store.loans.filter((loan) => loan.status === 'out')).toHaveLength(1);
			},
		],
		[
			'loan-return',
			{ id: 'loan-1', savedSeed: { packets: 3, harvestYear: 2029 } },
			() => {
				expect(library.store.loan('loan-1')?.status).toBe('out');
				expect(lots('var-borlotti')).toEqual(['lot-borlotti-29']);
				expect(shelf('var-borlotti')).toBe(6);
			},
		],
		[
			'waitlist-join',
			{ memberId: 'mem-ines', varietyId: 'var-runner' },
			() => expect(library.store.waitingFor('var-runner')).toEqual([]),
		],
		[
			'request-decide',
			{ id: 'req-1', decision: 'approve' },
			(done) => {
				expect(library.store.request('req-1')?.status).toBe('pending');
				expect(library.store.loan((done.data as { loanId: string }).loanId)?.status).toBe(
					'cancelled'
				);
				expect(shelf('var-glassgem')).toBe(2);
			},
		],
		[
			'donation-import',
			{ rows: [{ label: 'Parsnip', packets: 2, harvestYear: 2029 }] },
			(done) => {
				expect(lots('var-parsnip')).toEqual(['lot-parsnip-28']);
				expect(shelf('var-parsnip')).toBe(2);
				expect(library.store.donation((done.data as { id: string }).id)?.status).toBe('cancelled');
			},
		],
	])('%s', async (command, input, check) => {
		const done = await call(command, input);
		expect(done.success).toBe(true);
		expect(done.undoCommand).toBeDefined();
		const undone = await call(done.undoCommand as string, done.undoArgs ?? {});
		expect(undone.success).toBe(true);
		check(done);
	});
});

describe('several decisions in one afd-batch', () => {
	beforeEach(() => start(stewardFixture));

	it('reports which did not go through, and why', async () => {
		const result = (await call('afd-batch', {
			commands: ['req-1', 'req-2', 'req-3'].map((id) => ({
				id: `approve-${id}`,
				command: 'request-decide',
				input: { id, decision: 'approve' },
			})),
		})) as unknown as {
			success: boolean;
			results: Array<{ id: string; result: CommandResult }>;
			summary: Record<string, number>;
		};
		expect(result.success).toBe(true);
		expect(result.summary).toMatchObject({ total: 3, successCount: 2, failureCount: 1 });
		expect(result.results.map((item) => item.result.data ?? item.result.error?.code)).toEqual([
			{
				id: 'req-1',
				status: 'approved',
				decidedAt: '2030-03-09T10:00:00Z',
				loanId: 'loan-2',
				memberTold: true,
			},
			{
				id: 'req-2',
				status: 'approved',
				decidedAt: '2030-03-09T10:00:00Z',
				loanId: 'loan-3',
				memberTold: true,
			},
			'OUT_OF_STOCK',
		]);
		expect(result.results[2]?.result.error?.suggestion).toContain('waitlist-join');
	});
});
