import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { listDesignCards, writeCardRecord } from './cards.js';
import { recordDecision } from './decisions.js';
import { runDesignObserve } from './observe.js';
import { recordDesignRelease } from './releases.js';
import type { DesignCardRecord } from './types.js';

const tempDirs: string[] = [];

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) await rm(dir, { recursive: true, force: true });
	}
});

const personOptions = {
	decidedBy: { kind: 'person' as const, id: 'human-owner', channel: 'mcp-relay' as const },
	humanConfirmed: true,
	invokingActorKind: 'person' as const,
};

function makeCard(cardId: string): DesignCardRecord {
	return {
		card: cardId,
		scope: 'interface',
		what: 'Show clear substitute option when book is out of stock',
		owner: 'product',
		touches: ['checkout-out-of-stock', 'checkout.substitutes'],
		severity: 'major',
		visual: { kind: 'transcript', summary: 'Substitute picker beside unavailable title.' },
		why: {
			findings: [{ summary: 'Users missed substitute option', evidence: 'observed' }],
			evidenceForBothSides: {
				for: ['Keeps checkout compact'],
				against: ['Low-vision users missed substitute banner'],
			},
			reviewerCount: 5,
			split: '3-2',
			trigger: 'split-3-to-2',
		},
		effect: {
			gatesBefore: { passed: 1, failed: 0 },
			gatesAfter: { passed: 1, failed: 0 },
			checksSummary: 'All gates passed.',
			regression: false,
		},
		risk: { affects: ['checkout-out-of-stock'], undoable: true },
		status: 'open',
		createdAt: '2030-05-10T10:00:00.000Z',
	};
}

async function makeBookshopWorkspace(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	await mkdir(join(dir, 'scenarios'), { recursive: true });
	await mkdir(join(dir, 'journals'), { recursive: true });
	await writeFile(
		join(dir, 'commands.json'),
		JSON.stringify({
			commands: ['order-create', 'order-cancel', 'stock-list', 'catalog-import', 'member-delete'],
		})
	);
	await writeFile(
		join(dir, 'scenarios', 'checkout-out-of-stock.scenario.yaml'),
		[
			'name: Checkout out of stock',
			'steps:',
			'  - description: Check stock',
			'    command: stock-list',
			'    expect: { success: true }',
			'  - description: Place order',
			'    command: order-create',
			'    expect: { success: true }',
			'',
		].join('\n')
	);
	await writeFile(
		join(dir, 'specimen.config.json'),
		JSON.stringify({
			commandManifest: './commands.json',
			panel: { scenariosDir: './scenarios' },
		})
	);
	return dir;
}

describe('Phase D1 — design-observe and unmeasured adoption reports', () => {
	it('satisfies Scenario 10: commands-only reports succeed and name unmeasured areas including panel-walks', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-d1-s10-'));
		tempDirs.push(root);
		await writeFile(join(root, 'commands.json'), JSON.stringify({ commands: ['order-create'] }));
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({ commandManifest: './commands.json' })
		);
		const bench = await createSpecimenBench({ root });
		try {
			// Step 1: design-states succeeds on commands-only product and names screen-gates
			const states = await bench.designStates({ commands: ['order-create'] });
			expect(states.states[0]?.command).toBe('order-create');
			expect(states.unmeasured[0]?.area).toBe('screen-gates');
			expect(states.unmeasured[0]?.reason).toContain('specimen');
			expect(states.unmeasured[0]?.addToMeasure).toContain('specimen-capture');

			// Step 2: design-card-list succeeds with no panel or journal configured and names panel-walks first
			const queue = await bench.listDesignCards({ scope: 'all' });
			expect(queue.page).toContain('cards.html');
			expect(queue.unmeasured[0]?.area).toBe('panel-walks');
			expect(queue.unmeasured[0]?.addToMeasure).toContain('panel-walk');

			// A rogue file in specimens/walks/ or a broken/invalid symlink in .specimen/walks/ does NOT clear panel-walks
			await mkdir(join(root, 'specimens', 'walks'), { recursive: true });
			await writeFile(join(root, 'specimens', 'walks', 'walk-000000000001.json'), '{}');
			await mkdir(join(root, '.specimen', 'walks'), { recursive: true });
			await writeFile(join(root, '.specimen', 'walks', 'not-a-walk.json'), '{}');
			await symlink(
				join(root, '.specimen', 'walks', 'missing-target.json'),
				join(root, '.specimen', 'walks', 'walk-000000000002.json')
			);
			const stillMissingWalk = await listDesignCards(root, { scope: 'all' });
			expect(stillMissingWalk.unmeasured[0]?.area).toBe('panel-walks');

			// Once a real walk record exists under .specimen/walks/walk-<12>.json, panel-walks clears
			await writeFile(join(root, '.specimen', 'walks', 'walk-000000000001.json'), '{}');
			const afterWalk = await listDesignCards(root, { scope: 'all' });
			expect(afterWalk.unmeasured.some((u) => u.area === 'panel-walks')).toBe(false);
		} finally {
			await bench.close();
		}
	});

	it('satisfies Scenario 12: DECISION_NOT_FOUND, NOT_RELEASED, JOURNAL_NOT_FOUND, and before/after post-release observation', async () => {
		const root = await makeBookshopWorkspace('specimen-d1-s12-');

		// Create two approved card decisions: one unreleased, one released with meantToFix
		await writeCardRecord(root, makeCard('card-000000000001'));
		const unreleased = await recordDecision(
			root,
			{
				card: 'card-000000000001',
				chosen: 'approve',
				reason: 'Approved but not released yet.',
			},
			{ ...personOptions, now: () => new Date('2030-05-11T10:00:00.000Z') }
		);
		if ('decisions' in unreleased) throw new Error('Expected single decision');

		await writeCardRecord(root, makeCard('card-000000000002'));
		const releasedDec = await recordDecision(
			root,
			{
				card: 'card-000000000002',
				chosen: 'approve',
				reason: 'Promoted inline substitute picker to reduce checkout drop-off.',
				meantToFix: { job: 'checkout-out-of-stock', target: 'checkout.substitutes' },
			},
			{ ...personOptions, now: () => new Date('2030-05-11T12:00:00.000Z') }
		);
		if ('decisions' in releasedDec) throw new Error('Expected single decision');

		await recordDesignRelease(
			root,
			{
				release: '2030.05.12',
				decisions: [releasedDec.decision],
				releasedAt: '2030-05-12T00:00:00.000Z',
			},
			personOptions
		);

		// Pre-release journal: 2 runs, 1 failed + repeated + outside step (50% completion)
		await writeFile(
			join(root, 'journals', 'pre-release.jsonl'),
			[
				JSON.stringify({
					timestamp: '2030-05-11T18:00:00.000Z',
					runId: 'pre-1',
					job: 'checkout-out-of-stock',
					command: 'stock-list',
					success: true,
				}),
				JSON.stringify({
					timestamp: '2030-05-11T18:00:05.000Z',
					runId: 'pre-1',
					job: 'checkout-out-of-stock',
					command: 'stock-list',
					success: true,
				}),
				JSON.stringify({
					timestamp: '2030-05-11T18:00:10.000Z',
					runId: 'pre-1',
					job: 'checkout-out-of-stock',
					command: 'order-cancel',
					success: true,
				}),
				JSON.stringify({
					timestamp: '2030-05-11T18:00:15.000Z',
					runId: 'pre-1',
					job: 'checkout-out-of-stock',
					command: 'order-create',
					success: false,
				}),
				JSON.stringify({
					timestamp: '2030-05-11T19:00:00.000Z',
					runId: 'pre-2',
					job: 'checkout-out-of-stock',
					command: 'stock-list',
					success: true,
				}),
				JSON.stringify({
					timestamp: '2030-05-11T19:00:05.000Z',
					runId: 'pre-2',
					job: 'checkout-out-of-stock',
					command: 'order-create',
					success: true,
				}),
			].join('\n')
		);

		// Post-release journal: 2 clean runs after releasedAt + 1 pre-release run (must be ignored!) + 1 unrelated job run (must be ignored!)
		await writeFile(
			join(root, 'journals', 'post-release.jsonl'),
			[
				// Pre-release run must be excluded
				JSON.stringify({
					timestamp: '2030-05-11T23:59:59.000Z',
					runId: 'straddle-pre',
					job: 'checkout-out-of-stock',
					command: 'order-create',
					success: false,
				}),
				// Unrelated job must be excluded when meantToFix.job is set
				JSON.stringify({
					timestamp: '2030-05-12T05:00:00.000Z',
					runId: 'other-job-1',
					job: 'import-book-shipment',
					command: 'catalog-import',
					success: false,
				}),
				// Post-release clean runs
				JSON.stringify({
					timestamp: '2030-05-12T08:00:00.000Z',
					runId: 'post-1',
					job: 'checkout-out-of-stock',
					command: 'stock-list',
					success: true,
				}),
				JSON.stringify({
					timestamp: '2030-05-12T08:00:04.000Z',
					runId: 'post-1',
					job: 'checkout-out-of-stock',
					command: 'order-create',
					success: true,
				}),
				JSON.stringify({
					timestamp: '2030-05-12T09:00:00.000Z',
					runId: 'post-2',
					job: 'checkout-out-of-stock',
					command: 'stock-list',
					success: true,
				}),
				JSON.stringify({
					timestamp: '2030-05-12T09:00:03.000Z',
					runId: 'post-2',
					job: 'checkout-out-of-stock',
					command: 'order-create',
					success: true,
				}),
			].join('\n')
		);

		const bench = await createSpecimenBench({ root });
		try {
			// Step 1: Unknown decision -> DECISION_NOT_FOUND with decision-list suggestion
			await expect(
				bench.designObserve({
					decision: 'dec-000000000000',
					journal: 'journals/post-release.jsonl',
				})
			).rejects.toMatchObject({
				code: 'DECISION_NOT_FOUND',
				suggestion: expect.stringContaining('decision-list'),
			});

			// Step 2: Unreleased decision -> NOT_RELEASED with design-release suggestion
			await expect(
				bench.designObserve({
					decision: unreleased.decision,
					journal: 'journals/post-release.jsonl',
				})
			).rejects.toMatchObject({
				code: 'NOT_RELEASED',
				suggestion: expect.stringContaining('design-release'),
			});

			// Step 3: Missing journal -> JOURNAL_NOT_FOUND with journal suggestion
			await expect(
				bench.designObserve({
					decision: releasedDec.decision,
					journal: 'journals/missing.jsonl',
				})
			).rejects.toMatchObject({
				code: 'JOURNAL_NOT_FOUND',
				suggestion: expect.stringContaining('journal'),
			});

			// Step 4: Released decision with before & after journals -> status: improved
			const observed = await bench.designObserve({
				decision: releasedDec.decision,
				journal: 'journals/post-release.jsonl',
				beforeJournal: 'journals/pre-release.jsonl',
			});
			expect(observed.decision).toBe(releasedDec.decision);
			expect(observed.releasedAt).toBe('2030-05-12T00:00:00.000Z');
			expect(observed.meantToFix).toEqual({
				job: 'checkout-out-of-stock',
				target: 'checkout.substitutes',
			});
			expect(observed.status).toBe('improved');
			expect(observed.metrics).toEqual({
				runs: 2,
				completionRate: 1,
				unexpectedFailures: 0,
				repeats: 0,
				outsideSteps: 0,
				before: {
					runs: 2,
					completionRate: 0.5,
					unexpectedFailures: 1,
					repeats: 1,
					outsideSteps: 1,
				},
			});
			expect(observed.note).toContain('not proof');
			expect(observed.unmeasured[0]?.area).toBe('perception-only-trouble');
		} finally {
			await bench.close();
		}
	});

	it('handles insufficient-data, regressed, unchanged, JSON arrays, straddling runs, and path confinement', async () => {
		const root = await makeBookshopWorkspace('specimen-d1-edges-');
		await writeCardRecord(root, makeCard('card-edge00000001'));
		const dec = await recordDecision(
			root,
			{
				card: 'card-edge00000001',
				chosen: 'approve',
				reason: 'Track edge cases.',
				meantToFix: { job: 'checkout-out-of-stock', target: 'checkout.flow' },
			},
			{ ...personOptions, now: () => new Date('2030-05-11T12:00:00.000Z') }
		);
		if ('decisions' in dec) throw new Error('Expected single decision');
		await recordDesignRelease(
			root,
			{
				release: '2030.05.12-rc1',
				decisions: [dec.decision],
				releasedAt: '2030-05-12T00:00:00.000Z',
			},
			personOptions
		);

		// 1. Journal containing only pre-release entries + a straddling run (started before releasedAt) -> insufficient-data, runs: 0
		await writeFile(
			join(root, 'journals', 'only-old.jsonl'),
			[
				JSON.stringify({
					timestamp: '2030-05-11T23:55:00.000Z',
					runId: 'straddle-1',
					job: 'checkout-out-of-stock',
					command: 'stock-list',
					success: true,
				}),
				JSON.stringify({
					timestamp: '2030-05-12T00:01:00.000Z',
					runId: 'straddle-1',
					job: 'checkout-out-of-stock',
					command: 'order-create',
					success: true,
				}),
			].join('\n')
		);
		const insufficient = await runDesignObserve(root, {
			decision: dec.decision,
			journal: 'journals/only-old.jsonl',
		});
		expect(insufficient.status).toBe('insufficient-data');
		expect(insufficient.metrics.runs).toBe(0);
		expect(insufficient.note).toContain('not proof');
		expect(insufficient.unmeasured[0]?.area).toBe('perception-only-trouble');
		expect(insufficient.unmeasured.some((u) => u.area === 'pre-release-baseline')).toBe(true);

		// 2. Regressed status from JSON array summary format + post-release contamination filtered from beforeJournal
		await writeFile(
			join(root, 'journals', 'before.json'),
			JSON.stringify([
				{
					timestamp: '2030-05-11T10:00:00.000Z',
					job: 'checkout-out-of-stock',
					completed: true,
					unexpectedFailures: 0,
					repeats: 0,
					outsideSteps: 0,
				},
				// Post-release entry in beforeJournal must be excluded
				{
					timestamp: '2030-05-13T10:00:00.000Z',
					job: 'checkout-out-of-stock',
					completed: false,
					unexpectedFailures: 5,
					repeats: 5,
					outsideSteps: 5,
				},
			])
		);
		await writeFile(
			join(root, 'journals', 'regressed.json'),
			JSON.stringify([
				{
					timestamp: '2030-05-12T10:00:00.000Z',
					job: 'checkout-out-of-stock',
					completed: false,
					unexpectedFailures: 2,
					repeats: 1,
					outsideSteps: 0,
				},
			])
		);
		const regressed = await runDesignObserve(root, {
			decision: dec.decision,
			journal: 'journals/regressed.json',
			beforeJournal: 'journals/before.json',
		});
		expect(regressed.status).toBe('regressed');
		expect(regressed.metrics.before?.runs).toBe(1);
		expect(regressed.metrics.before?.completionRate).toBe(1);

		// 3. Missing baseline returns insufficient-data (never unchanged) with distinct unmeasured message;
		//    empty beforeJournal also returns insufficient-data with distinct message.
		const noBaseline = await runDesignObserve(root, {
			decision: dec.decision,
			journal: 'journals/regressed.json',
		});
		expect(noBaseline.status).toBe('insufficient-data');
		expect(noBaseline.metrics.runs).toBe(1);
		expect(noBaseline.metrics.before).toBeUndefined();
		expect(noBaseline.unmeasured.find((u) => u.area === 'pre-release-baseline')?.reason).toContain(
			'No beforeJournal was supplied'
		);

		await writeFile(join(root, 'journals', 'empty-before.jsonl'), '');
		const emptyBaseline = await runDesignObserve(root, {
			decision: dec.decision,
			journal: 'journals/regressed.json',
			beforeJournal: 'journals/empty-before.jsonl',
		});
		expect(emptyBaseline.status).toBe('insufficient-data');
		expect(emptyBaseline.metrics.before?.runs).toBe(0);
		expect(
			emptyBaseline.unmeasured.find((u) => u.area === 'pre-release-baseline')?.reason
		).toContain('zero qualifying pre-release runs');

		// 4. Canonical AFD JournalEntry format (result.success, error: null, traceId, context.job, expectedRefusal),
		//    metadata rows ignored, trailing summary merged, undated/invalid timestamps excluded,
		//    explicit counters + executedCommands, and `..`-prefixed contained filename accepted.
		await writeFile(
			join(root, 'journals', '..canonical-before.jsonl'),
			[
				// Heartbeat/metadata row must be ignored
				JSON.stringify({ type: 'heartbeat', timestamp: '2030-05-11T10:00:00.000Z' }),
				// Invalid timestamp row must be excluded
				JSON.stringify({
					seq: 1,
					timestamp: 'not-a-date',
					traceId: 'trace-invalid',
					command: 'stock-list',
					context: { job: 'checkout-out-of-stock' },
					result: { success: true, error: null },
				}),
				// Canonical AFD JournalEntry with result.success: false -> failure
				JSON.stringify({
					seq: 2,
					timestamp: '2030-05-11T12:00:00.000Z',
					traceId: 'trace-before-1',
					command: 'stock-list',
					context: { job: 'checkout-out-of-stock' },
					result: { success: true, error: null },
				}),
				JSON.stringify({
					seq: 3,
					timestamp: '2030-05-11T12:00:05.000Z',
					traceId: 'trace-before-1',
					command: 'order-create',
					context: { job: 'checkout-out-of-stock' },
					result: { success: false, error: { code: 'OUT_OF_STOCK', message: 'Sold out' } },
				}),
			].join('\n')
		);
		await writeFile(
			join(root, 'journals', 'canonical-after.jsonl'),
			[
				// Heartbeat row ignored
				JSON.stringify({ type: 'session-start', timestamp: '2030-05-12T01:00:00.000Z' }),
				// Canonical AFD JournalEntry with error: null AND expectedRefusal: true -> 0 unexpected failures, 100% completion
				JSON.stringify({
					seq: 10,
					timestamp: '2030-05-12T08:00:00.000Z',
					traceId: 'trace-after-1',
					command: 'stock-list',
					context: { job: 'checkout-out-of-stock' },
					result: { success: true, error: null },
				}),
				JSON.stringify({
					seq: 11,
					timestamp: '2030-05-12T08:00:02.000Z',
					traceId: 'trace-after-1',
					command: 'order-create',
					context: { job: 'checkout-out-of-stock' },
					expectedRefusal: true,
					result: { success: false, error: { code: 'CONFIRM_SUBSTITUTE' } },
				}),
				JSON.stringify({
					seq: 12,
					timestamp: '2030-05-12T08:00:05.000Z',
					traceId: 'trace-after-1',
					command: 'order-create',
					context: { job: 'checkout-out-of-stock' },
					result: { success: true, error: null },
				}),
				// Trailing summary sharing traceId merges instead of double-counting
				JSON.stringify({
					timestamp: '2030-05-12T08:00:06.000Z',
					traceId: 'trace-after-1',
					unexpectedFailures: 0,
					repeats: 0,
					outsideSteps: 0,
				}),
				// Run with an undated event must be excluded from post-release metrics
				JSON.stringify({
					timestamp: '2030-05-12T09:00:00.000Z',
					traceId: 'trace-undated',
					command: 'stock-list',
					context: { job: 'checkout-out-of-stock' },
					result: { success: true },
				}),
				JSON.stringify({
					traceId: 'trace-undated',
					command: 'order-create',
					context: { job: 'checkout-out-of-stock' },
					result: { success: false },
				}),
			].join('\n')
		);
		const bench = await createSpecimenBench({ root });
		try {
			const canonicalRes = await bench.designObserve({
				decision: dec.decision,
				journal: 'journals/canonical-after.jsonl',
				beforeJournal: 'journals/..canonical-before.jsonl',
			});
			expect(canonicalRes.status).toBe('improved');
			expect(canonicalRes.metrics).toEqual({
				runs: 1,
				completionRate: 1,
				unexpectedFailures: 0,
				repeats: 0,
				outsideSteps: 0,
				before: {
					runs: 1,
					completionRate: 0,
					unexpectedFailures: 1,
					repeats: 0,
					outsideSteps: 0,
				},
			});
		} finally {
			await bench.close();
		}

		// 5. Untagged traffic with no scenario for meantToFix.job is NOT blindly attributed
		await writeFile(
			join(root, 'journals', 'untagged.jsonl'),
			JSON.stringify({
				timestamp: '2030-05-12T10:00:00.000Z',
				command: 'unrelated-cmd',
				result: { success: true },
			})
		);
		const unattributed = await runDesignObserve(root, {
			decision: dec.decision,
			journal: 'journals/untagged.jsonl',
		});
		expect(unattributed.status).toBe('insufficient-data');
		expect(unattributed.metrics.runs).toBe(0);
		expect(unattributed.unmeasured.some((u) => u.area === 'job-attribution')).toBe(true);

		// 6. Malformed JSONL throws VALIDATION_ERROR
		await writeFile(join(root, 'journals', 'broken.jsonl'), '{not json\n');
		await expect(
			runDesignObserve(root, { decision: dec.decision, journal: 'journals/broken.jsonl' })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

		// 7. Path traversal and symlink escape throw typed VALIDATION_ERROR
		await expect(
			runDesignObserve(root, { decision: dec.decision, journal: '../outside.jsonl' })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

		const outsideDir = await mkdtemp(join(tmpdir(), 'specimen-d1-outside-'));
		tempDirs.push(outsideDir);
		await writeFile(join(outsideDir, 'secret.jsonl'), '{}\n');
		await symlink(join(outsideDir, 'secret.jsonl'), join(root, 'journals', 'link.jsonl'));
		await expect(
			runDesignObserve(root, { decision: dec.decision, journal: 'journals/link.jsonl' })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
	});
});
