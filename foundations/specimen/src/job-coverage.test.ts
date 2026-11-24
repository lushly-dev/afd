import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { computeCoverage, UNREACHED_PREFIX } from './coverage.js';
import {
	computeJobCoverage,
	JOBS_COVERAGE_OBLIGATIONS,
	type JobCoverageCapture,
} from './job-coverage.js';
import type { ComponentSchema } from './plugin.js';
import { coverageRunSchema } from './schema.js';
import { readCaptureSetManifest, runCaptureSet, writeCaptureSet } from './sets.js';
import {
	CAPTURE_VERSION,
	type ElementObservation,
	NORMALIZATION_VERSION,
	type Observation,
} from './types.js';

const tempDirs: string[] = [];
afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'specimen-job-coverage-'));
	tempDirs.push(dir);
	return dir;
}

function makeElement(
	tag: string,
	ref: string,
	attributes: Record<string, string> = {},
	state: Record<string, string | number | boolean | null> = {}
): ElementObservation {
	return {
		ref,
		tag,
		attributes,
		box: { x: 0, y: 0, width: 120, height: 32 },
		scroll: { width: 120, height: 32, clientWidth: 120, clientHeight: 32 },
		styles: {},
		state,
	};
}

function makeObservation(options: {
	specimenId: string;
	checkpoint: string;
	elements: ElementObservation[];
	job?: { name: string; step: number; description: string };
}): Observation {
	return {
		manifest: {
			captureVersion: CAPTURE_VERSION,
			normalizationVersion: NORMALIZATION_VERSION,
			specimenId: options.specimenId,
			capturedUtc: '2026-11-23T00:00:00.000Z',
			bench: { name: '@lushly-dev/specimen', version: '2.2.0', plugins: [] },
			driver: { name: 'host', emulates: ['viewport'] },
			checkpoint: {
				name: options.checkpoint,
				actionMode: options.job ? 'real-input' : 'none',
				ready: { steps: [], outcome: 'ready', deadlineMs: 10_000 },
				baseline: {
					clock: 'real',
					random: { source: 'seeded', seed: 1 },
					storage: 'empty',
				},
			},
			source: { revision: 'abc1234', digest: 'deadbeef', dirty: false },
			dependencies: 'lock',
			browser: { name: 'chromium', version: '130.0.0.0', platform: 'linux-x64', build: null },
			...(options.job ? { job: options.job } : {}),
			context: {
				viewport: { width: 1280, height: 720 },
				theme: 'light',
				locale: 'en-US',
				reducedMotion: 'no-preference',
				motion: 'natural',
				pixelRatio: 1,
				observed: {
					width: 1280,
					height: 720,
					media: true,
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
			dom: { raw: '<div></div>', normalized: '<div></div>' },
			a11y: { snapshot: '', axe: 'not-run' },
			events: { declared: [], history: [] },
			evidence: {
				expectations: [],
				claims: [],
				commands: [],
				formData: [],
				validity: [],
				attributesSet: [],
			},
			elements: options.elements,
			console: { errors: [], warnings: [] },
			visual: { path: null },
		},
		completeness: {
			dom: { status: 'complete', scope: 'dom', reasons: [] },
			a11y: { status: 'partial', scope: 'a11y', reasons: ['AXE_NOT_RUN'] },
			layout: { status: 'complete', scope: 'layout', reasons: [] },
			styles: { status: 'complete', scope: 'styles', reasons: [] },
			tokens: { status: 'unsupported', scope: 'tokens', reasons: [] },
			events: { status: 'not-requested', scope: 'events', reasons: [] },
			visual: { status: 'not-requested', scope: 'visual', reasons: [] },
		},
	};
}

const noticeSchema: ComponentSchema = {
	tag: 'example-notice',
	sources: ['manifest'],
	properties: [
		{
			name: 'variant',
			attribute: 'variant',
			type: "'warning' | 'error'",
			values: ['warning', 'error'],
		},
	],
	attributes: [],
	slots: [],
	events: [],
	cssProperties: [],
	commands: [],
	unknown: ['commands'],
};

const bannerSchema: ComponentSchema = {
	tag: 'example-banner',
	sources: ['manifest'],
	properties: [
		{
			name: 'tone',
			attribute: 'tone',
			type: "'info' | 'alert'",
			values: ['info', 'alert'],
		},
	],
	attributes: [],
	slots: [],
	events: [],
	cssProperties: [],
	commands: [],
	unknown: ['commands'],
};

const chipSchema: ComponentSchema = {
	tag: 'example-chip',
	sources: ['manifest'],
	properties: [
		{
			name: 'size',
			attribute: 'size',
			type: "'small' | 'medium'",
			values: ['small', 'medium'],
		},
	],
	attributes: [],
	slots: [],
	events: [],
	cssProperties: [],
	commands: [],
	unknown: ['commands'],
};

describe('jobs@1 computeJobCoverage', () => {
	it('reports reachedBy ({ key, name, step }), unreached partitions, and reason when no job renders a component', () => {
		const captures: JobCoverageCapture[] = [
			{
				key: 'example-keep-a-draft/4',
				name: 'conflict-notice',
				step: 4,
				observation: makeObservation({
					specimenId: 'example-keep-a-draft',
					checkpoint: 'conflict-notice',
					job: { name: 'keep-a-draft', step: 4, description: 'Another writer saves the note' },
					elements: [
						makeElement('example-notice', 'root/example-notice:1', { variant: 'warning' }),
						makeElement('example-notice', 'root/example-notice:2', { variant: 'warning' }),
						makeElement('example-chip', 'root/example-chip:1', { size: 'medium' }),
					],
				}),
			},
		];

		const report = computeJobCoverage([noticeSchema, bannerSchema, chipSchema], captures, {
			version: '2026-11-23',
			entries: [
				{
					component: 'example-chip',
					obligation: 'unreached:size=small',
					reason: 'Small chips appear only in a settings dialog no job opens.',
				},
				{
					// schema-partitions@1 waiver must be ignored by jobs@1 (not reported as unused).
					component: 'example-notice',
					obligation: 'default',
					reason: 'Ignored by jobs@1.',
				},
				{
					component: 'example-chip',
					obligation: 'unreached:size=tiny',
					reason: 'Stale waiver for removed partition.',
				},
			],
		});

		const notice = report.components.find((c) => c.tag === 'example-notice');
		expect(notice?.cases).toBe(1);
		expect(notice?.jobs).toEqual({
			reachedBy: [{ key: 'example-keep-a-draft/4', name: 'conflict-notice', step: 4 }],
			unreached: ['variant=error'],
		});
		expect(notice?.obligations.find((o) => o.id === 'unreached:variant=warning')).toMatchObject({
			level: 'represented',
			evidenceCount: 2,
		});
		expect(notice?.obligations.find((o) => o.id === 'unreached:variant=error')).toMatchObject({
			level: 'missing',
			reason: 'No job capture shows variant as error.',
		});

		const banner = report.components.find((c) => c.tag === 'example-banner');
		expect(banner?.cases).toBe(0);
		expect(banner?.jobs).toEqual({
			reachedBy: [],
			unreached: ['tone=info', 'tone=alert'],
			reason: 'No job capture renders <example-banner>.',
		});

		const chip = report.components.find((c) => c.tag === 'example-chip');
		expect(chip?.jobs).toEqual({
			reachedBy: [{ key: 'example-keep-a-draft/4', name: 'conflict-notice', step: 4 }],
			unreached: [],
		});
		expect(chip?.obligations.find((o) => o.id === 'unreached:size=small')?.waiver).toBe(
			'Small chips appear only in a settings dialog no job opens.'
		);
		expect(report.waived).toBe(1);
		expect(report.unusedWaivers).toEqual([
			{
				component: 'example-chip',
				obligation: 'unreached:size=tiny',
				reason: 'Stale waiver for removed partition.',
			},
		]);
		expect(report.complete).toBe(false);

		// Narrowing to the fully-covered/waived chip alone is complete.
		const chipOnly = computeJobCoverage([chipSchema], captures, {
			version: '2026-11-23',
			entries: [
				{
					component: 'example-chip',
					obligation: 'unreached:size=small',
					reason: 'Small chips appear only in a settings dialog no job opens.',
				},
			],
		});
		expect(chipOnly.complete).toBe(true);
		expect(chipOnly.waived).toBe(1);
		expect(chipOnly.components[0]?.jobs?.unreached).toEqual([]);
	});

	it('orders reachedBy deterministically by specimen id and numeric step, and handles slots and unobservable properties honestly', () => {
		const slottedSchema: ComponentSchema = {
			tag: 'example-card',
			sources: ['manifest'],
			properties: [
				{ name: 'secretMode', type: "'a' | 'b'", values: ['a', 'b'] }, // not reflected to an attribute
			],
			attributes: [],
			slots: [{ name: '' }, { name: 'footer' }],
			events: [],
			cssProperties: [],
			commands: [],
			unknown: ['commands'],
		};
		const captures: JobCoverageCapture[] = [
			{
				key: 'job-a/10',
				name: 'tenth',
				step: 10,
				observation: makeObservation({
					specimenId: 'job-a',
					checkpoint: 'tenth',
					job: { name: 'a', step: 10, description: 'Step 10' },
					elements: [
						makeElement(
							'example-card',
							'root/example-card:1',
							{},
							{ 'slot:': 1, 'slot:footer': 0 }
						),
					],
				}),
			},
			{
				key: 'job-a/2',
				name: 'second',
				step: 2,
				observation: makeObservation({
					specimenId: 'job-a',
					checkpoint: 'second',
					job: { name: 'a', step: 2, description: 'Step 2' },
					elements: [
						makeElement(
							'example-card',
							'root/example-card:1',
							{},
							{ 'slot:': 1, 'slot:footer': 0 }
						),
					],
				}),
			},
		];

		const report = computeJobCoverage([slottedSchema], captures);
		const card = report.components[0];
		expect(card?.jobs?.reachedBy).toEqual([
			{ key: 'job-a/2', name: 'second', step: 2 },
			{ key: 'job-a/10', name: 'tenth', step: 10 },
		]);
		// Unobservable non-reflected property stays unknown (not guessed as unreached).
		expect(card?.obligations.find((o) => o.id === 'unreached:secretMode=a')?.level).toBe('unknown');
		expect(card?.obligations.find((o) => o.id === 'unreached:secretMode=b')?.level).toBe('unknown');
		expect(card?.jobs?.unreached).toEqual(['slot:default=empty', 'slot:footer=filled']);
		expect(report.complete).toBe(false);
	});

	it('leaves schema-partitions@1 computeCoverage completely unchanged when unreached:* waivers are present', () => {
		const cases = [
			{
				id: 'chip-case',
				observation: makeObservation({
					specimenId: 'chip-case',
					checkpoint: 'after-run',
					elements: [makeElement('example-chip', 'root/example-chip:1', { size: 'medium' })],
				}),
			},
		];
		const baseWaivers = {
			version: '2026-11-23',
			entries: [
				{ component: 'example-chip', obligation: 'default', reason: 'Same as medium.' },
				{ component: 'example-chip', obligation: 'property:gone=true', reason: 'Removed.' },
			],
		};
		const withJobsWaiver = {
			version: '2026-11-23',
			entries: [
				...baseWaivers.entries,
				{
					component: 'example-chip',
					obligation: `${UNREACHED_PREFIX}size=small`,
					reason: 'Only in settings dialog.',
				},
			],
		};
		const withoutJobsWaiver = computeCoverage([chipSchema], cases, baseWaivers);
		const withJobsWaiverResult = computeCoverage([chipSchema], cases, withJobsWaiver);
		expect(withJobsWaiverResult).toEqual(withoutJobsWaiver);
		expect(withJobsWaiverResult.components[0]?.jobs).toBeUndefined();
	});

	it('preserves recorded null property values in element.state instead of classifying the property as unknown', () => {
		const nullableSchema: ComponentSchema = {
			tag: 'example-toggle',
			sources: ['manifest'],
			properties: [{ name: 'mode', type: "null | 'on'", values: [null, 'on'] }],
			attributes: [],
			slots: [],
			events: [],
			cssProperties: [],
			commands: [],
			unknown: ['commands'],
		};
		const captures: JobCoverageCapture[] = [
			{
				key: 'job-toggle/1',
				name: 'initial',
				step: 1,
				observation: makeObservation({
					specimenId: 'job-toggle',
					checkpoint: 'initial',
					job: { name: 'toggle', step: 1, description: 'Initial' },
					elements: [
						makeElement('example-toggle', 'root/example-toggle:1', {}, { 'prop:mode': null }),
					],
				}),
			},
		];

		const report = computeJobCoverage([nullableSchema], captures);
		const toggle = report.components[0];
		expect(toggle?.obligations.find((o) => o.id === 'unreached:mode=null')?.level).toBe(
			'represented'
		);
		expect(toggle?.obligations.find((o) => o.id === 'unreached:mode=on')?.level).toBe('missing');
		expect(toggle?.jobs?.unreached).toEqual(['mode=on']);
	});
});

describe('jobs@1 set-backed bench.coverage()', () => {
	it('reads job captures from a mixed capture set without launching a browser, ignores isolated captures, applies waivers, and refuses unknown sets with CAPTURE_SET_NOT_FOUND', async () => {
		const root = await makeTempDir();
		await writeFile(join(root, 'dummy.ts'), 'export const Dummy = {};\n', 'utf8');
		await writeFile(
			join(root, 'custom-elements.json'),
			JSON.stringify({
				schemaVersion: '1.0.0',
				modules: [
					{
						path: 'src/components.ts',
						declarations: [
							{
								tagName: 'example-notice',
								members: [
									{
										kind: 'field',
										name: 'variant',
										attribute: 'variant',
										type: { text: "'warning' | 'error'" },
									},
								],
							},
							{
								tagName: 'example-banner',
								members: [
									{
										kind: 'field',
										name: 'tone',
										attribute: 'tone',
										type: { text: "'info' | 'alert'" },
									},
								],
							},
							{
								tagName: 'example-chip',
								members: [
									{
										kind: 'field',
										name: 'size',
										attribute: 'size',
										type: { text: "'small' | 'medium'" },
									},
								],
							},
						],
					},
				],
			}),
			'utf8'
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				manifest: './custom-elements.json',
				specimens: [
					{ id: 'banner-isolated', title: 'Banner', module: './dummy.ts', exportName: 'Dummy' },
				],
				coverage: {
					waivers: {
						version: '2026-11-23',
						entries: [
							{
								component: 'example-chip',
								obligation: 'unreached:size=small',
								reason: 'Small chips appear only in a settings dialog no job opens.',
							},
						],
					},
				},
			}),
			'utf8'
		);

		const { run: setRun } = await writeCaptureSet(root, {
			kind: 'capture',
			context: {
				viewport: { width: 1280, height: 720 },
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
			browser: { name: 'chromium', version: '130.0.0.0' },
			axe: false,
			revision: 'abc1234',
			dirty: false,
			label: 'main',
			skipped: { jobs: 0, gates: 0 },
			entries: [
				// Isolated component specimen renders example-banner, which must NOT count as a job capture.
				{
					key: 'banner-isolated',
					id: 'banner-isolated',
					status: 'captured',
					observation: makeObservation({
						specimenId: 'banner-isolated',
						checkpoint: 'mount',
						elements: [makeElement('example-banner', 'root/example-banner:1', { tone: 'info' })],
					}),
				},
				// Job capture renders example-notice (warning) and example-chip (medium).
				{
					key: 'example-keep-a-draft/4',
					id: 'example-keep-a-draft',
					status: 'captured',
					checkpoint: 'conflict-notice',
					step: 4,
					job: 'keep-a-draft',
					observation: makeObservation({
						specimenId: 'example-keep-a-draft',
						checkpoint: 'conflict-notice',
						job: { name: 'keep-a-draft', step: 4, description: 'Another writer saves the note' },
						elements: [
							makeElement('example-notice', 'root/example-notice:1', { variant: 'warning' }),
							makeElement('example-chip', 'root/example-chip:1', { size: 'medium' }),
						],
					}),
				},
				// Unavailable job capture must not reach components and is recorded in cases.failed.
				{
					key: 'example-broken/2',
					id: 'example-broken',
					status: 'unavailable',
					reason: 'Step 1 failed earlier; capture not taken.',
					checkpoint: 'after-open',
					step: 2,
					job: 'broken-job',
				},
			],
		});

		// Nonexistent browser path proves zero browser launch for jobs@1.
		const bench = await createSpecimenBench({
			root,
			executablePath: join(root, 'missing-chromium'),
		});
		try {
			// Step 1: notice reached by step 4, variant=error unreached.
			const noticeRun = await bench.coverage({
				component: 'example-notice',
				obligations: JOBS_COVERAGE_OBLIGATIONS,
				captures: 'main',
			});
			expect(coverageRunSchema.parse(noticeRun)).toBeTruthy();
			expect(noticeRun.obligations).toBe('jobs@1');
			expect(noticeRun.components[0]?.tag).toBe('example-notice');
			expect(noticeRun.components[0]?.jobs).toEqual({
				reachedBy: [{ key: 'example-keep-a-draft/4', name: 'conflict-notice', step: 4 }],
				unreached: ['variant=error'],
			});
			expect(noticeRun.cases).toEqual({
				total: 2,
				passed: 1,
				failed: [{ id: 'example-broken/2', message: 'Step 1 failed earlier; capture not taken.' }],
				skipped: 0,
			});

			// Step 2: banner rendered only by isolated specimen -> empty reachedBy + reason.
			const bannerRun = await bench.coverage({
				component: 'example-banner',
				obligations: 'jobs@1',
				captures: setRun.set, // lookup by set id also works
			});
			expect(bannerRun.components[0]?.jobs).toEqual({
				reachedBy: [],
				unreached: ['tone=info', 'tone=alert'],
				reason: 'No job capture renders <example-banner>.',
			});

			// Step 3: chip gap waived -> unreached empty, waived: 1.
			const chipRun = await bench.coverage({
				component: 'example-chip',
				obligations: 'jobs@1',
				captures: 'main',
			});
			expect(chipRun.components[0]?.jobs?.unreached).toEqual([]);
			expect(chipRun.waived).toBe(1);
			expect(chipRun.complete).toBe(true);

			// Filter narrows job entries.
			const filteredRun = await bench.coverage({
				component: 'example-notice',
				obligations: 'jobs@1',
				captures: 'main',
				filter: { ids: ['example-keep-a-draft'] },
			});
			expect(filteredRun.cases).toEqual({ total: 1, passed: 1, failed: [], skipped: 0 });
			expect(filteredRun.components[0]?.jobs?.reachedBy).toHaveLength(1);

			// Unsupported filter.file is refused.
			await expect(
				bench.coverage({
					obligations: 'jobs@1',
					captures: 'main',
					filter: { file: './dummy.ts' },
				})
			).rejects.toThrow(/filter\.file/);

			// Unknown capture set or label is refused with CAPTURE_SET_NOT_FOUND.
			await expect(
				bench.coverage({
					obligations: 'jobs@1',
					captures: 'nonexistent-set',
				})
			).rejects.toMatchObject({
				code: 'CAPTURE_SET_NOT_FOUND',
				suggestion: expect.stringContaining('specimen-capture'),
			});

			// Unknown capture set + unknown component still refuses with CAPTURE_SET_NOT_FOUND first.
			await expect(
				bench.coverage({
					component: 'example-missing',
					obligations: 'jobs@1',
					captures: 'nonexistent-set',
				})
			).rejects.toMatchObject({
				code: 'CAPTURE_SET_NOT_FOUND',
			});

			// Prototype property name is refused cleanly as an unknown schema.
			await expect(
				bench.coverage({
					component: 'toString',
					obligations: 'jobs@1',
					captures: 'main',
				})
			).rejects.toThrow('No schema describes toString');

			// Empty filter.ids, misspelled filter.ids, and unmatched filter.match refuse with SPECIMEN_NOT_FOUND.
			await expect(
				bench.coverage({
					obligations: 'jobs@1',
					captures: 'main',
					filter: { ids: [] },
				})
			).rejects.toMatchObject({
				code: 'SPECIMEN_NOT_FOUND',
			});
			await expect(
				bench.coverage({
					obligations: 'jobs@1',
					captures: 'main',
					filter: { ids: ['example-keep-a-drft'] },
				})
			).rejects.toMatchObject({
				code: 'SPECIMEN_NOT_FOUND',
				details: expect.objectContaining({
					nearest: expect.arrayContaining(['example-keep-a-draft']),
				}),
			});
			await expect(
				bench.coverage({
					obligations: 'jobs@1',
					captures: 'main',
					filter: { match: 'no-such-job-pattern' },
				})
			).rejects.toMatchObject({
				code: 'SPECIMEN_NOT_FOUND',
			});

			// Unknown component is refused.
			await expect(
				bench.coverage({
					component: 'example-missing',
					obligations: 'jobs@1',
					captures: 'main',
				})
			).rejects.toThrow('No schema describes example-missing');
		} finally {
			await bench.close();
		}
	});

	it('stamps unavailable job failures in runCaptureSet and surfaces both stamped and legacy unmarked failed jobs in jobs@1 cases.failed', async () => {
		const root = await makeTempDir();
		await writeFile(join(root, 'dummy.ts'), 'export const Dummy = {};\n', 'utf8');
		await writeFile(
			join(root, 'custom-elements.json'),
			JSON.stringify({
				schemaVersion: '1.0.0',
				modules: [
					{
						path: 'src/components.ts',
						declarations: [
							{
								tagName: 'example-notice',
								members: [
									{
										kind: 'field',
										name: 'variant',
										attribute: 'variant',
										type: { text: "'warning' | 'error'" },
									},
								],
							},
						],
					},
				],
			}),
			'utf8'
		);
		const jobEntry = {
			id: 'example-failed-early',
			title: 'Failed early',
			module: './dummy.ts',
			exportName: 'Dummy',
			job: {
				scenario: 'example/scenarios/failed.scenario.yaml',
				target: 'app',
				captures: [{ after: 'Step 1', name: 'first' }],
			},
		};
		const legacyJobEntry = {
			id: 'example-legacy-unmarked',
			title: 'Legacy unmarked',
			module: './dummy.ts',
			exportName: 'Dummy',
			job: {
				scenario: 'example/scenarios/legacy.scenario.yaml',
				target: 'app',
				captures: [{ after: 'Step 1', name: 'first' }],
			},
		};
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				manifest: './custom-elements.json',
				specimens: [
					{ id: 'banner-isolated', title: 'Banner', module: './dummy.ts', exportName: 'Dummy' },
					jobEntry,
					legacyJobEntry,
				],
			}),
			'utf8'
		);

		// 1. runCaptureSet stamps `job` when a job fails before its first checkpoint in a mixed set.
		const captured = await runCaptureSet(
			{
				root,
				entries: [
					{
						id: 'banner-isolated',
						title: 'Banner',
						module: './dummy.ts',
						exportName: 'Dummy',
					},
					jobEntry,
				],
				workers: 1,
				prepare: async () => {},
				sourceState: async () => ({ revision: 'abc1234', dirty: false }),
				render: async () =>
					makeObservation({
						specimenId: 'banner-isolated',
						checkpoint: 'mount',
						elements: [],
					}),
				runJob: async () => {
					throw new Error('Job runner crashed before first checkpoint');
				},
			},
			{ label: 'mixed-crash', axe: false }
		);
		const crashManifest = await readCaptureSetManifest(root, captured.set);
		expect(crashManifest.captures['example-failed-early']?.status).toBe('unavailable');
		expect(crashManifest.captures['example-failed-early']?.job).toBe('example-failed-early');

		// 2. Also write a legacy mixed set where an unavailable configured job lacks `job`.
		await writeCaptureSet(root, {
			kind: 'capture',
			context: {
				viewport: { width: 1280, height: 720 },
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
			browser: { name: 'chromium', version: '130.0.0.0' },
			axe: false,
			revision: 'abc1234',
			dirty: false,
			label: 'legacy-mixed',
			skipped: { jobs: 0, gates: 0 },
			entries: [
				{
					key: 'banner-isolated',
					id: 'banner-isolated',
					status: 'captured',
					observation: makeObservation({
						specimenId: 'banner-isolated',
						checkpoint: 'mount',
						elements: [],
					}),
				},
				{
					key: 'example-legacy-unmarked',
					id: 'example-legacy-unmarked',
					status: 'unavailable',
					reason: 'Failed before first checkpoint in older set format',
				},
			],
		});

		const bench = await createSpecimenBench({
			root,
			executablePath: join(root, 'missing-chromium'),
		});
		try {
			const crashRun = await bench.coverage({
				component: 'example-notice',
				obligations: 'jobs@1',
				captures: 'mixed-crash',
			});
			expect(crashRun.cases).toEqual({
				total: 1,
				passed: 0,
				failed: [
					{
						id: 'example-failed-early',
						message: 'Job runner crashed before first checkpoint',
					},
				],
				skipped: 0,
			});
			expect(crashRun.components[0]?.jobs?.reachedBy).toEqual([]);
			expect(crashRun.components[0]?.jobs?.reason).toBe('No job capture renders <example-notice>.');

			const legacyRun = await bench.coverage({
				component: 'example-notice',
				obligations: 'jobs@1',
				captures: 'legacy-mixed',
			});
			expect(legacyRun.cases).toEqual({
				total: 1,
				passed: 0,
				failed: [
					{
						id: 'example-legacy-unmarked',
						message: 'Failed before first checkpoint in older set format',
					},
				],
				skipped: 0,
			});
		} finally {
			await bench.close();
		}
	});
});
