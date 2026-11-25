import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCompare } from './compare.js';
import {
	checkDecisions,
	DECISION_ID_PATTERN,
	generateDecisionId,
	getDecision,
	listDecisions,
	matchesSubjectGlob,
	readAllDecisions,
	readDecisionEvidenceManifest,
	readDecisionRecord,
	recordDecision,
	writeDecisionEvidence,
} from './decisions.js';
import { canonicalJson, diffObservations } from './diff.js';
import {
	decisionCheckResultSchema,
	decisionGetResultSchema,
	decisionListResultSchema,
	decisionRecordResultSchema,
} from './schema.js';
import type { CaptureSetHost } from './sets.js';
import { captureSetsDir, readCaptureSetManifest, writeCaptureSet } from './sets.js';
import type { Observation, SpecimenContext, SpecimenEntry } from './types.js';

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'specimen-decisions-'));
	directories.push(dir);
	return dir;
}

const lightContext: SpecimenContext = {
	viewport: { width: 1280, height: 800 },
	theme: 'light',
	locale: 'en-US',
	reducedMotion: 'no-preference',
	motion: 'natural',
};

function makeObservation(
	id: string,
	options: {
		axeStatus?: 'passed' | 'failed';
		violations?: { id: string; targets: string[] }[];
		incompleteChecks?: { id: string; help: string; targets: string[] }[];
		height?: number;
		screenshot?: string | null;
	} = {}
): Observation {
	const channel = { status: 'complete' as const, scope: 'declared targets', reasons: [] };
	return {
		manifest: {
			captureVersion: '0.10',
			normalizationVersion: '0.2',
			specimenId: id,
			capturedUtc: '2026-11-24T00:00:00.000Z',
			bench: { name: '@lushly-dev/specimen', version: '2.2.0', plugins: [] },
			driver: { name: 'host', emulates: [] },
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				ready: { steps: ['upgrade', 'fonts', 'frame'], outcome: 'ready', deadlineMs: 10_000 },
				baseline: {
					clock: 'real',
					random: { source: 'seeded', seed: 1 },
					storage: 'empty',
				},
			},
			source: { revision: 'a1b2c3d', digest: 'source', dirty: false },
			dependencies: 'lock',
			browser: { name: 'chromium', version: '130', platform: 'linux-x64', build: null },
			context: {
				...lightContext,
				pixelRatio: 1,
				observed: {
					width: 1280,
					height: 800,
					media: false,
					colorScheme: 'light',
					contrast: 'no-preference',
					reducedMotion: 'no-preference',
					language: 'en-US',
					devicePixelRatio: 1,
				},
				resources: { fonts: [], remote: [] },
			},
		},
		channels: {
			dom: { raw: `<div data-id="${id}"></div>`, normalized: `<div data-id="${id}"></div>` },
			a11y: {
				snapshot: `- region "${id}"`,
				axe: {
					status: options.axeStatus ?? 'passed',
					policy: 'error',
					violations: (options.violations ?? []).map((v) => ({
						id: v.id,
						impact: 'serious',
						help: v.id,
						targets: v.targets,
						details: [],
					})),
					incomplete: options.incompleteChecks?.length ?? 0,
					incompleteChecks: (options.incompleteChecks ?? []).map((c) => ({
						id: c.id,
						impact: null,
						help: c.help,
						targets: c.targets,
						details: [],
					})),
					exceptions: [],
				},
			},
			events: { declared: [], history: [] },
			evidence: {
				expectations: [],
				claims: [],
				commands: [],
				formData: [],
				validity: [],
				attributesSet: [],
			},
			elements: [
				{
					ref: 'root/div:1',
					tag: 'div',
					attributes: { 'data-id': id },
					box: { x: 0, y: 0, width: 320, height: options.height ?? 36 },
					scroll: { width: 320, height: 36, clientWidth: 320, clientHeight: 36 },
					styles: { gap: id === 'toolbar--airy' ? '12px' : '4px' },
					state: { focused: false, value: '' },
				},
			],
			console: { errors: [], warnings: [] },
			visual: { path: options.screenshot ?? null },
		},
		completeness: {
			dom: channel,
			a11y: channel,
			layout: channel,
			styles: channel,
			tokens: { ...channel, status: 'unsupported' },
			events: { ...channel, status: 'unsupported' },
			visual: { ...channel, status: options.screenshot ? 'complete' : 'not-requested' },
		},
	};
}

function makeCompareHost(root: string): CaptureSetHost {
	const entries: SpecimenEntry[] = [
		{ id: 'toolbar--dense', title: 'Toolbar/Dense', module: './t.ts', exportName: 'Dense' },
		{ id: 'toolbar--airy', title: 'Toolbar/Airy', module: './t.ts', exportName: 'Airy' },
		{ id: 'toolbar--grouped', title: 'Toolbar/Grouped', module: './t.ts', exportName: 'Grouped' },
		{ id: 'list--empty', title: 'List/Empty', module: './l.ts', exportName: 'Empty' },
		{
			id: 'list--empty-plain',
			title: 'List/EmptyPlain',
			module: './l.ts',
			exportName: 'EmptyPlain',
		},
	];
	return {
		root,
		entries,
		workers: 2,
		prepare: async () => {},
		sourceState: async () => ({ revision: 'a1b2c3d', dirty: false }),
		render: async ({ entry, screenshot }) => {
			await writeFile(screenshot, `png:${entry.id}`);
			return makeObservation(entry.id, {
				screenshot,
				height: entry.id === 'toolbar--airy' ? 52 : 36,
				axeStatus: entry.id === 'toolbar--grouped' ? 'failed' : 'passed',
				violations:
					entry.id === 'toolbar--grouped'
						? [{ id: 'color-contrast', targets: ['span.group-label'] }]
						: [],
				incompleteChecks:
					entry.id === 'list--empty'
						? [
								{
									id: 'color-contrast',
									help: 'Text over background image could not be measured',
									targets: ['p.empty-hint'],
								},
							]
						: [],
			});
		},
	};
}

describe('Design Decisions Phase 3 (decisions.ts)', () => {
	it('generates lowercase Crockford base-32 decision ids excluding i, l, o, u', () => {
		for (let i = 0; i < 64; i++) {
			const id = generateDecisionId();
			expect(id).toMatch(DECISION_ID_PATTERN);
			expect(id.slice(4)).not.toMatch(/[ilou]/);
		}
		const deterministic = generateDecisionId(
			new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
		);
		expect(deterministic).toBe('dec-0123456789ab');
	});

	it('matches POSIX subject globs accurately across directories and braces', () => {
		expect(matchesSubjectGlob('src/toolbar/toolbar.css', 'src/toolbar/**')).toBe(true);
		expect(matchesSubjectGlob('src/toolbar/sub/item.ts', 'src/toolbar/**')).toBe(true);
		expect(matchesSubjectGlob('src/list/list.css', 'src/toolbar/**')).toBe(false);
		expect(matchesSubjectGlob('src/toolbar/toolbar.css', 'src/**/*.css')).toBe(true);
		expect(matchesSubjectGlob('src/app.css', 'src/**/*.css')).toBe(true);
		expect(matchesSubjectGlob('src/toolbar/toolbar.ts', 'src/toolbar/*.{ts,css}')).toBe(true);
		expect(matchesSubjectGlob('src\\toolbar\\toolbar.css', 'src/toolbar/**')).toBe(true);
	});

	it('satisfies Scenario 03 end-to-end: refusals, choice recording, committed evidence, and decision-get', async () => {
		const root = await scratchDir();
		const host = makeCompareHost(root);

		// Step 1: compare three variants (toolbar--grouped fails color-contrast)
		const compared = await runCompare(host, {
			ids: ['toolbar--dense', 'toolbar--airy', 'toolbar--grouped'],
			context: { theme: 'light', viewport: { width: 1280, height: 800 } },
		});

		// Step 2: empty reason refused with REASON_REQUIRED
		await expect(
			recordDecision(root, {
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: compared.set,
				chosen: 'toolbar--dense',
				reason: '',
			})
		).rejects.toMatchObject({
			code: 'REASON_REQUIRED',
			suggestion: expect.stringContaining('reason'),
		});

		// Whitespace-only or omitted reason also returns REASON_REQUIRED
		await expect(
			recordDecision(root, {
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: compared.set,
				chosen: 'toolbar--dense',
				reason: '   ',
			})
		).rejects.toMatchObject({ code: 'REASON_REQUIRED' });

		// Step 3: unknown variant refused with VARIANT_NOT_FOUND naming compared variants
		await expect(
			recordDecision(root, {
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: compared.set,
				chosen: 'toolbar--compact',
				reason: 'Fits twelve commands.',
			})
		).rejects.toMatchObject({
			code: 'VARIANT_NOT_FOUND',
			message: expect.stringContaining('toolbar--compact'),
			suggestion: expect.stringContaining('toolbar--dense'),
		});

		// Step 4: gate-failing variant refused with CHOSEN_FAILS_GATE naming rule and specimen-compare
		await expect(
			recordDecision(root, {
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: compared.set,
				chosen: 'toolbar--grouped',
				reason: 'Groups read better.',
			})
		).rejects.toMatchObject({
			code: 'CHOSEN_FAILS_GATE',
			message: expect.stringContaining('color-contrast'),
			suggestion: expect.stringContaining('specimen-compare'),
		});

		// Step 5: valid choice records decision file and copies evidence screenshots + manifest
		const recorded = await recordDecision(
			root,
			{
				slug: 'toolbar-density',
				question: 'How dense should the toolbar be?',
				set: compared.set,
				chosen: 'toolbar--dense',
				reason: 'The editor shows twelve commands; at the airy gap the last three wrap at 1280 px.',
				subjects: {
					files: ['src/toolbar/**'],
					tokens: ['space.toolbar.gap'],
				},
			},
			{ decidedBy: { kind: 'test' } }
		);
		expect(decisionRecordResultSchema.safeParse(recorded).success).toBe(true);
		expect(recorded).toMatchObject({
			decision: expect.stringMatching(DECISION_ID_PATTERN),
			kind: 'choice',
			chosen: 'toolbar--dense',
			kept: ['toolbar--airy', 'toolbar--grouped'],
			path: expect.stringMatching(/^specimens\/decisions\/dec-[0-9a-hjkmnp-tv-z]{12}\.json$/),
			evidenceDir: `specimens/evidence/${compared.set}/`,
			evidence: { set: compared.set, dir: `specimens/evidence/${compared.set}/` },
			subjects: {
				specimens: ['toolbar--dense'],
				files: ['src/toolbar/**'],
				tokens: ['space.toolbar.gap'],
			},
		});
		if ('decisions' in recorded) throw new Error('Expected single decision result');

		// Evidence screenshots and manifest written under specimens/evidence/<set>/ (no observations copied).
		const evidenceManifest = await readDecisionEvidenceManifest(root, compared.set);
		expect(evidenceManifest?.captures).toHaveLength(3);
		expect(evidenceManifest?.captures[1]).toMatchObject({
			id: 'toolbar--airy',
			screenshot: `specimens/evidence/${compared.set}/toolbar--airy.png`,
		});
		expect(
			await readFile(join(root, 'specimens', 'evidence', compared.set, 'toolbar--airy.png'), 'utf8')
		).toBe('png:toolbar--airy');

		// Step 6: decision-get reads back reason, 3 captures in compare order, and default subjects.specimens
		const fetched = await getDecision(root, { decision: recorded.decision });
		expect(decisionGetResultSchema.safeParse(fetched).success).toBe(true);
		expect(fetched).toMatchObject({
			decision: recorded.decision,
			kind: 'choice',
			chosen: 'toolbar--dense',
			kept: ['toolbar--airy', 'toolbar--grouped'],
			reason: expect.stringContaining('twelve commands'),
			evidence: {
				set: compared.set,
				captures: [
					{
						id: 'toolbar--dense',
						screenshot: `specimens/evidence/${compared.set}/toolbar--dense.png`,
					},
					{
						id: 'toolbar--airy',
						screenshot: `specimens/evidence/${compared.set}/toolbar--airy.png`,
					},
					{
						id: 'toolbar--grouped',
						axe: 'failed',
						violations: ['color-contrast'],
						screenshot: `specimens/evidence/${compared.set}/toolbar--grouped.png`,
					},
				],
			},
			subjects: {
				specimens: ['toolbar--dense'],
				files: ['src/toolbar/**'],
				tokens: ['space.toolbar.gap'],
			},
			decidedBy: { kind: 'test' },
		});
	});

	it('swaps old->new chosen in subjects.specimens on reversal without local comparison set (Scenario 09)', async () => {
		const root = await scratchDir();
		const host = makeCompareHost(root);
		const compared = await runCompare(host, {
			ids: ['toolbar--dense', 'toolbar--airy', 'toolbar--grouped'],
		});
		const initial = await recordDecision(root, {
			slug: 'toolbar-density',
			question: 'How dense should the toolbar be?',
			set: compared.set,
			chosen: 'toolbar--dense',
			reason: 'Twelve commands need dense spacing.',
			subjects: {
				specimens: ['toolbar--dense', 'editor--shell'],
				files: ['src/toolbar/**'],
				tokens: ['space.toolbar.gap'],
			},
		});
		if ('decisions' in initial) throw new Error('Expected single decision');

		// Delete the local .specimen/sets/ comparison set to prove reversal needs no local set.
		await rm(captureSetsDir(root), { recursive: true, force: true });

		// Reversing without `set` to a variant that failed axe in committed evidence still rejects with CHOSEN_FAILS_GATE.
		await expect(
			recordDecision(root, {
				supersedes: initial.decision,
				chosen: 'toolbar--grouped',
				reason: 'Try grouped instead.',
			})
		).rejects.toMatchObject({
			code: 'CHOSEN_FAILS_GATE',
			message: expect.stringContaining('color-contrast'),
			suggestion: expect.stringContaining('specimen-compare'),
		});

		const reversed = await recordDecision(root, {
			supersedes: initial.decision,
			chosen: 'toolbar--airy',
			reason: 'Commands fell to eight, so airy reads calmer.',
		});
		expect(decisionRecordResultSchema.safeParse(reversed).success).toBe(true);
		if ('decisions' in reversed) throw new Error('Expected single decision');

		expect(reversed).toMatchObject({
			kind: 'choice',
			supersedes: initial.decision,
			chosen: 'toolbar--airy',
			kept: ['toolbar--dense', 'toolbar--grouped'],
			evidence: { set: compared.set, dir: `specimens/evidence/${compared.set}/` },
			subjects: {
				specimens: ['toolbar--airy', 'editor--shell'],
				files: ['src/toolbar/**'],
				tokens: ['space.toolbar.gap'],
			},
		});

		// Prior decision is now superseded.
		const oldRecord = await readDecisionRecord(root, initial.decision);
		expect(oldRecord.kind === 'choice' && oldRecord.status).toBe('superseded');

		// decision-check now matches toolbar--airy and editor--shell, and no longer matches toolbar--dense.
		const airyCheck = await checkDecisions(root, { specimens: ['toolbar--airy'] });
		expect(decisionCheckResultSchema.safeParse(airyCheck).success).toBe(true);
		expect(airyCheck.decisions).toHaveLength(1);
		expect(airyCheck.decisions[0]).toMatchObject({
			decision: reversed.decision,
			chosen: 'toolbar--airy',
			supersedes: initial.decision,
			matched: { specimens: ['toolbar--airy'] },
		});

		const denseCheck = await checkDecisions(root, { specimens: ['toolbar--dense'] });
		expect(denseCheck.decisions).toEqual([]);

		const shellCheck = await checkDecisions(root, { specimens: ['editor--shell'] });
		expect(shellCheck.decisions).toHaveLength(1);
		expect(shellCheck.decisions[0]?.decision).toBe(reversed.decision);

		// Committed evidence still readable via decision-get even after .specimen/sets/ was removed.
		const fetched = await getDecision(root, { decision: reversed.decision });
		expect(fetched.kind).toBe('choice');
		if (fetched.kind === 'choice') {
			expect(fetched.evidence.captures).toHaveLength(3);
			expect(fetched.evidence.captures[1]?.id).toBe('toolbar--airy');
		}
	});

	it('handles two-choice shared-token supersession via default review resolution without injection', async () => {
		const root = await scratchDir();
		const host = makeCompareHost(root);

		const toolbarCompare = await runCompare(host, {
			ids: ['toolbar--dense', 'toolbar--airy'],
		});
		const listCompare = await runCompare(host, {
			ids: ['list--empty', 'list--empty-plain'],
		});

		const toolbarChoice = await recordDecision(root, {
			slug: 'toolbar-density',
			question: 'How dense should the toolbar be?',
			set: toolbarCompare.set,
			chosen: 'toolbar--dense',
			reason: 'Twelve commands fit at 4px.',
			subjects: {
				specimens: ['toolbar--dense', 'editor--shell'],
				files: ['src/toolbar/**'],
				tokens: ['space.shared.gap'],
			},
		});
		const listChoice = await recordDecision(root, {
			slug: 'list-empty-state',
			question: 'Should the empty list include a hint?',
			set: listCompare.set,
			chosen: 'list--empty',
			reason: 'Hint explains how to create the first item.',
			subjects: {
				specimens: ['list--empty'],
				files: ['src/list/**'],
				tokens: ['space.shared.gap'],
			},
		});
		if ('decisions' in toolbarChoice || 'decisions' in listChoice) {
			throw new Error('Expected single decisions');
		}

		// Create before and after capture sets simulating a shared-token height change on both chosen specimens.
		const beforeToolbar = makeObservation('toolbar--dense', { height: 36 });
		const beforeList = makeObservation('list--empty', { height: 36 });
		const afterToolbar = makeObservation('toolbar--dense', { height: 48 });
		const afterList = makeObservation('list--empty', { height: 48 });

		const beforeSet = await writeCaptureSet(root, {
			kind: 'capture',
			context: lightContext,
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				baseline: { clock: 'real', random: { source: 'seeded', seed: 1 }, storage: 'empty' },
			},
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: 'a1b2c3d',
			dirty: false,
			label: 'main',
			entries: [
				{
					key: 'toolbar--dense',
					id: 'toolbar--dense',
					status: 'captured',
					observation: beforeToolbar,
				},
				{
					key: 'list--empty',
					id: 'list--empty',
					status: 'captured',
					observation: beforeList,
				},
			],
			skipped: { jobs: 0, gates: 0 },
		});
		const afterSet = await writeCaptureSet(root, {
			kind: 'capture',
			context: lightContext,
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				baseline: { clock: 'real', random: { source: 'seeded', seed: 1 }, storage: 'empty' },
			},
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: 'e4f5a6b',
			dirty: false,
			label: 'branch',
			entries: [
				{
					key: 'toolbar--dense',
					id: 'toolbar--dense',
					status: 'captured',
					observation: afterToolbar,
				},
				{
					key: 'list--empty',
					id: 'list--empty',
					status: 'captured',
					observation: afterList,
				},
			],
			skipped: { jobs: 0, gates: 0 },
		});

		// Derive the exact real review item id from diffObservations (no injected resolver!).
		const diff = diffObservations(beforeToolbar, afterToolbar);
		expect(diff.status).toBe('changed');
		const firstDiff = diff.differences[0];
		expect(firstDiff).toBeDefined();
		const cause = {
			channel: firstDiff?.channel,
			...(firstDiff?.target !== undefined ? { target: firstDiff.target } : {}),
			...(firstDiff?.property !== undefined ? { property: firstDiff.property } : {}),
			...(firstDiff?.left !== undefined ? { left: firstDiff.left } : {}),
			...(firstDiff?.right !== undefined ? { right: firstDiff.right } : {}),
		};
		const causeHash = createHash('sha256').update(canonicalJson(cause)).digest('hex').slice(0, 12);
		const membersHash = createHash('sha256')
			.update(canonicalJson(['list--empty', 'toolbar--dense']))
			.digest('hex')
			.slice(0, 12);
		const itemId = `changed:${causeHash}:${membersHash}:${beforeSet.run.set}..${afterSet.run.set}`;

		// Fabricated changed: and insufficient: items are rejected with REVIEW_ITEM_NOT_FOUND.
		await expect(
			recordDecision(root, {
				items: [`changed:deadbeef0000:${membersHash}:${beforeSet.run.set}..${afterSet.run.set}`],
				chosen: 'accept',
				reason: 'Fabricated cause.',
			})
		).rejects.toMatchObject({ code: 'REVIEW_ITEM_NOT_FOUND' });

		await expect(
			recordDecision(root, {
				items: [`insufficient:toolbar--dense:${beforeSet.run.set}..${afterSet.run.set}`],
				chosen: 'accept',
				reason: 'Not actually insufficient.',
			})
		).rejects.toMatchObject({ code: 'REVIEW_ITEM_NOT_FOUND' });

		// Accepting without supersedes fails with SUPERSEDE_REQUIRED naming both touched choices.
		await expect(
			recordDecision(root, {
				items: [itemId],
				chosen: 'accept',
				reason: 'Accept change without supersedes.',
			})
		).rejects.toMatchObject({
			code: 'SUPERSEDE_REQUIRED',
			message: expect.stringContaining(toolbarChoice.decision),
		});

		// Accepting with partial supersedes fails with SUPERSEDE_REQUIRED naming the missing choice.
		await expect(
			recordDecision(root, {
				items: [itemId],
				chosen: 'accept',
				supersedes: [toolbarChoice.decision],
				reason: 'Both surfaces adopt the 8px shared gap token.',
			})
		).rejects.toMatchObject({
			code: 'SUPERSEDE_REQUIRED',
			message: expect.stringContaining(listChoice.decision),
			suggestion: expect.stringContaining('supersedes'),
		});

		// Conflicting set/subjects alongside items + supersedes are rejected cleanly.
		await expect(
			recordDecision(root, {
				items: [itemId],
				set: afterSet.run.set,
				chosen: 'accept',
				supersedes: [toolbarChoice.decision, listChoice.decision],
				reason: 'Should reject set with items.',
			})
		).rejects.toThrow(/Invalid decision record request\.set/);
		await expect(
			recordDecision(root, {
				items: [itemId],
				subjects: { files: ['src/other/**'] },
				chosen: 'accept',
				supersedes: [toolbarChoice.decision, listChoice.decision],
				reason: 'Should reject subjects with items.',
			})
		).rejects.toThrow(/Invalid decision record request\.subjects/);

		// Accepting with both choices in supersedes writes two independent successor choices.
		const multi = await recordDecision(root, {
			items: [itemId],
			chosen: 'accept',
			supersedes: [toolbarChoice.decision, listChoice.decision],
			reason: 'Both surfaces adopt the 8px shared gap token after command count dropped.',
		});
		expect(decisionRecordResultSchema.safeParse(multi).success).toBe(true);
		if (!('decisions' in multi)) throw new Error('Expected multi-choice result');
		expect(multi.decisions).toHaveLength(2);
		expect(multi.decisions[0]?.decision).not.toBe(multi.decisions[1]?.decision);

		// First successor keeps toolbar--dense's variants, chosen, kept, and subjects.
		expect(multi.decisions[0]).toMatchObject({
			kind: 'choice',
			supersedes: toolbarChoice.decision,
			chosen: 'toolbar--dense',
			kept: ['toolbar--airy'],
			evidence: { set: afterSet.run.set, dir: `specimens/evidence/${afterSet.run.set}/` },
			subjects: {
				specimens: ['toolbar--dense', 'editor--shell'],
				files: ['src/toolbar/**'],
				tokens: ['space.shared.gap'],
			},
			answers: [{ item: itemId, kind: 'changed', ids: ['list--empty', 'toolbar--dense'] }],
		});

		// Second successor keeps list--empty's variants, chosen, kept, and subjects.
		expect(multi.decisions[1]).toMatchObject({
			kind: 'choice',
			supersedes: listChoice.decision,
			chosen: 'list--empty',
			kept: ['list--empty-plain'],
			evidence: { set: afterSet.run.set, dir: `specimens/evidence/${afterSet.run.set}/` },
			subjects: {
				specimens: ['list--empty'],
				files: ['src/list/**'],
				tokens: ['space.shared.gap'],
			},
			answers: [{ item: itemId, kind: 'changed', ids: ['list--empty', 'toolbar--dense'] }],
		});

		// Both prior choices are superseded; decision-check on the shared token finds both new successors with the new reason.
		const checked = await checkDecisions(root, { tokens: ['space.shared.gap'] });
		expect(checked.decisions).toHaveLength(2);
		const bySupersedes = new Map(checked.decisions.map((d) => [d.supersedes, d]));
		expect(bySupersedes.get(toolbarChoice.decision)).toMatchObject({
			chosen: 'toolbar--dense',
			reason: expect.stringContaining('8px shared gap token'),
			matched: { tokens: ['space.shared.gap'] },
		});
		expect(bySupersedes.get(listChoice.decision)).toMatchObject({
			chosen: 'list--empty',
			reason: expect.stringContaining('8px shared gap token'),
			matched: { tokens: ['space.shared.gap'] },
		});
	});

	it('lists current choices sorted by id ascending with stale globs and undecided comparison sets', async () => {
		const root = await scratchDir();
		const host = makeCompareHost(root);

		// Create source files: src/toolbar/toolbar.css exists, src/empty/** does not.
		await mkdir(join(root, 'src', 'toolbar'), { recursive: true });
		await writeFile(join(root, 'src', 'toolbar', 'toolbar.css'), '.toolbar {}');

		const toolbarCompare = await runCompare(host, {
			ids: ['toolbar--dense', 'toolbar--airy', 'toolbar--grouped'],
		});
		const undecidedCompare = await runCompare(host, {
			ids: ['list--empty', 'list--empty-plain'],
		});

		// Write two decisions with deterministic ids to verify ascending id order.
		await mkdir(join(root, 'specimens', 'decisions'), { recursive: true });
		await writeFile(
			join(root, 'specimens', 'decisions', 'dec-q7k2m4xab3na.json'),
			JSON.stringify({
				id: 'dec-q7k2m4xab3na',
				kind: 'choice',
				slug: 'toolbar-density',
				status: 'current',
				question: 'How dense should the toolbar be?',
				variants: ['toolbar--dense', 'toolbar--airy', 'toolbar--grouped'],
				chosen: 'toolbar--dense',
				kept: ['toolbar--airy', 'toolbar--grouped'],
				discarded: [],
				reason: 'Fits twelve commands.',
				evidence: { set: toolbarCompare.set, dir: `specimens/evidence/${toolbarCompare.set}/` },
				subjects: { files: ['src/toolbar/**'], specimens: ['toolbar--dense'] },
				decidedAt: '2026-11-12T15:20:00Z',
				decidedBy: { kind: 'person' },
			})
		);
		await writeFile(
			join(root, 'specimens', 'decisions', 'dec-h3np6wz5c2rf.json'),
			JSON.stringify({
				id: 'dec-h3np6wz5c2rf',
				kind: 'choice',
				slug: 'empty-state-copy',
				status: 'current',
				question: 'Should the empty list explain how to add an item?',
				variants: ['empty--hint', 'empty--plain'],
				chosen: 'empty--hint',
				kept: [],
				discarded: ['empty--plain'],
				reason: 'First-run sessions stalled without it.',
				evidence: { set: 'set-6c9a1e4b8f22', dir: 'specimens/evidence/set-6c9a1e4b8f22/' },
				subjects: { files: ['src/empty/**'] },
				decidedAt: '2026-11-10T10:05:00Z',
				decidedBy: { kind: 'person' },
			})
		);
		// Also write a superseded choice and an answer — neither appears in decision-list.decisions.
		await writeFile(
			join(root, 'specimens', 'decisions', 'dec-000000000001.json'),
			JSON.stringify({
				id: 'dec-000000000001',
				kind: 'choice',
				slug: 'old',
				status: 'superseded',
				question: 'Old question?',
				variants: ['a', 'b'],
				chosen: 'a',
				kept: ['b'],
				discarded: [],
				reason: 'Old reason.',
				evidence: { set: 'set-aaaaaaaaaaaa', dir: 'specimens/evidence/set-aaaaaaaaaaaa/' },
				subjects: { specimens: ['a'] },
				decidedAt: '2026-11-01T00:00:00Z',
				decidedBy: { kind: 'script' },
			})
		);
		await writeFile(
			join(root, 'specimens', 'decisions', 'dec-000000000002.json'),
			JSON.stringify({
				id: 'dec-000000000002',
				kind: 'answer',
				chosen: 'accept',
				reason: 'Measured contrast by hand.',
				answers: [
					{
						item: 'check:list--empty:color-contrast:set-4f1c0a9e2b7d..set-7e2a90c4d311',
						fingerprint: 'c04',
					},
				],
				decidedAt: '2026-11-11T00:00:00Z',
				decidedBy: { kind: 'person' },
			})
		);

		const listed = await listDecisions(root);
		expect(decisionListResultSchema.safeParse(listed).success).toBe(true);
		expect(listed.decisions).toEqual([
			{
				decision: 'dec-h3np6wz5c2rf',
				question: 'Should the empty list explain how to add an item?',
				chosen: 'empty--hint',
				stale: ['src/empty/**'],
			},
			{
				decision: 'dec-q7k2m4xab3na',
				question: 'How dense should the toolbar be?',
				chosen: 'toolbar--dense',
				stale: [],
			},
		]);
		expect(listed.undecided).toEqual([
			{
				set: undecidedCompare.set,
				ids: ['list--empty', 'list--empty-plain'],
			},
		]);

		// decision-check ignores answers and superseded choices, and matches files/specimens/tokens.
		const fileHit = await checkDecisions(root, { files: ['src/toolbar/toolbar.css'] });
		expect(fileHit.decisions).toHaveLength(1);
		expect(fileHit.decisions[0]).toMatchObject({
			decision: 'dec-q7k2m4xab3na',
			matched: { files: ['src/toolbar/toolbar.css'] },
		});
		expect((await checkDecisions(root, { files: ['src/list/list.css'] })).decisions).toEqual([]);
		expect((await checkDecisions(root, { specimens: ['a'] })).decisions).toEqual([]);
	});

	it('records Mode 3 review answers without subjects and enforces DECISION_NOT_FOUND / CAPTURE_SET_NOT_FOUND', async () => {
		const root = await scratchDir();
		const host = makeCompareHost(root);
		const compared = await runCompare(host, {
			ids: ['list--empty', 'list--empty-plain'],
		});

		// DECISION_NOT_FOUND on decision-get and decision-record supersedes points to decision-list.
		await expect(getDecision(root, { decision: 'dec-q7k2m4xab3nb' })).rejects.toMatchObject({
			code: 'DECISION_NOT_FOUND',
			suggestion: expect.stringContaining('decision-list'),
		});
		await expect(
			recordDecision(root, {
				supersedes: 'dec-q7k2m4xab3nb',
				chosen: 'list--empty',
				reason: 'Switch choice.',
			})
		).rejects.toMatchObject({
			code: 'DECISION_NOT_FOUND',
			suggestion: expect.stringContaining('decision-list'),
		});

		// CAPTURE_SET_NOT_FOUND on decision-record points to specimen-capture.
		await expect(
			recordDecision(root, {
				slug: 'missing-set',
				question: 'Which?',
				set: 'no-such-label',
				chosen: 'list--empty',
				reason: 'Reason.',
			})
		).rejects.toMatchObject({
			code: 'CAPTURE_SET_NOT_FOUND',
			suggestion: expect.stringContaining('specimen-capture'),
		});

		// Mode 3 answer for an incomplete check (optional slug/question, no subjects).
		const checkItem = `check:list--empty:color-contrast:${compared.set}..${compared.set}`;
		const answer = await recordDecision(root, {
			items: [checkItem],
			chosen: 'accept',
			reason: 'Hint sits on the solid band of the image; measured 7.1:1 by hand.',
		});
		expect(decisionRecordResultSchema.safeParse(answer).success).toBe(true);
		if ('decisions' in answer) throw new Error('Expected single answer result');
		expect(answer.kind).toBe('answer');
		expect(answer.chosen).toBe('accept');
		expect('subjects' in answer).toBe(false);
		expect(answer.answers?.[0]).toMatchObject({
			item: checkItem,
			id: 'list--empty',
			check: 'color-contrast',
		});

		// Reading back the answer via decision-get works and has no subjects.
		const fetchedAnswer = await getDecision(root, { decision: answer.decision });
		expect(decisionGetResultSchema.safeParse(fetchedAnswer).success).toBe(true);
		expect(fetchedAnswer.kind).toBe('answer');
		expect('subjects' in fetchedAnswer).toBe(false);

		// Answer never appears in decision-check or decision-list.
		expect((await listDecisions(root)).decisions).toEqual([]);
		expect((await checkDecisions(root, { specimens: ['list--empty'] })).decisions).toEqual([]);

		// Unknown review item refuses with REVIEW_ITEM_NOT_FOUND naming specimen-review.
		await expect(
			recordDecision(root, {
				items: [`check:button--primary:color-contrast:${compared.set}..${compared.set}`],
				chosen: 'accept',
				reason: 'Looks fine.',
			})
		).rejects.toMatchObject({
			code: 'REVIEW_ITEM_NOT_FOUND',
			suggestion: expect.stringContaining('specimen-review'),
		});
	});

	it('supports direct multi-choice supersession without items and rejects atomically on invalid second target', async () => {
		const root = await scratchDir();
		const host = makeCompareHost(root);
		const sharedCompare = await runCompare(host, { ids: ['toolbar--dense', 'toolbar--airy'] });
		const otherCompare = await runCompare(host, { ids: ['list--empty', 'list--empty-plain'] });

		const first = await recordDecision(root, {
			slug: 'toolbar-primary',
			question: 'Toolbar primary density?',
			set: sharedCompare.set,
			chosen: 'toolbar--dense',
			reason: 'Initial primary choice.',
		});
		const second = await recordDecision(root, {
			slug: 'toolbar-secondary',
			question: 'Toolbar secondary density?',
			set: sharedCompare.set,
			chosen: 'toolbar--dense',
			reason: 'Initial secondary choice.',
		});
		const third = await recordDecision(root, {
			slug: 'list-state',
			question: 'List empty state?',
			set: otherCompare.set,
			chosen: 'list--empty',
			reason: 'Initial list choice.',
		});
		if ('decisions' in first || 'decisions' in second || 'decisions' in third) {
			throw new Error('Expected single decisions');
		}

		// Second target lacks toolbar--airy: rejects without mutating `first`.
		await expect(
			recordDecision(root, {
				supersedes: [first.decision, third.decision],
				chosen: 'toolbar--airy',
				reason: 'Switch both to airy.',
			})
		).rejects.toMatchObject({ code: 'VARIANT_NOT_FOUND' });
		expect((await readDecisionRecord(root, first.decision)).kind).toBe('choice');
		expect(((await readDecisionRecord(root, first.decision)) as { status: string }).status).toBe(
			'current'
		);

		// Valid direct multi-choice supersession writes two successors and supersedes both predecessors.
		const multi = await recordDecision(root, {
			supersedes: [first.decision, second.decision],
			chosen: 'toolbar--airy',
			reason: 'Both toolbars switch to airy.',
		});
		expect(decisionRecordResultSchema.safeParse(multi).success).toBe(true);
		if (!('decisions' in multi)) throw new Error('Expected multi-choice result');
		expect(multi.decisions).toHaveLength(2);
		expect(multi.decisions.map((d) => d.supersedes)).toEqual([first.decision, second.decision]);
		expect(multi.decisions.every((d) => d.chosen === 'toolbar--airy')).toBe(true);
		expect(((await readDecisionRecord(root, first.decision)) as { status: string }).status).toBe(
			'superseded'
		);
		expect(((await readDecisionRecord(root, second.decision)) as { status: string }).status).toBe(
			'superseded'
		);
	});

	it('treats choices referenced by supersedes as superseded even if predecessor status was not flipped', async () => {
		const root = await scratchDir();
		await mkdir(join(root, 'specimens', 'decisions'), { recursive: true });
		await writeFile(
			join(root, 'specimens', 'decisions', 'dec-000000000010.json'),
			JSON.stringify({
				id: 'dec-000000000010',
				kind: 'choice',
				slug: 'toolbar-density',
				status: 'current',
				question: 'How dense?',
				variants: ['toolbar--dense', 'toolbar--airy'],
				chosen: 'toolbar--dense',
				kept: ['toolbar--airy'],
				discarded: [],
				reason: 'Old choice.',
				evidence: { set: 'set-aaaaaaaaaaaa', dir: 'specimens/evidence/set-aaaaaaaaaaaa/' },
				subjects: { specimens: ['toolbar--dense'] },
				decidedAt: '2026-11-10T00:00:00Z',
				decidedBy: { kind: 'script' },
			})
		);
		await writeFile(
			join(root, 'specimens', 'decisions', 'dec-000000000011.json'),
			JSON.stringify({
				id: 'dec-000000000011',
				kind: 'choice',
				slug: 'toolbar-density',
				status: 'current',
				question: 'How dense?',
				variants: ['toolbar--dense', 'toolbar--airy'],
				chosen: 'toolbar--airy',
				kept: ['toolbar--dense'],
				discarded: [],
				reason: 'New choice.',
				evidence: { set: 'set-aaaaaaaaaaaa', dir: 'specimens/evidence/set-aaaaaaaaaaaa/' },
				subjects: { specimens: ['toolbar--airy'] },
				supersedes: 'dec-000000000010',
				decidedAt: '2026-11-11T00:00:00Z',
				decidedBy: { kind: 'script' },
			})
		);

		const listed = await listDecisions(root);
		expect(listed.decisions.map((d) => d.decision)).toEqual(['dec-000000000011']);

		const oldChecked = await checkDecisions(root, { specimens: ['toolbar--dense'] });
		expect(oldChecked.decisions).toEqual([]);

		const oldFetched = await getDecision(root, { decision: 'dec-000000000010' });
		expect(oldFetched.kind === 'choice' && oldFetched.status).toBe('superseded');
	});

	it('keeps committed evidence immutable, preserves per-capture checkpoint, and fails on missing screenshot', async () => {
		const root = await scratchDir();
		const host = makeCompareHost(root);
		const compared = await runCompare(host, { ids: ['toolbar--dense', 'toolbar--airy'] });
		const manifest = await readCaptureSetManifest(root, compared.set);

		// Annotate one capture with an explicit checkpoint and write committed evidence.
		const denseCapture = manifest.captures['toolbar--dense'];
		if (!denseCapture?.screenshot)
			throw new Error('Expected toolbar--dense capture with screenshot');
		const withCheckpoint = {
			...manifest,
			captures: {
				...manifest.captures,
				'toolbar--dense': {
					...denseCapture,
					checkpoint: 'after-open',
				},
			},
		};
		const firstWrite = await writeDecisionEvidence(root, withCheckpoint);
		expect(firstWrite.manifest.captures.find((c) => c.id === 'toolbar--dense')?.checkpoint).toBe(
			'after-open'
		);

		// Calling writeDecisionEvidence again with altered revision & altered source PNG reuses existing snapshot.
		const srcPng = join(captureSetsDir(root), compared.set, denseCapture.screenshot);
		await writeFile(srcPng, 'MUTATED-PNG');
		const secondWrite = await writeDecisionEvidence(root, {
			...withCheckpoint,
			revision: 'zzzzzzz',
		});
		expect(secondWrite.manifest.revision).toBe(withCheckpoint.revision);
		expect(
			await readFile(
				join(root, 'specimens', 'evidence', compared.set, 'toolbar--dense.png'),
				'utf8'
			)
		).toBe('png:toolbar--dense');

		// Missing declared source screenshot on a new set fails loudly instead of silently dropping it.
		const compared2 = await runCompare(host, { ids: ['list--empty', 'list--empty-plain'] });
		const manifest2 = await readCaptureSetManifest(root, compared2.set);
		const emptyCapture = manifest2.captures['list--empty'];
		if (!emptyCapture?.screenshot) throw new Error('Expected list--empty capture with screenshot');
		await rm(join(captureSetsDir(root), compared2.set, emptyCapture.screenshot), { force: true });
		await expect(writeDecisionEvidence(root, manifest2)).rejects.toThrow();

		// A sourceSetDir symlink escaping root is refused.
		const outside = await scratchDir();
		const escapedSetId = 'set-deadbeef1234';
		await writeFile(join(outside, 'shot.png'), 'outside');
		try {
			await symlink(outside, join(captureSetsDir(root), escapedSetId));
			await expect(
				writeDecisionEvidence(root, {
					...manifest2,
					set: escapedSetId,
					captures: {
						'list--empty': {
							...emptyCapture,
							screenshot: 'shot.png',
						},
					},
				})
			).rejects.toThrow(/escapes root/);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
		}
	});

	it('handles symlink cycles and malformed globs gracefully in decision-list and decision-check', async () => {
		const root = await scratchDir();
		await mkdir(join(root, 'src', 'toolbar'), { recursive: true });
		await writeFile(join(root, 'src', 'toolbar', 'toolbar.css'), '.toolbar {}');
		try {
			await symlink(join(root, 'src'), join(root, 'src', 'toolbar', 'loop'));
		} catch {
			// Symlinks may be disallowed on restricted Windows accounts; continue verifying corrupt glob resilience.
		}

		await mkdir(join(root, 'specimens', 'decisions'), { recursive: true });
		await writeFile(
			join(root, 'specimens', 'decisions', 'dec-000000000020.json'),
			JSON.stringify({
				id: 'dec-000000000020',
				kind: 'choice',
				slug: 'cycle-and-bad-glob',
				status: 'current',
				question: 'Does glob walk terminate?',
				variants: ['a', 'b'],
				chosen: 'a',
				kept: ['b'],
				discarded: [],
				reason: 'Testing resilience.',
				evidence: { set: 'set-aaaaaaaaaaaa', dir: 'specimens/evidence/set-aaaaaaaaaaaa/' },
				subjects: { files: ['src/**/*.missing', 'src/[z-a]/bad.ts'] },
				decidedAt: '2026-11-10T00:00:00Z',
				decidedBy: { kind: 'script' },
			})
		);

		const listed = await listDecisions(root);
		expect(listed.decisions).toEqual([
			{
				decision: 'dec-000000000020',
				question: 'Does glob walk terminate?',
				chosen: 'a',
				stale: ['src/**/*.missing', 'src/[z-a]/bad.ts'],
			},
		]);
		const checked = await checkDecisions(root, { files: ['src/toolbar/toolbar.css'] });
		expect(checked.decisions).toEqual([]);
	});

	it('rejects symlink escapes when reading decisions', async () => {
		const root = await scratchDir();
		const outside = await scratchDir();
		const externalFile = join(outside, 'dec-q7k2m4xab3na.json');
		await writeFile(externalFile, JSON.stringify({ id: 'dec-q7k2m4xab3na', kind: 'answer' }));
		await mkdir(join(root, 'specimens', 'decisions'), { recursive: true });
		try {
			await symlink(externalFile, join(root, 'specimens', 'decisions', 'dec-q7k2m4xab3na.json'));
		} catch {
			// Skip symlink assertion on Windows environments without symlink privileges.
			return;
		}
		await expect(readAllDecisions(root)).rejects.toThrow(/escapes root/);
	});
});
