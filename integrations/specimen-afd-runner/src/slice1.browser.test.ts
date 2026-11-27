import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { failure, success } from '@lushly-dev/afd-core/result';
import { InProcessExecutor, parseScenarioFile } from '@lushly-dev/afd-testing';
import { createSpecimenBench, readSetCapture, type SpecimenBench } from '@lushly-dev/specimen';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginUrl = pathToFileURL(resolve(packageRoot, 'dist/index.js')).href;
const jobSourceUrl = pathToFileURL(resolve(packageRoot, 'dist/job-source.js')).href;

/**
 * Self-contained Slice 1 verification app matching the Notes scenarios in
 * docs/features/complete/screens-from-jobs/scenarios/ (Jobs 1, 2, 3, 6, 8, 9).
 */
const APP_MODULE_SOURCE = `
function createHandler(options = {}) {
	let nextId = 1;
	const notes = new Map();
	let openEditors = 0;
	let conflict = false;
	let exported = false;
	const render = options.onRender || (() => {});

	return async (name, input = {}) => {
		switch (name) {
			case 'document-create': {
				const id = 'doc-' + nextId++;
				const title = typeof input.title === 'string' ? input.title : 'Untitled';
				notes.set(id, { id, title, body: '' });
				render({ id, title, openEditors, conflict, exported });
				return { success: true, data: { id, title, createdAt: new Date().toISOString() } };
			}
			case 'document-open': {
				if (options.brokenOpen && input.group !== 'beside') {
					return {
						success: false,
						error: {
							code: 'DOCUMENT_OPEN_FAILED',
							message: 'Refused to open note in broken build.',
							suggestion: 'Fix document-open before retrying.',
						},
					};
				}
				const id = String(input.id || '');
				const note = notes.get(id);
				if (!note) {
					return {
						success: false,
						error: { code: 'NOT_FOUND', message: 'Missing note ' + id, suggestion: 'Create a note first.' },
					};
				}
				openEditors = input.group === 'beside' ? 2 : Math.max(openEditors, 1);
				render({ id, title: note.title, openEditors, conflict, exported });
				return { success: true, data: { id, openEditors } };
			}
			case 'notes-content-set': {
				const id = String(input.id || '');
				const note = notes.get(id);
				if (!note) {
					return {
						success: false,
						error: { code: 'NOT_FOUND', message: 'Missing note ' + id, suggestion: 'Create a note first.' },
					};
				}
				note.body = String(input.content || '');
				const draft = options.readDraft ? options.readDraft() : '';
				conflict = draft.length > 0;
				render({ id, title: note.title, openEditors, conflict, exported, draft });
				return { success: true, data: { id, conflict } };
			}
			case 'notes-export': {
				exported = true;
				return { success: true, data: { exported: true } };
			}
			case 'task-list-load': {
				render({ dueStep: 1 });
				return { success: true, data: { count: 1 } };
			}
			case 'task-sort-by-due': {
				render({ dueStep: 2 });
				return { success: true, data: { sorted: true } };
			}
			default:
				return {
					success: false,
					error: { code: 'UNKNOWN_COMMAND', message: 'Unknown ' + name, suggestion: 'Check command name.' },
				};
		}
	};
}

function mountNotes(density, brokenOpen = false) {
	const root = document.createElement('div');
	root.id = 'notes-app';
	root.dataset.density = density;

	const heading = document.createElement('h1');
	heading.textContent = 'Notes (' + density + ')';

	const editors = document.createElement('p');
	editors.id = 'editors';
	editors.textContent = 'editors:0';

	const draftLabel = document.createElement('label');
	draftLabel.htmlFor = 'second-editor';
	draftLabel.textContent = 'Second editor';

	const draftInput = document.createElement('input');
	draftInput.id = 'second-editor';
	draftInput.type = 'text';

	const notice = document.createElement('div');
	notice.id = 'conflict-notice';

	root.call = createHandler({
		brokenOpen,
		readDraft: () => draftInput.value,
		onRender: (state) => {
			editors.textContent = 'editors:' + state.openEditors + ':' + (state.title || '');
			notice.replaceChildren();
			if (state.conflict) {
				const msg = document.createElement('span');
				msg.textContent = 'Conflict kept draft (' + density + '): ' + state.draft;
				// Deliberately unnamed icon button so axe reports button-name in Job 3.
				const dismiss = document.createElement('button');
				dismiss.type = 'button';
				const icon = document.createElement('span');
				icon.setAttribute('aria-hidden', 'true');
				icon.textContent = 'x';
				dismiss.append(icon);
				notice.append(msg, dismiss);
			}
		},
	});
	root.append(heading, editors, draftLabel, draftInput, notice);
	return root;
}

function mountDueDates() {
	const root = document.createElement('main');
	root.id = 'due-app';
	const heading = document.createElement('h1');
	heading.textContent = 'Tasks';
	const list = document.createElement('p');
	list.id = 'due-list';
	const dueAt = Date.UTC(2026, 2, 5, 9, 0, 0);
	const renderList = (step) => {
		const days = Math.round((dueAt - Date.now()) / 86_400_000);
		const tag = Math.floor(Math.random() * 100000);
		list.textContent = 'step-' + step + ': Due in ' + days + ' days #' + tag;
	};
	renderList(0);
	root.call = createHandler({
		onRender: (state) => {
			if (state.dueStep) renderList(state.dueStep);
		},
	});
	root.append(heading, list);
	return root;
}

export const NotesApp = {
	targets: {
		app: { selector: '#notes-app' },
		'second-editor': { selector: '#second-editor' },
	},
	render: () => mountNotes('comfortable', false),
};

export const NotesAppCompact = {
	targets: {
		app: { selector: '#notes-app' },
		'second-editor': { selector: '#second-editor' },
	},
	render: () => mountNotes('compact', false),
};

export const NotesAppBroken = {
	targets: {
		app: { selector: '#notes-app' },
		'second-editor': { selector: '#second-editor' },
	},
	render: () => mountNotes('comfortable', true),
};

export const DueDatesApp = {
	targets: {
		app: { selector: '#due-app' },
	},
	render: () => mountDueDates(),
};

export const NoticeComponent = {
	render: () => {
		const el = document.createElement('main');
		const heading = document.createElement('h1');
		heading.textContent = 'Notice';
		const p = document.createElement('p');
		p.textContent = 'Plain component specimen';
		el.append(heading, p);
		return el;
	},
};
`;

const KEEP_A_DRAFT_YAML = `name: Keep a draft
description: Keep an unsaved draft when another writer saves the note
job: keep-a-draft
steps:
  - description: A note is created
    command: document-create
    input:
      title: Meeting notes
    expect:
      success: true
  - description: The note opens
    command: document-open
    input:
      id: \${{ steps[0].data.id }}
    expect:
      success: true
  - description: The note opens beside itself
    command: document-open
    input:
      id: \${{ steps[0].data.id }}
      group: beside
    expect:
      success: true
  - description: Another writer saves the note
    command: notes-content-set
    input:
      id: \${{ steps[0].data.id }}
      content: External update
    expect:
      success: true
`;

const KEEP_A_DRAFT_CONTINUE_YAML = `name: Keep a draft continue
description: Step 2 continues on failure
job: keep-a-draft
steps:
  - description: A note is created
    command: document-create
    input:
      title: Meeting notes
    expect:
      success: true
  - description: The note opens
    command: document-open
    continueOnFailure: true
    input:
      id: \${{ steps[0].data.id }}
    expect:
      success: true
  - description: The note opens beside itself
    command: document-open
    input:
      id: \${{ steps[0].data.id }}
      group: beside
    expect:
      success: true
  - description: Another writer saves the note
    command: notes-content-set
    input:
      id: \${{ steps[0].data.id }}
      content: External update
    expect:
      success: true
`;

const KEEP_A_DRAFT_RENAMED_YAML = KEEP_A_DRAFT_YAML.replace(
	'The note opens beside itself',
	'The note splits into two panes'
);

const EXPORT_A_NOTE_YAML = `name: Export a note
description: Exporting a note does not change the screen
job: export-a-note
steps:
  - description: A note is created
    command: document-create
    input:
      title: Export me
    expect:
      success: true
  - description: The note opens
    command: document-open
    input:
      id: \${{ steps[0].data.id }}
    expect:
      success: true
  - description: The note exports to markdown
    command: notes-export
    input:
      id: \${{ steps[0].data.id }}
    expect:
      success: true
`;

const UNTITLED_STEPS_YAML = `name: Untitled steps
description: Step 2 has no description
job: untitled-steps
steps:
  - description: A note is created
    command: document-create
    input:
      title: Untitled
    expect:
      success: true
  - command: document-open
    input:
      id: \${{ steps[0].data.id }}
    expect:
      success: true
`;

const DUE_DATES_YAML = `name: Due dates
description: Relative due dates stay deterministic under pinned clock
job: due-dates
steps:
  - description: Tasks load
    command: task-list-load
    expect:
      success: true
  - description: Tasks sort by due date
    command: task-sort-by-due
    expect:
      success: true
`;

function createHeadlessNotesHandler() {
	let nextId = 1;
	const notes = new Map<string, { id: string; title: string; body: string }>();
	return async (command: string, input?: Record<string, unknown>) => {
		switch (command) {
			case 'document-create': {
				const id = `doc-${nextId++}`;
				const title = typeof input?.title === 'string' ? input.title : 'Untitled';
				notes.set(id, { id, title, body: '' });
				return success({ id, title });
			}
			case 'document-open': {
				const id = String(input?.id ?? '');
				if (!notes.has(id)) {
					return failure({
						code: 'NOT_FOUND',
						message: `Missing ${id}`,
						suggestion: 'Create first',
					});
				}
				return success({ id, openEditors: input?.group === 'beside' ? 2 : 1 });
			}
			case 'notes-content-set': {
				const id = String(input?.id ?? '');
				const note = notes.get(id);
				if (!note) {
					return failure({
						code: 'NOT_FOUND',
						message: `Missing ${id}`,
						suggestion: 'Create first',
					});
				}
				note.body = String(input?.content ?? '');
				return success({ id, saved: true });
			}
			default:
				return failure({
					code: 'UNKNOWN',
					message: `Unknown ${command}`,
					suggestion: 'Check name',
				});
		}
	};
}

describe('Screens from Jobs Slice 1 end-to-end verification (Jobs 1, 2, 3, 6, 8, 9)', () => {
	let root: string;
	let bench: SpecimenBench;

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), 'specimen-slice1-'));
		await mkdir(join(root, 'example/scenarios'), { recursive: true });
		await writeFile(
			join(root, 'afd.plugin.mjs'),
			`import { afdRunner } from ${JSON.stringify(pluginUrl)};\nexport default afdRunner();\n`,
			'utf8'
		);
		await writeFile(
			join(root, 'afd.job-source.mjs'),
			`export { default } from ${JSON.stringify(jobSourceUrl)};\n`,
			'utf8'
		);
		await writeFile(join(root, 'app.specimens.mjs'), APP_MODULE_SOURCE, 'utf8');
		await writeFile(join(root, 'example/scenarios/keep-a-draft.scenario.yaml'), KEEP_A_DRAFT_YAML);
		await writeFile(
			join(root, 'example/scenarios/keep-a-draft-continue.scenario.yaml'),
			KEEP_A_DRAFT_CONTINUE_YAML
		);
		await writeFile(
			join(root, 'example/scenarios/keep-a-draft-renamed.scenario.yaml'),
			KEEP_A_DRAFT_RENAMED_YAML
		);
		await writeFile(
			join(root, 'example/scenarios/export-a-note.scenario.yaml'),
			EXPORT_A_NOTE_YAML
		);
		await writeFile(
			join(root, 'example/scenarios/untitled-steps.scenario.yaml'),
			UNTITLED_STEPS_YAML
		);
		await writeFile(join(root, 'example/scenarios/due-dates.scenario.yaml'), DUE_DATES_YAML);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify(
				{
					plugins: ['./afd.plugin.mjs'],
					jobSources: ['./afd.job-source.mjs'],
					specimens: [
						{
							id: 'example-notice',
							title: 'Example/Notice',
							module: './app.specimens.mjs',
							exportName: 'NoticeComponent',
						},
						{
							id: 'example-keep-a-draft',
							title: 'Example/Notes/Keep a draft',
							module: './app.specimens.mjs',
							exportName: 'NotesApp',
							job: {
								scenario: 'example/scenarios/keep-a-draft.scenario.yaml',
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
						},
						{
							id: 'example-export-a-note',
							title: 'Example/Notes/Export a note',
							module: './app.specimens.mjs',
							exportName: 'NotesApp',
							job: {
								scenario: 'example/scenarios/export-a-note.scenario.yaml',
								target: 'app',
								captures: [
									{ after: 'The note opens', name: 'the-note-opens' },
									{ after: 'The note exports to markdown', name: 'the-note-exports-to-markdown' },
								],
							},
						},
						{
							id: 'example-keep-a-draft-compact',
							title: 'Example/Notes/Keep a draft compact',
							module: './app.specimens.mjs',
							exportName: 'NotesAppCompact',
							job: {
								scenario: 'example/scenarios/keep-a-draft.scenario.yaml',
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
						},
						{
							id: 'example-keep-a-draft-stale',
							title: 'Example/Notes/Keep a draft stale',
							module: './app.specimens.mjs',
							exportName: 'NotesApp',
							job: {
								scenario: 'example/scenarios/keep-a-draft-renamed.scenario.yaml',
								target: 'app',
								captures: [{ after: 'The note opens beside itself', name: 'two-editors' }],
							},
						},
						{
							id: 'example-due-dates',
							title: 'Example/Tasks/Due dates',
							module: './app.specimens.mjs',
							exportName: 'DueDatesApp',
							job: {
								scenario: 'example/scenarios/due-dates.scenario.yaml',
								target: 'app',
								pin: { clock: '2026-03-02T09:00:00Z' },
								captures: [
									{ after: 'Tasks load', name: 'loaded' },
									{ after: 'Tasks sort by due date', name: 'sorted' },
								],
							},
						},
						{
							id: 'example-keep-a-draft-broken',
							title: 'Example/Notes/Keep a draft broken',
							module: './app.specimens.mjs',
							exportName: 'NotesAppBroken',
							job: {
								scenario: 'example/scenarios/keep-a-draft.scenario.yaml',
								target: 'app',
								captures: [
									{ after: 'The note opens beside itself', name: 'two-editors' },
									{ after: 'Another writer saves the note', name: 'conflict-notice' },
								],
							},
						},
						{
							id: 'example-keep-a-draft-continue',
							title: 'Example/Notes/Keep a draft continue',
							module: './app.specimens.mjs',
							exportName: 'NotesAppBroken',
							job: {
								scenario: 'example/scenarios/keep-a-draft-continue.scenario.yaml',
								target: 'app',
								captures: [
									{ after: 'The note opens beside itself', name: 'two-editors' },
									{ after: 'Another writer saves the note', name: 'conflict-notice' },
								],
							},
						},
					],
				},
				null,
				2
			),
			'utf8'
		);
		bench = await createSpecimenBench({ root });
	}, 60_000);

	afterAll(async () => {
		await bench?.close();
		if (root) await rm(root, { recursive: true, force: true });
	});

	it('Job 2 (build-a-state-once): creates job entries from scenarios, refuses undescribed/stale steps, and runs the same scenario headless', async () => {
		const created = await bench.createJob({
			id: 'example-keep-a-draft-created',
			scenario: 'example/scenarios/keep-a-draft.scenario.yaml',
			module: './app.specimens.mjs',
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
		expect(created.written).toMatch(/specimen\.config\.json$/);
		expect(created.entry.job.captures).toEqual([
			{ after: 'The note opens beside itself', name: 'two-editors' },
			{
				after: 'Another writer saves the note',
				name: 'conflict-notice',
				before: [{ action: { fill: 'second-editor', value: ' draft' } }],
			},
		]);

		// Bare step numbers default capture names to deterministic kebab-case description slugs.
		const bareCreated = await bench.createJob({
			id: 'example-export-a-note-created',
			scenario: 'example/scenarios/export-a-note.scenario.yaml',
			module: './app.specimens.mjs',
			exportName: 'NotesApp',
			target: 'app',
			captures: [3],
		});
		expect(bareCreated.written).toMatch(/specimen\.config\.json$/);
		expect(bareCreated.entry.job.captures[0]?.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

		// Undescribed step is refused with STEP_HAS_NO_DESCRIPTION.
		await expect(
			bench.createJob({
				id: 'example-untitled',
				scenario: 'example/scenarios/untitled-steps.scenario.yaml',
				module: './app.specimens.mjs',
				exportName: 'NotesApp',
				target: 'app',
				captures: [2],
			})
		).rejects.toMatchObject({
			code: 'STEP_HAS_NO_DESCRIPTION',
			suggestion: expect.stringContaining('description'),
		});

		// Newly created job specimen appears immediately in kind: 'job' listing.
		const jobs = bench.list({ kind: 'job' });
		expect(jobs.find((e) => e.id === 'example-keep-a-draft-created')?.job?.scenario).toBe(
			'example/scenarios/keep-a-draft.scenario.yaml'
		);

		// The exact same scenario file runs headless through @lushly-dev/afd-testing.
		const parsed = await parseScenarioFile(
			join(root, 'example/scenarios/keep-a-draft.scenario.yaml')
		);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			const executor = new InProcessExecutor({ handler: createHeadlessNotesHandler() });
			const headless = await executor.execute(parsed.scenario);
			expect(headless.outcome).toBe('pass');
		}

		// Stale capture description is caught statically with no browser and refused at run time.
		const staleReport = bench.validate({ id: 'example-keep-a-draft-stale' });
		expect(staleReport.valid).toBe(false);
		expect(staleReport.issues[0]).toMatchObject({
			severity: 'error',
			code: 'CAPTURE_STEP_UNKNOWN',
			suggestion: expect.stringContaining('specimen-job-create'),
		});
		await expect(bench.runJob({ id: 'example-keep-a-draft-stale' })).rejects.toMatchObject({
			code: 'CAPTURE_STEP_UNKNOWN',
			suggestion: expect.stringContaining('specimen-validate'),
		});
	}, 60_000);

	it('Jobs 1 & 3 (see-a-jobs-states + check-a-state-where-it-occurs): captures states, reports unchanged, reads from set & checks a11y with zero step replay', async () => {
		const run = await bench.runJob({ id: 'example-keep-a-draft' });
		expect(run.set).toMatch(/^set-[0-9a-f]{12}$/);
		expect(run.job).toBe('keep-a-draft');
		expect(run.status).toBe('passed');
		expect(run.steps).toHaveLength(4);
		expect(run.steps[0]?.capture).toBeUndefined();
		expect(run.steps[1]?.capture).toBeUndefined();
		expect(run.steps[2]?.capture).toMatchObject({
			key: 'example-keep-a-draft/3',
			status: 'captured',
		});
		expect(run.steps[3]?.capture).toMatchObject({
			key: 'example-keep-a-draft/4',
			name: 'conflict-notice',
			actions: 1,
		});
		expect(run.captures).toHaveLength(2);
		expect(run.captures[0]?.key).toBe('example-keep-a-draft/3');
		expect(run.captures[0]?.screenshot).toMatch(/\.png$/);
		expect(run.captures[1]?.key).toBe('example-keep-a-draft/4');

		// Open a fresh bench with a nonexistent Chromium path to prove specimen-render(set) and
		// specimen-a11y(set) launch zero browsers and replay zero steps.
		const browserless = await createSpecimenBench({
			root,
			executablePath: join(root, 'no-browser-here'),
		});
		try {
			const kept = await browserless.render({
				id: 'example-keep-a-draft',
				set: run.set,
				checkpoint: 'conflict-notice',
			});
			expect(kept.manifest.set).toBe(run.set);
			expect(kept.manifest.checkpoint.name).toBe('conflict-notice');
			expect(kept.manifest.job).toEqual({
				name: 'keep-a-draft',
				step: 4,
				description: 'Another writer saves the note',
			});

			// Job 3: specimen-a11y reads recorded axe from set without replaying any step.
			const a11y = await browserless.a11y({ set: run.set });
			expect(a11y.counts).toMatchObject({ total: 2, passed: 1, failed: 1 });
			expect(a11y.reports[0]).toMatchObject({
				checkpoint: 'two-editors',
				status: 'passed',
			});
			expect(a11y.reports[1]).toMatchObject({
				checkpoint: 'conflict-notice',
				status: 'failed',
				job: { name: 'keep-a-draft', step: 4 },
				violations: [expect.objectContaining({ id: 'button-name' })],
			});

			// Rendering a job without set is refused with JOB_NEEDS_RUN.
			await expect(browserless.render({ id: 'example-keep-a-draft' })).rejects.toMatchObject({
				code: 'JOB_NEEDS_RUN',
				suggestion: expect.stringContaining('specimen-job-run'),
			});
		} finally {
			await browserless.close();
		}

		// Second variant entry on the same scenario keeps distinct <id>/<step> keys.
		const compactRun = await bench.runJob({ id: 'example-keep-a-draft-compact' });
		expect(compactRun.status).toBe('passed');
		expect(compactRun.captures.map((c) => c.key)).toEqual([
			'example-keep-a-draft-compact/3',
			'example-keep-a-draft-compact/4',
		]);
		const compactKept = await bench.render({
			id: 'example-keep-a-draft-compact',
			set: compactRun.set,
			checkpoint: 'conflict-notice',
		});
		expect(compactKept.manifest.job).toMatchObject({ name: 'keep-a-draft', step: 4 });
		expect(compactKept.channels.dom.raw).toContain('(compact)');

		// Marked step that changed nothing on screen is reported as unchanged.
		const exportRun = await bench.runJob({ id: 'example-export-a-note' });
		expect(exportRun.status).toBe('passed');
		expect(exportRun.steps[2]?.capture).toMatchObject({
			key: 'example-export-a-note/3',
			status: 'unchanged',
			reason: expect.stringContaining('did not change'),
		});

		// Component specimen is refused by specimen-job-run with NOT_A_JOB.
		await expect(bench.runJob({ id: 'example-notice' })).rejects.toMatchObject({
			code: 'NOT_A_JOB',
			suggestion: expect.stringContaining('specimen-list'),
		});
	}, 120_000);

	it('Job 6 (pin-the-clock): pins clock and seeded random so two runs diff with no-change-observed', async () => {
		const first = await bench.runJob({ id: 'example-due-dates' });
		expect(first.set).toMatch(/^set-[0-9a-f]{12}$/);
		expect(first.pinned).toEqual({ clock: '2026-03-02T09:00:00Z', random: 'seeded' });

		const second = await bench.runJob({ id: 'example-due-dates' });
		expect(second.set).toMatch(/^set-[0-9a-f]{12}$/);
		expect(second.status).toBe('passed');

		for (const step of [1, 2]) {
			const diff = await bench.diff({
				left: { set: first.set, id: `example-due-dates/${step}` },
				right: { set: second.set, id: `example-due-dates/${step}` },
			});
			expect(diff.status).toBe('no-change-observed');
			expect(diff.differences).toHaveLength(0);
		}
	}, 120_000);

	it('Jobs 8 & 9 (refuse-a-capture-from-the-wrong-state + run-without-a-browser): refuses captures after failure and reports BROWSER_UNAVAILABLE when browser is missing', async () => {
		const brokenRun = await bench.runJob({ id: 'example-keep-a-draft-broken' });
		expect(brokenRun.status).toBe('failed');
		expect(brokenRun.steps[1]).toMatchObject({ step: 2, status: 'failed' });
		expect(brokenRun.steps[2]).toMatchObject({
			status: 'skipped',
			capture: {
				status: 'not-taken',
				reason: expect.stringContaining('Step 2 failed'),
			},
		});
		expect(brokenRun.steps[3]?.capture?.status).toBe('not-taken');

		const brokenA11y = await bench.a11y({ set: brokenRun.set });
		expect(brokenA11y.counts).toMatchObject({ total: 2, notRun: 2 });
		expect(brokenA11y.reports[0]).toMatchObject({
			status: 'not-run',
			reason: expect.stringContaining('not taken'),
		});

		const continueRun = await bench.runJob({ id: 'example-keep-a-draft-continue' });
		expect(continueRun.status).toBe('failed');
		expect(continueRun.steps[1]?.status).toBe('failed');
		expect(continueRun.steps[2]?.status).toBe('passed');
		expect(continueRun.steps[2]?.capture).toMatchObject({
			status: 'not-taken',
			reason: expect.stringContaining('Step 2 failed earlier'),
		});

		// Job 9: headless evaluation passes while browserless specimen-job-run refuses with BROWSER_UNAVAILABLE.
		const parsed = await parseScenarioFile(
			join(root, 'example/scenarios/keep-a-draft.scenario.yaml')
		);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			const headless = await new InProcessExecutor({
				handler: createHeadlessNotesHandler(),
			}).execute(parsed.scenario);
			expect(headless.outcome).toBe('pass');
		}
		const noBrowser = await createSpecimenBench({
			root,
			executablePath: join(root, 'missing-chromium-binary'),
		});
		try {
			await expect(noBrowser.runJob({ id: 'example-keep-a-draft' })).rejects.toMatchObject({
				code: 'BROWSER_UNAVAILABLE',
			});
		} finally {
			await noBrowser.close();
		}
	}, 120_000);

	it('specimen-capture runs job specimens through the configured runner into <id>/<step> captures', async () => {
		const captured = await bench.captureSet({
			ids: ['example-notice', 'example-due-dates'],
			label: 'mixed-capture',
		});
		expect(captured.counts.captured).toBe(3); // 1 component + 2 job captures
		expect(captured.skipped.jobs).toBe(0);

		const noticeObs = await readSetCapture(root, { set: 'mixed-capture', id: 'example-notice' });
		const dueStep1 = await readSetCapture(root, {
			set: 'mixed-capture',
			id: 'example-due-dates/1',
		});
		const dueStep2 = await readSetCapture(root, {
			set: 'mixed-capture',
			id: 'example-due-dates/2',
		});
		expect(noticeObs.manifest.specimenId).toBe('example-notice');
		expect(dueStep1.manifest.job).toMatchObject({ name: 'due-dates', step: 1 });
		expect(dueStep2.manifest.job).toMatchObject({ name: 'due-dates', step: 2 });
	}, 120_000);
});
