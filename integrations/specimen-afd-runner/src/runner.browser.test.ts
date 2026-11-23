import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	createSpecimenBench,
	readCaptureSetManifest,
	readSetCapture,
	type SpecimenBench,
} from '@lushly-dev/specimen';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');

describe('@lushly-dev/specimen-afd-runner in Chromium', () => {
	let bench: SpecimenBench;

	beforeAll(async () => {
		await rm(join(fixturesRoot, '.specimen'), { recursive: true, force: true });
		bench = await createSpecimenBench({ root: fixturesRoot });
	}, 60_000);

	afterAll(async () => {
		await bench?.close();
		await rm(join(fixturesRoot, '.specimen'), { recursive: true, force: true });
	});

	it('validates the consuming fixture config with afdJobSource without launching a browser', () => {
		const report = bench.validate();
		expect(report.valid).toBe(true);
		expect(report.issues).toEqual([]);
	});

	it('registers the afd command runner and dispatches explicit commands in a regular specimen', async () => {
		const inspected = await bench.inspect({ id: 'notes-direct-command' });
		expect(inspected.plugins).toEqual([
			expect.objectContaining({
				id: 'afd-runner',
				runners: ['afd'],
			}),
		]);

		const rendered = await bench.render({ id: 'notes-direct-command', checkpoint: 'created' });
		expect(rendered.channels.evidence.commands).toContain('note-create');
		expect(rendered.channels.dom.raw).toContain('created:note-1:Direct dispatch');
	}, 60_000);

	it('runs a multi-step AFD scenario with fixture setup, step references, person actions, pinned clock, and unchanged steps', async () => {
		const first = await bench.runJob({ id: 'notes-keep-a-draft', label: 'main' });
		expect(first.status).toBe('passed');
		expect(first.set).toMatch(/^set-[0-9a-f]{12}$/);
		expect(first.pinned).toEqual({ clock: '2026-03-02T09:00:00Z', random: 'seeded' });
		expect(first.steps.map((s) => s.status)).toEqual([
			'passed',
			'passed',
			'passed',
			'passed',
			'passed',
		]);
		expect(first.captures.map((c) => ({ key: c.key, name: c.name, status: c.status }))).toEqual([
			{ key: 'notes-keep-a-draft/3', name: 'two-editors', status: 'captured' },
			{ key: 'notes-keep-a-draft/4', name: 'after-noop', status: 'unchanged' },
			{ key: 'notes-keep-a-draft/5', name: 'conflict-notice', status: 'captured' },
		]);
		expect(first.steps[4]?.capture?.actions).toBe(1);

		const twoEditors = await readSetCapture(fixturesRoot, {
			set: 'main',
			id: 'notes-keep-a-draft/3',
		});
		const conflict = await readSetCapture(fixturesRoot, {
			set: 'main',
			id: 'notes-keep-a-draft/5',
		});
		expect(twoEditors.channels.dom.raw).toContain('team-vault');
		expect(twoEditors.channels.dom.raw).toContain(
			'two-editors:note-1:Meeting notes @ 2026-03-02T09:00:00.000Z'
		);
		expect(twoEditors.channels.evidence.commands).toContain('note-seed');
		expect(twoEditors.channels.evidence.commands).toContain('note-open-beside');
		expect(conflict.channels.dom.raw).toContain('Conflict: kept unsaved draft');

		// Repeat run on the same pinned clock produces an identical set id and zero diff.
		const second = await bench.runJob({ id: 'notes-keep-a-draft', label: 'repeat' });
		expect(second.set).toBe(first.set);
		const diff = await bench.diff({
			left: { set: 'main', id: 'notes-keep-a-draft/3' },
			right: { set: 'repeat', id: 'notes-keep-a-draft/3' },
		});
		expect(diff.status).toBe('no-change-observed');
		expect(diff.differences).toHaveLength(0);

		// Compact density variant running the same scenario gets its own <id>/<step> keys.
		const compact = await bench.runJob({ id: 'notes-keep-a-draft-compact', label: 'compact' });
		expect(compact.status).toBe('passed');
		expect(compact.captures.map((c) => c.key)).toEqual([
			'notes-keep-a-draft-compact/3',
			'notes-keep-a-draft-compact/5',
		]);
		const compactConflict = await readSetCapture(fixturesRoot, {
			set: 'compact',
			id: 'notes-keep-a-draft-compact/5',
		});
		expect(compactConflict.channels.dom.raw).toContain('Conflict: kept compact draft');
	}, 120_000);

	it('evaluates structured CommandResult failure expectations in the page', async () => {
		const run = await bench.runJob({ id: 'notes-expected-failure' });
		expect(run.status).toBe('passed');
		expect(run.steps).toEqual([
			expect.objectContaining({
				step: 1,
				command: 'note-open',
				status: 'passed',
			}),
		]);
		expect(run.captures).toEqual([
			expect.objectContaining({
				key: 'notes-expected-failure/1',
				name: 'missing-note',
				status: 'captured',
			}),
		]);
	}, 60_000);

	it('refuses captures after a failed step even when continueOnFailure is true', async () => {
		const run = await bench.runJob({ id: 'notes-continue-after-failure' });
		expect(run.status).toBe('failed');
		expect(run.steps.map((s) => s.status)).toEqual(['passed', 'failed', 'passed']);
		expect(run.captures).toEqual([
			expect.objectContaining({
				key: 'notes-continue-after-failure/3',
				name: 'after-continued-step',
				status: 'not-taken',
			}),
		]);

		const manifest = await readCaptureSetManifest(fixturesRoot, run.set);
		expect(manifest.captures['notes-continue-after-failure/3']?.status).toBe('unavailable');
	}, 60_000);

	it('cancels a running scenario via AbortSignal and skips subsequent steps and captures', async () => {
		const run = await bench.runJob({ id: 'notes-cancel-mid-run' });
		expect(run.status).toBe('failed');
		expect(run.steps.map((s) => s.status)).toEqual(['passed', 'failed', 'skipped']);
		expect(run.steps[1]?.error).toMatch(/aborted/i);
		expect(run.captures.map((c) => ({ key: c.key, status: c.status }))).toEqual([
			{ key: 'notes-cancel-mid-run/1', status: 'captured' },
			{ key: 'notes-cancel-mid-run/3', status: 'not-taken' },
		]);

		const manifest = await readCaptureSetManifest(fixturesRoot, run.set);
		expect(manifest.captures['notes-cancel-mid-run/1']?.status).toBe('captured');
		expect(manifest.captures['notes-cancel-mid-run/3']?.status).toBe('unavailable');
	}, 60_000);

	it('aborts and recovers cleanly when a hanging AFD command hits the render deadline', async () => {
		await expect(bench.runJob({ id: 'notes-deadline-hang', timeoutMs: 1500 })).rejects.toThrow(
			/running the job scenario/i
		);

		const recovery = await bench.runJob({ id: 'notes-expected-failure' });
		expect(recovery.status).toBe('passed');
	}, 60_000);

	it('surfaces CAPTURE_STEP_UNKNOWN, CAPTURE_STEP_AMBIGUOUS, JOB_SCENARIO_INVALID, and STEP_HAS_NO_DESCRIPTION through bench.validate() and bench.runJob()', async () => {
		const scratch = await mkdtemp(join(tmpdir(), 'specimen-afd-runner-errors-'));
		let scratchBench: SpecimenBench | undefined;
		try {
			await mkdir(join(scratch, 'scenarios'), { recursive: true });
			await writeFile(
				join(scratch, 'job-source.mjs'),
				`export { default } from ${JSON.stringify(pathToFileURL(resolve(fixturesRoot, '../dist/job-source.js')).href)};\n`,
				'utf8'
			);
			await writeFile(
				join(scratch, 'app.js'),
				`export const App = { targets: { app: { selector: '#a' } }, render() { const el = document.createElement('div'); el.id = 'a'; return el; } };\n`,
				'utf8'
			);
			await writeFile(
				join(scratch, 'scenarios/dup.scenario.yaml'),
				`name: Dup\ndescription: Dup\njob: dup\nsteps:\n  - description: Same\n    command: note-noop\n    expect:\n      success: true\n  - description: Same\n    command: note-noop\n    expect:\n      success: true\n`,
				'utf8'
			);
			await writeFile(
				join(scratch, 'scenarios/broken.scenario.yaml'),
				`name: Broken\nsteps: []\n`,
				'utf8'
			);
			await writeFile(
				join(scratch, 'scenarios/no-desc.scenario.yaml'),
				`name: NoDesc\ndescription: NoDesc\njob: no-desc\nsteps:\n  - command: note-noop\n    expect:\n      success: true\n`,
				'utf8'
			);
			await writeFile(
				join(scratch, 'specimen.config.json'),
				JSON.stringify({
					jobSources: ['./job-source.mjs'],
					specimens: [
						{
							id: 'err-unknown',
							title: 'Err/Unknown',
							module: './app.js',
							exportName: 'App',
							job: {
								scenario: './scenarios/dup.scenario.yaml',
								target: 'app',
								captures: [{ after: 'Missing step', name: 'missing' }],
							},
						},
						{
							id: 'err-ambiguous',
							title: 'Err/Ambiguous',
							module: './app.js',
							exportName: 'App',
							job: {
								scenario: './scenarios/dup.scenario.yaml',
								target: 'app',
								captures: [{ after: 'Same', name: 'same' }],
							},
						},
						{
							id: 'err-invalid',
							title: 'Err/Invalid',
							module: './app.js',
							exportName: 'App',
							job: {
								scenario: './scenarios/broken.scenario.yaml',
								target: 'app',
								captures: [{ after: 'Anything', name: 'any' }],
							},
						},
						{
							id: 'err-no-desc',
							title: 'Err/NoDesc',
							module: './app.js',
							exportName: 'App',
							job: {
								scenario: './scenarios/no-desc.scenario.yaml',
								target: 'app',
								captures: [{ after: 'First', name: 'first' }],
							},
						},
					],
				}),
				'utf8'
			);

			scratchBench = await createSpecimenBench({ root: scratch });
			const validation = scratchBench.validate();
			expect(validation.valid).toBe(false);
			const codes = new Map(validation.issues.map((issue) => [issue.id, issue.code]));
			expect(codes.get('err-unknown')).toBe('CAPTURE_STEP_UNKNOWN');
			expect(codes.get('err-ambiguous')).toBe('CAPTURE_STEP_AMBIGUOUS');
			expect(codes.get('err-invalid')).toBe('JOB_SCENARIO_INVALID');
			expect(codes.get('err-no-desc')).toBe('STEP_HAS_NO_DESCRIPTION');

			await expect(scratchBench.runJob({ id: 'err-unknown' })).rejects.toMatchObject({
				code: 'CAPTURE_STEP_UNKNOWN',
			});
			await expect(scratchBench.runJob({ id: 'err-ambiguous' })).rejects.toMatchObject({
				code: 'CAPTURE_STEP_AMBIGUOUS',
			});
			await expect(scratchBench.runJob({ id: 'err-invalid' })).rejects.toMatchObject({
				code: 'JOB_SCENARIO_INVALID',
			});
			await expect(scratchBench.runJob({ id: 'err-no-desc' })).rejects.toMatchObject({
				code: 'STEP_HAS_NO_DESCRIPTION',
			});
		} finally {
			await scratchBench?.close();
			await rm(scratch, { recursive: true, force: true });
		}
	}, 60_000);
});
