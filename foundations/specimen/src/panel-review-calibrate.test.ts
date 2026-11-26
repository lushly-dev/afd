import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { listDesignCards, readCardRecord } from './cards.js';
import { recordDecision } from './decisions.js';
import type { PanelWalkDriver } from './panel-types.js';
import { recordDesignRelease } from './releases.js';

const tempDirs: string[] = [];

async function makeWorkspace(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	await mkdir(join(dir, 'scenarios'), { recursive: true });
	await mkdir(join(dir, 'specimens', 'changes'), { recursive: true });
	await writeFile(
		join(dir, 'scenarios', 'checkout-out-of-stock.scenario.yaml'),
		`name: Checkout out of stock
description: Verify substitutes and clear recovery when an item is out of stock.
steps:
  - description: Open checkout screen with out-of-stock item
    command: cart-open
  - description: Confirm substitute suggestion
    command: checkout-confirm
`
	);
	await writeFile(
		join(dir, 'scenarios', 'book-search.scenario.yaml'),
		`name: Book search
description: Search for a book and review matching results.
steps:
  - description: Enter query
    command: catalog-search
`
	);
	await writeFile(
		join(dir, 'specimens', 'changes', 'checkout-authored-by-caller.json'),
		JSON.stringify({ change: 'checkout-authored-by-caller', author: 'author-alice' }, null, '\t')
	);
	await writeFile(
		join(dir, 'specimens', 'changes', 'checkout-substitutes-layout.json'),
		JSON.stringify({ change: 'checkout-substitutes-layout', author: 'author-bob' }, null, '\t')
	);
	await writeFile(
		join(dir, 'specimen.config.json'),
		JSON.stringify(
			{
				commandManifest: './commands.json',
				panel: {
					scenariosDir: './scenarios',
					memberCostUsd: 0.5,
					personas: [
						{ id: 'rev-1', modality: 'pointer', family: 'anthropic' },
						{ id: 'rev-2', modality: 'keyboard', family: 'openai' },
						{ id: 'rev-3', modality: 'screen-reader', family: 'google' },
						{ id: 'rev-4', modality: 'low-vision', family: 'anthropic' },
						{ id: 'rev-5', modality: 'pointer', family: 'openai' },
					],
				},
			},
			null,
			'\t'
		)
	);
	await writeFile(
		join(dir, 'commands.json'),
		JSON.stringify({ commands: ['cart-open', 'checkout-confirm', 'catalog-search'] })
	);
	return dir;
}

const personOptions = {
	decidedBy: { kind: 'person' as const, id: 'human-owner', channel: 'mcp-relay' as const },
	humanConfirmed: true,
	invokingActorKind: 'person' as const,
};

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await rm(dir, { recursive: true, force: true });
	}
});

describe('Phase C3 — panel-review and panel-calibrate', () => {
	it('satisfies Scenario 05: server-derived AUTHOR_CANNOT_REVIEW, BUDGET_EXCEEDED, 5-member panel split-3-to-2 escalation, provisional queue hiding, withdraw preserving decided cards, and RUN_NOT_FOUND', async () => {
		const root = await makeWorkspace('specimen-c3-s05-');
		const bench = await createSpecimenBench({ root });

		// Driver: rev-1 & rev-2 flag a 3-to-2 split on checkout substitutes layout; rev-3..rev-5 pass cleanly.
		const splitDriver: PanelWalkDriver = async (ctx) => {
			const flagsSplit = ctx.persona.id === 'rev-1' || ctx.persona.id === 'rev-2';
			return {
				transcript: `Walk for ${ctx.job} by ${ctx.persona.id}\nDone.`,
				actions: 2,
				journal: [
					{ command: 'cart-open', success: true },
					{ command: 'checkout-confirm', success: true },
				],
				findings: flagsSplit
					? [
							{
								summary: 'Substitute card pushes primary confirmation button below fold.',
								evidence: 'observed',
								where: 'checkout-substitutes-banner',
							},
						]
					: [],
			};
		};

		try {
			// Step 1: Author derived server-side cannot run panel-review (`AUTHOR_CANNOT_REVIEW`, suggestion contains 'independent')
			await expect(
				bench.panelReview(
					{
						change: 'checkout-authored-by-caller',
						jobs: ['checkout-out-of-stock'],
						target: 'http://127.0.0.1:4181/?screen=checkout',
						appDate: '2030-05-12',
					},
					{ actorId: 'author-alice', driver: splitDriver }
				)
			).rejects.toMatchObject({
				code: 'AUTHOR_CANNOT_REVIEW',
				suggestion: expect.stringContaining('independent'),
			});

			// Absent actorId also fails closed with AUTHOR_CANNOT_REVIEW unless allowUnverifiedLocal is enabled
			await expect(
				bench.panelReview(
					{
						change: 'checkout-substitutes-layout',
						jobs: ['checkout-out-of-stock'],
						target: 'http://127.0.0.1:4181/?screen=checkout',
						appDate: '2030-05-12',
					},
					{ driver: splitDriver }
				)
			).rejects.toMatchObject({ code: 'AUTHOR_CANNOT_REVIEW' });

			// Spoofing optional input `author` against server-derived author is also refused
			await expect(
				bench.panelReview(
					{
						change: 'checkout-authored-by-caller',
						author: 'someone-else',
						jobs: ['checkout-out-of-stock'],
						target: 'http://127.0.0.1:4181/?screen=checkout',
						appDate: '2030-05-12',
					},
					{ actorId: 'independent-carol', driver: splitDriver }
				)
			).rejects.toMatchObject({ code: 'AUTHOR_CANNOT_REVIEW' });

			// Step 2: Pre-flight budget refusal (`BUDGET_EXCEEDED`, suggestion contains 'design-card-list')
			await expect(
				bench.panelReview(
					{
						change: 'checkout-substitutes-layout',
						jobs: ['checkout-out-of-stock'],
						target: 'http://127.0.0.1:4181/?screen=checkout',
						appDate: '2030-05-12',
						budget: { maxRounds: 0, maxCostUsd: 0 },
					},
					{ actorId: 'independent-carol', driver: splitDriver }
				)
			).rejects.toMatchObject({
				code: 'BUDGET_EXCEEDED',
				suggestion: expect.stringContaining('design-card-list'),
			});

			// Unknown job fails pre-flight with JOB_NOT_FOUND
			await expect(
				bench.panelReview(
					{
						change: 'checkout-substitutes-layout',
						jobs: ['nonexistent-job'],
						target: 'http://127.0.0.1:4181/?screen=checkout',
						appDate: '2030-05-12',
					},
					{ actorId: 'independent-carol', driver: splitDriver }
				)
			).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });

			// Step 3: Independent 5-member panel settles agreed items provisionally & escalates 3-2 split with evidenceForBothSides
			const review = await bench.panelReview(
				{
					change: 'checkout-substitutes-layout',
					jobs: ['checkout-out-of-stock'],
					target: 'http://127.0.0.1:4181/?screen=checkout',
					appDate: '2030-05-12',
					panelSize: 5,
					budget: { maxRounds: 2, maxCostUsd: 10 },
				},
				{ actorId: 'independent-carol', driver: splitDriver }
			);
			if ('withdrawn' in review) throw new Error('Expected panel review run result');
			expect(review.run).toMatch(/^run-[0-9a-hjkmnp-tv-z]{12}$/);
			expect(review.round).toBe(1);
			expect(review.panelSize).toBe(5);
			expect(review.walks).toHaveLength(5);
			expect(review.overlap.families).toEqual(['anthropic', 'google', 'openai']);
			expect(review.overlap.sharedFindings).toBe(1);
			expect(review.provisional.length).toBeGreaterThanOrEqual(1);
			expect(review.provisional[0]).toMatchObject({
				provisional: true,
				decidedBy: { kind: 'panel' },
			});
			expect(review.escalated).toHaveLength(1);
			expect(review.escalated[0]).toMatchObject({
				card: expect.stringMatching(/^card-/),
				trigger: 'split-3-to-2',
				split: '3-2',
			});
			expect(review.escalated[0]?.evidenceForBothSides.for.length).toBeGreaterThan(0);
			expect(review.escalated[0]?.evidenceForBothSides.against.length).toBeGreaterThan(0);
			expect(review.nextSteps[0]).toContain('design-card-list');
			expect(review.unmeasured.some((u) => u.area === 'forced-colors')).toBe(true);

			// Step 4: design-card-list hides provisional items by default and shows the escalated open card
			const queue = await listDesignCards(root, { scope: 'all' });
			expect(queue.cards).toHaveLength(1);
			expect(queue.cards[0]).toMatchObject({
				card: review.escalated[0]?.card,
				status: 'open',
				why: {
					trigger: 'split-3-to-2',
				},
			});
			expect(queue.cards[0]?.why.evidenceForBothSides?.for.length).toBeGreaterThan(0);
			expect(queue.cards[0]?.why.evidenceForBothSides?.against.length).toBeGreaterThan(0);

			// End-to-end Phase C exit criterion: person approves the escalated card and cuts a release!
			const approvedCard = await recordDecision(
				root,
				{
					card: review.escalated[0]?.card,
					chosen: 'approve',
					reason: 'Keep compact substitute card above the fold.',
				},
				personOptions
			);
			const decId = 'decision' in approvedCard ? approvedCard.decision : '';
			expect(decId).toMatch(/^dec-/);

			const release = await recordDesignRelease(
				root,
				{ release: '1.0.0', decisions: [decId] },
				personOptions
			);
			expect(release.release).toBe('1.0.0');

			// Withdraw mode preserves already person-decided cards and removes provisional items from calibration
			const withdrawn = await bench.panelReview({
				action: 'withdraw',
				run: review.run,
				reason: 'Clean up test run after approval',
			});
			if (!('withdrawn' in withdrawn)) throw new Error('Expected withdraw result');
			expect(withdrawn.withdrawn).toBe(true);
			expect(withdrawn.preservedDecidedCards).toEqual([review.escalated[0]?.card]);
			expect(withdrawn.withdrawnProvisional).toBe(review.provisional.length);
			expect((await readCardRecord(root, review.escalated[0]?.card ?? '')).status).toBe('approved');

			// Step 6: Withdrawing an unknown run id fails with RUN_NOT_FOUND suggesting panel-review
			await expect(
				bench.panelReview({
					action: 'withdraw',
					run: 'run-000000000000',
					reason: 'Wrong target port',
				})
			).rejects.toMatchObject({
				code: 'RUN_NOT_FOUND',
				suggestion: expect.stringContaining('panel-review'),
			});
		} finally {
			await bench.close();
		}
	});

	it('satisfies Scenario 08: NOTHING_TO_SAMPLE, blind sampling omitting panelVerdict, server-side disagreementRate + reopenedCards, PERSON_REQUIRED, SAMPLE_NOT_FOUND, and mid-flight budget stop', async () => {
		const root = await makeWorkspace('specimen-c3-s08-');
		const bench = await createSpecimenBench({ root });

		const cleanDriver: PanelWalkDriver = async (ctx) => ({
			transcript: `Clean walk for ${ctx.job} by ${ctx.persona.id}\nDone.`,
			actions: 2,
			journal:
				ctx.job === 'checkout-out-of-stock'
					? [
							{ command: 'cart-open', success: true },
							{ command: 'checkout-confirm', success: true },
						]
					: [{ command: 'catalog-search', success: true }],
			findings: [],
		});

		try {
			// Step 1: Sampling before any provisional agreements exist fails with NOTHING_TO_SAMPLE
			await expect(bench.panelCalibrate({ action: 'sample', count: 5 })).rejects.toMatchObject({
				code: 'NOTHING_TO_SAMPLE',
				suggestion: expect.stringContaining('panel-review'),
			});

			// Generate two provisional panel agreements across two jobs (mid-flight budget stops after quorum on both!)
			const partialBudgetRun = await bench.panelReview(
				{
					change: 'checkout-substitutes-layout',
					jobs: ['checkout-out-of-stock', 'book-search'],
					target: 'http://127.0.0.1:4181/?screen=checkout',
					appDate: '2030-05-12',
					panelSize: 5,
					// 9 walks * $0.50 = $4.50 -> completes 5/5 for job 1 + 4/5 (quorum >= 3) for job 2, then stops on budget
					budget: { maxRounds: 2, maxCostUsd: 4.5 },
				},
				{ actorId: 'independent-carol', driver: cleanDriver }
			);
			if ('withdrawn' in partialBudgetRun) throw new Error('Expected run result');
			expect(partialBudgetRun.stoppedBy).toBe('budget');
			expect(partialBudgetRun.walks).toHaveLength(9);
			expect(partialBudgetRun.provisional).toHaveLength(2);

			// Step 2: Blind sample returns 2 items with walk evidence and strictly omits panelVerdict
			const sample = await bench.panelCalibrate({ action: 'sample', count: 2, seed: 7 });
			expect(sample.sample).toMatch(/^cal-[0-9a-hjkmnp-tv-z]{12}$/);
			expect(sample.items).toHaveLength(2);
			expect(sample.items[0]?.evidence.walk).toMatch(/^walk-/);
			expect(sample.items[0]?.panelVerdict).toBeUndefined();
			expect(sample.items[1]?.panelVerdict).toBeUndefined();

			// Non-person actor is refused with PERSON_REQUIRED on record
			await expect(
				bench.panelCalibrate(
					{
						action: 'record',
						sample: sample.sample,
						judgements: [{ item: sample.items[0]?.item ?? '', verdict: 'accept' }],
					},
					{ invokingActorKind: 'agent' }
				)
			).rejects.toMatchObject({ code: 'PERSON_REQUIRED' });

			// Step 3: Person records independent verdicts (1 agrees, 1 disagrees) -> disagreementRate 0.5, 1 reopened card
			const recorded = await bench.panelCalibrate(
				{
					action: 'record',
					sample: sample.sample,
					judgements: [
						{ item: sample.items[0]?.item ?? '', verdict: 'accept' },
						{
							item: sample.items[1]?.item ?? '',
							verdict: 'reject',
							reason: 'Focus order still skips the cancel button',
						},
					],
				},
				{ humanConfirmed: true, invokingActorKind: 'person', actorId: 'human-owner' }
			);
			expect(recorded.recorded).toBe(2);
			expect(recorded.disagreed).toBe(1);
			expect(recorded.disagreementRate).toBe(0.5);
			expect(recorded.reopenedCards).toHaveLength(1);
			expect(recorded.reopenedCards?.[0]).toMatch(/^card-/);
			// panelVerdict is now revealed after recording
			expect(recorded.items[0]?.panelVerdict).toBe('accept');

			// Reopened card is open in design-card-list
			const reopenedCard = await readCardRecord(root, recorded.reopenedCards?.[0] ?? '');
			expect(reopenedCard.status).toBe('open');
			expect(reopenedCard.why.findings[0]?.summary).toContain('cancel button');

			// Step 4: Unknown sample id fails with SAMPLE_NOT_FOUND suggesting panel-calibrate
			await expect(
				bench.panelCalibrate(
					{ action: 'record', sample: 'cal-000000000000', judgements: [] },
					{ humanConfirmed: true, invokingActorKind: 'person' }
				)
			).rejects.toMatchObject({
				code: 'SAMPLE_NOT_FOUND',
				suggestion: expect.stringContaining('panel-calibrate'),
			});
		} finally {
			await bench.close();
		}
	});

	it('enforces fail-closed authorship, per-job quorum, all 5 escalation triggers, full withdraw preservation + budget retention, withdrawn-sample invalidation, baseline comparison, and symlink confinement', async () => {
		const root = await makeWorkspace('specimen-c3-hardening-');
		// Structured change records for remaining 4 triggers
		await writeFile(
			join(root, 'specimens', 'changes', 'guidance-update.json'),
			JSON.stringify({
				author: 'author-bob',
				guidanceChange: true,
				touches: ['specimens/patterns/error-recovery/pattern.json'],
			})
		);
		await writeFile(
			join(root, 'specimens', 'changes', 'irreversible-delete.json'),
			JSON.stringify({ author: 'author-bob', irreversible: true })
		);
		await writeFile(
			join(root, 'specimens', 'changes', 'novel-flow.json'),
			JSON.stringify({ author: 'author-bob', noPrecedent: true })
		);
		await writeFile(
			join(root, 'specimens', 'changes', 'conflict-change.json'),
			JSON.stringify({ author: 'author-bob', touches: ['checkout-banner'] })
		);

		const cleanDriver: PanelWalkDriver = async (ctx) => ({
			transcript: `Clean walk for ${ctx.job}\nDone.`,
			actions: 2,
			journal:
				ctx.job === 'checkout-out-of-stock'
					? [
							{ command: 'cart-open', success: true },
							{ command: 'checkout-confirm', success: true },
						]
					: [{ command: 'catalog-search', success: true }],
			findings: [],
		});
		const failedDriver: PanelWalkDriver = async (ctx) => ({
			transcript: `Failed walk for ${ctx.job}\nStopped — broken button.`,
			actions: 1,
			journal: [{ command: 'cart-open', success: false }],
			findings: [],
		});

		const bench = await createSpecimenBench({ root });
		try {
			// 1. Fail-closed when no authoritative server author exists (and prototype key safety)
			await expect(
				bench.panelReview(
					{
						change: 'unregistered-change',
						author: 'someone-else',
						jobs: ['book-search'],
						target: 'http://127.0.0.1:4181/?screen=search',
						appDate: '2030-05-12',
					},
					{ actorId: 'independent-carol', driver: cleanDriver }
				)
			).rejects.toMatchObject({ code: 'AUTHOR_CANNOT_REVIEW' });

			await expect(
				bench.panelReview(
					{
						change: 'constructor',
						jobs: ['book-search'],
						target: 'http://127.0.0.1:4181/?screen=search',
						appDate: '2030-05-12',
					},
					{ actorId: 'independent-carol', driver: cleanDriver }
				)
			).rejects.toMatchObject({ code: 'AUTHOR_CANNOT_REVIEW' });

			// 2. Per-job quorum: budget stop after 1/5 walks on job 2 leaves job 2 unsettled (only 1 provisional item!)
			const quorumRun = await bench.panelReview(
				{
					change: 'checkout-substitutes-layout',
					jobs: ['checkout-out-of-stock', 'book-search'],
					target: 'http://127.0.0.1:4181/?screen=checkout',
					appDate: '2030-05-12',
					panelSize: 5,
					budget: { maxRounds: 2, maxCostUsd: 3.0 }, // 6 walks: 5 for job 1, 1 for job 2 (< quorum 3)
				},
				{ actorId: 'independent-carol', driver: cleanDriver }
			);
			if ('withdrawn' in quorumRun) throw new Error('Expected run result');
			expect(quorumRun.stoppedBy).toBe('budget');
			expect(quorumRun.provisional).toHaveLength(1);

			// 3. Draw sample, refuse empty judgements, then withdraw run -> recording pre-drawn sample MUST fail!
			const preWithdrawSample = await bench.panelCalibrate({ action: 'sample', count: 1, seed: 1 });
			await expect(
				bench.panelCalibrate(
					{ action: 'record', sample: preWithdrawSample.sample, judgements: [] },
					{ humanConfirmed: true, invokingActorKind: 'person' }
				)
			).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

			await bench.panelReview({
				action: 'withdraw',
				run: quorumRun.run,
				reason: 'Misconfigured run withdrawn before calibration.',
			});
			await expect(
				bench.panelCalibrate(
					{
						action: 'record',
						sample: preWithdrawSample.sample,
						judgements: [{ item: preWithdrawSample.items[0]?.item ?? '', verdict: 'accept' }],
					},
					{ humanConfirmed: true, invokingActorKind: 'person' }
				)
			).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

			// Budget retention: withdrawn run still counts toward maxRounds & maxCostUsd!
			await expect(
				bench.panelReview(
					{
						change: 'checkout-substitutes-layout',
						jobs: ['book-search'],
						target: 'http://127.0.0.1:4181/?screen=search',
						appDate: '2030-05-12',
						budget: { maxRounds: 1, maxCostUsd: 10 },
					},
					{ actorId: 'independent-carol', driver: cleanDriver }
				)
			).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });

			// 4. Structured triggers: guidance-change, irreversible-or-default, no-precedent, conflicts-recorded-decision
			const guidanceRev = await bench.panelReview(
				{
					change: 'guidance-update',
					jobs: ['book-search'],
					target: 'http://127.0.0.1:4181/?screen=search',
					appDate: '2030-05-12',
					panelSize: 3,
				},
				{ actorId: 'independent-carol', driver: cleanDriver }
			);
			if ('withdrawn' in guidanceRev) throw new Error('Expected run result');
			expect(guidanceRev.escalated[0]?.trigger).toBe('guidance-change');

			// Withdraw preserves person-decided `changes-requested` and `deferred` cards!
			const guidanceCardId = guidanceRev.escalated[0]?.card ?? '';
			await recordDecision(
				root,
				{
					card: guidanceCardId,
					chosen: 'request-changes',
					reason: 'Need clearer wording.',
				},
				personOptions
			);
			const guidanceWithdraw = await bench.panelReview({
				action: 'withdraw',
				run: guidanceRev.run,
				reason: 'Retracting run after person requested changes.',
			});
			if (!('withdrawn' in guidanceWithdraw)) throw new Error('Expected withdraw result');
			expect(guidanceWithdraw.preservedDecidedCards).toEqual([guidanceCardId]);
			expect((await readCardRecord(root, guidanceCardId)).status).toBe('changes-requested');

			const irrevRev = await bench.panelReview(
				{
					change: 'irreversible-delete',
					jobs: ['book-search'],
					target: 'http://127.0.0.1:4181/?screen=search',
					appDate: '2030-05-12',
					panelSize: 3,
				},
				{ actorId: 'independent-carol', driver: cleanDriver }
			);
			if ('withdrawn' in irrevRev) throw new Error('Expected run result');
			expect(irrevRev.escalated[0]?.trigger).toBe('irreversible-or-default');
			const irrevCardId = irrevRev.escalated[0]?.card ?? '';
			await recordDecision(
				root,
				{ card: irrevCardId, chosen: 'defer', reason: 'Wait for next sprint.' },
				personOptions
			);
			const irrevWithdraw = await bench.panelReview({
				action: 'withdraw',
				run: irrevRev.run,
				reason: 'Retracting run after person deferred.',
			});
			if (!('withdrawn' in irrevWithdraw)) throw new Error('Expected withdraw result');
			expect(irrevWithdraw.preservedDecidedCards).toEqual([irrevCardId]);
			expect((await readCardRecord(root, irrevCardId)).status).toBe('deferred');

			const novelRev = await bench.panelReview(
				{
					change: 'novel-flow',
					jobs: ['book-search'],
					target: 'http://127.0.0.1:4181/?screen=search',
					appDate: '2030-05-12',
					panelSize: 3,
				},
				{ actorId: 'independent-carol', driver: cleanDriver }
			);
			if ('withdrawn' in novelRev) throw new Error('Expected run result');
			expect(novelRev.escalated[0]?.trigger).toBe('no-precedent');

			// Approve novel card targeting `checkout-banner` so next change triggers `conflicts-recorded-decision`
			await recordDecision(
				root,
				{
					card: novelRev.escalated[0]?.card,
					chosen: 'approve',
					reason: 'Approve baseline checkout-banner behavior.',
					meantToFix: { job: 'checkout-out-of-stock', target: 'checkout-banner' },
				},
				personOptions
			);
			const conflictRev = await bench.panelReview(
				{
					change: 'conflict-change',
					jobs: ['book-search'],
					target: 'http://127.0.0.1:4181/?screen=search',
					appDate: '2030-05-12',
					panelSize: 3,
				},
				{
					actorId: 'independent-carol',
					driver: async (ctx) => ({
						transcript: `Walk ${ctx.job}\nDone.`,
						actions: 1,
						journal: [{ command: 'cart-open', success: true }],
						findings: [
							{ summary: 'Banner altered', evidence: 'observed', where: 'checkout-banner' },
						],
					}),
				}
			);
			if ('withdrawn' in conflictRev) throw new Error('Expected run result');
			expect(conflictRev.escalated[0]?.trigger).toBe('conflicts-recorded-decision');

			// 5. Failed walks do NOT falsely settle as `verdict: 'accept'` and stop with `gate-regression`,
			//    and baseline run comparison wires baselineWalk into runPanelWalk!
			const failedRev = await bench.panelReview(
				{
					change: 'checkout-substitutes-layout',
					jobs: ['book-search'],
					target: 'http://127.0.0.1:4181/?screen=search',
					appDate: '2030-05-12',
					panelSize: 3,
					baseline: quorumRun.run,
					budget: { maxRounds: 5, maxCostUsd: 20 },
				},
				{ actorId: 'independent-carol', driver: failedDriver }
			);
			if ('withdrawn' in failedRev) throw new Error('Expected run result');
			expect(failedRev.stoppedBy).toBe('gate-regression');
			expect(failedRev.provisional).toHaveLength(0);

			// 6. Symlink escape in specimens/changes/ is refused
			const outsideDir = await mkdtemp(join(tmpdir(), 'specimen-c3-escape-'));
			tempDirs.push(outsideDir);
			await writeFile(join(outsideDir, 'secret.json'), JSON.stringify({ author: 'other' }));
			await symlink(
				join(outsideDir, 'secret.json'),
				join(root, 'specimens', 'changes', 'escaped-change.json')
			);
			await expect(
				bench.panelReview(
					{
						change: 'escaped-change',
						jobs: ['book-search'],
						target: 'http://127.0.0.1:4181/?screen=search',
						appDate: '2030-05-12',
					},
					{ actorId: 'independent-carol', driver: cleanDriver }
				)
			).rejects.toThrow(/escapes/);
		} finally {
			await bench.close();
		}

		// 7. allowUnverifiedLocal: true permits absent actorId and records `reviewer-identity` in `unmeasured`
		const localRoot = await makeWorkspace('specimen-c3-unverified-');
		await writeFile(
			join(localRoot, 'specimen.config.json'),
			JSON.stringify({
				commandManifest: './commands.json',
				panel: { scenariosDir: './scenarios', allowUnverifiedLocal: true },
			})
		);
		const localBench = await createSpecimenBench({ root: localRoot });
		try {
			const res = await localBench.panelReview(
				{
					change: 'unregistered-local',
					jobs: ['book-search'],
					target: 'http://127.0.0.1:4181/?screen=search',
					appDate: '2030-05-12',
					panelSize: 1,
				},
				{ driver: cleanDriver }
			);
			if ('withdrawn' in res) throw new Error('Expected run result');
			expect(res.unmeasured.some((u) => u.area === 'reviewer-identity')).toBe(true);

			// 8. Stopped walks with 1 finding never settle as provisional accept; 1-1 tie escalates; touches patterns escalates cleanly
			const stoppedDriver: PanelWalkDriver = async (ctx) => ({
				transcript: `Stopped for ${ctx.persona.id}\nStopped: stuck on modal.`,
				actions: 1,
				journal: [],
				findings:
					ctx.persona.id === 'rev-1'
						? [{ summary: 'Modal traps focus', where: 'checkout.modal', evidence: 'observed' }]
						: [],
			});
			const stoppedRes = await localBench.panelReview(
				{
					change: 'stopped-with-finding',
					jobs: ['book-search'],
					target: 'http://127.0.0.1:4181/?screen=search',
					appDate: '2030-05-12',
					panelSize: 3,
				},
				{ driver: stoppedDriver }
			);
			if ('withdrawn' in stoppedRes) throw new Error('Expected run result');
			expect(stoppedRes.provisional).toHaveLength(0);

			let tieIdx = 0;
			const tieDriver: PanelWalkDriver = async () => {
				tieIdx += 1;
				return {
					transcript: 'Done.',
					actions: 1,
					journal: [{ command: 'catalog-search', success: true }],
					findings:
						tieIdx === 1
							? [{ summary: 'Split layout concern', where: 'search.bar', evidence: 'observed' }]
							: [],
				};
			};
			const tieRes = await localBench.panelReview(
				{
					change: 'two-walk-tie',
					jobs: ['book-search'],
					target: 'http://127.0.0.1:4181/?screen=search',
					appDate: '2030-05-12',
					panelSize: 2,
				},
				{ driver: tieDriver }
			);
			if ('withdrawn' in tieRes) throw new Error('Expected run result');
			expect(tieRes.escalated.some((e) => e.trigger === 'split-3-to-2')).toBe(true);
			expect(tieRes.provisional.some((p) => p.summary.includes('search.bar'))).toBe(false);

			await writeFile(
				join(localRoot, 'specimens', 'changes', 'touches-pattern-clean.json'),
				JSON.stringify({
					author: 'author-bob',
					touches: ['specimens/patterns/error-recovery/pattern.json'],
				})
			);
			const touchesRes = await localBench.panelReview(
				{
					change: 'touches-pattern-clean',
					jobs: ['book-search'],
					target: 'http://127.0.0.1:4181/?screen=search',
					appDate: '2030-05-12',
					panelSize: 3,
				},
				{ actorId: 'independent-carol', driver: cleanDriver }
			);
			if ('withdrawn' in touchesRes) throw new Error('Expected run result');
			expect(touchesRes.escalated).toHaveLength(1);
			expect(touchesRes.escalated[0]?.trigger).toBe('guidance-change');
			expect(touchesRes.provisional).toHaveLength(0);
		} finally {
			await localBench.close();
		}
	});
});
