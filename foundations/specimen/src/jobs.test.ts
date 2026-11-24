import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecimenBench } from './bench.js';
import { installPinnedClock, parsePinnedClock } from './browser/clock.js';
import { defineJobSource, parseJobScenarioWithSources } from './job-source.js';
import {
	buildJobCaptures,
	finalizeCheckpointsRun,
	finalizeJobRun,
	isObservationUnchanged,
	isValidClockPin,
	readA11yFromSet,
	readObservationFromSet,
	resolveJobCapturePlan,
	resolvePinnedBaseline,
	slugifyStepDescription,
	validateJobEntries,
	withJobValidation,
} from './jobs.js';
import { jobCreateResultSchema } from './schema.js';
import { readCaptureSetManifest, readSetCapture, SET_ID_PATTERN } from './sets.js';
import {
	CAPTURE_VERSION,
	type JobScenario,
	NORMALIZATION_VERSION,
	type Observation,
	type SpecimenEntry,
} from './types.js';

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'specimen-jobs-'));
	directories.push(dir);
	return dir;
}

function makeObservation(
	dom: string,
	options: { checkpoint?: string; clock?: 'real' | { pinned: string } } = {}
): Observation {
	const complete = { status: 'complete' as const, scope: 'structured', reasons: [] };
	return {
		manifest: {
			captureVersion: CAPTURE_VERSION,
			normalizationVersion: NORMALIZATION_VERSION,
			specimenId: 'example-keep-a-draft',
			capturedUtc: '2026-11-23T00:00:00.000Z',
			bench: { name: '@lushly-dev/specimen', version: '2.2.0', plugins: [] },
			driver: { name: 'host', emulates: ['viewport', 'color-scheme'] },
			checkpoint: {
				name: options.checkpoint ?? 'two-editors',
				actionMode: 'real-input',
				ready: { steps: ['upgrade', 'fonts', 'frame'], outcome: 'ready', deadlineMs: 10_000 },
				baseline: {
					clock: options.clock ?? { pinned: '2026-03-02T09:00:00Z' },
					random: { source: 'seeded', seed: 1 },
					storage: 'empty',
				},
			},
			source: { revision: 'a1b2c3d', digest: 'src-digest', dirty: false },
			dependencies: 'lock-1',
			browser: { name: 'chromium', version: '151.0', platform: 'win32-x64', build: null },
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
			dom: { raw: dom, normalized: dom },
			a11y: {
				snapshot: `- region "${dom}"`,
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
			elements: [],
			console: { errors: [], warnings: [] },
			visual: { path: null },
		},
		completeness: {
			dom: complete,
			a11y: complete,
			layout: complete,
			styles: complete,
			tokens: { status: 'unsupported', scope: 'tokens', reasons: [] },
			events: { status: 'not-requested', scope: 'events', reasons: [] },
			visual: { status: 'not-requested', scope: 'visual', reasons: [] },
		},
	};
}

const sampleEntry: SpecimenEntry = {
	id: 'example-keep-a-draft',
	title: 'Example/Notes/Keep a draft',
	module: './app.specimens.ts',
	exportName: 'NotesApp',
	job: {
		scenario: './keep-a-draft.scenario.json',
		target: 'app',
		pin: { clock: '2026-03-02T09:00:00Z' },
		captures: [
			{ after: 'The note opens beside itself', name: 'two-editors' },
			{
				after: 'Another writer saves the note',
				name: 'conflict-notice',
				before: [{ action: { fill: 'second-editor', value: ' draft' } }],
			},
		],
	},
};

const sampleScenario: JobScenario = {
	job: 'keep-a-draft',
	steps: [
		{ step: 1, command: 'document-create', description: 'A note is created' },
		{ step: 2, command: 'document-open', description: 'The note opens' },
		{ step: 3, command: 'document-open', description: 'The note opens beside itself' },
		{ step: 4, command: 'notes-content-set', description: 'Another writer saves the note' },
	],
};

describe('pinned clock controller', () => {
	it('validates ISO-8601 clock pins strictly', () => {
		expect(isValidClockPin('2026-03-02T09:00:00Z')).toBe(true);
		expect(isValidClockPin('2026-03-02T09:00:00.250+02:00')).toBe(true);
		expect(isValidClockPin('2026-03-02')).toBe(false);
		expect(isValidClockPin('2026-03-02T09:00:00')).toBe(false);
		expect(() => parsePinnedClock('not-a-date')).toThrow(/Invalid pin\.clock/);
		expect(resolvePinnedBaseline()).toEqual({ clock: 'real', random: 'seeded' });
		expect(resolvePinnedBaseline({ clock: '2026-03-02T09:00:00Z' })).toEqual({
			clock: '2026-03-02T09:00:00Z',
			random: 'seeded',
		});
	});

	it('pins Date and positive timers, fires zero-delay timers, supports advance() and withRealTimers(), and restores', async () => {
		const clock = installPinnedClock('2026-03-02T09:00:00Z');
		try {
			const expected = Date.parse('2026-03-02T09:00:00Z');
			expect(Date.now()).toBe(expected);
			expect(new Date().toISOString()).toBe('2026-03-02T09:00:00.000Z');
			expect(new Date() instanceof Date).toBe(true);
			expect(new Date(0).toISOString()).toBe('1970-01-01T00:00:00.000Z');
			expect(Date()).toContain('2026');

			// Zero-delay timer fires immediately without moving virtual time.
			const zeroRan = await new Promise<boolean>((resolve) => {
				setTimeout(() => resolve(true), 0);
			});
			expect(zeroRan).toBe(true);
			expect(Date.now()).toBe(expected);

			// Positive-delay setTimeout & setInterval stay paused until advance().
			const log: string[] = [];
			const cancelled = setTimeout(() => log.push('cancelled'), 50);
			clearTimeout(cancelled);
			setTimeout(() => log.push(`t100:${Date.now() - expected}`), 100);
			const interval = setInterval(() => log.push(`i40:${Date.now() - expected}`), 40);

			await clock.withRealTimers(async () => {
				await new Promise((resolve) => setTimeout(resolve, 25));
			});
			expect(log).toEqual([]);

			clock.advance(100);
			clearInterval(interval);
			clock.advance(100);
			expect(log).toEqual(['i40:40', 'i40:80', 't100:100']);
			expect(Date.now()).toBe(expected + 200);
		} finally {
			clock.restore();
		}
		expect(Date.now()).toBeGreaterThan(Date.parse('2026-03-02T09:00:00Z'));
	});
});

describe('job capture plan, validation, and unchanged/not-taken states', () => {
	it('resolves capture plans into <id>/<step> keys and refuses unknown or ambiguous descriptions', () => {
		const plan = resolveJobCapturePlan(sampleEntry, sampleScenario);
		expect(plan).toEqual([
			{
				after: 'The note opens beside itself',
				name: 'two-editors',
				step: 3,
				key: 'example-keep-a-draft/3',
				before: [],
			},
			{
				after: 'Another writer saves the note',
				name: 'conflict-notice',
				step: 4,
				key: 'example-keep-a-draft/4',
				before: [{ action: { fill: 'second-editor', value: ' draft' } }],
			},
		]);

		const missingScenario: JobScenario = {
			job: 'keep-a-draft',
			steps: [{ step: 1, command: 'document-create', description: 'Renamed step' }],
		};
		expect(() => resolveJobCapturePlan(sampleEntry, missingScenario)).toThrow(
			expect.objectContaining({ code: 'CAPTURE_STEP_UNKNOWN' })
		);

		const duplicateScenario: JobScenario = {
			job: 'keep-a-draft',
			steps: [
				{ step: 1, command: 'a', description: 'The note opens beside itself' },
				{ step: 2, command: 'b', description: 'The note opens beside itself' },
				{ step: 3, command: 'c', description: 'Another writer saves the note' },
			],
		};
		expect(() => resolveJobCapturePlan(sampleEntry, duplicateScenario)).toThrow(
			expect.objectContaining({ code: 'CAPTURE_STEP_AMBIGUOUS' })
		);

		expect(() =>
			resolveJobCapturePlan(
				{ id: 'plain', title: 'Plain', module: './p.ts', exportName: 'Plain' },
				sampleScenario
			)
		).toThrow(expect.objectContaining({ code: 'NOT_A_JOB' }));
	});

	it('detects unchanged observations across different checkpoint names', () => {
		const first = makeObservation('<main>Same</main>', { checkpoint: 'step-a' });
		const same = makeObservation('<main>Same</main>', { checkpoint: 'step-b' });
		const diff = makeObservation('<main>Changed</main>', { checkpoint: 'step-c' });
		expect(isObservationUnchanged(first, same)).toBe(true);
		expect(isObservationUnchanged(first, diff)).toBe(false);
	});

	it('finalizes multi-checkpoint runs with unchanged detection and capture-set persistence', async () => {
		const root = await scratchDir();
		const shot1 = join(root, 's1.png');
		const shot2 = join(root, 's2.png');
		const shot3 = join(root, 's3.png');
		await Promise.all([writeFile(shot1, '1'), writeFile(shot2, '2'), writeFile(shot3, '3')]);

		const run = await finalizeCheckpointsRun({
			root,
			id: 'counter',
			context: makeObservation('<div></div>').manifest.context,
			axe: true,
			pin: { clock: '2026-03-02T09:00:00Z' },
			label: 'cp-run',
			revision: 'a1b2c3d',
			dirty: false,
			captures: [
				{
					key: 'counter/1',
					name: 'initial',
					step: 1,
					observation: makeObservation('<p>0</p>', { checkpoint: 'initial' }),
					screenshotSource: shot1,
				},
				{
					key: 'counter/2',
					name: 'after-noop',
					step: 2,
					observation: makeObservation('<p>0</p>', { checkpoint: 'after-noop' }),
					screenshotSource: shot2,
				},
				{
					key: 'counter/3',
					name: 'after-click',
					step: 3,
					observation: makeObservation('<p>1</p>', { checkpoint: 'after-click' }),
					screenshotSource: shot3,
				},
			],
		});

		expect(run.set).toMatch(SET_ID_PATTERN);
		expect(run.pinned).toEqual({ clock: '2026-03-02T09:00:00Z', random: 'seeded' });
		expect(run.captures.map((c) => c.status)).toEqual(['captured', 'unchanged', 'captured']);
		expect(run.captures[1]?.reason).toContain('did not change');
		const saved = await readSetCapture(root, { set: 'cp-run', id: 'counter/3' });
		expect(saved.manifest.set).toBe(run.set);
		expect((await stat(saved.channels.visual.path as string)).isFile()).toBe(true);
	});

	it('enforces no capture after any failed step (including continueOnFailure) and records unchanged & job manifest metadata', async () => {
		const root = await scratchDir();
		const plan = resolveJobCapturePlan(sampleEntry, sampleScenario);

		// Passing run with unchanged second capture.
		const shot3 = join(root, 'step3.png');
		const shot4 = join(root, 'step4.png');
		await Promise.all([writeFile(shot3, 'png3'), writeFile(shot4, 'png4')]);
		const passRun = await finalizeJobRun({
			root,
			entry: sampleEntry,
			scenario: sampleScenario,
			capturePlan: plan,
			driverResult: {
				status: 'passed',
				steps: [
					{
						step: 1,
						command: 'document-create',
						description: 'A note is created',
						status: 'passed',
					},
					{ step: 2, command: 'document-open', description: 'The note opens', status: 'passed' },
					{
						step: 3,
						command: 'document-open',
						description: 'The note opens beside itself',
						status: 'passed',
					},
					{
						step: 4,
						command: 'notes-content-set',
						description: 'Another writer saves the note',
						status: 'passed',
						actions: 1,
					},
				],
			},
			capturedByKey: new Map([
				[
					'example-keep-a-draft/3',
					{
						observation: makeObservation('<main>Same</main>', { checkpoint: 'two-editors' }),
						screenshotSource: shot3,
					},
				],
				[
					'example-keep-a-draft/4',
					{
						observation: makeObservation('<main>Same</main>', { checkpoint: 'conflict-notice' }),
						screenshotSource: shot4,
					},
				],
			]),
			context: makeObservation('<main></main>').manifest.context,
			axe: true,
			revision: 'a1b2c3d',
			dirty: false,
			label: 'job-pass',
		});
		expect(passRun.status).toBe('passed');
		expect(passRun.steps[0]?.capture).toBeUndefined();
		expect(passRun.steps[2]?.capture).toMatchObject({
			key: 'example-keep-a-draft/3',
			status: 'captured',
		});
		expect(passRun.steps[3]?.capture).toMatchObject({
			key: 'example-keep-a-draft/4',
			status: 'unchanged',
			actions: 1,
			reason: expect.stringContaining('did not change'),
		});
		const obs4 = await readSetCapture(root, { set: 'job-pass', id: 'example-keep-a-draft/4' });
		expect(obs4.manifest.job).toEqual({
			name: 'keep-a-draft',
			step: 4,
			description: 'Another writer saves the note',
		});
		expect(obs4.manifest.set).toBe(passRun.set);

		// Failing run with continueOnFailure on step 2: step 3 passes, yet capture MUST be not-taken!
		const strayShot = join(root, 'stray.png');
		await writeFile(strayShot, 'discard-me');
		const failRun = await finalizeJobRun({
			root,
			entry: sampleEntry,
			scenario: sampleScenario,
			capturePlan: plan,
			driverResult: {
				status: 'failed',
				steps: [
					{
						step: 1,
						command: 'document-create',
						description: 'A note is created',
						status: 'passed',
					},
					{
						step: 2,
						command: 'document-open',
						description: 'The note opens',
						status: 'failed',
						error: 'Refused',
					},
					{
						step: 3,
						command: 'document-open',
						description: 'The note opens beside itself',
						status: 'passed',
					},
					{
						step: 4,
						command: 'notes-content-set',
						description: 'Another writer saves the note',
						status: 'skipped',
					},
				],
			},
			capturedByKey: new Map([
				[
					'example-keep-a-draft/3',
					{
						observation: makeObservation('<main>Broken</main>', { checkpoint: 'two-editors' }),
						screenshotSource: strayShot,
					},
				],
			]),
			context: makeObservation('<main></main>').manifest.context,
			axe: true,
			revision: 'a1b2c3d',
			dirty: false,
		});
		expect(failRun.status).toBe('failed');
		expect(failRun.steps[2]?.status).toBe('passed');
		expect(failRun.steps[2]?.capture).toMatchObject({
			status: 'not-taken',
			reason: expect.stringContaining('Step 2 failed earlier'),
		});
		expect(failRun.steps[3]?.capture).toMatchObject({
			status: 'not-taken',
			reason: expect.stringContaining('Step 2 failed earlier'),
		});
		expect(failRun.counts.captured).toBe(0);
		expect(failRun.counts.unavailable).toBe(2);
		const failManifest = await readCaptureSetManifest(root, failRun.set);
		expect(failManifest.captures['example-keep-a-draft/3']?.status).toBe('unavailable');
		await expect(stat(strayShot)).rejects.toThrow();
	});

	it('validates job entries via JobSource plugin point without importing AFD', async () => {
		const root = await scratchDir();
		await writeFile(
			join(root, 'keep-a-draft.scenario.json'),
			JSON.stringify(sampleScenario),
			'utf8'
		);
		const jsonSource = defineJobSource({
			id: 'json-test-source',
			async parseScenario(ctx) {
				return JSON.parse(await ctx.read(ctx.scenarioPath)) as JobScenario;
			},
		});

		const parsed = await parseJobScenarioWithSources([jsonSource], {
			root,
			base: root,
			entry: sampleEntry,
		});
		expect(parsed.job).toBe('keep-a-draft');

		// Without any jobSources, validation emits a deferred RUNNER_MISSING issue.
		const deferred = await validateJobEntries([sampleEntry], [], root, root);
		expect(deferred.issues).toMatchObject([{ severity: 'deferred', code: 'RUNNER_MISSING' }]);

		// With a matching source, valid job entry produces 0 issues.
		const ok = await validateJobEntries([sampleEntry], [jsonSource], root, root);
		expect(ok.checked).toBe(1);
		expect(ok.issues).toEqual([]);
		expect(ok.entries).toHaveLength(1);

		// Validating a valid job by id increments checked even with 0 issues.
		const byIdOk = withJobValidation(
			{ valid: true, scope: 'static', checked: 0, issues: [] },
			ok,
			{ id: sampleEntry.id },
			root
		);
		expect(byIdOk.valid).toBe(true);
		expect(byIdOk.checked).toBe(1);

		// Escaping scenario path is refused by ctx.read() with JOB_SCENARIO_INVALID + suggestion.
		const escapingEntry: SpecimenEntry = {
			...sampleEntry,
			job: {
				...(sampleEntry.job ?? { scenario: '', target: 'app', captures: [] }),
				scenario: '../outside.json',
			},
		};
		await expect(
			parseJobScenarioWithSources([jsonSource], { root, base: root, entry: escapingEntry })
		).rejects.toMatchObject({
			code: 'JOB_SCENARIO_INVALID',
			suggestion: expect.any(String),
		});

		// Missing file and malformed plugin output normalize to JOB_SCENARIO_INVALID.
		const missingEntry: SpecimenEntry = {
			...sampleEntry,
			job: {
				...(sampleEntry.job ?? { scenario: '', target: 'app', captures: [] }),
				scenario: './does-not-exist.json',
			},
		};
		await expect(
			parseJobScenarioWithSources([jsonSource], { root, base: root, entry: missingEntry })
		).rejects.toMatchObject({
			code: 'JOB_SCENARIO_INVALID',
			suggestion: expect.any(String),
		});
		const badPlugin = defineJobSource({
			id: 'bad-plugin',
			parseScenario: () => ({ job: 'bad', steps: [{ step: 2, command: 'x' }] }) as JobScenario,
		});
		await expect(
			parseJobScenarioWithSources([badPlugin], { root, base: root, entry: sampleEntry })
		).rejects.toMatchObject({
			code: 'JOB_SCENARIO_INVALID',
			suggestion: expect.any(String),
		});

		// Real symlink inside root pointing outside root is refused (skipped cleanly if OS denies symlinks).
		const outside = await scratchDir();
		const outsideFile = join(outside, 'secret.json');
		await writeFile(outsideFile, JSON.stringify(sampleScenario), 'utf8');
		const linkPath = join(root, 'escape-link.json');
		let linked = false;
		try {
			await symlink(outsideFile, linkPath);
			linked = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
		}
		if (linked) {
			const symlinkEntry: SpecimenEntry = {
				...sampleEntry,
				job: {
					...(sampleEntry.job ?? { scenario: '', target: 'app', captures: [] }),
					scenario: './escape-link.json',
				},
			};
			await expect(
				parseJobScenarioWithSources([jsonSource], { root, base: root, entry: symlinkEntry })
			).rejects.toMatchObject({ code: 'JOB_SCENARIO_INVALID' });
		}

		const invalid = await validateJobEntries([escapingEntry], [jsonSource], root, root);
		expect(invalid.issues[0]).toMatchObject({ severity: 'error', code: 'JOB_SCENARIO_INVALID' });

		// File-scoped validation ignores unrelated broken job entries.
		const unrelated = withJobValidation(
			{ valid: true, scope: 'static', checked: 1, issues: [] },
			invalid,
			{ file: join(root, 'other-component.stories.ts') },
			root
		);
		expect(unrelated.valid).toBe(true);
		expect(unrelated.checked).toBe(1);
		expect(unrelated.issues).toEqual([]);

		// File-scoped validation includes the job when targeting its module or scenario file.
		const matchingFile = withJobValidation(
			{ valid: true, scope: 'static', checked: 0, issues: [] },
			invalid,
			{ file: join(root, sampleEntry.module) },
			root
		);
		expect(matchingFile.valid).toBe(false);
		expect(matchingFile.checked).toBe(1);

		const merged = withJobValidation(
			{ valid: true, scope: 'static', checked: 0, issues: [] },
			invalid,
			undefined,
			root
		);
		expect(merged.valid).toBe(false);
		expect(merged.checked).toBe(1);
	});

	it('covers calendar-valid clock pins, clock edge cases, actionMode-aligned unchanged checks, and duplicate driver steps', async () => {
		expect(isValidClockPin('2026-02-30T09:00:00Z')).toBe(false);
		expect(isValidClockPin('2026-02-29T09:00:00Z')).toBe(false);
		expect(isValidClockPin('2024-02-29T09:00:00Z')).toBe(true);
		expect(() => parsePinnedClock('2026-02-30T09:00:00Z')).toThrow(/Invalid pin.clock/);

		const origSetTimeout = globalThis.setTimeout;
		const origClearTimeout = globalThis.clearTimeout;
		const clock = installPinnedClock('2026-03-02T09:00:00Z');
		try {
			const nowFn = Date.now;
			expect(Date.now).toBe(nowFn);
			expect(Date.UTC(2026, 2, 2, 9, 0, 0)).toBe(Date.now());
			expect(Date.parse('2026-03-02T09:00:00Z')).toBe(Date.now());
			const pinnedInstance = new Date();
			expect(Number(pinnedInstance)).toBe(Date.now());
			expect(() => setTimeout('alert(1)' as unknown as TimerHandler, 10)).toThrow(
				/String timer callbacks/
			);
			expect(() => clock.advance(-1)).toThrow(/non-negative/);
			expect(() => clock.advance(Number.NaN)).toThrow(/non-negative/);
			const loop = setInterval(() => {}, 1);
			expect(() => clock.advance(20_000)).toThrow(/exceeded/);
			clearInterval(loop);
		} finally {
			clock.restore();
		}
		expect(globalThis.setTimeout).toBe(origSetTimeout);
		expect(globalThis.clearTimeout).toBe(origClearTimeout);

		// Different actionMode ('none' on mount vs 'real-input' on step) compares cleanly without CAPTURES_INCOMPARABLE.
		const mountObs = makeObservation('<main>same</main>', { checkpoint: 'mount' });
		mountObs.manifest.checkpoint.actionMode = 'none';
		const stepObs = makeObservation('<main>same</main>', { checkpoint: 'after-run' });
		stepObs.manifest.checkpoint.actionMode = 'real-input';
		expect(isObservationUnchanged(mountObs, stepObs)).toBe(true);
		expect(mountObs.manifest.checkpoint.actionMode).toBe('none');
		expect(stepObs.manifest.checkpoint.actionMode).toBe('real-input');

		// Duplicate driver step numbers are refused before persisting captures.
		const root = await scratchDir();
		const plan = resolveJobCapturePlan(sampleEntry, sampleScenario);
		await expect(
			finalizeJobRun({
				root,
				entry: sampleEntry,
				scenario: sampleScenario,
				capturePlan: plan,
				driverResult: {
					status: 'failed',
					steps: [
						{ step: 1, status: 'passed' },
						{ step: 2, status: 'failed', error: 'boom' },
						{ step: 2, status: 'passed' },
					],
				},
				capturedByKey: new Map(),
				context: mountObs.manifest.context,
				axe: false,
				revision: null,
				dirty: null,
			})
		).rejects.toMatchObject({ code: 'JOB_SCENARIO_INVALID' });
	});

	it('slugifies step descriptions, builds job captures, and reads observations and a11y from sets without launching a browser', async () => {
		expect(slugifyStepDescription('The note opens beside itself')).toBe(
			'the-note-opens-beside-itself'
		);
		expect(slugifyStepDescription('  Save & Close (Draft #2)!  ')).toBe('save-close-draft-2');
		expect(slugifyStepDescription('***', 3)).toBe('step-3');

		const built = buildJobCaptures(sampleScenario, [
			3,
			{
				step: 4,
				name: 'conflict-notice',
				before: [{ action: { fill: 'second-editor', value: ' draft' } }],
			},
		]);
		expect(built).toEqual([
			{ after: 'The note opens beside itself', name: 'the-note-opens-beside-itself' },
			{
				after: 'Another writer saves the note',
				name: 'conflict-notice',
				before: [{ action: { fill: 'second-editor', value: ' draft' } }],
			},
		]);

		expect(() => buildJobCaptures(sampleScenario, [99])).toThrow(
			expect.objectContaining({ code: 'CAPTURE_STEP_UNKNOWN' })
		);
		expect(() =>
			buildJobCaptures(
				{
					job: 'no-desc',
					steps: [{ step: 1, command: 'note-create' }],
				},
				[1]
			)
		).toThrow(
			expect.objectContaining({
				code: 'STEP_HAS_NO_DESCRIPTION',
				suggestion: expect.stringContaining('description'),
			})
		);
		expect(() =>
			buildJobCaptures(
				{
					job: 'dup-desc',
					steps: [
						{ step: 1, command: 'a', description: 'Same step' },
						{ step: 2, command: 'b', description: 'Same step' },
					],
				},
				[1]
			)
		).toThrow(expect.objectContaining({ code: 'CAPTURE_STEP_AMBIGUOUS' }));

		// Persist a set with both a passing and failing axe observation, plus a failing run with untaken captures.
		const root = await scratchDir();
		const plan = resolveJobCapturePlan(sampleEntry, sampleScenario);
		const passObs = makeObservation('<main><button>Save</button></main>', {
			checkpoint: 'two-editors',
		});
		passObs.manifest.specimenId = sampleEntry.id;
		passObs.channels.a11y.axe = {
			status: 'passed',
			policy: 'error',
			violations: [],
			incomplete: 0,
			incompleteChecks: [],
			exceptions: [],
		};
		const failObs = makeObservation('<main><button></button></main>', {
			checkpoint: 'conflict-notice',
		});
		failObs.manifest.specimenId = sampleEntry.id;
		failObs.channels.a11y.axe = {
			status: 'failed',
			policy: 'error',
			violations: [
				{
					id: 'button-name',
					impact: 'critical',
					help: 'Buttons must have discernible text',
					targets: ['button'],
					details: [],
				},
			],
			incomplete: 0,
			incompleteChecks: [],
			exceptions: [],
		};

		const passedRun = await finalizeJobRun({
			root,
			entry: sampleEntry,
			scenario: sampleScenario,
			capturePlan: plan,
			driverResult: {
				status: 'passed',
				steps: [
					{ step: 1, status: 'passed' },
					{ step: 2, status: 'passed' },
					{ step: 3, status: 'passed' },
					{ step: 4, status: 'passed', actions: 1 },
				],
			},
			capturedByKey: new Map([
				['example-keep-a-draft/3', { observation: passObs, screenshotSource: null }],
				['example-keep-a-draft/4', { observation: failObs, screenshotSource: null }],
			]),
			context: passObs.manifest.context,
			axe: true,
			revision: 'abc1234',
			dirty: false,
			label: 'passing',
		});

		const readBack = await readObservationFromSet(root, {
			id: 'example-keep-a-draft',
			set: passedRun.set,
			checkpoint: 'conflict-notice',
		});
		expect(readBack.manifest.set).toBe(passedRun.set);
		expect(readBack.manifest.job).toEqual({
			name: 'keep-a-draft',
			step: 4,
			description: 'Another writer saves the note',
		});
		expect(readBack.manifest.checkpoint.name).toBe('conflict-notice');

		const a11yFromSet = await readA11yFromSet(root, { set: passedRun.set });
		expect(a11yFromSet.counts).toEqual({ total: 2, passed: 1, warning: 0, failed: 1, notRun: 0 });
		expect(a11yFromSet.reports[0]).toMatchObject({
			id: 'example-keep-a-draft',
			checkpoint: 'two-editors',
			status: 'passed',
			job: { name: 'keep-a-draft', step: 3, description: 'The note opens beside itself' },
		});
		expect(a11yFromSet.reports[1]).toMatchObject({
			id: 'example-keep-a-draft',
			checkpoint: 'conflict-notice',
			status: 'failed',
			job: { name: 'keep-a-draft', step: 4, description: 'Another writer saves the note' },
			violations: [{ id: 'button-name' }],
		});

		const failedRun = await finalizeJobRun({
			root,
			entry: sampleEntry,
			scenario: sampleScenario,
			capturePlan: plan,
			driverResult: {
				status: 'failed',
				steps: [
					{ step: 1, status: 'passed' },
					{ step: 2, status: 'failed', error: 'Step 2 boom' },
					{ step: 3, status: 'skipped' },
					{ step: 4, status: 'skipped' },
				],
			},
			capturedByKey: new Map(),
			context: passObs.manifest.context,
			axe: true,
			revision: 'abc1234',
			dirty: false,
			label: 'failing',
		});
		const failedA11y = await readA11yFromSet(root, { set: failedRun.set });
		expect(failedA11y.counts).toEqual({ total: 2, passed: 0, warning: 0, failed: 0, notRun: 2 });
		expect(failedA11y.reports[0]).toMatchObject({
			id: 'example-keep-a-draft',
			checkpoint: 'two-editors',
			status: 'not-run',
			reason: expect.stringContaining('not taken'),
		});
		expect(failedA11y.reports[1]).toMatchObject({
			id: 'example-keep-a-draft',
			checkpoint: 'conflict-notice',
			status: 'not-run',
			reason: expect.stringContaining('not taken'),
		});

		// Missing explicit ID, missing checkpoint, or unsupported filter fields refuse instead of silently passing.
		await expect(
			readA11yFromSet(root, { set: passedRun.set, id: 'does-not-exist' })
		).rejects.toMatchObject({ code: 'SPECIMEN_NOT_FOUND' });
		await expect(
			readA11yFromSet(root, { set: passedRun.set, checkpoint: 'no-such-checkpoint' })
		).rejects.toMatchObject({ code: 'SPECIMEN_NOT_FOUND' });
		await expect(
			readA11yFromSet(root, { set: passedRun.set, filter: { tags: ['smoke'] } })
		).rejects.toThrow(/filter\.tags/);
	});

	it('creates and updates job specimens via bench.createJob and enforces JOB_NEEDS_RUN, NOT_A_JOB, RUNNER_MISSING, and zero-browser set reads', async () => {
		const root = await scratchDir();
		await mkdir(join(root, 'scenarios'), { recursive: true });
		await writeFile(join(root, 'app.ts'), 'export const NotesApp = {};\n', 'utf8');
		await writeFile(
			join(root, 'scenarios/keep-a-draft.scenario.json'),
			JSON.stringify(sampleScenario),
			'utf8'
		);
		await writeFile(
			join(root, 'scenarios/no-desc.scenario.json'),
			JSON.stringify({ job: 'no-desc', steps: [{ step: 1, command: 'note-create' }] }),
			'utf8'
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				specimens: [
					{ id: 'plain-button', title: 'Button', module: './app.ts', exportName: 'NotesApp' },
				],
			}),
			'utf8'
		);
		const jsonSource = defineJobSource({
			id: 'json-test-source',
			async parseScenario(ctx) {
				return JSON.parse(await ctx.read(ctx.scenarioPath)) as JobScenario;
			},
		});

		const bench = await createSpecimenBench({
			root,
			jobSources: [jsonSource],
			executablePath: join(root, 'does-not-exist-chromium'),
		});
		try {
			// Creating a job specimen with bare step number derives deterministic slug name.
			const created = await bench.createJob({
				id: 'example-keep-a-draft',
				scenario: './scenarios/keep-a-draft.scenario.json',
				module: './app.ts',
				exportName: 'NotesApp',
				target: 'app',
				captures: [3],
			});
			expect(created.written).toBe('specimen.config.json');
			expect(created.entry.kind).toBe('job');
			expect(created.entry.job?.captures).toEqual([
				{ after: 'The note opens beside itself', name: 'the-note-opens-beside-itself' },
			]);

			// bench.list and bench.validate immediately reflect the newly created job specimen;
			// with no plugins configured, validate surfaces a deferred RUNNER_MISSING issue.
			expect(bench.list({ kind: 'job' }).map((e) => e.id)).toEqual(['example-keep-a-draft']);
			expect(bench.validate({ id: 'example-keep-a-draft' })).toMatchObject({
				valid: true,
				checked: 1,
				issues: [{ severity: 'deferred', code: 'RUNNER_MISSING', field: 'plugins' }],
			});

			// Updating an existing job specimen replaces its job block while preserving existing specimen fields (like themes).
			const preUpdate = JSON.parse(await readFile(join(root, 'specimen.config.json'), 'utf8'));
			preUpdate.specimens[1].themes = { supported: ['light'], reason: 'light only' };
			await writeFile(join(root, 'specimen.config.json'), JSON.stringify(preUpdate, null, 2));
			const updated = await bench.createJob({
				id: 'example-keep-a-draft',
				scenario: './scenarios/keep-a-draft.scenario.json',
				module: './app.ts',
				exportName: 'NotesApp',
				target: 'app',
				pin: { clock: '2026-03-02T09:00:00Z' },
				captures: [
					{ step: 3, name: 'two-editors' },
					{
						step: 4,
						name: 'conflict-notice',
						before: [{ action: { fill: 'second-editor', value: ' draft' } }],
					},
				],
			});
			expect(updated.written).toBe('specimen.config.json');
			expect(jobCreateResultSchema.parse(updated).entry.themes).toEqual({
				supported: ['light'],
				basis: 'declared',
				reason: 'light only',
			});
			const savedConfig = JSON.parse(await readFile(join(root, 'specimen.config.json'), 'utf8'));
			expect(savedConfig.specimens).toHaveLength(2);
			expect(savedConfig.specimens[1].themes).toEqual({
				supported: ['light'],
				reason: 'light only',
			});

			// Refuses undescribed step with STEP_HAS_NO_DESCRIPTION.
			await expect(
				bench.createJob({
					id: 'example-no-desc',
					scenario: './scenarios/no-desc.scenario.json',
					module: './app.ts',
					exportName: 'NotesApp',
					target: 'app',
					captures: [1],
				})
			).rejects.toMatchObject({
				code: 'STEP_HAS_NO_DESCRIPTION',
				suggestion: expect.stringContaining('description'),
			});

			// Refuses overwriting a component specimen with NOT_A_JOB.
			await expect(
				bench.createJob({
					id: 'plain-button',
					scenario: './scenarios/keep-a-draft.scenario.json',
					module: './app.ts',
					exportName: 'NotesApp',
					target: 'app',
					captures: [3],
				})
			).rejects.toMatchObject({ code: 'NOT_A_JOB' });

			// Refuses rendering a job specimen without a capture set via JOB_NEEDS_RUN.
			await expect(bench.render({ id: 'example-keep-a-draft' })).rejects.toMatchObject({
				code: 'JOB_NEEDS_RUN',
				suggestion: expect.stringContaining('specimen-job-run'),
			});

			// Refuses running a component specimen as a job via NOT_A_JOB.
			await expect(bench.runJob({ id: 'plain-button' })).rejects.toMatchObject({
				code: 'NOT_A_JOB',
				suggestion: expect.stringContaining('specimen-list'),
			});

			// Refuses running a job specimen without a configured runner plugin via RUNNER_MISSING.
			await expect(bench.runJob({ id: 'example-keep-a-draft' })).rejects.toMatchObject({
				code: 'RUNNER_MISSING',
				suggestion: expect.stringContaining('plugins'),
			});

			// Reading from a persisted set via bench.render and bench.a11y requires NO browser at all.
			const plan = resolveJobCapturePlan(updated.entry, sampleScenario);
			const obs = makeObservation('<main>Saved</main>', { checkpoint: 'two-editors' });
			obs.manifest.specimenId = 'example-keep-a-draft';
			obs.channels.a11y.axe = {
				status: 'passed',
				policy: 'error',
				violations: [],
				incomplete: 0,
				incompleteChecks: [],
				exceptions: [],
			};
			const saved = await finalizeJobRun({
				root,
				entry: updated.entry,
				scenario: sampleScenario,
				capturePlan: plan,
				driverResult: {
					status: 'passed',
					steps: [
						{ step: 1, status: 'passed' },
						{ step: 2, status: 'passed' },
						{ step: 3, status: 'passed' },
						{ step: 4, status: 'passed' },
					],
				},
				capturedByKey: new Map([
					['example-keep-a-draft/3', { observation: obs, screenshotSource: null }],
				]),
				context: obs.manifest.context,
				axe: true,
				revision: null,
				dirty: null,
			});
			const renderedFromSet = await bench.render({
				id: 'example-keep-a-draft',
				set: saved.set,
				checkpoint: 'two-editors',
			});
			expect(renderedFromSet.manifest.set).toBe(saved.set);
			expect(renderedFromSet.manifest.job?.step).toBe(3);

			const a11yFromSet = await bench.a11y({ set: saved.set });
			expect(a11yFromSet.counts.total).toBe(2);
			expect(a11yFromSet.counts.passed).toBe(1);
			expect(a11yFromSet.counts.notRun).toBe(1);

			// An accepted createJob drains cleanly when close() runs concurrently,
			// while a createJob called after close() rejects immediately.
			const drainingCreate = bench.createJob({
				id: 'example-keep-a-draft',
				scenario: './scenarios/keep-a-draft.scenario.json',
				module: './app.ts',
				exportName: 'NotesApp',
				target: 'app',
				captures: [3],
			});
			const closePromise = bench.close();
			await expect(
				bench.createJob({
					id: 'example-after-close',
					scenario: './scenarios/keep-a-draft.scenario.json',
					module: './app.ts',
					exportName: 'NotesApp',
					target: 'app',
					captures: [3],
				})
			).rejects.toThrow('closed');
			expect((await drainingCreate).entry.id).toBe('example-keep-a-draft');
			await closePromise;
		} finally {
			await bench.close();
		}
	});
});
