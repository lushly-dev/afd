import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	CARDS_DIR,
	computeCardDigest,
	generateCardId,
	getDecision,
	listDecisions,
	listDesignCards,
	RELEASES_DIR,
	readAllCards,
	readAllReleases,
	readCardRecord,
	readReleaseManifest,
	recordDecision,
	recordDesignRelease,
	renderCardsPageHtml,
	writeCardRecord,
} from './index.js';
import type { DesignCardRecord } from './types.js';
import { parseConfig } from './validate.js';

const tempDirs: string[] = [];
afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRoot(prefix = 'specimen-cards-'): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function makeCard(overrides: Partial<DesignCardRecord> = {}): DesignCardRecord {
	return {
		card: overrides.card ?? generateCardId(),
		what: 'Clarify out-of-stock recovery action',
		owner: 'product',
		scope: 'release',
		touches: ['src/checkout/cart.ts'],
		severity: 'major',
		visual: {
			kind: 'transcript',
			summary: 'Screen reader walk stopped at out-of-stock alert without next action.',
			context: { modality: 'screen-reader', viewport: '1280x800', theme: 'light' },
		},
		why: {
			findings: [
				{
					summary: 'Alert does not announce recovery link.',
					evidence: 'observed',
				},
			],
			reviewerCount: 5,
			split: '4-1',
			trigger: 'split-3-to-2',
		},
		effect: {
			gatesBefore: { passed: 10, failed: 1 },
			gatesAfter: { passed: 11, failed: 0 },
			checksSummary: 'All portable gates pass after fix.',
			regression: false,
		},
		risk: {
			affects: ['checkout-out-of-stock'],
			undoable: true,
		},
		status: 'open',
		...overrides,
	};
}

const personOptions = {
	decidedBy: { kind: 'person' as const, channel: 'mcp-relay' as const, id: 'alice' },
	humanConfirmed: true,
	invokingActorKind: 'agent' as const,
};

describe('Phase C2: design cards, card-mode decisions, and design releases', () => {
	it('satisfies Scenario 03 end-to-end (listing, person boundary, refusal scopes, unsafe block + remediation, regression ack, batch, release, and decision-list filters)', async () => {
		const root = await makeRoot('specimen-s03-');

		// Step 1-2: Write cards with mixed severities and statuses, verify ordering, pagination, and withdrawn/provisional filtering.
		const cBlocker = makeCard({
			card: 'card-aaaaaaaaaaaa',
			severity: 'blocker',
			what: 'Blocker card A',
			changeSignature: 'sig:auto-retry-payment',
		});
		const cMajor = makeCard({
			card: 'card-bbbbbbbbbbbb',
			severity: 'major',
			what: 'Major card B',
			effect: {
				gatesBefore: { passed: 10, failed: 0 },
				gatesAfter: { passed: 9, failed: 1 },
				regression: true,
			},
		});
		const cMinor1 = makeCard({
			card: 'card-cccccccccccc',
			severity: 'minor',
			what: 'Minor card C1',
		});
		const cMinor2 = makeCard({
			card: 'card-dddddddddddd',
			severity: 'minor',
			what: 'Minor card C2',
		});
		const cWithdrawn = makeCard({
			card: 'card-eeeeeeeeeeee',
			severity: 'blocker',
			what: 'Withdrawn card E',
			status: 'withdrawn',
		});
		const cProvisional = makeCard({
			card: 'card-pr0v00000001',
			severity: 'major',
			what: 'Provisional panel card P',
			status: 'provisional',
		});
		for (const card of [cMinor2, cMajor, cWithdrawn, cProvisional, cMinor1, cBlocker]) {
			await writeCardRecord(root, card);
		}

		// Default list hides withdrawn and provisional cards and sorts blocker > major > minor then card id ascending.
		const page1 = await listDesignCards(root, { limit: 2 });
		expect(page1.total).toBe(4);
		expect(page1.more).toBe(2);
		expect(page1.cards.map((c) => c.card)).toEqual(['card-aaaaaaaaaaaa', 'card-bbbbbbbbbbbb']);
		expect(page1.next).toBe('card-bbbbbbbbbbbb');
		expect(page1.page).toContain('cards.html');
		expect(renderCardsPageHtml(page1.cards)).toContain('Blocker card A');
		expect(renderCardsPageHtml()).toContain('/api/cards.json');

		// includeProvisional: true surfaces provisional cards.
		const withProvisional = await listDesignCards(root, { includeProvisional: true });
		expect(withProvisional.cards.map((c) => c.card)).toContain('card-pr0v00000001');

		// Cursor pagination fetches the remaining two cards cleanly.
		const page2 = await listDesignCards(root, { limit: 2, after: page1.next });
		expect(page2.cards.map((c) => c.card)).toEqual(['card-cccccccccccc', 'card-dddddddddddd']);
		expect(page2.more).toBe(0);
		expect(page2.next).toBeUndefined();

		// Explicit withdrawn filter finds withdrawn card; withdrawn cards cannot be decided (CARD_ALREADY_DECIDED).
		const withdrawnList = await listDesignCards(root, { status: 'withdrawn' });
		expect(withdrawnList.cards.map((c) => c.card)).toEqual(['card-eeeeeeeeeeee']);
		await expect(
			recordDecision(
				root,
				{
					card: cWithdrawn.card,
					chosen: 'approve',
					reason: 'Attempt to resurrect withdrawn card.',
				},
				personOptions
			)
		).rejects.toMatchObject({ code: 'CARD_ALREADY_DECIDED' });
		await expect(listDesignCards(root, { card: 'card-999999999999' })).rejects.toMatchObject({
			code: 'CARD_NOT_FOUND',
		});

		// Step 3: Non-person (script / unconfirmed agent) refused with PERSON_REQUIRED in card mode.
		await expect(
			recordDecision(
				root,
				{ card: cBlocker.card, chosen: 'approve', reason: 'Agent attempting self-approval.' },
				{ decidedBy: { kind: 'script' }, humanConfirmed: false, invokingActorKind: 'agent' }
			)
		).rejects.toMatchObject({ code: 'PERSON_REQUIRED' });

		// Provisional panel write is refused in card mode.
		await expect(
			recordDecision(
				root,
				{
					card: cBlocker.card,
					chosen: 'approve',
					reason: 'Provisional attempt.',
					provisional: true,
				},
				personOptions
			)
		).rejects.toMatchObject({ code: 'PERSON_REQUIRED' });

		// Step 4: Rejecting a card without refusalScope fails with REFUSAL_SCOPE_REQUIRED.
		await expect(
			recordDecision(
				root,
				{ card: cBlocker.card, chosen: 'reject', reason: 'Do not auto-retry payments.' },
				personOptions
			)
		).rejects.toMatchObject({ code: 'REFUSAL_SCOPE_REQUIRED' });

		// Step 5: Rejecting with refusalScope: 'wrong-for-context' allows a later card on the same signature.
		const thisFixCard = makeCard({
			card: 'card-ffffffffffff',
			severity: 'minor',
			what: 'Try softer wording',
			changeSignature: 'sig:wording-copy',
		});
		await writeCardRecord(root, thisFixCard);
		const thisFixDec = await recordDecision(
			root,
			{
				card: thisFixCard.card,
				chosen: 'reject',
				refusalScope: 'wrong-for-context',
				reason: 'Wording is wrong for this context.',
			},
			personOptions
		);
		expect('decision' in thisFixDec && thisFixDec.refusalScope).toBe('wrong-for-context');
		const retryThisFixCard = makeCard({
			card: 'card-gggggggggggg',
			severity: 'minor',
			what: 'Clearer wording attempt 2',
			changeSignature: 'sig:wording-copy',
		});
		await writeCardRecord(root, retryThisFixCard);
		const approvedRetry = await recordDecision(
			root,
			{
				card: retryThisFixCard.card,
				chosen: 'approve',
				reason: 'Clearer phrasing resolves confusion.',
			},
			personOptions
		);
		expect('decision' in approvedRetry && approvedRetry.chosen).toBe('approve');

		// Step 6: Rejecting with refusalScope: 'unsafe' creates a lasting block on changeSignature.
		const unsafeRefusal = await recordDecision(
			root,
			{
				card: cBlocker.card,
				chosen: 'reject',
				refusalScope: 'unsafe',
				reason: 'Automatic payment retry risks double-charging customers.',
			},
			personOptions
		);
		expect('decision' in unsafeRefusal).toBe(true);
		const unsafeDecisionId = 'decision' in unsafeRefusal ? unsafeRefusal.decision : '';
		expect((await readCardRecord(root, cBlocker.card)).status).toBe('rejected');

		// Step 7: Re-proposing same changeSignature without supersedes+remediation fails with REFUSED_AS_UNSAFE and closes the card.
		const reProposed = makeCard({
			card: 'card-hhhhhhhhhhhh',
			severity: 'blocker',
			what: 'Retry payment automatically again',
			changeSignature: 'sig:auto-retry-payment',
		});
		await writeCardRecord(root, reProposed);
		await expect(
			recordDecision(
				root,
				{
					card: reProposed.card,
					chosen: 'approve',
					reason: 'Try approving re-proposed unsafe direction.',
				},
				personOptions
			)
		).rejects.toMatchObject({ code: 'REFUSED_AS_UNSAFE' });
		expect((await readCardRecord(root, reProposed.card)).status).toBe('rejected');

		// Step 8: Superseding the unsafe decision with concrete remediation unlocks approval.
		const remediatedCard = makeCard({
			card: 'card-jjjjjjjjjjjj',
			severity: 'blocker',
			what: 'Idempotency-keyed manual retry confirmation',
			changeSignature: 'sig:auto-retry-payment',
		});
		await writeCardRecord(root, remediatedCard);
		const remediatedDec = await recordDecision(
			root,
			{
				card: remediatedCard.card,
				chosen: 'approve',
				supersedes: unsafeDecisionId,
				remediation: 'Requires explicit click plus server idempotency key.',
				reason: 'Idempotency key and explicit confirmation eliminate double-charge risk.',
				meantToFix: {
					job: 'checkout-out-of-stock',
					target: 'payment-retry-failures',
				},
			},
			personOptions
		);
		expect('decision' in remediatedDec).toBe(true);
		const remediatedDecId = 'decision' in remediatedDec ? remediatedDec.decision : '';
		const fetchedRemediated = await getDecision(root, { decision: remediatedDecId });
		expect(fetchedRemediated).toMatchObject({
			kind: 'card',
			card: remediatedCard.card,
			chosen: 'approve',
			supersedes: unsafeDecisionId,
			remediation: 'Requires explicit click plus server idempotency key.',
			meantToFix: { job: 'checkout-out-of-stock', target: 'payment-retry-failures' },
			decidedBy: { kind: 'person', channel: 'mcp-relay', id: 'alice' },
		});

		// Step 9: Regression card refuses without regressionAccepted: true and refuses inside batch cards[].
		await expect(
			recordDecision(
				root,
				{ card: cMajor.card, chosen: 'approve', reason: 'Accepting regression without flag.' },
				personOptions
			)
		).rejects.toMatchObject({ code: 'REGRESSION_ACK_REQUIRED' });
		await expect(
			recordDecision(
				root,
				{
					cards: [cMajor.card, cMinor1.card],
					chosen: 'approve',
					regressionAccepted: true,
					reason: 'Attempting batch approval with a regression card.',
				},
				personOptions
			)
		).rejects.toMatchObject({ code: 'REGRESSION_ACK_REQUIRED' });

		// Individual approval of regression card with regressionAccepted: true succeeds.
		const regApproved = await recordDecision(
			root,
			{
				card: cMajor.card,
				chosen: 'approve',
				regressionAccepted: true,
				reason: 'Known temporary gate regression tracked for next sprint.',
			},
			personOptions
		);
		expect('decision' in regApproved && regApproved.regressionAccepted).toBe(true);
		const regApprovedId = 'decision' in regApproved ? regApproved.decision : '';

		// Step 10: Batch approval of non-regression cards succeeds atomically.
		const batchResult = await recordDecision(
			root,
			{
				cards: [cMinor1.card, cMinor2.card],
				chosen: 'approve',
				reason: 'Both minor copy cards reviewed and approved together.',
			},
			personOptions
		);
		expect('decisions' in batchResult).toBe(true);
		const batchIds = 'decisions' in batchResult ? batchResult.decisions.map((d) => d.decision) : [];
		expect(batchIds).toHaveLength(2);

		// Already-approved card cannot be re-decided (CARD_ALREADY_DECIDED).
		await expect(
			recordDecision(
				root,
				{
					card: cMinor1.card,
					chosen: 'reject',
					refusalScope: 'not-a-priority',
					reason: 'Too late.',
				},
				personOptions
			)
		).rejects.toMatchObject({ code: 'CARD_ALREADY_DECIDED' });

		// Step 11: design-release checks person boundary, open and changes-requested cards, unapproved decisions, timestamp, and idempotency.
		const openBlocker = makeCard({ card: 'card-kkkkkkkkkkkk', severity: 'minor', status: 'open' });
		await writeCardRecord(root, openBlocker);
		await expect(
			recordDesignRelease(
				root,
				{ release: '1.2.0', decisions: [remediatedDecId] },
				{ decidedBy: { kind: 'script' }, humanConfirmed: false }
			)
		).rejects.toMatchObject({ code: 'PERSON_REQUIRED' });
		await expect(
			recordDesignRelease(root, { release: '1.2.0', decisions: [remediatedDecId] }, personOptions)
		).rejects.toMatchObject({ code: 'UNAPPROVED_CARDS_OPEN' });

		// Requesting changes still blocks release with UNAPPROVED_CARDS_OPEN.
		await recordDecision(
			root,
			{ card: openBlocker.card, chosen: 'request-changes', reason: 'Clarify copy before ship.' },
			personOptions
		);
		await expect(
			recordDesignRelease(root, { release: '1.2.0', decisions: [remediatedDecId] }, personOptions)
		).rejects.toMatchObject({ code: 'UNAPPROVED_CARDS_OPEN' });

		// Deferring the remaining card unblocks release (deferred cards do not block).
		await recordDecision(
			root,
			{ card: openBlocker.card, chosen: 'defer', reason: 'Defer to 1.3.0.' },
			personOptions
		);

		// Unapproved decision (unsafe refusal) cannot be released.
		await expect(
			recordDesignRelease(root, { release: '1.2.0', decisions: [unsafeDecisionId] }, personOptions)
		).rejects.toMatchObject({ code: 'DECISION_NOT_APPROVED' });

		// Unknown decision fails with DECISION_NOT_FOUND.
		await expect(
			recordDesignRelease(
				root,
				{ release: '1.2.0', decisions: ['dec-000000000000'] },
				personOptions
			)
		).rejects.toMatchObject({ code: 'DECISION_NOT_FOUND' });

		// Timestamp predating latest approval is refused.
		await expect(
			recordDesignRelease(
				root,
				{
					release: '1.2.0',
					decisions: [remediatedDecId, regApprovedId, ...batchIds],
					releasedAt: '2020-01-01T00:00:00.000Z',
				},
				personOptions
			)
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

		// Clean release succeeds and writes specimens/releases/1.2.0.json.
		const released = await recordDesignRelease(
			root,
			{ release: '1.2.0', decisions: [remediatedDecId, regApprovedId, ...batchIds] },
			personOptions
		);
		expect(released.release).toBe('1.2.0');
		expect(released.manifestPath).toBe(`${RELEASES_DIR}/1.2.0.json`);
		expect(released.decisions).toHaveLength(4);
		const manifest = await readReleaseManifest(root, '1.2.0');
		expect(manifest?.releasedBy).toEqual({ kind: 'person', id: 'alice', channel: 'mcp-relay' });

		// Identical release call is idempotent; conflicting decision list fails cleanly.
		const idempotent = await recordDesignRelease(
			root,
			{ release: '1.2.0', decisions: [...batchIds, regApprovedId, remediatedDecId] },
			personOptions
		);
		expect(idempotent.releasedAt).toBe(released.releasedAt);
		await expect(
			recordDesignRelease(root, { release: '1.2.0', decisions: [remediatedDecId] }, personOptions)
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
		// Already-released decision cannot be re-released under a different release identifier.
		await expect(
			recordDesignRelease(root, { release: '1.3.0', decisions: [remediatedDecId] }, personOptions)
		).rejects.toMatchObject({ code: 'DECISION_NOT_APPROVED' });

		// Step 12: decision-list filters by kind='card', released=true/false, and paginates.
		const releasedCards = await listDecisions(root, { kind: 'card', released: true });
		expect(releasedCards.decisions.map((d) => d.decision).sort()).toEqual(
			[remediatedDecId, regApprovedId, ...batchIds].sort()
		);
		expect(releasedCards.decisions.every((d) => d.released === true && d.release === '1.2.0')).toBe(
			true
		);
		const unreleasedCards = await listDecisions(root, { kind: 'card', released: false });
		expect(unreleasedCards.decisions.length).toBeGreaterThanOrEqual(2);
		expect(unreleasedCards.decisions.every((d) => d.released === false)).toBe(true);

		const paged = await listDecisions(root, { kind: 'card', released: true, limit: 2 });
		expect(paged.decisions).toHaveLength(2);
		expect(paged.total).toBe(4);
		expect(paged.next).toBe(paged.decisions[1]?.decision);
		const paged2 = await listDecisions(root, {
			kind: 'card',
			released: true,
			limit: 2,
			after: paged.next,
		});
		expect(paged2.decisions).toHaveLength(2);
		expect(paged2.next).toBeUndefined();
	});

	it('satisfies Scenario 06 step 5 (fork approval flips approvalStatus and activates patternBindings) and Scenario 07 steps 5-6 (merge digest pinning + UPSTREAM_CHANGED)', async () => {
		const root = await makeRoot('specimen-pattern-cards-');
		const patternRel = 'specimens/patterns/error-recovery/pattern.json';
		await mkdir(join(root, 'specimens', 'patterns', 'error-recovery'), { recursive: true });
		await writeFile(
			join(root, patternRel),
			JSON.stringify(
				{
					name: 'error-recovery',
					title: 'Error recovery (local fork)',
					approvalStatus: 'proposed',
					keep: [{ id: 'k1', statement: 'Show actionable suggestion.' }],
				},
				null,
				2
			)
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify(
				{
					specimens: [
						{ id: 'sample', title: 'Test/Sample', module: './sample.ts', exportName: 'Sample' },
					],
				},
				null,
				2
			)
		);

		// Scenario 06 step 5: approving fork card sets approvalStatus='approved' and activates patternBindings.
		const forkCard = makeCard({
			card: 'card-f0rk00000001',
			scope: 'guidance',
			owner: 'company',
			patternAction: {
				kind: 'fork',
				library: 'local',
				pattern: 'error-recovery',
				patternPath: patternRel,
				source: 'afd-defaults/error-recovery',
				bind: true,
				configPath: 'specimen.config.json',
			},
		});
		await writeCardRecord(root, forkCard);
		const forkDecision = await recordDecision(
			root,
			{ card: forkCard.card, chosen: 'approve', reason: 'Approve local error-recovery override.' },
			personOptions
		);
		expect('decision' in forkDecision && forkDecision.appliedPatterns).toEqual([
			'local/error-recovery',
		]);
		const updatedPattern = JSON.parse(await readFile(join(root, patternRel), 'utf8')) as {
			approvalStatus: string;
		};
		expect(updatedPattern.approvalStatus).toBe('approved');
		const updatedConfig = JSON.parse(
			await readFile(join(root, 'specimen.config.json'), 'utf8')
		) as { patternBindings?: Record<string, string> };
		expect(updatedConfig.patternBindings).toEqual({
			'afd-defaults/error-recovery': 'local/error-recovery',
		});
		// Reloading the updated config through parseConfig succeeds without unrecognized-key errors.
		expect(parseConfig(updatedConfig).patternBindings).toEqual({
			'afd-defaults/error-recovery': 'local/error-recovery',
		});

		// Scenario 07 steps 5-6: merge card verifies pinned upstream version + complete statement digests and refuses UPSTREAM_CHANGED.
		const upstreamRel = 'upstream/error-recovery/pattern.json';
		await mkdir(join(root, 'upstream', 'error-recovery'), { recursive: true });
		const stmtText = 'Show actionable recovery suggestion.';
		const v1Text = JSON.stringify({
			name: 'error-recovery',
			version: '1.1.0',
			keep: [{ id: 'k1', text: stmtText }],
		});
		await writeFile(join(root, upstreamRel), v1Text);
		const v1Digest = `sha256:${createHash('sha256').update(stmtText, 'utf8').digest('hex')}`;

		const mergeCard = makeCard({
			card: 'card-m3rg00000001',
			scope: 'guidance',
			owner: 'company',
			patternAction: {
				kind: 'merge',
				library: 'local',
				pattern: 'error-recovery',
				patternPath: patternRel,
				upstreamLibrary: 'afd-defaults',
				upstreamPattern: 'error-recovery',
				upstreamVersion: '1.1.0',
				upstreamDigests: { k1: v1Digest },
				upstreamPath: upstreamRel,
				stagedPattern: {
					name: 'error-recovery',
					title: 'Error recovery (merged 1.1.0)',
					approvalStatus: 'proposed',
					keep: [{ id: 'k1', text: stmtText }],
				},
			},
		});
		await writeCardRecord(root, mergeCard);

		// 1. Version bump alone triggers UPSTREAM_CHANGED even with identical statement text.
		await writeFile(
			join(root, upstreamRel),
			JSON.stringify({
				name: 'error-recovery',
				version: '1.2.0',
				keep: [{ id: 'k1', text: stmtText }],
			})
		);
		await expect(
			recordDecision(
				root,
				{ card: mergeCard.card, chosen: 'approve', reason: 'Apply upstream 1.1.0 merge.' },
				personOptions
			)
		).rejects.toMatchObject({ code: 'UPSTREAM_CHANGED' });

		// 2. Newly added upstream statement triggers UPSTREAM_CHANGED.
		await writeFile(
			join(root, upstreamRel),
			JSON.stringify({
				name: 'error-recovery',
				version: '1.1.0',
				keep: [
					{ id: 'k1', text: stmtText },
					{ id: 'k2', text: 'Brand new upstream requirement.' },
				],
			})
		);
		await expect(
			recordDecision(
				root,
				{ card: mergeCard.card, chosen: 'approve', reason: 'Apply upstream 1.1.0 merge.' },
				personOptions
			)
		).rejects.toMatchObject({ code: 'UPSTREAM_CHANGED' });

		// 3. Batch atomicity: if card 2 fails UPSTREAM_CHANGED, card 1 is NOT committed on disk.
		const cleanSibling = makeCard({ card: 'card-at0m00000001', severity: 'minor' });
		await writeCardRecord(root, cleanSibling);
		await expect(
			recordDecision(
				root,
				{
					cards: [cleanSibling.card, mergeCard.card],
					chosen: 'approve',
					reason: 'Batch with stale merge card.',
				},
				personOptions
			)
		).rejects.toMatchObject({ code: 'UPSTREAM_CHANGED' });
		expect((await readCardRecord(root, cleanSibling.card)).status).toBe('open');

		// 4. Restore pinned upstream content -> STALE_CARD triggers if expectedCardDigests mismatches.
		await writeFile(join(root, upstreamRel), v1Text);
		await expect(
			recordDecision(
				root,
				{ card: mergeCard.card, chosen: 'approve', reason: 'Apply verified upstream 1.1.0 merge.' },
				{ ...personOptions, expectedCardDigests: { [mergeCard.card]: 'sha256:stale' } }
			)
		).rejects.toMatchObject({ code: 'STALE_CARD' });

		// Matching expectedCardDigests succeeds and applies stagedPattern with approvalStatus='approved'.
		const mergeDec = await recordDecision(
			root,
			{ card: mergeCard.card, chosen: 'approve', reason: 'Apply verified upstream 1.1.0 merge.' },
			{
				...personOptions,
				expectedCardDigests: { [mergeCard.card]: computeCardDigest(mergeCard) },
			}
		);
		expect('decision' in mergeDec && mergeDec.appliedPatterns).toEqual(['local/error-recovery']);
		const mergedPattern = JSON.parse(await readFile(join(root, patternRel), 'utf8')) as {
			title: string;
			approvalStatus: string;
		};
		expect(mergedPattern).toMatchObject({
			title: 'Error recovery (merged 1.1.0)',
			approvalStatus: 'approved',
		});
	});

	it('supports Scenario 11 step 4 (keep-waiver card), Mode 3 provisional panel settlement with fail-closed AUTHOR_CANNOT_DECIDE, cursor stability, and symlink confinement', async () => {
		const root = await makeRoot('specimen-c2-edge-');

		// Scenario 11 step 4: keep-waiver card approval.
		const waiverCard = makeCard({
			card: 'card-wa1v00000001',
			scope: 'guidance',
			owner: 'company',
			what: 'Waive upstream keep statement k-shortcut',
			why: {
				findings: [{ summary: 'Host reserves Cmd+K globally.', evidence: 'observed' }],
				reviewerCount: 3,
				split: '3-0',
				trigger: 'keep-waiver',
			},
		});
		await writeCardRecord(root, waiverCard);
		const waiverDec = await recordDecision(
			root,
			{
				card: waiverCard.card,
				chosen: 'approve',
				reason: 'Global shell owns Cmd+K; waiver documented.',
			},
			personOptions
		);
		expect('decision' in waiverDec && waiverDec.chosen).toBe('approve');

		// Cursor pagination stays valid even after the cursor card leaves the open queue.
		const cur1 = makeCard({ card: 'card-111111111111', severity: 'major' });
		const cur2 = makeCard({ card: 'card-222222222222', severity: 'major' });
		const cur3 = makeCard({ card: 'card-333333333333', severity: 'minor' });
		await writeCardRecord(root, cur1);
		await writeCardRecord(root, cur2);
		await writeCardRecord(root, cur3);
		const p1 = await listDesignCards(root, { limit: 1 });
		expect(p1.next).toBe(cur1.card);
		await recordDecision(
			root,
			{ card: cur1.card, chosen: 'approve', reason: 'Decided mid-queue.' },
			personOptions
		);
		const p2 = await listDesignCards(root, { limit: 2, after: p1.next });
		expect(p2.cards.map((c) => c.card)).toEqual([cur2.card, cur3.card]);

		// Mode 3 provisional panel settlement: server-derived changeAuthor is authoritative and fails closed.
		const resolveReviewItem = async (item: string) => ({
			entry: { item, fingerprint: 'fp-1' },
			afterSet: 'set-0123456789ab',
			touchedChoices: [],
			question: 'Accept spacing tweak?',
		});
		// Missing server-derived changeAuthor fails closed with AUTHOR_CANNOT_DECIDE.
		await expect(
			recordDecision(
				root,
				{
					items: ['changed:abc:def:set-111111111111..set-0123456789ab'],
					chosen: 'accept',
					reason: 'Attempting without server changeAuthor.',
					provisional: true,
					panel: { reviewers: ['r1', 'r2', 'r3', 'r4', 'r5'], split: '5-0' },
					changeAuthor: 'spoofed-other',
				},
				{ actorId: 'panel-reviewer-bot', resolveReviewItem }
			)
		).rejects.toMatchObject({ code: 'AUTHOR_CANNOT_DECIDE' });

		// Caller changeAuthor cannot override server-derived options.changeAuthor.
		await expect(
			recordDecision(
				root,
				{
					items: ['changed:abc:def:set-111111111111..set-0123456789ab'],
					chosen: 'accept',
					reason: 'Attempting to override server changeAuthor.',
					provisional: true,
					panel: { reviewers: ['r1', 'r2', 'r3', 'r4', 'r5'], split: '5-0' },
					changeAuthor: 'different-author',
				},
				{ actorId: 'agent-author-1', changeAuthor: 'agent-author-1', resolveReviewItem }
			)
		).rejects.toMatchObject({ code: 'AUTHOR_CANNOT_DECIDE' });

		// Author sitting on panel.reviewers is also refused with AUTHOR_CANNOT_DECIDE.
		await expect(
			recordDecision(
				root,
				{
					items: ['changed:abc:def:set-111111111111..set-0123456789ab'],
					chosen: 'accept',
					reason: 'Author listed as panel reviewer.',
					provisional: true,
					panel: { reviewers: ['r1', 'agent-author-1', 'r3', 'r4', 'r5'], split: '5-0' },
				},
				{ actorId: 'panel-reviewer-bot', changeAuthor: 'agent-author-1', resolveReviewItem }
			)
		).rejects.toMatchObject({ code: 'AUTHOR_CANNOT_DECIDE' });

		// Independent reviewer + server-derived changeAuthor succeeds.
		const provDec = await recordDecision(
			root,
			{
				items: ['changed:abc:def:set-111111111111..set-0123456789ab'],
				chosen: 'accept',
				reason: 'All 5 independent panel reviewers agreed.',
				provisional: true,
				panel: { reviewers: ['r1', 'r2', 'r3', 'r4', 'r5'], split: '5-0' },
				changeAuthor: 'agent-author-1',
			},
			{
				actorId: 'panel-reviewer-bot',
				changeAuthor: 'agent-author-1',
				resolveReviewItem,
			}
		);
		expect('decision' in provDec && provDec.provisional).toBe(true);
		const provDecisionId = 'decision' in provDec ? provDec.decision : '';
		const provFetched = await getDecision(root, { decision: provDecisionId });
		expect(provFetched).toMatchObject({
			kind: 'answer',
			provisional: true,
			decidedBy: {
				kind: 'panel',
				reviewers: ['r1', 'r2', 'r3', 'r4', 'r5'],
				split: '5-0',
			},
		});

		// Provisional panel decision is rejected by design-release (DECISION_NOT_APPROVED).
		await recordDecision(
			root,
			{ card: cur2.card, chosen: 'defer', reason: 'Defer.' },
			personOptions
		);
		await recordDecision(
			root,
			{ card: cur3.card, chosen: 'defer', reason: 'Defer.' },
			personOptions
		);
		await expect(
			recordDesignRelease(root, { release: '2.0.0', decisions: [provDecisionId] }, personOptions)
		).rejects.toMatchObject({ code: 'DECISION_NOT_APPROVED' });

		// Contained symlinked card is discovered by readAllCards (never silently omitted).
		const targetCardDir = join(root, 'specimens', 'linked-cards');
		await mkdir(targetCardDir, { recursive: true });
		const linkedCard = makeCard({ card: 'card-11nk00000001', what: 'Contained symlinked card' });
		const linkedTarget = join(targetCardDir, 'linked.json');
		await writeFile(linkedTarget, JSON.stringify(linkedCard));
		await symlink(linkedTarget, join(root, CARDS_DIR, `${linkedCard.card}.json`));
		const discoveredCards = await readAllCards(root);
		expect(discoveredCards.map((c) => c.card)).toContain(linkedCard.card);

		// Contained symlinked release manifest is discovered by readAllReleases.
		const waiverDecId = 'decision' in waiverDec ? waiverDec.decision : '';
		await recordDecision(
			root,
			{ card: linkedCard.card, chosen: 'defer', reason: 'Defer.' },
			personOptions
		);
		await recordDesignRelease(root, { release: '2.0.0', decisions: [waiverDecId] }, personOptions);
		const linkedRelDir = join(root, 'specimens', 'linked-releases');
		await mkdir(linkedRelDir, { recursive: true });
		const linkedRelPath = join(linkedRelDir, '2.0.1.json');
		await writeFile(
			linkedRelPath,
			JSON.stringify({
				version: 1,
				release: '2.0.1',
				scope: 'all',
				releasedAt: new Date().toISOString(),
				decisions: [waiverDecId],
				releasedBy: { kind: 'person', id: 'alice', channel: 'cli' },
			})
		);
		await symlink(linkedRelPath, join(root, RELEASES_DIR, '2.0.1.json'));
		const discoveredReleases = await readAllReleases(root);
		expect(discoveredReleases.map((r) => r.release)).toContain('2.0.1');

		// Symlink escape confinement for cards directory.
		const outside = await makeRoot('specimen-outside-');
		const escapeRoot = await makeRoot('specimen-escape-');
		await mkdir(join(escapeRoot, 'specimens'), { recursive: true });
		await symlink(outside, join(escapeRoot, CARDS_DIR));
		await expect(writeCardRecord(escapeRoot, makeCard())).rejects.toThrow(/escapes/i);
	});
});
