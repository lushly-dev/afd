import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDecisions, recordDecision } from './decisions.js';
import { readReviewPageData, runReview } from './review.js';
import { renderReviewPageHtml } from './review-page.js';
import { parseReviewRequest } from './review-validate.js';
import { writeCaptureSet } from './sets.js';
import {
	CAPTURE_VERSION,
	type ElementObservation,
	NORMALIZATION_VERSION,
	type Observation,
	type SpecimenContext,
} from './types.js';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeWorkspace(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'specimen-review-'));
	tempDirs.push(dir);
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
		theme?: 'light' | 'dark';
		dom?: string;
		gap?: string;
		padding?: string;
		axeStatus?: 'passed' | 'failed';
		violations?: { id: string; targets: string[] }[];
		incompleteChecks?: { id: string; help: string; targets: string[] }[];
		incompleteDom?: boolean;
		elements?: ElementObservation[];
	} = {}
): Observation {
	const theme = options.theme ?? 'light';
	const complete = { status: 'complete' as const, scope: 'root', reasons: [] };
	const elements: ElementObservation[] = options.elements ?? [
		{
			ref: 'root/violet-toolbar:1',
			tag: 'violet-toolbar',
			attributes: {},
			box: { x: 0, y: 0, width: 400, height: 40 },
			scroll: { width: 400, height: 40, clientWidth: 400, clientHeight: 40 },
			styles: {
				gap: options.gap ?? '4px',
				...(options.padding ? { padding: options.padding } : {}),
			},
			state: {},
		},
	];
	const domText = options.dom ?? `<violet-toolbar data-id="${id}"></violet-toolbar>`;
	return {
		manifest: {
			captureVersion: CAPTURE_VERSION,
			normalizationVersion: NORMALIZATION_VERSION,
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
			source: { revision: 'a1b2c3d', digest: 'src', dirty: false },
			dependencies: 'lock',
			browser: { name: 'chromium', version: '130', platform: 'linux-x64', build: null },
			context: {
				...lightContext,
				theme,
				pixelRatio: 1,
				observed: {
					width: 1280,
					height: 800,
					media: false,
					colorScheme: theme,
					contrast: 'no-preference',
					reducedMotion: 'no-preference',
					language: 'en-US',
					devicePixelRatio: 1,
				},
				resources: { fonts: [], remote: [] },
			},
		},
		channels: {
			dom: { raw: domText, normalized: domText },
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
					incomplete: (options.incompleteChecks ?? []).length,
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
			elements,
			console: { errors: [], warnings: [] },
			visual: { path: null },
		},
		completeness: {
			dom: options.incompleteDom
				? { status: 'partial', scope: 'root', reasons: ['SHADOW_UNAVAILABLE'] }
				: complete,
			a11y: complete,
			layout: complete,
			styles: complete,
			tokens: { ...complete, status: 'unsupported' },
			events: { ...complete, status: 'unsupported' },
			visual: { ...complete, status: 'not-requested' },
		},
	};
}

const defaultCheckpoint = {
	name: 'mount',
	actionMode: 'none' as const,
	baseline: {
		clock: 'real' as const,
		random: { source: 'seeded' as const, seed: 1 },
		storage: 'empty' as const,
	},
};

async function seedDecidedFixture(root: string) {
	// Compare set for toolbar-density choice (toolbar--dense chosen; airy & grouped kept).
	const compareSet = await writeCaptureSet(root, {
		kind: 'compare',
		order: ['toolbar--dense', 'toolbar--airy', 'toolbar--grouped'],
		context: lightContext,
		checkpoint: defaultCheckpoint,
		browser: { name: 'chromium', version: '130' },
		axe: true,
		revision: '9f8e7d6',
		dirty: true,
		skipped: { jobs: 0, gates: 0 },
		entries: [
			{
				key: 'toolbar--dense',
				id: 'toolbar--dense',
				status: 'captured',
				observation: makeObservation('toolbar--dense', { gap: '4px' }),
			},
			{
				key: 'toolbar--airy',
				id: 'toolbar--airy',
				status: 'captured',
				observation: makeObservation('toolbar--airy', { gap: '12px' }),
			},
			{
				key: 'toolbar--grouped',
				id: 'toolbar--grouped',
				status: 'captured',
				observation: makeObservation('toolbar--grouped', {
					gap: '4px',
					axeStatus: 'failed',
					violations: [{ id: 'color-contrast', targets: ['span.group-label'] }],
				}),
			},
		],
	});

	const choice = await recordDecision(
		root,
		{
			slug: 'toolbar-density',
			question: 'How dense should the toolbar be?',
			set: compareSet.run.set,
			chosen: 'toolbar--dense',
			reason: 'The editor shows twelve commands; at the airy gap the last three wrap at 1280 px.',
			subjects: {
				specimens: ['toolbar--dense', 'editor--shell'],
				files: ['src/toolbar/**'],
				tokens: ['space.toolbar.gap'],
			},
		},
		{ decidedBy: { kind: 'person' }, now: () => new Date('2026-11-12T15:20:00Z') }
	);
	const toolbarDecisionId = 'decision' in choice ? choice.decision : '';

	const listEmptyObs = makeObservation('list--empty', {
		incompleteChecks: [
			{
				id: 'color-contrast',
				help: 'Text over a background image could not be measured',
				targets: ['p.empty-hint'],
			},
		],
	});

	// `main` capture set
	const mainSet = await writeCaptureSet(root, {
		kind: 'capture',
		label: 'main',
		context: lightContext,
		checkpoint: defaultCheckpoint,
		browser: { name: 'chromium', version: '130' },
		axe: true,
		revision: 'a1b2c3d',
		dirty: false,
		skipped: { jobs: 0, gates: 0 },
		entries: [
			{
				key: 'toolbar--dense',
				id: 'toolbar--dense',
				status: 'captured',
				observation: makeObservation('toolbar--dense', { gap: '4px' }),
			},
			{
				key: 'toolbar--airy',
				id: 'toolbar--airy',
				status: 'captured',
				observation: makeObservation('toolbar--airy', { gap: '12px' }),
			},
			{
				key: 'toolbar--grouped',
				id: 'toolbar--grouped',
				status: 'captured',
				observation: makeObservation('toolbar--grouped', {
					gap: '4px',
					axeStatus: 'failed',
					violations: [{ id: 'color-contrast', targets: ['span.group-label'] }],
				}),
			},
			{ key: 'list--empty', id: 'list--empty', status: 'captured', observation: listEmptyObs },
			{
				key: 'list--empty-plain',
				id: 'list--empty-plain',
				status: 'captured',
				observation: makeObservation('list--empty-plain'),
			},
			{
				key: 'button--primary',
				id: 'button--primary',
				status: 'captured',
				observation: makeObservation('button--primary'),
			},
			{
				key: 'editor--shell',
				id: 'editor--shell',
				status: 'captured',
				observation: makeObservation('editor--shell', { gap: '4px' }),
			},
		],
	});

	// `branch-quiet` label pointing to identical captures as `main`
	await writeCaptureSet(root, {
		kind: 'capture',
		label: 'branch-quiet',
		context: lightContext,
		checkpoint: defaultCheckpoint,
		browser: { name: 'chromium', version: '130' },
		axe: true,
		revision: 'a1b2c3d',
		dirty: false,
		skipped: { jobs: 0, gates: 0 },
		entries: [
			{
				key: 'toolbar--dense',
				id: 'toolbar--dense',
				status: 'captured',
				observation: makeObservation('toolbar--dense', { gap: '4px' }),
			},
			{
				key: 'toolbar--airy',
				id: 'toolbar--airy',
				status: 'captured',
				observation: makeObservation('toolbar--airy', { gap: '12px' }),
			},
			{
				key: 'toolbar--grouped',
				id: 'toolbar--grouped',
				status: 'captured',
				observation: makeObservation('toolbar--grouped', {
					gap: '4px',
					axeStatus: 'failed',
					violations: [{ id: 'color-contrast', targets: ['span.group-label'] }],
				}),
			},
			{ key: 'list--empty', id: 'list--empty', status: 'captured', observation: listEmptyObs },
			{
				key: 'list--empty-plain',
				id: 'list--empty-plain',
				status: 'captured',
				observation: makeObservation('list--empty-plain'),
			},
			{
				key: 'button--primary',
				id: 'button--primary',
				status: 'captured',
				observation: makeObservation('button--primary'),
			},
			{
				key: 'editor--shell',
				id: 'editor--shell',
				status: 'captured',
				observation: makeObservation('editor--shell', { gap: '4px' }),
			},
		],
	});

	// `branch` capture set: toolbar--dense and editor--shell changed gap 4px -> 8px
	const branchSet = await writeCaptureSet(root, {
		kind: 'capture',
		label: 'branch',
		context: lightContext,
		checkpoint: defaultCheckpoint,
		browser: { name: 'chromium', version: '130' },
		axe: true,
		revision: 'e4f5a6b',
		dirty: false,
		skipped: { jobs: 0, gates: 0 },
		entries: [
			{
				key: 'toolbar--dense',
				id: 'toolbar--dense',
				status: 'captured',
				observation: makeObservation('toolbar--dense', { gap: '8px' }),
			},
			{
				key: 'toolbar--airy',
				id: 'toolbar--airy',
				status: 'captured',
				observation: makeObservation('toolbar--airy', { gap: '16px' }),
			},
			{
				key: 'toolbar--grouped',
				id: 'toolbar--grouped',
				status: 'captured',
				observation: makeObservation('toolbar--grouped', {
					gap: '8px',
					axeStatus: 'failed',
					violations: [{ id: 'color-contrast', targets: ['span.group-label'] }],
				}),
			},
			{ key: 'list--empty', id: 'list--empty', status: 'captured', observation: listEmptyObs },
			{
				key: 'list--empty-plain',
				id: 'list--empty-plain',
				status: 'captured',
				observation: makeObservation('list--empty-plain'),
			},
			{
				key: 'button--primary',
				id: 'button--primary',
				status: 'captured',
				observation: makeObservation('button--primary'),
			},
			{
				key: 'editor--shell',
				id: 'editor--shell',
				status: 'captured',
				observation: makeObservation('editor--shell', { gap: '8px' }),
			},
		],
	});

	return { toolbarDecisionId, mainSet: mainSet.run.set, branchSet: branchSet.run.set };
}

describe('specimen-review (Phase 4 #2212)', () => {
	it('satisfies Scenario 05: excludes kept unchosen variants before blocking, groups by cause, and refuses missing labels', async () => {
		const root = await makeWorkspace();
		const { mainSet, branchSet, toolbarDecisionId } = await seedDecidedFixture(root);

		const beforeFiles = await readdir(join(root, '.specimen'));
		const review = await runReview(root, { before: 'main', after: 'branch' });
		// Read-only guarantee: no extra files written under .specimen/
		expect(await readdir(join(root, '.specimen'))).toEqual(beforeFiles);

		expect(review.before).toEqual({
			set: mainSet,
			label: 'main',
			revision: 'a1b2c3d',
			dirty: false,
		});
		expect(review.after).toEqual({
			set: branchSet,
			label: 'branch',
			revision: 'e4f5a6b',
			dirty: false,
		});
		expect(review.open).toHaveLength(2);
		expect(review.open[0]).toMatchObject({
			kind: 'changed',
			ids: ['editor--shell', 'toolbar--dense'],
			cause: {
				channel: 'styles',
				target: 'root/violet-toolbar:1',
				property: 'gap',
				left: '4px',
				right: '8px',
			},
			options: ['accept', 'reject'],
			decisions: [
				{ decision: toolbarDecisionId, reason: expect.stringContaining('wrap at 1280 px') },
			],
		});
		expect(review.open[0]?.captures).toHaveLength(2);
		expect(review.open[0]?.captures[0]?.before).toBeTruthy();
		expect(review.open[0]?.captures[0]?.after).toBeTruthy();

		expect(review.open[1]).toMatchObject({
			kind: 'incomplete-check',
			ids: ['list--empty'],
			check: 'color-contrast',
			options: ['accept', 'reject'],
		});
		expect(review.open[1]?.question).toContain('p.empty-hint');

		// toolbar--grouped failed axe, but it is a kept unchosen variant so it is settled.kept, never blocking.
		expect(review.blocking).toEqual([]);
		expect(review.settled).toEqual({ unchanged: 2, kept: 2, answered: 0 });
		expect(review.page).toBe(`review.html?before=${mainSet}&after=${branchSet}`);

		await expect(runReview(root, { before: 'release-1', after: 'branch' })).rejects.toMatchObject({
			code: 'CAPTURE_SET_NOT_FOUND',
			message: expect.stringContaining('release-1'),
			suggestion: expect.stringContaining('specimen-capture'),
		});
	});

	it('satisfies Scenario 04: SUPERSEDE_REQUIRED on accepting a decision-covered change, then superseding settles it', async () => {
		const root = await makeWorkspace();
		const { toolbarDecisionId, branchSet } = await seedDecidedFixture(root);

		const check1 = await checkDecisions(root, { files: ['src/toolbar/toolbar.css'] });
		expect(check1.decisions).toHaveLength(1);
		expect(check1.decisions[0]?.decision).toBe(toolbarDecisionId);
		expect((await checkDecisions(root, { files: ['src/list/list.css'] })).decisions).toEqual([]);

		const review1 = await runReview(root, {
			before: 'main',
			after: 'branch',
			ids: ['toolbar--dense', 'editor--shell'],
		});
		expect(review1.open).toHaveLength(1);
		const changedItem = review1.open[0];
		if (!changedItem) throw new Error('Expected one open item');
		expect(changedItem.item).toMatch(/^changed:/);
		expect(changedItem.ids).toEqual(['editor--shell', 'toolbar--dense']);
		expect(changedItem.decisions).toHaveLength(1);

		await expect(
			recordDecision(root, {
				items: [changedItem.item],
				chosen: 'accept',
				reason: 'The command count fell to eight, so the wider gap no longer wraps.',
			})
		).rejects.toMatchObject({
			code: 'SUPERSEDE_REQUIRED',
			message: expect.stringContaining(toolbarDecisionId),
			suggestion: expect.stringContaining('supersedes'),
		});

		const superseded = await recordDecision(root, {
			items: [changedItem.item],
			chosen: 'accept',
			supersedes: toolbarDecisionId,
			reason: 'The command count fell to eight, so the wider gap no longer wraps.',
		});
		expect('decision' in superseded).toBe(true);
		if (!('decision' in superseded)) throw new Error('Expected single decision');
		expect(superseded.kind).toBe('choice');
		expect(superseded.supersedes).toBe(toolbarDecisionId);
		expect(superseded.chosen).toBe('toolbar--dense');
		expect(superseded.evidence?.set).toBe(branchSet);
		expect(superseded.answers?.[0]?.item).toBe(changedItem.item);

		const check2 = await checkDecisions(root, { tokens: ['space.toolbar.gap'] });
		expect(check2.decisions).toHaveLength(1);
		expect(check2.decisions[0]?.supersedes).toBe(toolbarDecisionId);
		expect(check2.decisions[0]?.reason).toContain('fell to eight');

		const review2 = await runReview(root, {
			before: 'main',
			after: 'branch',
			ids: ['toolbar--dense', 'editor--shell'],
		});
		expect(review2.open).toEqual([]);
		expect(review2.settled.answered).toBe(1);
	});

	it('satisfies Scenarios 06 and 08: incomplete-check answers, reject -> blocking until content changes, and quiet settled review', async () => {
		const root = await makeWorkspace();
		const { mainSet, branchSet } = await seedDecidedFixture(root);

		const checkReview = await runReview(root, {
			before: 'main',
			after: 'branch',
			ids: ['list--empty'],
		});
		expect(checkReview.open).toHaveLength(1);
		const checkItem = checkReview.open[0];
		if (!checkItem) throw new Error('Expected one incomplete-check item');
		expect(checkItem.item).toMatch(/^check:list--empty:color-contrast:/);
		expect(checkItem.question).toContain('p.empty-hint');

		const answered = await recordDecision(root, {
			items: [checkItem.item],
			chosen: 'accept',
			reason: 'The hint sits on the solid band of the image; measured 7.1 to 1 by hand.',
		});
		expect('decision' in answered).toBe(true);
		if (!('decision' in answered)) throw new Error('Expected single answer');
		expect(answered.kind).toBe('answer');
		expect(answered.chosen).toBe('accept');
		expect(answered.subjects).toBeUndefined();
		expect(answered.answers?.[0]).toMatchObject({
			id: 'list--empty',
			check: 'color-contrast',
		});

		const checkReviewAfter = await runReview(root, {
			before: 'main',
			after: 'branch',
			ids: ['list--empty'],
		});
		expect(checkReviewAfter.open).toEqual([]);
		expect(checkReviewAfter.settled.answered).toBe(1);

		// Scenario 08: quiet review over main..branch-quiet with list--empty already answered.
		const quiet = await runReview(root, { before: 'main', after: 'branch-quiet' });
		expect(quiet.open).toEqual([]);
		expect(quiet.blocking).toEqual([]);
		expect(quiet.settled).toEqual({ unchanged: 4, kept: 2, answered: 1 });

		// Scenario 06 reject: rejecting a decision-covered change writes an answer without SUPERSEDE_REQUIRED
		// and holds the item in blocking until content changes.
		const changedReview = await runReview(root, {
			before: 'main',
			after: 'branch',
			ids: ['toolbar--dense', 'editor--shell'],
		});
		const changedReviewItem = changedReview.open[0]?.item ?? '';
		const rejected = await recordDecision(root, {
			items: [changedReviewItem],
			chosen: 'reject',
			reason: 'Reverting the gap change; twelve commands still wrap at 8 px.',
		});
		expect(
			'decision' in rejected && rejected.kind === 'answer' && rejected.chosen === 'reject'
		).toBe(true);

		const afterReject = await runReview(root, {
			before: 'main',
			after: 'branch',
			ids: ['toolbar--dense', 'editor--shell'],
		});
		expect(afterReject.open).toEqual([]);
		expect(afterReject.settled.answered).toBe(0);
		expect(afterReject.blocking).toEqual([
			{
				kind: 'rejected',
				ids: ['editor--shell', 'toolbar--dense'],
				item: changedReviewItem,
				reason: 'Reverting the gap change; twelve commands still wrap at 8 px.',
			},
		]);

		// Once content changes to a new value (6px), the old rejection fingerprint no longer blocks.
		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'branch-fixed',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: 'f9e8d7c',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{
					key: 'toolbar--dense',
					id: 'toolbar--dense',
					status: 'captured',
					observation: makeObservation('toolbar--dense', { gap: '6px' }),
				},
				{
					key: 'editor--shell',
					id: 'editor--shell',
					status: 'captured',
					observation: makeObservation('editor--shell', { gap: '6px' }),
				},
			],
		});
		const afterContentChange = await runReview(root, {
			before: 'main',
			after: 'branch-fixed',
			ids: ['toolbar--dense', 'editor--shell'],
		});
		expect(afterContentChange.blocking).toEqual([]);
		expect(afterContentChange.open).toHaveLength(1);

		// Fabricated item refused with REVIEW_ITEM_NOT_FOUND.
		await expect(
			recordDecision(root, {
				items: [`check:button--primary:color-contrast:${mainSet}..${branchSet}`],
				chosen: 'accept',
				reason: 'Looks fine.',
			})
		).rejects.toMatchObject({
			code: 'REVIEW_ITEM_NOT_FOUND',
			suggestion: expect.stringContaining('specimen-review'),
		});
	});

	it('satisfies Scenario 07: refuses review across sets captured in different themes with CAPTURES_INCOMPARABLE', async () => {
		const root = await makeWorkspace();
		await seedDecidedFixture(root);
		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'dark',
			context: { ...lightContext, theme: 'dark' },
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: 'e4f5a6b',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{
					key: 'toolbar--dense',
					id: 'toolbar--dense',
					status: 'captured',
					observation: makeObservation('toolbar--dense', { theme: 'dark' }),
				},
			],
		});

		await expect(runReview(root, { before: 'main', after: 'dark' })).rejects.toMatchObject({
			code: 'CAPTURES_INCOMPARABLE',
			message: expect.stringContaining('context.theme'),
			suggestion: expect.stringContaining('specimen-capture'),
		});
	});

	it('ensures filtered ids reviews never settle unseen specimens and multi-choice supersession preserves every choice', async () => {
		const root = await makeWorkspace();
		const cmpA = await writeCaptureSet(root, {
			kind: 'compare',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: '1111111',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{
					key: 'card--compact',
					id: 'card--compact',
					status: 'captured',
					observation: makeObservation('card--compact', { gap: '4px' }),
				},
				{
					key: 'card--spacious',
					id: 'card--spacious',
					status: 'captured',
					observation: makeObservation('card--spacious', { gap: '12px' }),
				},
			],
		});
		const cmpB = await writeCaptureSet(root, {
			kind: 'compare',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: '1111111',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{
					key: 'panel--compact',
					id: 'panel--compact',
					status: 'captured',
					observation: makeObservation('panel--compact', { gap: '4px' }),
				},
				{
					key: 'panel--spacious',
					id: 'panel--spacious',
					status: 'captured',
					observation: makeObservation('panel--spacious', { gap: '12px' }),
				},
			],
		});
		const decA = await recordDecision(root, {
			slug: 'card-density',
			question: 'Card density?',
			set: cmpA.run.set,
			chosen: 'card--compact',
			reason: 'Compact cards fit three columns.',
		});
		const decB = await recordDecision(root, {
			slug: 'panel-density',
			question: 'Panel density?',
			set: cmpB.run.set,
			chosen: 'panel--compact',
			reason: 'Compact panels avoid vertical scroll.',
		});
		if (!('decision' in decA) || !('decision' in decB)) throw new Error('Expected decisions');

		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'before',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: '1111111',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{
					key: 'card--compact',
					id: 'card--compact',
					status: 'captured',
					observation: makeObservation('card--compact', { gap: '4px' }),
				},
				{
					key: 'panel--compact',
					id: 'panel--compact',
					status: 'captured',
					observation: makeObservation('panel--compact', { gap: '4px' }),
				},
				{
					key: 'extra--plain',
					id: 'extra--plain',
					status: 'captured',
					observation: makeObservation('extra--plain', { gap: '4px' }),
				},
			],
		});
		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'after',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: '2222222',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{
					key: 'card--compact',
					id: 'card--compact',
					status: 'captured',
					observation: makeObservation('card--compact', { gap: '8px' }),
				},
				{
					key: 'panel--compact',
					id: 'panel--compact',
					status: 'captured',
					observation: makeObservation('panel--compact', { gap: '8px' }),
				},
				{
					key: 'extra--plain',
					id: 'extra--plain',
					status: 'captured',
					observation: makeObservation('extra--plain', { gap: '8px' }),
				},
			],
		});

		// 1. Filtered review on only extra--plain cannot settle card--compact or panel--compact.
		const filtered = await runReview(root, {
			before: 'before',
			after: 'after',
			ids: ['extra--plain'],
		});
		expect(filtered.open).toHaveLength(1);
		expect(filtered.open[0]?.decisions).toEqual([]);
		const filteredItemId = filtered.open[0]?.item ?? '';
		await recordDecision(root, {
			items: [filteredItemId],
			chosen: 'accept',
			reason: 'Accepted extra--plain alone.',
		});
		expect(
			(await runReview(root, { before: 'before', after: 'after', ids: ['extra--plain'] })).open
		).toEqual([]);

		// Unfiltered review MUST still show the full 3-member group open (unseen specimens were never authorized).
		const unfiltered = await runReview(root, { before: 'before', after: 'after' });
		expect(unfiltered.open).toHaveLength(1);
		const unfilteredItemId = unfiltered.open[0]?.item ?? '';
		expect(unfiltered.open[0]?.ids).toEqual(['card--compact', 'extra--plain', 'panel--compact']);
		expect(unfiltered.open[0]?.decisions.map((d) => d.decision).sort()).toEqual(
			[decA.decision, decB.decision].sort()
		);

		// 2. Accepting with only one superseded choice is refused; superseding both writes two successors.
		await expect(
			recordDecision(root, {
				items: [unfilteredItemId],
				chosen: 'accept',
				supersedes: decA.decision,
				reason: 'Missing second choice.',
			})
		).rejects.toMatchObject({
			code: 'SUPERSEDE_REQUIRED',
			message: expect.stringContaining(decB.decision),
		});

		const multi = await recordDecision(root, {
			items: [unfilteredItemId],
			chosen: 'accept',
			supersedes: [decA.decision, decB.decision],
			reason: 'Shared spacing token moved to 8px across cards and panels.',
		});
		expect('decisions' in multi).toBe(true);
		if (!('decisions' in multi)) throw new Error('Expected multi-choice result');
		expect(multi.decisions).toHaveLength(2);
		expect(multi.decisions.map((d) => d.chosen)).toEqual(['card--compact', 'panel--compact']);
		expect(multi.decisions.map((d) => d.supersedes)).toEqual([decA.decision, decB.decision]);

		const finalReview = await runReview(root, { before: 'before', after: 'after' });
		expect(finalReview.open).toEqual([]);
		expect(finalReview.settled.answered).toBe(1);
	});

	it('groups a 20-specimen token cause into 1 open item ordered largest-first, supports job prefixes, insufficient-evidence, and blocking failures', async () => {
		const root = await makeWorkspace();
		const beforeEntries = [];
		const afterEntries = [];

		// 20 specimens sharing one token cause (gap 4px -> 8px)
		for (let i = 1; i <= 20; i++) {
			const id = `token-specimen-${String(i).padStart(2, '0')}`;
			beforeEntries.push({
				key: id,
				id,
				status: 'captured' as const,
				observation: makeObservation(id, { gap: '4px' }),
			});
			afterEntries.push({
				key: id,
				id,
				status: 'captured' as const,
				observation: makeObservation(id, { gap: '8px' }),
			});
		}

		// 2 job steps with a different cause (padding 4px -> 12px)
		for (const step of [1, 2]) {
			const key = `edit-note/${step}`;
			beforeEntries.push({
				key,
				id: 'edit-note',
				step,
				status: 'captured' as const,
				observation: makeObservation('edit-note', { gap: '4px', padding: '4px' }),
			});
			afterEntries.push({
				key,
				id: 'edit-note',
				step,
				status: 'captured' as const,
				observation: makeObservation('edit-note', { gap: '4px', padding: '12px' }),
			});
		}

		// 1 insufficient-evidence specimen
		beforeEntries.push({
			key: 'shadow--partial',
			id: 'shadow--partial',
			status: 'captured' as const,
			observation: makeObservation('shadow--partial'),
		});
		afterEntries.push({
			key: 'shadow--partial',
			id: 'shadow--partial',
			status: 'captured' as const,
			observation: makeObservation('shadow--partial', { incompleteDom: true }),
		});

		// 1 axe-failed and 1 unavailable blocking specimen
		afterEntries.push({
			key: 'broken--a11y',
			id: 'broken--a11y',
			status: 'captured' as const,
			observation: makeObservation('broken--a11y', {
				axeStatus: 'failed',
				violations: [{ id: 'label', targets: ['input'] }],
			}),
		});
		afterEntries.push({
			key: 'broken--render',
			id: 'broken--render',
			status: 'unavailable' as const,
			reason: 'Module threw on mount',
		});

		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'before20',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: 'aaaa111',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: beforeEntries,
		});
		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'after20',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: 'bbbb222',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: afterEntries,
		});

		const review = await runReview(root, { before: 'before20', after: 'after20' });
		// 20-specimen cause is 1 single open item and comes FIRST (largest group first).
		expect(review.open).toHaveLength(3);
		expect(review.open[0]).toMatchObject({ kind: 'changed' });
		expect(review.open[0]?.ids).toHaveLength(20);
		expect(review.open[1]).toMatchObject({
			kind: 'changed',
			ids: ['edit-note/1', 'edit-note/2'],
		});
		expect(review.open[2]).toMatchObject({
			kind: 'insufficient-evidence',
			ids: ['shadow--partial'],
			limitation: expect.stringContaining('SHADOW_UNAVAILABLE'),
		});
		expect(review.blocking).toEqual([
			{ kind: 'axe-failed', ids: ['broken--a11y'], violations: ['label'] },
			{ kind: 'unavailable', ids: ['broken--render'], reason: 'Module threw on mount' },
		]);

		// Job prefix filtering matches edit-note/1 and edit-note/2.
		const jobOnly = await runReview(root, {
			before: 'before20',
			after: 'after20',
			ids: ['edit-note'],
		});
		expect(jobOnly.open).toHaveLength(1);
		expect(jobOnly.open[0]?.ids).toEqual(['edit-note/1', 'edit-note/2']);

		// Accepting insufficient-evidence settles it.
		const pageBefore = await readReviewPageData(root, {
			before: 'before20',
			after: 'after20',
			ids: ['shadow--partial'],
		});
		expect(pageBefore.open).toHaveLength(1);
		const shadowItemId = pageBefore.open[0]?.item ?? '';
		await recordDecision(root, {
			items: [shadowItemId],
			chosen: 'accept',
			reason: 'Closed shadow root checked manually.',
		});
		const pageAfter = await readReviewPageData(root, {
			before: 'before20',
			after: 'after20',
			ids: ['shadow--partial'],
		});
		expect(pageAfter.open).toEqual([]);
		expect(pageAfter.settled.answered).toBe(1);
		expect(pageAfter.matchedAnswers[0]?.decidedBy).toEqual({ kind: 'script' });
	});

	it('validates review requests and renders review.html markup', () => {
		expect(parseReviewRequest({ before: 'main', after: 'branch' })).toEqual({
			before: 'main',
			after: 'branch',
		});
		expect(parseReviewRequest({ before: 'main', after: 'branch', ids: ['a', 'b'] })).toEqual({
			before: 'main',
			after: 'branch',
			ids: ['a', 'b'],
		});
		expect(() => parseReviewRequest(null)).toThrow(/JSON object/);
		expect(() => parseReviewRequest({ before: 'main', after: 'branch', extra: 1 })).toThrow(
			/unknown option/
		);
		expect(() => parseReviewRequest({ before: 'main', after: '' })).toThrow(/non-empty/);
		expect(() => parseReviewRequest({ before: 'main', after: 'branch', ids: [] })).toThrow(
			/at least one/
		);
		expect(() => parseReviewRequest({ before: 'main', after: 'branch', ids: ['a', 'a'] })).toThrow(
			/duplicate id/
		);

		const html = renderReviewPageHtml();
		expect(html).toContain('Design review');
		expect(html).toContain('data-actor-badge');
		expect(html).toContain('./api/review.json?');
	});

	it('surfaces matching-hash insufficient-evidence, rejects mismatched axe sets, orders timestamps numerically, and resolves job buckets in >16-member groups', async () => {
		const root = await makeWorkspace();

		// 1. Identical content hash with incomplete required channel MUST raise insufficient-evidence, never settled.unchanged.
		const partialObs = makeObservation('shadow--same', { incompleteDom: true });
		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'partial-before',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: '1111111',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{ key: 'shadow--same', id: 'shadow--same', status: 'captured', observation: partialObs },
			],
		});
		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'partial-after',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: '2222222',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{ key: 'shadow--same', id: 'shadow--same', status: 'captured', observation: partialObs },
			],
		});
		const partialReview = await runReview(root, {
			before: 'partial-before',
			after: 'partial-after',
		});
		expect(partialReview.open).toHaveLength(1);
		expect(partialReview.open[0]?.kind).toBe('insufficient-evidence');
		expect(partialReview.settled.unchanged).toBe(0);

		// 2. Mismatched axe mode refuses with CAPTURES_INCOMPARABLE.
		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'no-axe-after',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: false,
			revision: '2222222',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{ key: 'shadow--same', id: 'shadow--same', status: 'captured', observation: partialObs },
			],
		});
		await expect(
			runReview(root, { before: 'partial-before', after: 'no-axe-after' })
		).rejects.toMatchObject({
			code: 'CAPTURES_INCOMPARABLE',
			message: expect.stringContaining('axe'),
		});

		// 3. Timestamp recency compares instants numerically (2026-11-12T15:20:00.500Z is newer than 2026-11-12T15:20:00Z).
		const partialItemId = partialReview.open[0]?.item ?? '';
		await recordDecision(
			root,
			{
				items: [partialItemId],
				chosen: 'reject',
				reason: 'Earlier rejection without fractional seconds.',
			},
			{ now: () => new Date('2026-11-12T15:20:00Z') }
		);
		await recordDecision(
			root,
			{
				items: [partialItemId],
				chosen: 'accept',
				reason: 'Newer acceptance 500ms later.',
			},
			{ now: () => new Date('2026-11-12T15:20:00.500Z') }
		);
		const recencyReview = await runReview(root, {
			before: 'partial-before',
			after: 'partial-after',
		});
		expect(recencyReview.blocking).toEqual([]);
		expect(recencyReview.open).toEqual([]);
		expect(recencyReview.settled.answered).toBe(1);

		// 4. Job-prefix bucket (3 steps) resolves cleanly inside a >16-member cause group.
		const bigBefore = [];
		const bigAfter = [];
		for (let i = 1; i <= 18; i++) {
			const id = `bulk-${String(i).padStart(2, '0')}`;
			bigBefore.push({
				key: id,
				id,
				status: 'captured' as const,
				observation: makeObservation(id, { gap: '4px' }),
			});
			bigAfter.push({
				key: id,
				id,
				status: 'captured' as const,
				observation: makeObservation(id, { gap: '8px' }),
			});
		}
		for (const step of [1, 2, 3]) {
			const key = `big-job/${step}`;
			bigBefore.push({
				key,
				id: 'big-job',
				step,
				status: 'captured' as const,
				observation: makeObservation('big-job', { gap: '4px' }),
			});
			bigAfter.push({
				key,
				id: 'big-job',
				step,
				status: 'captured' as const,
				observation: makeObservation('big-job', { gap: '8px' }),
			});
		}
		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'big-before',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: '1111111',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: bigBefore,
		});
		await writeCaptureSet(root, {
			kind: 'capture',
			label: 'big-after',
			context: lightContext,
			checkpoint: defaultCheckpoint,
			browser: { name: 'chromium', version: '130' },
			axe: true,
			revision: '2222222',
			dirty: false,
			skipped: { jobs: 0, gates: 0 },
			entries: bigAfter,
		});
		const jobReview = await runReview(root, {
			before: 'big-before',
			after: 'big-after',
			ids: ['big-job'],
		});
		expect(jobReview.open).toHaveLength(1);
		expect(jobReview.open[0]?.ids).toEqual(['big-job/1', 'big-job/2', 'big-job/3']);
		const jobAnswer = await recordDecision(root, {
			items: [jobReview.open[0]?.item ?? ''],
			chosen: 'accept',
			reason: 'Accepted 3-step job bucket inside 21-member cause group.',
		});
		expect('decision' in jobAnswer && jobAnswer.kind === 'answer').toBe(true);
		expect(
			(await runReview(root, { before: 'big-before', after: 'big-after', ids: ['big-job'] })).open
		).toEqual([]);
	});
});
