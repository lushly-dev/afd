import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { assertWalkTargetAllowed } from './panel-browser.js';
import {
	MODALITY_TOOL_POLICIES,
	type PanelWalkDriver,
	type PanelWalkResult,
} from './panel-types.js';
import {
	buildWalkPrompt,
	compareWalkReportsBlind,
	computeWalkPath,
	createModalityToolbox,
	enforceModalityTools,
	parseWalkEnding,
	readWalkRecord,
	WalkLimitError,
	writeWalkRecord,
} from './panel-walk.js';
import { panelWalkResultSchema } from './schema.js';

const cleanDriver: PanelWalkDriver = async (ctx) => {
	const firstTool = ctx.toolbox.allowedTools[0];
	if (firstTool) {
		await ctx.toolbox.invoke(firstTool);
	}
	return {
		transcript: `Walk for ${ctx.job} (${ctx.modality})\nDone.`,
		actions: ctx.toolbox.calls.length,
		journal: ctx.expectedSteps.map((command) => ({ command, success: true })),
		findings: [],
	};
};

describe('panel-walk (Phase C1 unit & sandbox contracts)', () => {
	let root: string;

	beforeAll(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-panel-walk-unit-')));
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('satisfies Scenario 04 end-to-end (all 6 steps), strips YAML steps from prompt, and injects appDate', async () => {
		const dir = join(root, 'bookshop');
		await mkdir(join(dir, 'scenarios'), { recursive: true });
		await writeFile(
			join(dir, 'scenarios', 'checkout-out-of-stock.scenario.yaml'),
			[
				'name: Checkout out of stock',
				'description: Try to buy an out-of-stock book and join the waiting list.',
				'startingState: Signed in on the catalogue page.',
				'steps:',
				'  - command: order-create',
				'    expect:',
				'      error: OUT_OF_STOCK',
				'  - command: waitlist-join',
			].join('\n')
		);
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify({
				panel: {
					personas: [
						{ id: 'p-pointer', modality: 'pointer', name: 'P1', stance: 'Quick' },
						{ id: 'p-keyboard', modality: 'keyboard', name: 'P3', stance: 'Methodical' },
						{ id: 'p-sr', modality: 'screen-reader', name: 'P4', stance: 'Exact' },
						{ id: 'p-lowvision', modality: 'low-vision', name: 'P5', stance: 'Patient' },
					],
				},
			})
		);

		const bench = await createSpecimenBench({ root: dir });
		try {
			// Step 1: screen-reader refuses mouse click & dom_query with MODALITY_FORBIDDEN
			await expect(
				bench.panelWalk(
					{
						job: 'checkout-out-of-stock',
						persona: 'p-sr',
						modality: 'screen-reader',
						target: 'http://127.0.0.1:4173',
						requestedTools: ['click', 'dom_query'],
					},
					{ driver: cleanDriver }
				)
			).rejects.toMatchObject({ code: 'MODALITY_FORBIDDEN' });

			// Step 2: clean screen-reader walk with appDate -> prompt includes appDate, strips YAML steps
			const walk1 = await bench.panelWalk(
				{
					job: 'checkout-out-of-stock',
					persona: 'p-sr',
					modality: 'screen-reader',
					target: 'http://127.0.0.1:4173',
					appDate: '2030-05-12',
				},
				{ driver: cleanDriver }
			);
			expect(panelWalkResultSchema.safeParse(walk1).success).toBe(true);
			expect(walk1.ending).toBe('done');
			expect(walk1.path.done).toBe(true);
			expect(walk1.path.deviations).toBe(0);
			expect(walk1.unmeasured[0]?.area).toBe('forced-colors');
			expect(walk1.unmeasured.some((u) => u.area === 'fixed-clock')).toBe(false);

			const rec1 = await readWalkRecord(dir, walk1.walk);
			expect(rec1?.prompt).toContain('Today in the application is 2030-05-12.');
			expect(rec1?.prompt).toContain('Try to buy an out-of-stock book and join the waiting list.');
			expect(rec1?.prompt).toContain('Starting state: Signed in on the catalogue page.');
			expect(rec1?.prompt).not.toContain('steps:');
			expect(rec1?.prompt).not.toContain('order-create');
			expect(rec1?.prompt).not.toContain('waitlist-join');
			expect(rec1?.prompt).not.toContain('OUT_OF_STOCK');
			expect(rec1?.allowedTools).toEqual([...MODALITY_TOOL_POLICIES['screen-reader'].allowedTools]);

			// Step 3: omitting appDate reports fixed-clock as unmeasured
			const walkNoDate = await bench.panelWalk(
				{
					job: 'checkout-out-of-stock',
					persona: 'p-sr',
					modality: 'screen-reader',
					target: 'http://127.0.0.1:4173',
				},
				{ driver: cleanDriver }
			);
			expect(walkNoDate.unmeasured.some((u) => u.area === 'fixed-clock')).toBe(true);

			// Step 4: unknown job / persona / baseline walk errors
			await expect(
				bench.panelWalk(
					{
						job: 'nonexistent-job',
						persona: 'p-sr',
						modality: 'screen-reader',
						target: 'http://127.0.0.1:4173',
					},
					{ driver: cleanDriver }
				)
			).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
			await expect(
				bench.panelWalk(
					{
						job: 'checkout-out-of-stock',
						persona: 'unknown-persona',
						modality: 'screen-reader',
						target: 'http://127.0.0.1:4173',
					},
					{ driver: cleanDriver }
				)
			).rejects.toMatchObject({ code: 'PERSONA_NOT_FOUND' });
			await expect(
				bench.panelWalk(
					{
						job: 'checkout-out-of-stock',
						persona: 'p-sr',
						modality: 'screen-reader',
						target: 'http://127.0.0.1:4173',
						baselineWalk: 'walk-000000000000',
					},
					{ driver: cleanDriver }
				)
			).rejects.toMatchObject({ code: 'WALK_NOT_FOUND' });

			// Step 5: valid requestedTools subset does NOT crash
			const subsetWalk = await bench.panelWalk(
				{
					job: 'checkout-out-of-stock',
					persona: 'p-sr',
					modality: 'screen-reader',
					target: 'http://127.0.0.1:4173',
					requestedTools: ['press', 'type'],
				},
				{ driver: cleanDriver }
			);
			expect(subsetWalk.ending).toBe('done');

			// Step 6: blind pairwise comparison against baselineWalk detects regression
			const failingDriver: PanelWalkDriver = async () => ({
				transcript: 'Walk stopped.\nStopped — silent live region hid status.',
				actions: 2,
				journal: [{ command: 'order-create', success: false }],
				findings: [
					{
						summary: 'Visible status update was never announced through a live region.',
						evidence: 'observed',
						where: 'checkout',
					},
				],
			});
			const regressed = await bench.panelWalk(
				{
					job: 'checkout-out-of-stock',
					persona: 'p-sr',
					modality: 'screen-reader',
					target: 'http://127.0.0.1:4173',
					appDate: '2030-05-12',
					baselineWalk: walk1.walk,
				},
				{ driver: failingDriver }
			);
			expect(regressed.ending).toBe('stopped');
			expect(regressed.comparison).toMatchObject({
				baselineWalk: walk1.walk,
				method: 'blind-pairwise-report',
				worse: 'current',
			});
		} finally {
			await bench.close();
		}
	});

	it('enforces network target URL allowlist and rejects SSRF / non-HTTP schemes', () => {
		expect(() => assertWalkTargetAllowed('http://127.0.0.1:4173')).not.toThrow();
		expect(() => assertWalkTargetAllowed('http://localhost:3000/app')).not.toThrow();
		expect(() => assertWalkTargetAllowed('http://[::1]:8080')).not.toThrow();
		expect(() => assertWalkTargetAllowed('https://169.254.169.254/latest/meta-data')).toThrow(
			/not allowed by network policy/
		);
		expect(() =>
			assertWalkTargetAllowed('https://staging.example.test/app', [
				'https://staging.example.test:443',
			])
		).not.toThrow();
		expect(() => assertWalkTargetAllowed('file:///etc/passwd')).toThrow(
			/Unsupported target scheme/
		);
		expect(() => assertWalkTargetAllowed('javascript:alert(1)')).toThrow(
			/Unsupported target scheme/
		);
		expect(() => assertWalkTargetAllowed('local://checkout')).toThrow(/Unsupported target scheme/);
	});

	it('confines scenarios, personas, and walk records against symlink escapes and bad walk IDs', async () => {
		const outside = join(root, 'outside-secret');
		await mkdir(outside, { recursive: true });
		await writeFile(join(outside, 'secret.yaml'), 'name: secret\n');
		await writeFile(join(outside, 'secret-persona.md'), 'Secret persona');

		const dir = join(root, 'symlink-escape');
		await mkdir(join(dir, 'scenarios'), { recursive: true });
		await mkdir(join(dir, 'personas'), { recursive: true });
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify({
				panel: {
					jobs: ['safe-job'],
					personas: [{ id: 'p-ptr', modality: 'pointer' }],
				},
			})
		);

		try {
			await symlink(join(outside, 'secret.yaml'), join(dir, 'scenarios', 'escaped-job.yaml'));
			await symlink(
				join(outside, 'secret-persona.md'),
				join(dir, 'personas', 'escaped-persona.md')
			);
			const bench = await createSpecimenBench({ root: dir });
			try {
				await expect(
					bench.panelWalk(
						{
							job: 'escaped-job',
							persona: 'p-ptr',
							modality: 'pointer',
							target: 'http://127.0.0.1:4173',
						},
						{ driver: cleanDriver }
					)
				).rejects.toThrow(/escapes workspace root/i);
				await expect(
					bench.panelWalk(
						{
							job: 'safe-job',
							persona: 'escaped-persona',
							modality: 'pointer',
							target: 'http://127.0.0.1:4173',
						},
						{ driver: cleanDriver }
					)
				).rejects.toThrow(/escapes workspace root/i);
			} finally {
				await bench.close();
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
		}

		// writeWalkRecord rejects invalid / traversal walk IDs
		await expect(
			writeWalkRecord(dir, {
				version: 1,
				walk: '../../escape',
				recordedUtc: new Date().toISOString(),
				target: 'http://127.0.0.1:4173',
				viewport: { width: 1280, height: 800 },
				allowedTools: ['click'],
				prompt: 'p',
				endingLine: 'Done.',
				transcript: 'Done.',
				journal: [],
				expectedSteps: [],
				result: {
					walk: '../../escape',
					job: 'j',
					persona: 'p',
					modality: 'pointer',
					ending: 'done',
					actions: 0,
					path: { done: true, failed: 0, repeats: 0, outside: 0, deviations: 0 },
					findings: [],
					unmeasured: [],
				},
			})
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
	});

	it('enforces maxActions cap and wall-clock deadline without silently clamping or blocking close', async () => {
		const dir = join(root, 'caps');
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, 'specimen.config.json'),
			JSON.stringify({
				panel: {
					jobs: ['job-cap'],
					personas: [{ id: 'p-ptr', modality: 'pointer' }],
				},
			})
		);

		const bench = await createSpecimenBench({ root: dir });
		try {
			// Toolbox hard cap stops execution on the 3rd call when maxActions = 2
			const capped = await bench.panelWalk(
				{
					job: 'job-cap',
					persona: 'p-ptr',
					modality: 'pointer',
					target: 'http://127.0.0.1:4173',
					maxActions: 2,
				},
				{
					driver: async (ctx) => {
						await ctx.toolbox.invoke('click');
						await ctx.toolbox.invoke('click');
						await ctx.toolbox.invoke('click'); // throws WalkLimitError
						return { transcript: 'Done.', findings: [] };
					},
				}
			);
			expect(capped.ending).toBe('stopped');
			expect(capped.actions).toBe(2);
			expect(capped.findings[0]?.summary).toContain('action cap');

			// Driver self-reporting more actions than maxActions is NOT silently clamped to Done
			const overReported = await bench.panelWalk(
				{
					job: 'job-cap',
					persona: 'p-ptr',
					modality: 'pointer',
					target: 'http://127.0.0.1:4173',
					maxActions: 3,
				},
				{
					driver: async () => ({
						transcript: 'Done.',
						actions: 10,
						findings: [],
					}),
				}
			);
			expect(overReported.ending).toBe('stopped');
			expect(overReported.actions).toBe(10);

			// Wall-clock deadline aborts hanging driver cleanly
			const timedOut = await bench.panelWalk(
				{
					job: 'job-cap',
					persona: 'p-ptr',
					modality: 'pointer',
					target: 'http://127.0.0.1:4173',
				},
				{
					timeoutMs: 40,
					driver: async (ctx) => {
						await new Promise<void>((resolve) => {
							ctx.signal?.addEventListener('abort', () => resolve(), { once: true });
						});
						return { transcript: 'Done.', findings: [] };
					},
				}
			);
			expect(timedOut.ending).toBe('stopped');
			expect(timedOut.findings[0]?.summary).toContain('deadline');
		} finally {
			await bench.close();
		}
	});

	it('enforces runtime modality sandboxing and includes double_click in low-vision forbiddenTools', async () => {
		expect(MODALITY_TOOL_POLICIES['low-vision'].forbiddenTools).toContain('double_click');
		expect(() => enforceModalityTools('low-vision', ['double_click'])).toThrow(/forbidden/);

		const srBox = createModalityToolbox('screen-reader', async (t) => ({ ok: t }), undefined, {
			maxActions: 2,
		});
		expect(srBox.showsScreenshot).toBe(false);
		await expect(srBox.invoke('screenshot')).rejects.toMatchObject({ code: 'MODALITY_FORBIDDEN' });
		await expect(srBox.invoke('dom_query')).rejects.toMatchObject({ code: 'MODALITY_FORBIDDEN' });
		await srBox.invoke('sr_read');
		await srBox.invoke('press', { key: 'Tab' });
		await expect(srBox.invoke('sr_move')).rejects.toBeInstanceOf(WalkLimitError);
	});

	it('computes Phase 0 journal path metrics with multiset outside, independent failures, and journal-backed done', () => {
		// Empty journal with Done. MUST NOT certify done when expectedSteps is non-empty
		expect(computeWalkPath([], ['order-create'], 'done')).toEqual({
			done: false,
			failed: 0,
			repeats: 0,
			outside: 0,
			deviations: 0,
		});

		// T4 one-at-a-time failure mode: command expected once called 3 times -> outside: 2
		expect(
			computeWalkPath(
				[
					{ command: 'request-decide', recordId: 'r1', success: true },
					{ command: 'request-decide', recordId: 'r2', success: true },
					{ command: 'request-decide', recordId: 'r3', success: true },
				],
				['request-decide'],
				'done'
			)
		).toEqual({
			done: true,
			failed: 0,
			repeats: 0,
			outside: 2,
			deviations: 2,
		});

		// Failed outside mutation counts BOTH failed AND outside (and repeated failed mutation counts repeats)
		expect(
			computeWalkPath(
				[
					{ command: 'outside-cmd', recordId: 'x1', success: false },
					{ command: 'outside-cmd', recordId: 'x1', success: false },
				],
				['expected-cmd'],
				'stopped'
			)
		).toEqual({
			done: false,
			failed: 2,
			repeats: 1,
			outside: 2,
			deviations: 5,
		});

		// Duplicate same-command expected steps without recordId do NOT false-repeat
		expect(
			computeWalkPath(
				[
					{ command: 'donation-correct', success: true },
					{ command: 'donation-correct', success: true },
				],
				['donation-correct', 'donation-correct'],
				'done'
			)
		).toEqual({
			done: true,
			failed: 0,
			repeats: 0,
			outside: 0,
			deviations: 0,
		});
	});

	it('strictly parses Done. and Stopped — <reason> endings and flags bare Stopped as malformed', () => {
		expect(parseWalkEnding('Checked page.\nDone.')).toEqual({
			ending: 'done',
			endingLine: 'Done.',
			malformed: false,
		});
		expect(parseWalkEnding('Tried.\nStopped — button was clipped.')).toEqual({
			ending: 'stopped',
			endingLine: 'Stopped — button was clipped.',
			malformed: false,
		});
		const bare = parseWalkEnding('Stopped');
		expect(bare.ending).toBe('stopped');
		expect(bare.malformed).toBe(true);
		expect(bare.endingLine).toContain('malformed ending line');
	});

	it('performs meaning-aware blind pairwise comparison (equal counts, stopped dominance, failed tiebreak, compatibility)', () => {
		const mk = (overrides: Partial<PanelWalkResult>): PanelWalkResult => ({
			walk: 'walk-aaaaaaaaaaaa',
			job: 'checkout',
			persona: 'p-sr',
			modality: 'screen-reader',
			ending: 'done',
			actions: 4,
			path: { done: true, failed: 0, repeats: 0, outside: 0, deviations: 0 },
			findings: [],
			unmeasured: [],
			...overrides,
		});

		// Stopped walk strictly dominates a completed walk even with 6 minor observations
		const stoppedWalk = mk({
			walk: 'walk-bbbbbbbbbbbb',
			ending: 'stopped',
			path: { done: false, failed: 0, repeats: 0, outside: 0, deviations: 0 },
		});
		const noisyCompleted = mk({
			findings: Array.from({ length: 6 }, (_, i) => ({
				summary: `Minor spacing note ${i}`,
				evidence: 'observed' as const,
				where: 'checkout',
			})),
		});
		expect(compareWalkReportsBlind(stoppedWalk, noisyCompleted).worse).toBe('current');
		expect(compareWalkReportsBlind(noisyCompleted, stoppedWalk).worse).toBe('baseline');

		// Equal-count reports: severe blocking observed trouble beats minor cosmetic note
		const blocking = mk({
			walk: 'walk-cccccccccccc',
			findings: [
				{
					summary: 'Visible status update was never announced through a live region.',
					evidence: 'observed',
					where: 'checkout',
				},
			],
		});
		const cosmetic = mk({
			walk: 'walk-dddddddddddd',
			findings: [
				{
					summary: 'Label wording felt slightly terse.',
					evidence: 'observed',
					where: 'checkout',
				},
			],
		});
		const eqCmp = compareWalkReportsBlind(blocking, cosmetic);
		expect(eqCmp.worse).toBe('current');
		expect(eqCmp.why).toContain('blocking trouble');

		// Failed-only tiebreak produces clean non-empty prose (never "...because it .")
		const failedTie = compareWalkReportsBlind(
			mk({
				walk: 'walk-eeeeeeeeeeee',
				path: { done: true, failed: 1, repeats: 0, outside: 0, deviations: 1 },
			}),
			mk({
				walk: 'walk-ffffffffffff',
				path: { done: true, failed: 0, repeats: 1, outside: 0, deviations: 1 },
			})
		);
		expect(failedTie.worse).toBe('current');
		expect(failedTie.why).toContain('failed commands');
		expect(failedTie.why).not.toContain('because it .');

		// Incompatible job/modality baseline is rejected
		expect(() =>
			compareWalkReportsBlind(
				mk({ modality: 'screen-reader' }),
				mk({ walk: 'walk-111111111111', modality: 'pointer' })
			)
		).toThrow(/incompatible/);

		// Custom blind judge receives anonymized Report A / Report B without walk IDs
		const custom = compareWalkReportsBlind(blocking, cosmetic, ({ reportA, reportB }) => {
			expect(reportA).not.toContain('walk-');
			expect(reportB).not.toContain('walk-');
			return { worse: 'same', why: 'Custom judge called.' };
		});
		expect(custom.why).toBe('Custom judge called.');
	});

	it('surfaces malformed persona JSON and persona markdown modality mismatch cleanly', async () => {
		const dir = join(root, 'persona-errors');
		await mkdir(join(dir, 'personas'), { recursive: true });
		await writeFile(join(dir, 'personas', 'bad-json.json'), '{not valid json');
		await writeFile(join(dir, 'personas', 'wrong-mod.md'), 'Modality: keyboard\n\nUses Tab only.');
		await writeFile(join(dir, 'specimen.config.json'), JSON.stringify({ panel: { jobs: ['j1'] } }));

		const bench = await createSpecimenBench({ root: dir });
		try {
			await expect(
				bench.panelWalk(
					{ job: 'j1', persona: 'bad-json', modality: 'pointer', target: 'http://127.0.0.1:4173' },
					{ driver: cleanDriver }
				)
			).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

			await expect(
				bench.panelWalk(
					{ job: 'j1', persona: 'wrong-mod', modality: 'pointer', target: 'http://127.0.0.1:4173' },
					{ driver: cleanDriver }
				)
			).rejects.toMatchObject({ code: 'MODALITY_FORBIDDEN' });
		} finally {
			await bench.close();
		}

		// Prompt sanity check
		const prompt = buildWalkPrompt({
			persona: { id: 'p-1', modality: 'keyboard', name: 'Kay', stance: 'Direct' },
			job: 'j1',
			script: 'Submit the form.',
			modality: 'keyboard',
			appDate: '2030-05-01',
		});
		expect(prompt).toContain('Today in the application is 2030-05-01.');
		expect(prompt).toContain('viewport 1280x800');
	});
});
