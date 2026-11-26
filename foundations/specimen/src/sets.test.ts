import * as fs from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	captureContentHash,
	computeSetId,
	diffCaptures,
	entryKind,
	isValidLabel,
	nearestSpecimenIds,
	readCaptureSetManifest,
	readSetCapture,
	resolveCaptureSetId,
	runCaptureSet,
	SET_ID_PATTERN,
	updateCaptureSetLabel,
	withFileLock,
	writeCaptureSet,
} from './sets.js';
import {
	CAPTURE_VERSION,
	type ElementObservation,
	NORMALIZATION_VERSION,
	type Observation,
	type SpecimenEntry,
} from './types.js';

vi.mock('node:fs/promises', { spy: true });

describe('a sharing error while taking a file lock', () => {
	const platform = Object.getOwnPropertyDescriptor(process, 'platform');
	const setPlatform = (value: NodeJS.Platform) =>
		Object.defineProperty(process, 'platform', { ...platform, value });
	const sharing = (code: string) => Object.assign(new Error('Pending deletion'), { code });
	afterEach(() => {
		if (platform) Object.defineProperty(process, 'platform', platform);
		vi.mocked(fs.open).mockReset();
	});

	it.each(['EPERM', 'EACCES', 'EBUSY'])(
		'is retried on Windows, where the old lock can be pending deletion (%s)',
		async (code) => {
			const lock = join(await scratchDir(), 'sharing.lock');
			setPlatform('win32');
			vi.mocked(fs.open).mockRejectedValueOnce(sharing(code));
			const work = vi.fn(async () => 'locked');
			await expect(withFileLock(lock, work)).resolves.toBe('locked');
			expect(work).toHaveBeenCalledOnce();
			expect(fs.open).toHaveBeenCalledTimes(2);
			await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
		}
	);

	it('is thrown at once on other platforms', async () => {
		const lock = join(await scratchDir(), 'sharing.lock');
		setPlatform('linux');
		vi.mocked(fs.open).mockRejectedValueOnce(sharing('EPERM'));
		const work = vi.fn(async () => 'locked');
		await expect(withFileLock(lock, work)).rejects.toMatchObject({ code: 'EPERM' });
		expect(work).not.toHaveBeenCalled();
		expect(fs.open).toHaveBeenCalledOnce();
	});
});

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'specimen-sets-'));
	directories.push(dir);
	return dir;
}

function makeElement(overrides: Partial<ElementObservation> = {}): ElementObservation {
	return {
		ref: 'root/button:1',
		tag: 'button',
		attributes: { type: 'button' },
		box: { x: 0, y: 0, width: 80, height: 32 },
		scroll: { width: 80, height: 32, clientWidth: 80, clientHeight: 32 },
		styles: { color: 'rgb(0, 0, 0)', padding: '8px' },
		state: { focused: false, value: '' },
		accessibility: { role: 'button', name: 'Save' },
		...overrides,
	};
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
	const complete = { status: 'complete' as const, scope: 'structured', reasons: [] };
	const base: Observation = {
		manifest: {
			captureVersion: CAPTURE_VERSION,
			normalizationVersion: NORMALIZATION_VERSION,
			specimenId: 'toolbar--dense',
			capturedUtc: '2026-11-23T00:00:00.000Z',
			bench: { name: '@lushly-dev/specimen', version: '2.2.0', plugins: [] },
			driver: { name: 'host', emulates: ['viewport', 'color-scheme'] },
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
			source: { revision: 'a1b2c3d', digest: 'src-digest', dirty: false },
			dependencies: 'lock-1',
			browser: { name: 'chromium', version: '151.0', platform: 'win32-x64', build: null },
			context: {
				viewport: { width: 1280, height: 800 },
				theme: 'light',
				locale: 'en-US',
				reducedMotion: 'no-preference',
				motion: 'natural',
				pixelRatio: 1,
				observed: {
					width: 1280,
					height: 800,
					media: true,
					colorScheme: 'light',
					contrast: 'no-preference',
					reducedMotion: 'no-preference',
					language: 'en-US',
					devicePixelRatio: 1,
				},
				resources: {
					fonts: [{ family: 'Inter', weight: '400', style: 'normal', status: 'loaded' }],
					remote: [],
				},
			},
		},
		channels: {
			dom: {
				raw: '<button type="button">Save</button>',
				normalized: '<button type="button">Save</button>',
			},
			a11y: {
				snapshot: '- button "Save"',
				axe: {
					status: 'passed',
					policy: 'error',
					violations: [],
					incomplete: 0,
					incompleteChecks: [],
					exceptions: [],
					engine: '4.14.0',
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
			elements: [makeElement()],
			console: { errors: [], warnings: [] },
			visual: { path: null },
		},
		completeness: {
			dom: complete,
			a11y: complete,
			layout: complete,
			styles: complete,
			tokens: {
				status: 'unsupported',
				scope: 'tokens',
				reasons: ['TOKEN_DETECTOR_NOT_IMPLEMENTED'],
			},
			events: { status: 'not-requested', scope: 'events', reasons: ['NO_EVENTS_DECLARED'] },
			visual: {
				status: 'not-requested',
				scope: 'appearance',
				reasons: ['SCREENSHOT_NOT_REQUESTED'],
			},
		},
	};
	return { ...base, ...overrides };
}

describe('captureContentHash and computeSetId', () => {
	it('ignores volatile fields and generated-id churn while remaining deterministic', () => {
		const a = makeObservation();
		const b = structuredClone(a);
		b.manifest.capturedUtc = '2026-11-24T12:34:56.000Z';
		b.manifest.checkpoint.ready.deadlineMs = 30_000;
		b.manifest.source = { revision: 'fffffff', digest: 'other', dirty: true };
		b.manifest.dependencies = 'lock-2';
		b.manifest.context.observed.width = 999;
		b.manifest.context.resources.remote = [
			{ url: 'http://127.0.0.1:4321/font.woff2', status: 200 },
		];
		b.channels.console.warnings = ['noisy warning'];
		b.channels.visual.path = '/tmp/different-screenshot.png';

		a.channels.dom.raw =
			'<button id="specimen-generated-1" aria-controls="specimen-generated-1">Save</button>';
		b.channels.dom.raw =
			'<button id="specimen-generated-99" aria-controls="specimen-generated-99">Save</button>';
		(a.channels.elements[0] as ElementObservation).attributes = {
			id: 'specimen-generated-1',
			'aria-controls': 'specimen-generated-1',
		};
		(b.channels.elements[0] as ElementObservation).attributes = {
			id: 'specimen-generated-99',
			'aria-controls': 'specimen-generated-99',
		};

		expect(captureContentHash(a)).toBe(captureContentHash(b));
	});

	it('produces a distinct capture content hash and set id for an event-only or scroll-only change', () => {
		const base = makeObservation();
		base.completeness.events = { status: 'complete', scope: 'declared events', reasons: [] };
		base.channels.events.declared = [{ type: 'change' }];
		base.channels.events.history = [
			{
				type: 'change',
				target: 'root/button:1',
				step: 'activate',
				composed: true,
				bubbles: true,
				trusted: true,
				detail: null,
			},
		];

		const eventChanged = structuredClone(base);
		eventChanged.channels.events.history = [];

		const scrollChanged = structuredClone(base);
		(scrollChanged.channels.elements[0] as ElementObservation).scroll.width = 160;

		const baseHash = captureContentHash(base);
		const eventHash = captureContentHash(eventChanged);
		const scrollHash = captureContentHash(scrollChanged);

		expect(eventHash).not.toBe(baseHash);
		expect(scrollHash).not.toBe(baseHash);
		expect(eventHash).not.toBe(scrollHash);

		const setInput = (hash: string) => ({
			context: {
				viewport: { width: 1280, height: 800 },
				theme: 'light' as const,
				locale: 'en-US',
				reducedMotion: 'no-preference' as const,
				motion: 'natural' as const,
			},
			checkpoint: {
				name: 'mount',
				actionMode: 'none' as const,
				baseline: {
					clock: 'real' as const,
					random: { source: 'seeded' as const, seed: 1 },
					storage: 'empty' as const,
				},
			},
			browser: { name: 'chromium', version: '151.0' },
			captureVersion: CAPTURE_VERSION,
			normalizationVersion: NORMALIZATION_VERSION,
			axe: true,
			captures: [{ key: 'toolbar--dense', status: 'captured' as const, hash }],
		});

		const baseSetId = computeSetId(setInput(baseHash));
		const eventSetId = computeSetId(setInput(eventHash));
		const scrollSetId = computeSetId(setInput(scrollHash));

		expect(baseSetId).toMatch(SET_ID_PATTERN);
		expect(eventSetId).not.toBe(baseSetId);
		expect(scrollSetId).not.toBe(baseSetId);
		expect(eventSetId).not.toBe(scrollSetId);
	});

	it('excludes event history when events completeness is not-requested or unsupported', () => {
		const a = makeObservation();
		const b = structuredClone(a);
		b.channels.events.history = [
			{
				type: 'click',
				target: null,
				step: null,
				composed: true,
				bubbles: true,
				trusted: true,
				detail: null,
			},
		];
		expect(captureContentHash(a)).toBe(captureContentHash(b));
	});

	it('detects axe incompleteChecks, completeness, and loaded font differences', () => {
		const base = makeObservation();
		const incomplete = structuredClone(base);
		if (incomplete.channels.a11y.axe !== 'not-run') {
			incomplete.channels.a11y.axe.incomplete = 1;
			incomplete.channels.a11y.axe.incompleteChecks = [
				{
					id: 'color-contrast',
					impact: 'serious',
					help: 'contrast',
					targets: ['p.hint'],
					details: [],
				},
			];
		}
		const partialLayout = structuredClone(base);
		partialLayout.completeness.layout = {
			status: 'partial',
			scope: 'limited',
			reasons: ['time-dependent'],
		};
		const diffFonts = structuredClone(base);
		diffFonts.manifest.context.resources.fonts = [
			{ family: 'Roboto', weight: '400', style: 'normal', status: 'loaded' },
		];

		const baseHash = captureContentHash(base);
		expect(captureContentHash(incomplete)).not.toBe(baseHash);
		expect(captureContentHash(partialLayout)).not.toBe(baseHash);
		expect(captureContentHash(diffFonts)).not.toBe(baseHash);
	});
});

describe('nearestSpecimenIds and entryKind', () => {
	it('ranks close typos first', () => {
		expect(
			nearestSpecimenIds('toolbar--dence', ['button--primary', 'toolbar--dense', 'toolbar--airy'])
		).toEqual(['toolbar--dense', 'toolbar--airy', 'button--primary']);
	});

	it('classifies component, story, gate, and job entries', () => {
		const base = { title: 'T', module: './a.ts', exportName: 'A' };
		expect(entryKind({ ...base, id: 'button--primary' })).toBe('component');
		expect(
			entryKind({
				...base,
				id: 'button--story',
				story: {
					name: 'Story',
					tags: [],
					play: 'absent',
					unresolved: [],
					annotations: { meta: [], story: [] },
				},
			})
		).toBe('story');
		expect(entryKind({ ...base, id: 'select--gate--escape-closes' })).toBe('component');
		expect(
			entryKind({
				...base,
				id: 'select--gate--escape-closes',
				kind: 'gate',
			} as unknown as SpecimenEntry)
		).toBe('gate');
		expect(
			entryKind({ ...base, id: 'keep-draft', job: { scenario: './a.yaml' } } as SpecimenEntry)
		).toBe('job');
	});
});

describe('capture set storage, runCaptureSet and diffCaptures', () => {
	it('persists sets, updates labels, appends revisions on re-capture, and diffs by { set, id }', async () => {
		const root = await scratchDir();
		const lightObs = makeObservation();
		const darkObs = structuredClone(lightObs);
		darkObs.manifest.context.theme = 'dark';
		darkObs.channels.dom.raw = '<button type="button" data-theme="dark">Save</button>';
		const shot = join(root, 'tmp-shot.png');
		await writeFile(shot, 'png-bytes');

		const first = await writeCaptureSet(root, {
			kind: 'capture',
			context: {
				viewport: { width: 1280, height: 800 },
				theme: 'light',
				locale: 'en-US',
				reducedMotion: 'no-preference',
				motion: 'natural',
			},
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				baseline: { clock: 'real', random: { source: 'seeded', seed: 1 }, storage: 'empty' },
			},
			browser: { name: 'chromium', version: '151.0' },
			axe: true,
			revision: 'a1b2c3d',
			dirty: false,
			label: 'main',
			entries: [
				{
					key: 'toolbar--dense',
					id: 'toolbar--dense',
					status: 'captured',
					observation: lightObs,
					screenshotSource: shot,
				},
				{
					key: 'example-job/4',
					id: 'example-job',
					status: 'captured',
					observation: lightObs,
					step: 4,
					checkpoint: 'conflict-notice',
					job: 'keep-a-draft',
				},
			],
			skipped: { jobs: 0, gates: 0 },
		});
		expect(first.run.set).toMatch(SET_ID_PATTERN);
		expect(first.run.label).toBe('main');
		expect(await resolveCaptureSetId(root, 'main')).toBe(first.run.set);

		// Re-capturing identical content at a second revision yields the same set id and appends revisions.
		const second = await writeCaptureSet(root, {
			kind: 'capture',
			context: first.manifest.context,
			checkpoint: first.manifest.checkpoint,
			browser: first.manifest.browser,
			axe: true,
			revision: 'd4e5f6a',
			dirty: true,
			label: 'main',
			entries: [
				{ key: 'toolbar--dense', id: 'toolbar--dense', status: 'captured', observation: lightObs },
				{
					key: 'example-job/4',
					id: 'example-job',
					status: 'captured',
					observation: lightObs,
					step: 4,
					checkpoint: 'conflict-notice',
					job: 'keep-a-draft',
				},
			],
			skipped: { jobs: 0, gates: 0 },
		});
		expect(second.run.set).toBe(first.run.set);
		const manifest = await readCaptureSetManifest(root, 'main');
		expect(manifest.createdUtc).toBe(first.manifest.createdUtc);
		expect(manifest.revisions).toHaveLength(2);
		expect(manifest.revisions[0]?.revision).toBe('a1b2c3d');
		expect(manifest.revisions[1]?.revision).toBe('d4e5f6a');

		// Screenshot was moved into the set directory and observation path updated; slash key round-trips.
		const savedDense = await readSetCapture(root, { set: 'main', id: 'toolbar--dense' });
		expect(savedDense.channels.visual.path).toContain('.specimen');
		expect((await stat(savedDense.channels.visual.path as string)).isFile()).toBe(true);
		const savedJobStep = await readSetCapture(root, { set: first.run.set, id: 'example-job/4' });
		expect(savedJobStep.manifest.specimenId).toBe('toolbar--dense');

		// Write a dark set and verify CAPTURES_INCOMPARABLE + allowContextDifferences + CAPTURE_SET_NOT_FOUND.
		const dark = await writeCaptureSet(root, {
			kind: 'capture',
			context: { ...first.manifest.context, theme: 'dark' },
			checkpoint: first.manifest.checkpoint,
			browser: first.manifest.browser,
			axe: true,
			revision: 'a1b2c3d',
			dirty: false,
			label: 'dark',
			entries: [
				{ key: 'toolbar--dense', id: 'toolbar--dense', status: 'captured', observation: darkObs },
			],
			skipped: { jobs: 0, gates: 0 },
		});

		await expect(
			diffCaptures(root, {
				left: { set: 'main', id: 'toolbar--dense' },
				right: { set: dark.run.set, id: 'toolbar--dense' },
			})
		).rejects.toMatchObject({
			code: 'CAPTURES_INCOMPARABLE',
			message: expect.stringContaining('context.theme'),
			suggestion: expect.stringContaining('allowContextDifferences'),
		});

		const allowed = await diffCaptures(root, {
			left: { set: 'main', id: 'toolbar--dense' },
			right: { set: 'dark', id: 'toolbar--dense' },
			allowContextDifferences: ['theme'],
		});
		expect(allowed.status).toBe('changed');

		await expect(
			diffCaptures(root, {
				left: { set: 'nonexistent', id: 'toolbar--dense' },
				right: { set: 'main', id: 'toolbar--dense' },
			})
		).rejects.toMatchObject({
			code: 'CAPTURE_SET_NOT_FOUND',
			suggestion: expect.stringContaining('specimen-capture'),
		});

		await expect(readSetCapture(root, { set: 'main', id: 'toolbar--dence' })).rejects.toMatchObject(
			{
				code: 'SPECIMEN_NOT_FOUND',
				suggestion: expect.stringContaining('toolbar--dense'),
			}
		);
	});

	it('skips jobs and gates by default, counts orthogonal axe incomplete, and records theme-unavailable entries', async () => {
		const root = await scratchDir();
		const entries: SpecimenEntry[] = [
			{ id: 'toolbar--dense', title: 'Toolbar/Dense', module: './t.ts', exportName: 'Dense' },
			{
				id: 'toolbar--airy',
				title: 'Toolbar/Airy',
				module: './t.ts',
				exportName: 'Airy',
				themes: { supported: ['light'], basis: 'declared', reason: 'Dark styles not written yet' },
			},
			{ id: 'toolbar--grouped', title: 'Toolbar/Grouped', module: './t.ts', exportName: 'Grouped' },
			{ id: 'list--empty', title: 'List/Empty', module: './l.ts', exportName: 'Empty' },
			{
				id: 'toolbar--gate--demo',
				title: 'Toolbar/Gate Demo',
				module: './t.ts',
				exportName: 'GateDemo',
			},
			{
				id: 'select--gate--escape-closes',
				title: 'Select/Gate',
				module: './s.ts',
				exportName: 'Gate',
				kind: 'gate',
			} as unknown as SpecimenEntry,
			{
				id: 'notes--keep-draft',
				title: 'Notes/Keep draft',
				module: './n.ts',
				exportName: 'Notes',
				job: { scenario: './keep-draft.scenario.yaml' },
			} as SpecimenEntry,
		];

		const prepare = vi.fn(async () => {});
		const render = vi.fn(
			async ({
				entry,
				context,
				screenshot,
			}: {
				entry: SpecimenEntry;
				context: { theme: 'light' | 'dark' | 'high-contrast' };
				screenshot: string;
			}) => {
				await writeFile(screenshot, 'png');
				const obs = makeObservation();
				obs.manifest.specimenId = entry.id;
				obs.manifest.context.theme = context.theme;
				obs.channels.visual.path = screenshot;
				if (entry.id === 'toolbar--grouped') {
					obs.channels.a11y.axe = {
						status: 'failed',
						policy: 'error',
						violations: [
							{
								id: 'color-contrast',
								impact: 'serious',
								help: 'contrast',
								targets: ['span'],
								details: [],
							},
						],
						incomplete: 0,
						incompleteChecks: [],
						exceptions: [],
					};
				} else if (entry.id === 'list--empty') {
					obs.channels.a11y.axe = {
						status: 'passed',
						policy: 'error',
						violations: [],
						incomplete: 1,
						incompleteChecks: [
							{
								id: 'color-contrast',
								impact: 'serious',
								help: 'bg image',
								targets: ['p.hint'],
								details: [],
							},
						],
						exceptions: [],
					};
				}
				return obs;
			}
		);

		const host = {
			root,
			entries,
			workers: 2,
			prepare,
			sourceState: async () => ({ revision: 'a1b2c3d', dirty: false }),
			render,
		};

		const main = await runCaptureSet(host, { label: 'main' });
		expect(main).toMatchObject({
			label: 'main',
			revision: 'a1b2c3d',
			dirty: false,
			counts: {
				captured: 5,
				unavailable: 0,
				axe: { passed: 4, failed: 1, incomplete: 1 },
			},
			unavailable: [],
			skipped: { jobs: 1, gates: 1, next: 'specimen-job-run', gatesNext: 'specimen-run' },
		});
		// Ordinary specimens containing '--gate--' in their id are NOT skipped; only explicit gate entries are.
		expect(entryKind(entries[4] as SpecimenEntry)).toBe('component');
		expect(entryKind(entries[5] as SpecimenEntry)).toBe('gate');

		// Dark subset marks light-only toolbar--airy unavailable without rendering it.
		render.mockClear();
		const dark = await runCaptureSet(host, {
			ids: ['toolbar--dense', 'toolbar--airy'],
			context: { theme: 'dark' },
			label: 'main-dark',
		});
		expect(render).toHaveBeenCalledTimes(1);
		expect(dark).toMatchObject({
			label: 'main-dark',
			counts: { captured: 1, unavailable: 1 },
			unavailable: [{ id: 'toolbar--airy', reason: expect.stringContaining('light') }],
			skipped: { jobs: 0, gates: 0 },
		});

		// Explicit unknown id fails before preparing or rendering anything.
		prepare.mockClear();
		render.mockClear();
		await expect(runCaptureSet(host, { ids: ['toolbar--dence'] })).rejects.toMatchObject({
			code: 'SPECIMEN_NOT_FOUND',
			message: expect.stringContaining('toolbar--dence'),
			suggestion: expect.stringContaining('toolbar--dense'),
		});
		expect(prepare).not.toHaveBeenCalled();
		expect(render).not.toHaveBeenCalled();

		// filter.kind including 'gate' captures gate entries without skipping them.
		const gatesOnly = await runCaptureSet(host, { filter: { kind: ['gate'] } });
		expect(gatesOnly.counts.captured).toBe(1);
		expect(gatesOnly.skipped).toEqual({ jobs: 0, gates: 0 });
	});

	it('keeps a 142-specimen Loam-sized capture response under 4 KB with no observation payload', async () => {
		const root = await scratchDir();
		const entries: SpecimenEntry[] = Array.from({ length: 142 }, (_, index) => ({
			id: `loam-screen-${String(index + 1).padStart(3, '0')}`,
			title: `Loam/Screen ${index + 1}`,
			module: './screens.specimens.ts',
			exportName: `Screen${index + 1}`,
		}));
		const result = await runCaptureSet(
			{
				root,
				entries,
				workers: 4,
				prepare: async () => {},
				sourceState: async () => ({
					revision: 'dbc8461100000000000000000000000000000000',
					dirty: false,
				}),
				render: async ({ entry }) => {
					const obs = makeObservation();
					obs.manifest.specimenId = entry.id;
					return obs;
				},
			},
			{ label: 'main' }
		);
		const json = JSON.stringify(result);
		expect(result.counts.captured).toBe(142);
		expect(Buffer.byteLength(json, 'utf8')).toBeLessThan(4096);
		expect(json).not.toContain('channels');
		expect(json).not.toContain('normalized');
		// Confirm labels file was written cleanly.
		const labels = JSON.parse(await readFile(join(root, '.specimen', 'labels.json'), 'utf8'));
		expect(labels.main).toBe(result.set);
	});

	it('rejects set-id-shaped labels, handles case-distinct ids, theme mismatches, --no-axe, concurrency, and store containment', async () => {
		const root = await scratchDir();
		const outside = await scratchDir();
		await writeFile(join(outside, 'secret.json'), '{"secret":true}', 'utf8');

		// Labels matching set-<12hex> are rejected so they never collide with set id resolution.
		expect(isValidLabel('set-0123456789ab')).toBe(false);
		expect(isValidLabel('set-main')).toBe(true);
		await expect(
			updateCaptureSetLabel(root, 'set-0123456789ab', 'set-abcdef012345')
		).rejects.toThrow(/Invalid capture set label/);

		// Missing set id does not suggest creating a label named after the set id.
		await expect(resolveCaptureSetId(root, 'set-0123456789ab')).rejects.toMatchObject({
			code: 'CAPTURE_SET_NOT_FOUND',
			suggestion: expect.not.stringContaining('label "set-0123456789ab"'),
		});

		// Case-distinct ids ('Button' and 'button') do not collide on case-insensitive filesystems.
		const upperObs = makeObservation({
			channels: {
				...makeObservation().channels,
				dom: { raw: '<button>Upper</button>', normalized: '<button>Upper</button>' },
			},
		});
		upperObs.manifest.specimenId = 'Button';
		const lowerObs = makeObservation({
			channels: {
				...makeObservation().channels,
				dom: { raw: '<button>Lower</button>', normalized: '<button>Lower</button>' },
			},
		});
		lowerObs.manifest.specimenId = 'button';
		const caseEntries: SpecimenEntry[] = [
			{ id: 'Button', title: 'Button/Upper', module: './b.ts', exportName: 'Upper' },
			{ id: 'button', title: 'Button/Lower', module: './b.ts', exportName: 'Lower' },
		];
		const caseRun = await runCaptureSet(
			{
				root,
				entries: caseEntries,
				workers: 2,
				prepare: async () => {},
				sourceState: async () => ({ revision: '1111111', dirty: false }),
				render: async ({ entry, screenshot }) => {
					await writeFile(screenshot, entry.id);
					const obs = entry.id === 'Button' ? structuredClone(upperObs) : structuredClone(lowerObs);
					obs.channels.visual.path = screenshot;
					return obs;
				},
			},
			{ label: 'case-check' }
		);
		expect(caseRun.counts.captured).toBe(2);
		const readUpper = await readSetCapture(root, { set: 'case-check', id: 'Button' });
		const readLower = await readSetCapture(root, { set: 'case-check', id: 'button' });
		expect(readUpper.channels.dom.raw).toContain('Upper');
		expect(readLower.channels.dom.raw).toContain('Lower');
		expect(readUpper.channels.visual.path).not.toBe(readLower.channels.visual.path);
		expect(await readFile(readUpper.channels.visual.path as string, 'utf8')).toBe('Button');
		expect(await readFile(readLower.channels.visual.path as string, 'utf8')).toBe('button');

		// Prototype keys return clean not-found errors instead of reading Object.prototype.
		await expect(readSetCapture(root, { set: 'case-check', id: 'toString' })).rejects.toMatchObject(
			{
				code: 'SPECIMEN_NOT_FOUND',
				message: expect.stringContaining('Capture not found'),
			}
		);
		await expect(resolveCaptureSetId(root, 'constructor')).rejects.toMatchObject({
			code: 'CAPTURE_SET_NOT_FOUND',
		});

		// Rendered theme mismatch (e.g. theme-pinned story) marks entry unavailable and removes screenshot.
		const pinnedRun = await runCaptureSet(
			{
				root,
				entries: [{ id: 'pinned', title: 'Pinned', module: './p.ts', exportName: 'Pinned' }],
				workers: 1,
				prepare: async () => {},
				sourceState: async () => ({ revision: '1111111', dirty: false }),
				render: async ({ screenshot }) => {
					await writeFile(screenshot, 'png');
					const obs = makeObservation();
					obs.manifest.specimenId = 'pinned';
					obs.manifest.context.theme = 'dark';
					obs.channels.visual.path = screenshot;
					return obs;
				},
			},
			{ context: { theme: 'light' } }
		);
		expect(pinnedRun.counts.captured).toBe(0);
		expect(pinnedRun.counts.unavailable).toBe(1);
		expect(pinnedRun.unavailable[0]?.reason).toContain('dark');
		expect(pinnedRun.unavailable[0]?.reason).toContain('light');

		// axe: false strips any axe object returned by a host and records AXE_NOT_RUN.
		const noAxeRun = await runCaptureSet(
			{
				root,
				entries: [{ id: 'plain', title: 'Plain', module: './p.ts', exportName: 'Plain' }],
				workers: 1,
				prepare: async () => {},
				sourceState: async () => ({ revision: '1111111', dirty: false }),
				render: async () => makeObservation(),
			},
			{ axe: false }
		);
		expect(noAxeRun.counts.axe).toEqual({ passed: 0, failed: 0, incomplete: 0 });
		const noAxeObs = await readSetCapture(root, { set: noAxeRun.set, id: 'plain' });
		expect(noAxeObs.channels.a11y.axe).toBe('not-run');
		expect(noAxeObs.completeness.a11y.reasons).toContain('AXE_NOT_RUN');

		// Concurrent label updates and concurrent same-set revision writes do not lose entries.
		await Promise.all(
			['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((label) =>
				updateCaptureSetLabel(root, label, caseRun.set)
			)
		);
		const labels = JSON.parse(await readFile(join(root, '.specimen', 'labels.json'), 'utf8'));
		for (const label of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
			expect(labels[label]).toBe(caseRun.set);
		}
		const baseManifest = await readCaptureSetManifest(root, caseRun.set);
		await Promise.all(
			['rev-1', 'rev-2', 'rev-3', 'rev-4'].map((rev) =>
				writeCaptureSet(root, {
					kind: 'capture',
					context: baseManifest.context,
					checkpoint: baseManifest.checkpoint,
					browser: baseManifest.browser,
					axe: true,
					revision: rev,
					dirty: false,
					entries: [
						{ key: 'Button', id: 'Button', status: 'captured', observation: upperObs },
						{ key: 'button', id: 'button', status: 'captured', observation: lowerObs },
					],
					skipped: { jobs: 0, gates: 0 },
				})
			)
		);
		const mergedManifest = await readCaptureSetManifest(root, caseRun.set);
		const recordedRevs = new Set(mergedManifest.revisions.map((r) => r.revision));
		expect(recordedRevs.has('1111111')).toBe(true);
		for (const rev of ['rev-1', 'rev-2', 'rev-3', 'rev-4']) {
			expect(recordedRevs.has(rev)).toBe(true);
		}

		// Tampered manifest.set traversal is refused.
		const tamperedSetId = 'set-deadbeef0001';
		const tamperedDir = join(root, '.specimen', 'sets', tamperedSetId);
		await mkdir(tamperedDir, { recursive: true });
		await writeFile(
			join(tamperedDir, 'manifest.json'),
			JSON.stringify({ ...baseManifest, set: '../../..' }),
			'utf8'
		);
		await expect(readCaptureSetManifest(root, tamperedSetId)).rejects.toThrow(
			/does not match directory id/
		);
		await expect(readSetCapture(root, { set: tamperedSetId, id: 'Button' })).rejects.toThrow(
			/does not match directory id/
		);

		// Symlink / junction escape inside a set directory is refused on read and write.
		const escapedSetId = 'set-deadbeef0002';
		const escapedDir = join(root, '.specimen', 'sets', escapedSetId);
		await mkdir(escapedDir, { recursive: true });
		await symlink(
			outside,
			join(escapedDir, 'captures'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		await writeFile(
			join(escapedDir, 'manifest.json'),
			JSON.stringify({
				...baseManifest,
				set: escapedSetId,
				captures: {
					Button: {
						...baseManifest.captures.Button,
						observation: 'captures/secret.json',
					},
				},
			}),
			'utf8'
		);
		await expect(readSetCapture(root, { set: escapedSetId, id: 'Button' })).rejects.toThrow(
			/escapes capture set directory/
		);

		const escapeRoot = await scratchDir();
		await symlink(
			outside,
			join(escapeRoot, '.specimen'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		await expect(updateCaptureSetLabel(escapeRoot, 'main', caseRun.set)).rejects.toThrow(
			/escapes root/
		);
	});

	it('runs job specimens through host.runJob during specimen-capture when configured and skips them with reason otherwise', async () => {
		const root = await scratchDir();
		const componentEntry: SpecimenEntry = {
			id: 'toolbar--dense',
			title: 'Toolbar/Dense',
			module: './t.ts',
			exportName: 'Dense',
		};
		const jobEntry: SpecimenEntry = {
			id: 'notes-keep-a-draft',
			title: 'Notes/Keep a draft',
			module: './n.ts',
			exportName: 'Notes',
			job: {
				scenario: './keep-a-draft.scenario.yaml',
				target: 'app',
				captures: [{ after: 'The note opens', name: 'two-editors' }],
			},
		};

		// Without runJob configured, specimen-capture skips job entries with an actionable reason.
		const skippedRun = await runCaptureSet(
			{
				root,
				entries: [componentEntry, jobEntry],
				workers: 1,
				prepare: async () => {},
				sourceState: async () => ({ revision: '1111111', dirty: false }),
				render: async ({ entry }) => {
					const obs = makeObservation();
					obs.manifest.specimenId = entry.id;
					return obs;
				},
			},
			{ label: 'no-runner' }
		);
		expect(skippedRun.counts.captured).toBe(1);
		expect(skippedRun.skipped).toMatchObject({
			jobs: 1,
			gates: 0,
			next: 'specimen-job-run',
			reason: expect.stringContaining('runner'),
		});

		// With runJob configured, specimen-capture executes job specimens and stores <id>/<step> captures.
		const jobObs = makeObservation();
		jobObs.manifest.specimenId = jobEntry.id;
		jobObs.manifest.checkpoint.name = 'two-editors';
		jobObs.manifest.job = { name: 'keep-a-draft', step: 3, description: 'The note opens' };
		const runJob = vi.fn(async ({ entry }: { entry: SpecimenEntry }) => [
			{
				key: `${entry.id}/3`,
				id: entry.id,
				status: 'captured' as const,
				observation: jobObs,
				checkpoint: 'two-editors',
				step: 3,
				job: 'keep-a-draft',
			},
		]);
		const withRunner = await runCaptureSet(
			{
				root,
				entries: [componentEntry, jobEntry],
				workers: 1,
				prepare: async () => {},
				sourceState: async () => ({ revision: '1111111', dirty: false }),
				render: async ({ entry }) => {
					const obs = makeObservation();
					obs.manifest.specimenId = entry.id;
					return obs;
				},
				runJob,
			},
			{ label: 'with-runner' }
		);
		expect(runJob).toHaveBeenCalledTimes(1);
		expect(withRunner.counts.captured).toBe(2);
		expect(withRunner.skipped).toEqual({ jobs: 0, gates: 0 });
		const savedJobCapture = await readSetCapture(root, {
			set: 'with-runner',
			id: 'notes-keep-a-draft/3',
		});
		expect(savedJobCapture.manifest.job?.step).toBe(3);

		// Job-first entry ordering produces the exact same set id and preserves the component's 'mount' checkpoint.
		const jobFirst = await runCaptureSet(
			{
				root,
				entries: [jobEntry, componentEntry],
				workers: 1,
				prepare: async () => {},
				sourceState: async () => ({ revision: '1111111', dirty: false }),
				render: async ({ entry }) => {
					const obs = makeObservation();
					obs.manifest.specimenId = entry.id;
					return obs;
				},
				runJob,
			},
			{ label: 'job-first' }
		);
		expect(jobFirst.set).toBe(withRunner.set);
		const jobFirstManifest = await readCaptureSetManifest(root, 'job-first');
		expect(jobFirstManifest.checkpoint.name).toBe('mount');
		expect(jobFirstManifest.captures['notes-keep-a-draft/3']?.checkpoint).toBe('two-editors');
	});
});
