import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import { readCaptureSetManifest, readSetCapture, SET_ID_PATTERN } from './sets.js';

describe('multi-checkpoint capture sets, pin.clock, and plugin-driven job runs end to end', () => {
	let scratch: string;
	let bench: SpecimenBench;

	beforeAll(async () => {
		scratch = await mkdtemp(join(tmpdir(), 'specimen-jobs-bench-'));
		await mkdir(join(scratch, 'scenarios'), { recursive: true });

		// Specimen module with both a clock-dependent multi-checkpoint component and a job app mount.
		await writeFile(
			join(scratch, 'app.specimens.js'),
			`export const ClockCounter = {
	targets: {
		inc: { selector: '#inc' },
		clock: { selector: '#clock' },
	},
	render() {
		const root = document.createElement('main');
		let count = 0;
		let ticks = 0;
		const timeEl = document.createElement('p');
		timeEl.id = 'clock';
		timeEl.textContent = new Date().toISOString() + ' | ' + String(Math.random()).slice(0, 8);
		const tickEl = document.createElement('p');
		tickEl.id = 'ticks';
		tickEl.textContent = 'ticks:0';
		const countEl = document.createElement('p');
		countEl.id = 'count';
		countEl.textContent = 'count:0';
		const incBtn = document.createElement('button');
		incBtn.id = 'inc';
		incBtn.type = 'button';
		incBtn.textContent = 'Increment';
		incBtn.addEventListener('click', () => {
			count += 1;
			countEl.textContent = 'count:' + count;
			console.warn('clicked-inc-' + count);
		});
		const timer = setInterval(() => {
			ticks += 1;
			tickEl.textContent = 'ticks:' + ticks;
		}, 25);
		root.append(timeEl, tickEl, countEl, incBtn);
		return {
			element: root,
			dispose() {
				clearInterval(timer);
			},
		};
	},
	scenario: [
		{ capture: 'initial' },
		{ action: { click: 'clock' } },
		{ capture: 'after-noop' },
		{ action: { click: 'inc' } },
		{ capture: 'after-click' },
	],
};

export const AbsentEventUnderClock = {
	targets: {
		btn: { selector: '#btn' },
	},
	events: [{ type: 'custom-save', target: 'btn' }],
	render() {
		const root = document.createElement('main');
		const btn = document.createElement('button');
		btn.id = 'btn';
		btn.type = 'button';
		btn.textContent = 'Save @ ' + new Date().toISOString();
		root.append(btn);
		return root;
	},
	scenario: [
		{ capture: 'initial' },
		{ id: 'quiet', action: { click: 'btn' } },
		{ expect: { event: 'custom-save', target: 'btn', since: 'quiet', absent: true, timeoutMs: 30 } },
		{ capture: 'after-quiet' },
	],
};

function createNotesMount(density) {
	return {
		targets: {
			app: { selector: '#notes-app' },
			draft: { selector: '#draft-input' },
		},
		render() {
			const container = document.createElement('main');
			container.id = 'notes-app';
			container.dataset.density = density;
			const status = document.createElement('p');
			status.id = 'status';
			status.textContent = 'ready @ ' + new Date().toISOString();
			const input = document.createElement('input');
			input.id = 'draft-input';
			input.type = 'text';
			input.setAttribute('aria-label', 'Draft text');
			const notice = document.createElement('p');
			notice.id = 'notice';
			notice.textContent = '';
			const log = [];
			container.call = async (name, payload) => {
				log.push(name);
				if (name === 'fail-open') {
					return { success: false, error: { code: 'OPEN_FAILED', message: 'Cannot open note' } };
				}
				if (name === 'document-open-beside') {
					status.textContent = density + ':two-editors @ ' + new Date().toISOString();
				} else if (name === 'notes-content-set') {
					notice.textContent = input.value ? 'Conflict: kept ' + input.value : 'Saved';
				}
				return { success: true, data: { name, payload, count: log.length } };
			};
			container.append(status, input, notice);
			return container;
		},
	};
}

export const NotesApp = createNotesMount('comfortable');
export const NotesAppCompact = createNotesMount('compact');
`,
			'utf8'
		);

		// AFD-free browser plugin registering a command runner and in-page job driver.
		await writeFile(
			join(scratch, 'job-plugin.js'),
			`export default {
	id: 'demo-job-plugin',
	version: '1.0.0',
	runners: {
		demo: {
			async run(element, name, input) {
				return await element.call(name, input);
			},
		},
	},
	jobDrivers: {
		demo: {
			async run(host) {
				const planByStep = new Map(host.capturePlan.map((cap) => [cap.step, cap]));
				const steps = [];
				let failed = false;
				let halted = false;
				for (const step of host.scenario.steps) {
					const plan = planByStep.get(step.step);
					if (halted) {
						steps.push({
							step: step.step,
							description: step.description,
							command: step.command,
							status: 'skipped',
						});
						continue;
					}
					let actions = 0;
					if (plan && plan.before.length > 0 && !failed) {
						actions = await host.runActions(plan.before);
					}
					const res = await host.runCommand('demo', host.entry.job.target, step.command, step.input ?? {});
					const ok = Boolean(res && res.success);
					if (!ok) {
						failed = true;
						if (!step.continueOnFailure) halted = true;
					}
					steps.push({
						step: step.step,
						description: step.description,
						command: step.command,
						status: ok ? 'passed' : 'failed',
						...(ok ? {} : { error: res?.error?.message ?? 'Step failed' }),
						...(actions > 0 ? { actions } : {}),
					});
					if (plan && ok && !failed) {
						await host.captureStep({
							key: plan.key,
							name: plan.name,
							step: plan.step,
							description: step.description,
							actions,
						});
					}
				}
				return { status: failed ? 'failed' : 'passed', steps };
			},
		},
	},
};
`,
			'utf8'
		);

		// AFD-free Node job source plugin parsing JSON scenario files.
		await writeFile(
			join(scratch, 'job-source.mjs'),
			`export default {
	id: 'demo-json-job-source',
	async parseScenario(ctx) {
		return JSON.parse(await ctx.read(ctx.scenarioPath));
	},
};
`,
			'utf8'
		);

		await writeFile(
			join(scratch, 'scenarios/keep-a-draft.json'),
			JSON.stringify({
				job: 'keep-a-draft',
				steps: [
					{ step: 1, command: 'document-create', description: 'A note is created' },
					{ step: 2, command: 'document-open', description: 'The note opens' },
					{ step: 3, command: 'document-open-beside', description: 'The note opens beside itself' },
					{ step: 4, command: 'notes-content-set', description: 'Another writer saves the note' },
				],
			}),
			'utf8'
		);

		await writeFile(
			join(scratch, 'scenarios/continue-after-fail.json'),
			JSON.stringify({
				job: 'keep-a-draft-continue',
				steps: [
					{ step: 1, command: 'document-create', description: 'A note is created' },
					{
						step: 2,
						command: 'fail-open',
						description: 'The note opens',
						continueOnFailure: true,
					},
					{
						step: 3,
						command: 'document-open-beside',
						description: 'The note opens beside itself',
					},
				],
			}),
			'utf8'
		);

		await writeFile(
			join(scratch, 'specimen.config.json'),
			JSON.stringify(
				{
					plugins: ['./job-plugin.js'],
					jobSources: ['./job-source.mjs'],
					specimens: [
						{
							id: 'clock-counter',
							title: 'Demo/ClockCounter',
							module: './app.specimens.js',
							exportName: 'ClockCounter',
						},
						{
							id: 'absent-event-clock',
							title: 'Demo/AbsentEventUnderClock',
							module: './app.specimens.js',
							exportName: 'AbsentEventUnderClock',
						},
						{
							id: 'example-keep-a-draft',
							title: 'Demo/Notes/Keep a draft',
							module: './app.specimens.js',
							exportName: 'NotesApp',
							job: {
								scenario: './scenarios/keep-a-draft.json',
								target: 'app',
								runner: 'demo',
								pin: { clock: '2026-03-02T09:00:00Z' },
								captures: [
									{ after: 'The note opens beside itself', name: 'two-editors' },
									{
										after: 'Another writer saves the note',
										name: 'conflict-notice',
										before: [{ action: { fill: 'draft', value: 'unsaved draft' } }],
									},
								],
							},
						},
						{
							id: 'example-keep-a-draft-compact',
							title: 'Demo/Notes/Keep a draft compact',
							module: './app.specimens.js',
							exportName: 'NotesAppCompact',
							job: {
								scenario: './scenarios/keep-a-draft.json',
								target: 'app',
								runner: 'demo',
								pin: { clock: '2026-03-02T09:00:00Z' },
								captures: [
									{ after: 'The note opens beside itself', name: 'two-editors' },
									{
										after: 'Another writer saves the note',
										name: 'conflict-notice',
										before: [{ action: { fill: 'draft', value: 'compact draft' } }],
									},
								],
							},
						},
						{
							id: 'example-keep-a-draft-continue',
							title: 'Demo/Notes/Keep a draft continue',
							module: './app.specimens.js',
							exportName: 'NotesApp',
							job: {
								scenario: './scenarios/continue-after-fail.json',
								target: 'app',
								runner: 'demo',
								pin: { clock: '2026-03-02T09:00:00Z' },
								captures: [{ after: 'The note opens beside itself', name: 'two-editors' }],
							},
						},
					],
				},
				null,
				2
			),
			'utf8'
		);

		bench = await createSpecimenBench({ root: scratch });
	}, 60_000);

	afterAll(async () => {
		await bench?.close();
		if (scratch) await rm(scratch, { recursive: true, force: true });
	});

	it('captures multiple checkpoints in one fresh render with pin.clock, detects unchanged, and diffs identically across runs', async () => {
		const run1 = await bench.captureCheckpoints({
			id: 'clock-counter',
			label: 'clock-1',
			pin: { clock: '2026-03-02T09:00:00Z' },
		});
		expect(run1.set).toMatch(SET_ID_PATTERN);
		expect(run1.pinned).toEqual({ clock: '2026-03-02T09:00:00Z', random: 'seeded' });
		expect(run1.captures.map((c) => [c.key, c.name, c.status])).toEqual([
			['clock-counter/1', 'initial', 'captured'],
			['clock-counter/2', 'after-noop', 'unchanged'],
			['clock-counter/3', 'after-click', 'captured'],
		]);
		expect(run1.captures[1]?.reason).toContain('did not change');
		expect(run1.counts.captured).toBe(3);
		expect(run1.counts.axe.passed + run1.counts.axe.failed).toBe(3);

		const obs1 = await readSetCapture(scratch, { set: 'clock-1', id: 'clock-counter/1' });
		const obs3 = await readSetCapture(scratch, { set: 'clock-1', id: 'clock-counter/3' });
		expect(obs1.channels.dom.raw).toContain('2026-03-02T09:00:00.000Z');
		expect(obs1.channels.dom.raw).toContain('ticks:0');
		expect(obs1.channels.console.warnings).toEqual([]);
		expect(obs3.channels.dom.raw).toContain('count:1');
		expect(obs3.channels.dom.raw).toContain('ticks:0');
		expect(obs3.channels.console.warnings).toContain('clicked-inc-1');
		expect(obs1.manifest.checkpoint.baseline.clock).toEqual({ pinned: '2026-03-02T09:00:00Z' });
		expect((await stat(obs3.channels.visual.path as string)).size).toBeGreaterThan(0);

		const run2 = await bench.captureCheckpoints({
			id: 'clock-counter',
			label: 'clock-2',
			pin: { clock: '2026-03-02T09:00:00Z' },
		});
		expect(run2.set).toBe(run1.set);

		for (const key of ['clock-counter/1', 'clock-counter/3']) {
			const diff = await bench.diff({
				left: { set: 'clock-1', id: key },
				right: { set: 'clock-2', id: key },
			});
			expect(diff.status).toBe('no-change-observed');
			expect(diff.differences).toHaveLength(0);
		}

		// Filtered & out-of-order requests keep scenario order and stable scenario ordinals, and
		// mixing 'mount' ('none') with a scenario step ('real-input') compares cleanly without error.
		const reversed = await bench.captureCheckpoints({
			id: 'clock-counter',
			checkpoints: ['after-click', 'initial'],
			pin: { clock: '2026-03-02T09:00:00Z' },
		});
		expect(reversed.captures.map((c) => [c.key, c.name, c.status])).toEqual([
			['clock-counter/1', 'initial', 'captured'],
			['clock-counter/3', 'after-click', 'captured'],
		]);

		const withMount = await bench.captureCheckpoints({
			id: 'clock-counter',
			checkpoints: ['mount', 'after-click'],
			pin: { clock: '2026-03-02T09:00:00Z' },
		});
		expect(withMount.captures.map((c) => [c.key, c.name, c.status])).toEqual([
			['clock-counter/0', 'mount', 'captured'],
			['clock-counter/3', 'after-click', 'captured'],
		]);

		// Mount-only stops before running scenario steps (no click warning recorded).
		const mountOnly = await bench.captureCheckpoints({
			id: 'clock-counter',
			checkpoints: ['mount'],
			pin: { clock: '2026-03-02T09:00:00Z' },
		});
		expect(mountOnly.captures.map((c) => [c.key, c.name])).toEqual([['clock-counter/0', 'mount']]);
		const mountOnlyObs = await readSetCapture(scratch, {
			set: mountOnly.set,
			id: 'clock-counter/0',
		});
		expect(mountOnlyObs.channels.console.warnings).toEqual([]);

		// Absent-event expectations use real Specimen timers and never hang under pin.clock.
		const absentRun = await bench.captureCheckpoints({
			id: 'absent-event-clock',
			pin: { clock: '2026-03-02T09:00:00Z' },
		});
		expect(absentRun.captures.map((c) => [c.key, c.name])).toEqual([
			['absent-event-clock/1', 'initial'],
			['absent-event-clock/2', 'after-quiet'],
		]);
	}, 120_000);

	it('lists/validates job entries, runs two variants sharing one scenario with <id>/<step> keys, and refuses captures after failed steps', async () => {
		expect(bench.list().map((e) => [e.id, e.kind])).toEqual([
			['clock-counter', 'native'],
			['absent-event-clock', 'native'],
			['example-keep-a-draft', 'job'],
			['example-keep-a-draft-compact', 'job'],
			['example-keep-a-draft-continue', 'job'],
		]);
		expect(bench.list({ kind: 'job' })).toHaveLength(3);
		expect(bench.list({ kind: 'component' }).map((e) => e.id)).toEqual([
			'clock-counter',
			'absent-event-clock',
		]);
		expect(bench.validate().valid).toBe(true);

		const comfy = await bench.runJob({ id: 'example-keep-a-draft', label: 'comfy' });
		expect(comfy.status).toBe('passed');
		expect(comfy.set).toMatch(SET_ID_PATTERN);
		expect(comfy.pinned).toEqual({ clock: '2026-03-02T09:00:00Z', random: 'seeded' });
		expect(comfy.captures.map((c) => [c.key, c.name, c.status])).toEqual([
			['example-keep-a-draft/3', 'two-editors', 'captured'],
			['example-keep-a-draft/4', 'conflict-notice', 'captured'],
		]);
		expect(comfy.steps[3]?.capture?.actions).toBe(1);

		const comfy4 = await readSetCapture(scratch, { set: 'comfy', id: 'example-keep-a-draft/4' });
		expect(comfy4.channels.dom.raw).toContain('Conflict: kept unsaved draft');
		expect(comfy4.channels.dom.raw).toContain('2026-03-02T09:00:00.000Z');
		expect(comfy4.manifest.job).toEqual({
			name: 'keep-a-draft',
			step: 4,
			description: 'Another writer saves the note',
		});

		const compact = await bench.runJob({ id: 'example-keep-a-draft-compact', label: 'compact' });
		expect(compact.status).toBe('passed');
		expect(compact.captures.map((c) => c.key)).toEqual([
			'example-keep-a-draft-compact/3',
			'example-keep-a-draft-compact/4',
		]);
		const compact4 = await readSetCapture(scratch, {
			set: 'compact',
			id: 'example-keep-a-draft-compact/4',
		});
		expect(compact4.channels.dom.raw).toContain('Conflict: kept compact draft');

		// Repeat run with pinned clock produces identical set and zero diff.
		const comfyAgain = await bench.runJob({ id: 'example-keep-a-draft' });
		expect(comfyAgain.set).toBe(comfy.set);
		const diff = await bench.diff({
			left: { set: comfy.set, id: 'example-keep-a-draft/4' },
			right: { set: comfyAgain.set, id: 'example-keep-a-draft/4' },
		});
		expect(diff.status).toBe('no-change-observed');
		expect(diff.differences).toHaveLength(0);

		// Failed step 2 with continueOnFailure: step 3 passes, yet capture is not-taken & unavailable.
		const broken = await bench.runJob({ id: 'example-keep-a-draft-continue' });
		expect(broken.status).toBe('failed');
		expect(broken.steps[1]?.status).toBe('failed');
		expect(broken.steps[2]?.status).toBe('passed');
		expect(broken.steps[2]?.capture).toMatchObject({
			status: 'not-taken',
			reason: expect.stringContaining('Step 2 failed earlier'),
		});
		const brokenManifest = await readCaptureSetManifest(scratch, broken.set);
		expect(brokenManifest.captures['example-keep-a-draft-continue/3']?.status).toBe('unavailable');

		// Process-isolated worker runs both captureCheckpoints and runJob with identical set IDs.
		const workerBench = await createSpecimenBench({
			root: scratch,
			runtimeIsolation: 'process',
		});
		try {
			const workerJob = await workerBench.runJob({ id: 'example-keep-a-draft' });
			expect(workerJob.status).toBe('passed');
			expect(workerJob.set).toBe(comfy.set);
		} finally {
			await workerBench.close();
		}
	}, 120_000);
});
