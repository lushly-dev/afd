/**
 * E2 and E4's captures (phase 0 specification, section 11), through Specimen's bench over the
 * chrome's fixtures in `@lushly-dev/loam-chrome`'s `specimens/`: the live and replayed 50-call
 * sessions are equal under `diffObservations`, and every part and the whole shell is captured,
 * with an ARIA snapshot, in light, dark and high contrast (D53).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSpecimenBench, diffObservations, type SpecimenBench } from '@lushly-dev/specimen';
import type { Observation, SpecimenContext } from '@lushly-dev/specimen/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SPECIMENS = fileURLToPath(new URL('../../../chrome/specimens/', import.meta.url));
const NOTES_SPECIMENS = fileURLToPath(
	new URL('../../../../apps/notes/specimens/', import.meta.url)
);

let bench: SpecimenBench;
beforeAll(async () => {
	bench = await createSpecimenBench({ root: SPECIMENS });
});
afterAll(async () => {
	await bench?.close();
});

const CONTEXT: Partial<SpecimenContext> = {
	viewport: { width: 1280, height: 800 },
	reducedMotion: 'reduce',
	motion: 'settled',
};

/**
 * Specimen's ARIA snapshot is empty while a modal dialog is open (a follow-up in the
 * specification); the palette's capture is checked through its DOM, and axe covers it open.
 */
const MODAL = new Set([
	'shell-palette',
	'app-modal',
	'app-modal-compact',
	'app-modal-danger',
	'app-modal-danger-compact',
	'app-project-switcher-dialog',
	'app-project-switcher-dialog-compact',
	// Phase 4's prompt and confirmation sit in the slot, modal.
	'settings-prompt',
	'settings-confirmation',
]);

function expectClean(observation: Observation, id = observation.manifest.specimenId) {
	expect(
		observation.channels.console.errors,
		`${id} console errors: ${observation.channels.console.errors.join(' | ')}`
	).toEqual([]);
	if (MODAL.has(id)) {
		expect(observation.channels.dom.normalized, id).toMatch(/<dialog[^>]* open/);
		return;
	}
	expect(observation.channels.a11y.snapshot.trim(), id).not.toBe('');
	expect(
		observation.completeness.dom.reasons
			.concat(observation.completeness.a11y.reasons)
			.filter((reason) => reason.includes('Context mismatch'))
	).toEqual([]);
}

describe('P2-E13: E2: a replayed journal reproduces the layout', () => {
	it('renders the live session and the replayed fixture identically', async () => {
		const live = await bench.render({ id: 'session-live', context: CONTEXT });
		const replay = await bench.render({ id: 'session-replay', context: CONTEXT });
		expectClean(live);
		expectClean(replay);
		// A replay does not journal the entries it replays, so the replayed kernel's journal holds
		// only what ran after it: the status bar's number is the one thing that differs (7.1).
		const journalNumber = (observation: Observation) =>
			Number(/Journal (\d+)/.exec(observation.channels.a11y.snapshot)?.[1]);
		expect(journalNumber(live)).toBe(50 + 2 + 3);
		expect(journalNumber(replay)).toBe(2 + 3);
		const diff = diffObservations(live, replay);
		const outsideJournal = diff.differences.filter((difference) => {
			// The journal's item: fourth from phase 2's step 6, after the workspace's, the project's (hidden
			// with no project) and the actor's (7.4).
			if (difference.target?.includes('loam-status-item:4')) return false;
			if (difference.target?.includes('loam-statusbar:1/shadow/span:2')) return false;
			if (difference.channel === 'a11y' || difference.channel === 'dom') {
				const strip = (value: unknown) =>
					String(value)
						.replace(/Journal \d+/g, 'Journal N')
						.replace(/>\d+</g, '>N<')
						// FAST's template markers carry an id drawn per page.
						.replace(/fast-[a-z0-9]+/g, 'fast-X');
				const [left, right] = [strip(difference.left), strip(difference.right)];
				if (left === right) return false;
				let at = 0;
				while (left[at] === right[at]) at++;
				console.error(
					`${difference.channel} differs at ${at}:\n${left.slice(at - 200, at + 200)}\n---\n${right.slice(at - 200, at + 200)}`
				);
				return true;
			}
			return true;
		});
		expect(outsideJournal).toEqual([]);
		// The session ends with the inspector open at 520 and the sidebar at 300.
		expect(live.channels.a11y.snapshot).toContain('complementary "Inspector"');
	}, 120_000);
});

/** Each fixture, and a landmark or role its snapshot must show. */
const CAPTURES: [string, string][] = [
	['shell', 'banner "Loam"'],
	['shell-compact-density', 'contentinfo "Status"'],
	['shell-palette', 'Command palette'],
	['titlebar', 'banner "Loam"'],
	['titlebar-signed-in', 'button "Sign out"'],
	['rail', 'navigation "Apps"'],
	['tabbar', 'navigation "Apps"'],
	['sidebar', 'complementary "Sidebar"'],
	['inspector', 'complementary "Inspector"'],
	['inspector-overlay', 'complementary "Inspector"'],
	['main', 'heading "No apps yet"'],
	['main-not-found', 'link "Go to the start page"'],
	['panel', 'region "Panel"'],
	['statusbar', 'contentinfo "Status"'],
	['resize-handle', 'separator "Resize sidebar"'],
	['empty-state', 'Output and logs will appear here.'],
	['status-item', 'Journal'],
	['notice', 'heading "Loam is open in another tab"'],
	['shell-project', 'button "Project: Atlas"'],
];

/** E11 (phase 1 specification, section 14): what apps add, comfortable and compact. */
const APP_CAPTURES: [string, string][] = [
	['app-mount', 'An app surface, in its own registry'],
	['app-mount-undefined', 'APP_ELEMENT_UNDEFINED'],
	['app-list', 'listbox "Greetings"'],
	['app-list-empty', 'Nothing here yet.'],
	['app-list-failed', 'The list could not be read'],
	['app-part-header', 'button "Greet"'],
	['app-rail-apps', 'button "Tray (unavailable)"'],
	['app-tabbar-apps', 'button "Tray (unavailable)"'],
	// Phase 2's step 6: the rail's bands, the switcher and its list, the tooltip, two sidebar groups, crumbs.
	['app-rail-project', 'button "Project: Atlas"'],
	['app-rail-tooltip', 'button "Tracker"'],
	['app-project-switcher-list', 'listbox "Projects"'],
	['app-project-switcher-dialog', 'aria-label="Choose a project"'],
	// Phase 2's step 11: an app's `tree` sidebar is `loam-tree`, nested, in place of the list's indented rows.
	['app-tree', 'treeitem "Install, Five minutes"'],
	['app-list-dual', 'region "In Atlas"'],
	['app-part-header-crumbs', 'navigation "Location"'],
	['app-status-action', 'button "Total 3"'],
	['app-toasts', 'status "Notifications"'],
	['app-modal', 'Say hello?'],
	['app-modal-danger', 'Delete this?'],
	['app-notice-embedded', 'heading "Hello"'],
	['app-view-frame-loading', 'Opening Hello'],
	['app-view-frame-failed', 'VIEW_READY_TIMEOUT'],
	['app-console', 'listbox "Commands"'],
	// Component Briefs' step C5: the first read, "Loading…" beside a decorative spinner.
	['app-console-loading', 'Loading…'],
	['app-console-invalid', 'Error: This field is required.'],
	['app-console-result', 'PROBE_REFUSED'],
	['app-console-mounted', 'MOUNT_UNREACHABLE'],
	// Phase 2's step 7: the projects section's list, its refused form, its empty state, a home, and a home of
	// long, empty and right-to-left summaries at 320 CSS px.
	['app-projects-section', 'table "Projects"'],
	['app-projects-section-form', "Error: That slug can't be used"],
	['app-projects-section-empty', 'No projects yet'],
	['app-projects-section-home', 'article "Slow"'],
	// Phase 2's step 11: the home's Documents card, the shell's, after the apps' summaries.
	['app-projects-section-documents', 'article "Documents"'],
	['app-projects-section-long', 'article "دفتر"'],
].flatMap(([id, expected]) => [
	[id, expected] as [string, string],
	[`${id}-compact`, expected] as [string, string],
]);

describe('P2-E13: E11: Specimen captures of what apps add', () => {
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`P2-E12: P2-E13: captures each in ${theme}, in both densities, each with an ARIA snapshot`, async () => {
			for (const [id, expected] of APP_CAPTURES) {
				const observation = await bench.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation);
				const channel = MODAL.has(id)
					? observation.channels.dom.normalized
					: observation.channels.a11y.snapshot;
				expect(channel, id).toContain(expected);
			}
		}, 300_000);
});

/** The documents specification's D10 so far (step 10): the editor area's elements, comfortable and compact. */
const EDITOR_CAPTURES: [string, string[]][] = [
	[
		'editor-area',
		[
			'region "Documents"',
			'heading "Roadmap"',
			'tablist "Documents, group 1"',
			'tab "Roadmap, unsaved" [selected]',
			'tab "Plan, pinned"',
			'tab "Ideas (preview)"',
			'Opening Roadmap',
			'DOCUMENT_TYPE_UNAVAILABLE',
			'button "Close"',
		],
	],
	['editor-group', ['tablist "Documents"', 'tab "Plan, pinned"', 'tabpanel', 'Opening Roadmap']],
	// Step 12 and #868: `loam-embed`, refused or missing alike, a link-only target, a ready target with a body,
	// and the depth and cycle stops.
	['editor-embed-unavailable', ['group "Embedded: Document"', 'Not available']],
	['editor-embed-link', ['group "Embedded: Roadmap"', 'link "Roadmap"']],
	[
		'editor-embed-ready',
		['group "Embedded: Roadmap"', 'link "Roadmap"', 'Plans for the quarter, and what ships first.'],
	],
	[
		'editor-embed-depth',
		[
			'Third embed.',
			'group "Embedded: Deep jot"',
			'Deep jot is embedded too deeply, or in itself, to show here',
		],
	],
	[
		'editor-embed-cycle',
		[
			'Embeds itself.',
			'group "Embedded: Loop jot"',
			'Loop jot is embedded too deeply, or in itself, to show here',
		],
	],
	[
		'editor-menu',
		['menu "Actions for Roadmap"', 'menuitem "Pin"', 'menuitem "Move to a new group"'],
	],
	['editor-frame-loading', ['Opening Roadmap']],
	['editor-frame-failed', ['heading "Ledger"', 'DOCUMENT_CONTENT_VERSION_NEWER', 'button "Close"']],
].flatMap(([id, expected]) => [
	[id, expected] as [string, string[]],
	[`${id}-compact`, expected] as [string, string[]],
]);

/** `notes-editor`, from the type's own fixtures, since no chrome file names a type (D2). */
const NOTES_CAPTURES: [string, string[]][] = [
	['notes-editor', ['textbox "Roadmap"']],
	// #868: `notes-editor` with the link picker open and with its embed list populated.
	[
		'notes-editor-picker',
		[
			'textbox "Roadmap"',
			'group "Insert a link"',
			'textbox "Find a document"',
			'button "Launch plan"',
			'button "Quarterly review"',
			'button "Cancel"',
		],
	],
	[
		'notes-editor-embeds',
		[
			'list "Embedded documents"',
			'group "Embedded: Launch plan"',
			'link "Launch plan"',
			'button "Remove embed: Launch plan"',
			'Plans for the quarter, and what ships first.',
			'group "Embedded: Document"',
			'button "Remove embed: document"',
			'Not available',
		],
	],
	// Step 12: its inspector's links and backlinks, and a note as another embeds it.
	[
		'notes-inspector',
		[
			'region "Links"',
			'button "Launch plan"',
			'region "Backlinks"',
			'button "Old notes"',
			'In trash',
		],
	],
	['notes-embed', ['Plans for the quarter, and what ships first.']],
].flatMap(([id, expected]) => [
	[id, expected] as [string, string[]],
	[`${id}-compact`, expected] as [string, string[]],
]);

/**
 * Specimen wraps `#specimen-root` in a `<main>` landmark, so mounting the whole `loam-shell`
 * (which brings its own `banner`, `main`, and `contentinfo` landmarks) triggers these five
 * exact `(rule, targets)` harness-wrapper landmark violations, identical to `chrome/specimens`'s
 * `shell` fixture. Any other rule or target fails the test.
 */
const SPECIMEN_SHELL_HARNESS_A11Y_VIOLATIONS = new Map<string, readonly string[]>([
	['landmark-banner-is-top-level', ['loam-shell,loam-titlebar']],
	['landmark-contentinfo-is-top-level', ['loam-shell,loam-statusbar']],
	['landmark-main-is-top-level', ['loam-shell,loam-main']],
	['landmark-no-duplicate-main', ['#specimen-root']],
	['landmark-unique', ['#specimen-root']],
]);

function isShellHarnessViolation(violation: { id: string; targets: string[] }): boolean {
	const expectedTargets = SPECIMEN_SHELL_HARNESS_A11Y_VIOLATIONS.get(violation.id);
	return (
		expectedTargets !== undefined &&
		violation.targets.length === expectedTargets.length &&
		violation.targets.every((target, index) => target === expectedTargets[index])
	);
}

describe("P2-D10: Specimen captures of notes' editor, inspector and embed", () => {
	let notes: SpecimenBench;
	beforeAll(async () => {
		notes = await createSpecimenBench({ root: NOTES_SPECIMENS });
	});
	afterAll(async () => {
		await notes?.close();
	});
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`P2-D10: captures the editor with a draft, the inspector and the embed in ${theme}, in both densities`, async () => {
			for (const [id, expected] of NOTES_CAPTURES) {
				const observation = await notes.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation);
				for (const each of expected) expect(observation.channels.a11y.snapshot, id).toContain(each);
				if (id.startsWith('notes-editor-embeds')) {
					expect(
						observation.channels.a11y.snapshot.match(/button "Remove embed(?:: [^"]+)?"/g),
						id
					).toHaveLength(2);
				}
			}
		}, 300_000);

	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`P2-D10: runs the notes-conflict job specimen in ${theme}, in both densities, capturing two-editors and conflict-notice without hand-built stubs`, async () => {
			// A browserless bench proves specimen-render(set) and specimen-a11y(set) launch zero
			// browsers and replay zero steps (Screens from Jobs Slice 1 exit criterion 4).
			const browserless = await createSpecimenBench({
				root: NOTES_SPECIMENS,
				executablePath: join(NOTES_SPECIMENS, 'no-browser-here'),
			});
			try {
				const conflictByDensity = new Map<
					'notes-conflict' | 'notes-conflict-compact',
					Observation
				>();
				for (const id of ['notes-conflict', 'notes-conflict-compact'] as const) {
					const run = await notes.runJob({ id, context: { ...CONTEXT, theme } });
					expect(run.status, id).toBe('passed');
					expect(run.job, id).toBe('notes-conflict');
					expect(run.pinned.clock, id).toBe('2026-03-02T09:00:00Z');
					expect(run.steps, id).toHaveLength(4);
					expect(
						run.captures.map((capture) => [capture.key, capture.name, capture.status]),
						id
					).toEqual([
						[`${id}/3`, 'two-editors', 'captured'],
						[`${id}/4`, 'conflict-notice', 'captured'],
					]);
					expect(run.steps[3]?.capture?.actions, id).toBe(1);

					const twoEditors = await browserless.render({
						id,
						set: run.set,
						checkpoint: 'two-editors',
					});
					expectClean(twoEditors, `${id}/3`);
					expect(twoEditors.manifest.context.theme, id).toBe(theme);
					expect(twoEditors.manifest.job?.step, id).toBe(3);
					expect(twoEditors.manifest.set, id).toBe(run.set);
					expect(twoEditors.channels.a11y.snapshot, id).toContain('tablist "Documents, group 1"');
					expect(twoEditors.channels.a11y.snapshot, id).toContain('tablist "Documents, group 2"');
					expect(twoEditors.channels.a11y.snapshot.match(/textbox "Roadmap"/g), id).toHaveLength(2);
					expect(twoEditors.channels.a11y.snapshot, id).not.toContain(
						'This note changed elsewhere'
					);

					const conflictNotice = await browserless.render({
						id,
						set: run.set,
						checkpoint: 'conflict-notice',
					});
					expectClean(conflictNotice, `${id}/4`);
					expect(conflictNotice.manifest.context.theme, id).toBe(theme);
					expect(conflictNotice.manifest.job?.step, id).toBe(4);
					expect(conflictNotice.manifest.set, id).toBe(run.set);
					for (const expected of [
						'tab "Roadmap, unsaved"',
						'alert',
						'This note changed elsewhere',
						'button "Keep mine"',
						'button "Use theirs"',
					]) {
						expect(conflictNotice.channels.a11y.snapshot, id).toContain(expected);
					}
					const incomingIndex = conflictNotice.channels.a11y.snapshot.indexOf(
						'Ship the editor area next week.'
					);
					const draftIndex = conflictNotice.channels.a11y.snapshot.indexOf(
						'Ship the editor area, then the documents section.'
					);
					expect(incomingIndex, `${id}/4 incoming text`).toBeGreaterThan(-1);
					expect(draftIndex, `${id}/4 preserved draft`).toBeGreaterThan(incomingIndex);
					conflictByDensity.set(id, conflictNotice);

					// Exit criterion 4: reading accessibility from the saved capture set replays zero steps.
					const a11y = await browserless.a11y({ set: run.set });
					expect(a11y.counts.total, id).toBe(2);
					expect(a11y.counts.notRun, id).toBe(0);
					expect(
						a11y.reports.map((item) => [item.id, item.checkpoint, item.job?.step]),
						id
					).toEqual([
						[id, 'two-editors', 3],
						[id, 'conflict-notice', 4],
					]);
					const recordedObservations = [twoEditors, conflictNotice];
					for (const [index, item] of a11y.reports.entries()) {
						expect(item.job?.name, `${id} ${item.checkpoint}`).toBe('notes-conflict');
						expect(item.status, `${id} ${item.checkpoint}`).not.toBe('not-run');
						expect(item.engine, `${id} ${item.checkpoint}`).toBeTruthy();
						const recordedAxe = recordedObservations[index]?.channels.a11y.axe;
						expect(recordedAxe, `${id} ${item.checkpoint}`).not.toBe('not-run');
						if (recordedAxe && recordedAxe !== 'not-run') {
							expect(item.violations, `${id} ${item.checkpoint}`).toEqual(recordedAxe.violations);
						}
						const appViolations = item.violations.filter(
							(violation) => !isShellHarnessViolation(violation)
						);
						expect(appViolations, `${id} ${item.checkpoint}`).toEqual([]);
					}
				}
				const comfortable = conflictByDensity.get('notes-conflict');
				const compact = conflictByDensity.get('notes-conflict-compact');
				expect(comfortable && compact, theme).toBeTruthy();
				if (comfortable && compact) {
					expect(diffObservations(comfortable, compact).differences.length, theme).toBeGreaterThan(
						0
					);
				}
			} finally {
				await browserless.close();
			}
		}, 300_000);

	it('validates the live notes specimen configuration including both job specimens', async () => {
		const report = await notes.validate();
		expect(report).toMatchObject({ valid: true, issues: [] });
		const jobs = await notes.list({ kind: 'job' });
		expect(jobs.map((entry) => entry.id)).toEqual(['notes-conflict', 'notes-conflict-compact']);
	});

	it('fails specimen-validate with CAPTURE_STEP_UNKNOWN when a marked step description is renamed', async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), 'loam-notes-rename-'));
		try {
			const originalScenario = await readFile(
				join(NOTES_SPECIMENS, 'scenarios/notes-conflict.scenario.yaml'),
				'utf8'
			);
			const renamedScenario = originalScenario.replace(
				'The note opens beside itself',
				'The note splits into two panes'
			);
			expect(renamedScenario).not.toBe(originalScenario);
			await writeFile(join(tempRoot, 'notes-conflict.scenario.yaml'), renamedScenario, 'utf8');
			await writeFile(
				join(tempRoot, 'notes.specimens.ts'),
				'export const NotesConflict = {};\n',
				'utf8'
			);
			const jobSourceUrl = pathToFileURL(join(NOTES_SPECIMENS, 'afd.job-source.mjs')).href;
			await writeFile(
				join(tempRoot, 'afd.job-source.mjs'),
				`export { default } from ${JSON.stringify(jobSourceUrl)};\n`,
				'utf8'
			);
			await writeFile(
				join(tempRoot, 'specimen.config.json'),
				JSON.stringify(
					{
						jobSources: ['./afd.job-source.mjs'],
						specimens: [
							{
								id: 'notes-conflict',
								title: 'Loam/Notes/Keep a draft',
								module: './notes.specimens.ts',
								exportName: 'NotesConflict',
								job: {
									scenario: './notes-conflict.scenario.yaml',
									target: 'shell',
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
			const staleBench = await createSpecimenBench({ root: tempRoot });
			try {
				const report = await staleBench.validate({ id: 'notes-conflict' });
				expect(report.valid).toBe(false);
				expect(report.issues.some((issue) => issue.code === 'CAPTURE_STEP_UNKNOWN')).toBe(true);
			} finally {
				await staleBench.close();
			}
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});
});

describe('P2-D10: Specimen captures of the editor area', () => {
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`P2-D10: captures each in ${theme}, in both densities, each with an ARIA snapshot`, async () => {
			for (const [id, expected] of EDITOR_CAPTURES) {
				const observation = await bench.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation);
				for (const each of expected) expect(observation.channels.a11y.snapshot, id).toContain(each);
				if (id.startsWith('editor-embed-depth')) {
					expect(observation.channels.a11y.snapshot, id).not.toContain('Should not render.');
				}
			}
		}, 300_000);
});

/**
 * The documents specification's D10 so far (step 11): the documents section's sidebar, with its row menu, its
 * list, trash and empty state, and the New menu, comfortable and compact. A hostile title is text (D8).
 */
const DOCUMENTS_CAPTURES: [string, string[]][] = [
	[
		'documents-tree',
		[
			'tree "Documents"',
			'treeitem "Recent" [expanded] [level=1]',
			'treeitem "Roadmap, Jot" [level=2]',
			'treeitem "Jots" [expanded] [level=1]',
			'treeitem "Roadmap" [level=2] [selected]',
			'treeitem "Trash" [expanded] [level=1]',
			'treeitem "Old plan, Trashed',
		],
	],
	[
		'documents-tree-menu',
		['menu "Actions for Roadmap"', 'menuitem "Open beside"', 'menuitem "Trash"'],
	],
	// #873: the sidebar's Rename and Links modal dialogs, each captured with a real ARIA snapshot.
	[
		'documents-tree-rename',
		['dialog "Rename Roadmap"', 'textbox "Title"', 'button "Save"', 'button "Cancel"'],
	],
	[
		'documents-tree-links',
		[
			'dialog "Links of Roadmap"',
			'table "Links of Roadmap"',
			'Ideas for the quarter',
			'Old plan',
			'In trash',
			'button "Close"',
		],
	],
	// #868: the documents inspector mounted in the shell's `loam-inspector` part via `syncInspector`.
	[
		'documents-inspector',
		[
			'complementary "Jot details"',
			'region "Links"',
			'Outgoing from Roadmap: Ideas for the quarter',
			'region "Backlinks"',
			'Old plan (In trash)',
		],
	],
	[
		'documents-section',
		['heading "Documents" [level=1]', 'table "Documents"', 'link "<img src=x onerror=alert(1)>"'],
	],
	['documents-section-trash', ['heading "Trash" [level=1]', 'button "Restore Old plan"']],
	['documents-section-loading', ['heading "Documents" [level=1]', 'Loading…']],
	['documents-section-empty', ['No documents yet', 'button "New Blank jot"', 'button "New Chore"']],
	['new-menu', ['menu "New"', 'group "Jots"', 'menuitem "Blank jot"', 'group "Chores"']],
].flatMap(([id, expected]) => [
	[id, expected] as [string, string[]],
	[`${id}-compact`, expected] as [string, string[]],
]);

describe('P2-D10: Specimen captures of the documents section and New', () => {
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`P2-D10: captures each in ${theme}, in both densities, each with an ARIA snapshot`, async () => {
			for (const [id, expected] of DOCUMENTS_CAPTURES) {
				const observation = await bench.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation);
				for (const each of expected) expect(observation.channels.a11y.snapshot, id).toContain(each);
				if (id === 'documents-section' || id === 'documents-section-compact') {
					expect(observation.channels.dom.normalized, id).toContain(
						'href="https://loam.example/personal/~/documents/doc_roadmap"'
					);
				}
				if (id.startsWith('documents-tree-rename') || id.startsWith('documents-tree-links')) {
					expect(observation.channels.a11y.snapshot, id).not.toContain('tree "Documents"');
					const a11y = await bench.a11y({ id, context: { ...CONTEXT, theme } });
					expect(a11y.counts.total, `${id} axe total`).toBe(1);
					expect(a11y.counts.notRun, `${id} axe notRun`).toBe(0);
					expect(a11y.reports[0]?.violations, `${id} axe violations`).toEqual([]);
				}
				// A hostile title is text, never markup (D8).
				expect(observation.channels.dom.normalized, id).not.toContain('<img src="x"');
			}
		}, 300_000);
});

describe('P2-E13: E4: Specimen captures of each part and the whole shell', () => {
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`captures every fixture in ${theme}, each with an ARIA snapshot`, async () => {
			for (const [id, expected] of CAPTURES) {
				const observation = await bench.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation);
				expect(observation.manifest.context.theme).toBe(theme);
				const channel = MODAL.has(id)
					? observation.channels.dom.normalized
					: observation.channels.a11y.snapshot;
				expect(channel, id).toContain(expected);
			}
		}, 300_000);

	it('captures the compact class at 390 × 844', async () => {
		const observation = await bench.render({
			id: 'shell',
			context: { ...CONTEXT, viewport: { width: 390, height: 844 } },
		});
		expectClean(observation);
		expect(observation.channels.a11y.snapshot).not.toContain('contentinfo');
		expect(observation.channels.a11y.snapshot).toContain('navigation "Apps"');
	}, 60_000);
});

/** Phase 3's section 14 (P3-E11): the account section's tabs, the sign-in dialog, the account menu, and the join, recovery, login and consent pages. */
const IDENTITY_CAPTURES: [string, string[]][] = [
	// The account section's every tab, over a kernel that answers as an owner's would (5.1 to 5.4, 7.2, 8.2).
	[
		'identity-account-profile',
		['tab "Profile" [selected]', 'button "Save name"', 'table "Your organizations"'],
	],
	[
		'identity-account-passkeys',
		['table "Your passkeys"', 'button "Remove Laptop"', 'button "Add a passkey"'],
	],
	[
		'identity-account-sessions',
		['table "Where you are signed in"', 'button "Sign out Safari on iOS"'],
	],
	[
		'identity-account-members',
		['tab "Members" [selected]', 'Cy Park', 'Reviewer', 'Sponsored by Cy Park'],
	],
	['identity-account-agents', ['tab "Agents" [selected]', 'Claude Code']],
	[
		'identity-sign-in',
		[
			'dialog "Sign in to Acme"',
			'button "Sign in with a passkey"',
			'textbox "Password"',
			'button "Continue with corp"',
			'button "Can\'t sign in?"',
		],
	],
	[
		'identity-account-menu',
		['menu "Account"', 'menuitemradio "Default" [checked]', 'menuitem "Sign out"'],
	],
	['identity-join', ['heading "Join Acme"', 'button "Create a passkey"']],
	['identity-recover', ['heading "Restore your access"', 'button "Create a passkey"']],
	['identity-oauth-login', ['button "Sign in with a passkey"', 'button "Sign in with corp"']],
	[
		'identity-oauth-consent',
		[
			'heading "Connect Claude Code to Acme?"',
			'tools.example.org',
			'name given by the app',
			'button "Connect"',
			'button "Deny"',
		],
	],
];

describe("P3-E11: Specimen captures of phase 3's elements and pages", () => {
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`P3-E11: captures the account section's every tab, the sign-in dialog, the account menu, and the join, recovery, login and consent pages in ${theme}`, async () => {
			for (const [id, expected] of IDENTITY_CAPTURES) {
				const observation = await bench.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation);
				for (const each of expected) expect(observation.channels.a11y.snapshot, id).toContain(each);
			}
		}, 300_000);
});

/**
 * Phase 4's section 15 (P4-E13): the settings section (its tree, its level tab list, a custom editor's form), the
 * keybinding editor's shadowing warning, the autonomy section's advisory notice, the inbox with a notice and a
 * confirmation waiting, a popover menu, an app's dialog with actions, the shell's prompt and a confirmation. The modal
 * two are read through their DOM, as `MODAL` says.
 */
const SETTINGS_CAPTURES: [string, string[]][] = [
	[
		'settings-section',
		[
			'tree "Settings sections"',
			'treeitem "Keybindings"',
			'tablist "Where Keybindings applies"',
			'tab "You, everywhere" [selected]',
			'form "Add an override"',
		],
	],
	[
		'settings-keybinding-shadowed',
		['status', "Recorded Mod+B. Mod+B is the shell's own; this binding would shadow it."],
	],
	[
		'settings-autonomy',
		[
			'treeitem "Autonomy" [level=2] [selected]',
			'note: "Loam holds every agent, the copilot included, to these rules: Act runs, Ask asks you first, Suggest only offers it to you."',
		],
	],
	[
		'settings-inbox',
		[
			'heading "Inbox"',
			'Requested by Claude Code for you',
			'button "Confirm Clear the guest book"',
			'button "Decline Clear the guest book"',
			'Ada is waiting at the guest book',
		],
	],
	[
		'settings-popover-menu',
		['menu "Greet, From Hello"', 'menuitem "Greet Ada"', 'menuitem "Greet Bo"'],
	],
	['settings-dialog', ['dialog "A card"', 'From Hello', 'button "Later"', 'button "Keep"']],
	['settings-prompt', ['aria-modal="true"', 'How many?', 'Count']],
	[
		'settings-confirmation',
		['aria-modal="true"', 'Run Clear the guest book?', 'No input', 'Decline'],
	],
];

describe("P4-E13: Specimen captures of phase 4's parts", () => {
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`P4-E13: captures the settings section, the keybinding editor's warning, the autonomy notice, the inbox, a popover menu, a dialog, a prompt and a confirmation in ${theme}`, async () => {
			for (const [id, expected] of SETTINGS_CAPTURES) {
				const observation = await bench.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation);
				expect(observation.manifest.context.theme).toBe(theme);
				// The theme the page applied, not only the context the manifest echoes.
				expect(observation.channels.dom.normalized, id).toContain(`data-theme-shown="${theme}"`);
				const channel = MODAL.has(id)
					? observation.channels.dom.normalized
					: observation.channels.a11y.snapshot;
				for (const each of expected) expect(channel, id).toContain(each);
			}
		}, 300_000);
});
