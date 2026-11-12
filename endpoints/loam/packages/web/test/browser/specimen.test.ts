/**
 * E2 and E4's captures (phase 0 specification, section 11), through Specimen's bench over the
 * chrome's fixtures in `@lushly-dev/loam-chrome`'s `specimens/`: the live and replayed 50-call
 * sessions are equal under `diffObservations`, and every part and the whole shell is captured,
 * with an ARIA snapshot, in light, dark and high contrast (D53).
 */
import { fileURLToPath } from 'node:url';
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
]);

function expectClean(observation: Observation, id = observation.manifest.specimenId) {
	expect(observation.channels.console.errors, id).toEqual([]);
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
	['app-projects-section-form', 'Error: A project already has'],
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
	// Step 12: `loam-embed`, refused or missing alike, and a target with no embed of its own as a link.
	['editor-embed-unavailable', ['group "Embedded: Document"', 'Not available']],
	['editor-embed-link', ['group "Embedded: Roadmap"', 'link "Roadmap"']],
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
	[
		'notes-editor-conflict',
		['alert', 'This note changed elsewhere', 'button "Keep mine"', 'button "Use theirs"'],
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

describe("P2-D10: Specimen captures of notes' editor, inspector and embed", () => {
	let notes: SpecimenBench;
	beforeAll(async () => {
		notes = await createSpecimenBench({ root: NOTES_SPECIMENS });
	});
	afterAll(async () => {
		await notes?.close();
	});
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`P2-D10: captures the editor with a draft and with its conflict notice, the inspector and the embed in ${theme}, in both densities`, async () => {
			for (const [id, expected] of NOTES_CAPTURES) {
				const observation = await notes.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation);
				for (const each of expected) expect(observation.channels.a11y.snapshot, id).toContain(each);
			}
		}, 300_000);
});

describe('P2-D10: Specimen captures of the editor area', () => {
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`P2-D10: captures each in ${theme}, in both densities, each with an ARIA snapshot`, async () => {
			for (const [id, expected] of EDITOR_CAPTURES) {
				const observation = await bench.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation);
				for (const each of expected) expect(observation.channels.a11y.snapshot, id).toContain(each);
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
