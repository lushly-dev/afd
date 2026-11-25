import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import type { SpecimenHostError } from './host.js';
import { writeNoteFile } from './note.js';
import { writePointFile } from './point.js';
import {
	noteCheckResultSchema,
	noteListResultSchema,
	noteResolveResultSchema,
	noteResultSchema,
} from './schema.js';
import type { Note, Point } from './types.js';

const EXAMPLE_BUTTON_SOURCE = `if (!customElements.get('example-button')) {
	class ExampleButton extends HTMLElement {
		constructor() {
			super();
			this.attachShadow({ mode: 'open' });
		}
		connectedCallback() {
			const label = this.getAttribute('label') || '';
			this.shadowRoot.innerHTML =
				'<button type="button">' +
				'<svg aria-hidden="true" width="16" height="16"><path d="M2 2h12v12H2z"></path></svg>' +
				'<span>' + label + '</span>' +
				'</button>';
		}
	}
	customElements.define('example-button', ExampleButton);
}
`;

function toolbarSource(
	shareLabel: string,
	includeArchive = false,
	duplicateExport = false
): string {
	return `import '../example-button.js';

if (!customElements.get('example-toolbar')) {
	class ExampleToolbar extends HTMLElement {
		constructor() {
			super();
			const shadow = this.attachShadow({ mode: 'open' });
			shadow.innerHTML =
				'<input type="search" aria-label="Search" placeholder="Search" />' +
				'<example-button label="${shareLabel}"></example-button>' +
				'<example-button label="Export"></example-button>' +
				${duplicateExport ? `'<example-button label="Export"></example-button>' +` : `'' +`}
				${includeArchive ? `'<example-button label="Archive"></example-button>' +` : `'' +`}
				'<button type="button" class="overflow-trigger" aria-label="More actions">More</button>' +
				'<div role="menu" hidden><button type="button" role="menuitem">Archive</button></div>';
			const trigger = shadow.querySelector('.overflow-trigger');
			const menu = shadow.querySelector('[role="menu"]');
			trigger?.addEventListener('click', () => {
				menu?.removeAttribute('hidden');
			});
		}
		connectedCallback() {
			this.setAttribute('role', 'toolbar');
		}
	}
	customElements.define('example-toolbar', ExampleToolbar);
}
`;
}

const TOOLBAR_SPECIMENS_SOURCE = `import './toolbar.js';

export const Toolbar = {
	render() {
		return document.createElement('example-toolbar');
	},
	targets: {
		more: { role: 'button', name: 'More actions' },
	},
	scenario: [
		{ action: { click: 'more' } },
		{ capture: 'menu-open' },
	],
};
`;

const BROKEN_SPECIMENS_SOURCE = `export const Broken = {
	render() {
		throw new Error('Intentional render failure');
	},
};
`;

const CUSTOM_ELEMENTS_MANIFEST = {
	schemaVersion: '1.0.0',
	modules: [
		{
			path: 'src/example-button.js',
			declarations: [{ tagName: 'example-button', customElement: true }],
		},
		{
			path: 'src/toolbar/toolbar.js',
			declarations: [{ tagName: 'example-toolbar', customElement: true }],
		},
	],
};

async function expectSpecimenError(promise: Promise<unknown>): Promise<SpecimenHostError> {
	const error = await promise.then(
		() => {
			throw new Error('Expected operation to fail');
		},
		(value: unknown) => value
	);
	expect(error).toBeInstanceOf(Error);
	return error as SpecimenHostError;
}

describe.each(['in-process', 'process'] as const)(
	'Pointing Slice 2 notes lifecycle through SpecimenBench (%s)',
	(runtimeIsolation) => {
		let root: string;
		let bench: SpecimenBench;

		beforeAll(async () => {
			root = await realpath(await mkdtemp(join(tmpdir(), `specimen-note-${runtimeIsolation}-`)));
			await mkdir(join(root, 'src', 'toolbar'), { recursive: true });
			await writeFile(join(root, 'src', 'example-button.js'), EXAMPLE_BUTTON_SOURCE);
			await writeFile(join(root, 'src', 'toolbar', 'toolbar.js'), toolbarSource('Share'));
			await writeFile(
				join(root, 'src', 'toolbar', 'toolbar.specimens.js'),
				TOOLBAR_SPECIMENS_SOURCE
			);
			await writeFile(join(root, 'src', 'broken.specimens.js'), BROKEN_SPECIMENS_SOURCE);
			await writeFile(
				join(root, 'custom-elements.json'),
				JSON.stringify(CUSTOM_ELEMENTS_MANIFEST, null, 2)
			);
			await writeFile(
				join(root, 'specimen.config.json'),
				JSON.stringify(
					{
						manifest: './custom-elements.json',
						specimens: [
							{
								id: 'example-toolbar',
								title: 'Toolbar',
								module: './src/toolbar/toolbar.specimens.js',
								exportName: 'Toolbar',
								component: 'example-toolbar',
							},
							{
								id: 'example-broken',
								title: 'Broken',
								module: './src/broken.specimens.js',
								exportName: 'Broken',
							},
						],
					},
					null,
					2
				)
			);
			bench = await createSpecimenBench({ root, runtimeIsolation });
		}, 120_000);

		afterAll(async () => {
			await bench?.close();
			if (root) await rm(root, { recursive: true, force: true, maxRetries: 10 });
		});

		async function clearNotes(): Promise<void> {
			await rm(join(root, 'specimens', 'notes'), { recursive: true, force: true });
		}

		it('Scenario 07: pins notes from pointer or fresh point, lists open notes, refuses NOTE_EMPTY and POINT_STALE', async () => {
			await clearNotes();

			// Step 1: Add note straight from pointer URI with custom pin + assignee
			const added = await bench.noteAdd({
				pointer:
					'specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:2&text=Export&pin=0.4,0.6',
				text: 'Export should offer CSV and PDF, not only CSV',
				assignee: 'agent',
			});
			expect(noteResultSchema.safeParse(added).success).toBe(true);
			expect(added.note.id).toMatch(/^note-[0-9a-z]{12}$/);
			expect(added.note.state).toBe('open');
			expect(added.note.orphaned).toBe(false);
			expect(added.note.assignee).toBe('agent');
			expect(added.note.subject.specimen).toBe('example-toolbar');
			expect(added.note.subject.accessible.role).toBe('button');
			expect(added.note.subject.accessible.name).toBe('Export');
			expect(added.note.pin).toEqual({ x: 0.4, y: 0.6 });

			// Committed file exists under specimens/notes/<id>.json
			const onDisk = JSON.parse(
				await readFile(join(root, 'specimens', 'notes', `${added.note.id}.json`), 'utf8')
			);
			expect(onDisk).toEqual(added.note);

			// Step 2: List open notes for assignee
			const listed = await bench.noteList({ assignee: 'agent', limit: 20 });
			expect(noteListResultSchema.safeParse(listed).success).toBe(true);
			expect(listed.notes).toHaveLength(1);
			expect(listed.notes[0]?.id).toBe(added.note.id);
			expect(listed.notes[0]?.text).toContain('CSV and PDF');
			expect('next' in listed).toBe(false);

			// Step 3: Refuse empty note text with NOTE_EMPTY
			const emptyErr = await expectSpecimenError(
				bench.noteAdd({
					pointer:
						'specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:2&text=Export',
					text: '',
				})
			);
			expect(emptyErr.code).toBe('NOTE_EMPTY');
			expect(emptyErr.suggestion).toContain('what');

			// Step 4: Refuse stale point with POINT_STALE
			const stalePoint: Point = {
				id: 'pt-2k7m9p4x8c1v',
				specimen: 'example-toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				element: {
					ref: 'root/example-toolbar:1/shadow/example-button:1',
					tag: 'example-button',
					text: 'Share',
					box: { x: 420, y: 12, width: 84, height: 32 },
				},
				accessible: {
					role: 'button',
					name: 'Share',
					from: 'root/example-toolbar:1/shadow/example-button:1/shadow/button:1',
				},
				identity: {
					strongest: 'role-name',
					roleName: { role: 'button', name: 'Share' },
					componentPosition: { tag: 'example-button', index: 1 },
					ref: 'root/example-toolbar:1/shadow/example-button:1',
				},
				component: { tag: 'example-button', module: 'src/example-button.js' },
				source: {
					specimen: { module: 'src/toolbar/toolbar.specimens.js', exportName: 'Toolbar' },
					component: { module: 'src/example-button.js' },
					digests: { 'src/example-button.js': '0000000000000000' },
				},
				ancestors: [],
				neighbourhood: {
					pageData: true,
					siblings: [],
					children: [],
					omitted: { siblings: 0, children: 0 },
				},
				pin: { x: 0.5, y: 0.5 },
				check: { command: 'specimen-point-check', when: 'before editing source for this point' },
			};
			await writePointFile(root, stalePoint);
			const staleErr = await expectSpecimenError(
				bench.noteAdd({
					point: 'pt-2k7m9p4x8c1v',
					text: 'The share icon is too small at this size',
				})
			);
			expect(staleErr.code).toBe('POINT_STALE');
			expect(staleErr.suggestion).toContain('specimen-point');

			// Also verify adding from a fresh point id succeeds and keeps its pin
			const freshPoint = await bench.point({
				pointer:
					'specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:1&pin=0.25,0.75',
			});
			const fromFreshPoint = await bench.noteAdd({
				point: freshPoint.point.id,
				text: 'Share icon needs clearer contrast',
			});
			expect(fromFreshPoint.note.subject.accessible.name).toBe('Share');
			expect(fromFreshPoint.note.pin).toEqual({ x: 0.25, y: 0.75 });
		});

		it('Scenario 08: detects orphans, weakened identities, unchecked specimens, restores recovered notes, and settles via move + bulk resolve', async () => {
			await clearNotes();
			// Update toolbar to match Scenario 08 fixture: "Share link" (renamed), "Export", and Archive in menu-open
			await writeFile(join(root, 'src', 'toolbar', 'toolbar.js'), toolbarSource('Share link'));
			try {
				const notes: Note[] = [
					{
						id: 'note-7k2m9q4x1r8t',
						state: 'open',
						orphaned: false,
						text: 'Archive button needs confirmation before moving items',
						subject: {
							specimen: 'example-toolbar',
							context: { theme: 'dark', viewport: '1280x800' },
							accessible: { role: 'button', name: 'Archive' },
							identity: {
								strongest: 'role-name',
								roleName: { role: 'button', name: 'Archive' },
								componentPosition: { tag: 'example-button', index: 3 },
								ref: 'root/example-toolbar:1/shadow/example-button:3',
							},
						},
						pin: { x: 0.5, y: 0.5 },
						history: [],
					},
					{
						id: 'note-3hd8w2c5n0vp',
						state: 'open',
						orphaned: false,
						text: 'Tighten horizontal padding on Share',
						subject: {
							specimen: 'example-toolbar',
							context: { theme: 'dark', viewport: '1280x800' },
							accessible: { role: 'button', name: 'Share' },
							identity: {
								strongest: 'role-name',
								roleName: { role: 'button', name: 'Share' },
								componentPosition: { tag: 'example-button', index: 1 },
								ref: 'root/example-toolbar:1/shadow/example-button:1',
							},
						},
						pin: { x: 0.5, y: 0.5 },
						history: [],
					},
					{
						id: 'note-q4z1m6t9b2xe',
						state: 'open',
						orphaned: false,
						text: 'Filter bar wraps awkwardly at narrow widths',
						subject: {
							specimen: 'example-toolbar',
							context: { theme: 'dark', viewport: '1280x800' },
							accessible: { role: 'group', name: 'Filters' },
							identity: {
								strongest: 'role-name',
								roleName: { role: 'group', name: 'Filters' },
								componentPosition: { tag: 'example-filter-bar', index: 1 },
								ref: 'root/example-toolbar:1/shadow/example-filter-bar:1',
							},
						},
						pin: { x: 0.5, y: 0.5 },
						history: [],
					},
					{
						id: 'note-w8c3r5y0k7aj',
						state: 'open',
						orphaned: false,
						text: 'Clear filters should stay disabled when no filter is active',
						subject: {
							specimen: 'example-toolbar',
							context: { theme: 'dark', viewport: '1280x800' },
							accessible: { role: 'button', name: 'Clear filters' },
							identity: {
								strongest: 'role-name',
								roleName: { role: 'button', name: 'Clear filters' },
								componentPosition: { tag: 'example-filter-bar', index: 1 },
								ref: 'root/example-toolbar:1/shadow/example-filter-bar:1/shadow/button:1',
							},
						},
						pin: { x: 0.5, y: 0.5 },
						history: [],
					},
					{
						id: 'note-f5n2p8v1d6gs',
						state: 'open',
						orphaned: false,
						text: 'Print button icon looks blurry',
						subject: {
							specimen: 'example-legacy',
							context: { theme: 'dark', viewport: '1280x800' },
							accessible: { role: 'button', name: 'Print' },
							identity: {
								strongest: 'role-name',
								roleName: { role: 'button', name: 'Print' },
								componentPosition: { tag: 'example-button', index: 1 },
								ref: 'root/example-legacy:1/shadow/example-button:1',
							},
						},
						pin: { x: 0.5, y: 0.5 },
						history: [],
					},
				];
				for (const note of notes) await writeNoteFile(root, note);

				// Step 1: specimen-note-check
				const checked = await bench.noteCheck({});
				expect(noteCheckResultSchema.safeParse(checked).success).toBe(true);
				expect(checked).toEqual({
					checked: 4,
					orphaned: ['note-7k2m9q4x1r8t', 'note-q4z1m6t9b2xe', 'note-w8c3r5y0k7aj'],
					weakened: ['note-3hd8w2c5n0vp'],
					unchecked: [
						{
							specimen: 'example-legacy',
							reason: 'specimen-missing',
							notes: ['note-f5n2p8v1d6gs'],
						},
					],
					restored: [],
				});

				// Step 2: Orphaned notes remain open and searchable
				const orphanedList = await bench.noteList({ orphaned: true });
				expect(orphanedList.notes).toHaveLength(3);

				// Step 3: Point at the Archive menu item at checkpoint menu-open
				const archivePoint = await bench.point({
					id: 'example-toolbar',
					checkpoint: 'menu-open',
					context: { theme: 'dark', viewport: '1280x800' },
					target: { role: 'menuitem', name: 'Archive' },
				});
				expect(archivePoint.point.accessible.role).toBe('menuitem');

				// Step 4: Move the orphaned note onto the menu item, keeping history
				const moved = await bench.noteMove({
					id: 'note-7k2m9q4x1r8t',
					point: archivePoint.point.id,
					reason: 'Archive moved into the overflow menu',
				});
				expect(noteResultSchema.safeParse(moved).success).toBe(true);
				expect(moved.note.orphaned).toBe(false);
				expect(moved.note.subject.checkpoint).toBe('menu-open');
				expect(moved.note.subject.accessible.role).toBe('menuitem');
				expect(moved.note.history[0]?.change).toBe('moved');
				expect(moved.note.history[0]?.reason).toContain('overflow menu');

				// Step 5: Bulk-resolve the two filter bar notes
				const bulkResolved = await bench.noteResolve({
					ids: ['note-q4z1m6t9b2xe', 'note-w8c3r5y0k7aj'],
					outcome: 'obsolete',
					reason: 'The filter bar was removed; filtering now lives in search',
				});
				expect(noteResolveResultSchema.safeParse(bulkResolved).success).toBe(true);
				expect(bulkResolved.resolved).toHaveLength(2);
				expect(bulkResolved.skipped).toHaveLength(0);

				// Extra: verify render-failed reports unchecked without orphaning, and restored clears orphaned flag
				const brokenNote: Note = {
					id: 'note-b1b2b3b4b5b6',
					state: 'open',
					orphaned: false,
					text: 'Broken specimen note',
					subject: {
						specimen: 'example-broken',
						context: { theme: 'dark', viewport: '1280x800' },
						accessible: { role: 'button', name: 'Go' },
						identity: {
							strongest: 'role-name',
							roleName: { role: 'button', name: 'Go' },
							ref: 'root/button:1',
						},
					},
					pin: { x: 0.5, y: 0.5 },
					history: [],
				};
				await writeNoteFile(root, brokenNote);
				const renderFailCheck = await bench.noteCheck({ specimen: 'example-broken' });
				expect(renderFailCheck).toEqual({
					checked: 0,
					orphaned: [],
					weakened: [],
					unchecked: [
						{
							specimen: 'example-broken',
							reason: 'render-failed',
							notes: ['note-b1b2b3b4b5b6'],
						},
					],
					restored: [],
				});
				expect((await bench.noteList({ specimen: 'example-broken' })).notes[0]?.orphaned).toBe(
					false
				);

				// Previously orphaned Archive note recovers when Archive button returns -> listed in restored
				const recoverableNote: Note = {
					id: 'note-r1r2r3r4r5r6',
					state: 'open',
					orphaned: true,
					text: 'Archive button restored test',
					subject: {
						specimen: 'example-toolbar',
						context: { theme: 'dark', viewport: '1280x800' },
						accessible: { role: 'button', name: 'Archive' },
						identity: {
							strongest: 'role-name',
							roleName: { role: 'button', name: 'Archive' },
							componentPosition: { tag: 'example-button', index: 3 },
							ref: 'root/example-toolbar:1/shadow/example-button:3',
						},
					},
					pin: { x: 0.5, y: 0.5 },
					history: [],
				};
				await writeNoteFile(root, recoverableNote);
				await writeFile(join(root, 'src', 'toolbar', 'toolbar.js'), toolbarSource('Share', true));
				const restoredCheck = await bench.noteCheck({ specimen: 'example-toolbar' });
				expect(restoredCheck.restored).toContain('note-r1r2r3r4r5r6');
				expect(restoredCheck.orphaned).not.toContain('note-r1r2r3r4r5r6');
				const restoredListed = await bench.noteList({
					specimen: 'example-toolbar',
					orphaned: false,
				});
				expect(restoredListed.notes.some((n) => n.id === 'note-r1r2r3r4r5r6')).toBe(true);
			} finally {
				await writeFile(join(root, 'src', 'toolbar', 'toolbar.js'), toolbarSource('Share'));
			}
		});

		it('Scenario 09: resolves with reason and evidence, removes from open list, refuses double-resolve, reopens with history, and refuses reopening open note', async () => {
			await clearNotes();
			await writeNoteFile(root, {
				id: 'note-9v4b7n2k5m1c',
				state: 'open',
				orphaned: false,
				assignee: 'agent',
				text: 'Export should offer CSV and PDF, not only CSV',
				subject: {
					specimen: 'example-toolbar',
					context: { theme: 'dark', viewport: '1280x800' },
					accessible: {
						role: 'button',
						name: 'Export',
						from: 'root/example-toolbar:1/shadow/example-button:2/shadow/button:1',
					},
					identity: {
						strongest: 'role-name',
						roleName: { role: 'button', name: 'Export' },
						componentPosition: { tag: 'example-button', index: 2 },
						ref: 'root/example-toolbar:1/shadow/example-button:2',
					},
				},
				pin: { x: 0.5, y: 0.5 },
				history: [],
			});

			// Step 1: Resolve without reason -> REASON_REQUIRED
			const noReason = await expectSpecimenError(
				bench.noteResolve({ id: 'note-9v4b7n2k5m1c', outcome: 'fixed' })
			);
			expect(noReason.code).toBe('REASON_REQUIRED');
			expect(noReason.suggestion).toContain('reason');

			// Step 2: Resolve with reason and evidence
			const resolved = await bench.noteResolve({
				id: 'note-9v4b7n2k5m1c',
				outcome: 'fixed',
				reason: 'Export now opens a menu with CSV and PDF',
				evidence: { revision: '4f2c9a1' },
			});
			expect(resolved.resolved).toHaveLength(1);
			expect(resolved.resolved[0]?.id).toBe('note-9v4b7n2k5m1c');
			expect(resolved.resolved[0]?.state).toBe('resolved');
			expect(resolved.resolved[0]?.resolution?.outcome).toBe('fixed');
			expect(resolved.resolved[0]?.resolution?.reason).toContain('CSV and PDF');
			expect(resolved.skipped).toHaveLength(0);

			// Step 3: Open list no longer shows it
			expect((await bench.noteList({})).notes).toHaveLength(0);

			// Step 4: Resolved list shows it with resolution reason
			const resolvedList = await bench.noteList({ state: 'resolved' });
			expect(resolvedList.notes).toHaveLength(1);
			expect(resolvedList.notes[0]?.id).toBe('note-9v4b7n2k5m1c');
			expect(resolvedList.notes[0]?.resolution?.reason).toContain('CSV and PDF');

			// Step 5: Resolving again -> NOTE_ALREADY_RESOLVED
			const again = await expectSpecimenError(
				bench.noteResolve({ id: 'note-9v4b7n2k5m1c', outcome: 'fixed', reason: 'Done' })
			);
			expect(again.code).toBe('NOTE_ALREADY_RESOLVED');
			expect(again.suggestion).toContain('specimen-note-reopen');

			// Step 6: Reopen keeps prior resolution in history
			const reopened = await bench.noteReopen({
				id: 'note-9v4b7n2k5m1c',
				reason: 'PDF export fails for long reports',
			});
			expect(reopened.note.state).toBe('open');
			expect(reopened.note.history).toHaveLength(2);
			expect(reopened.note.history[0]?.change).toBe('resolved');
			expect(reopened.note.history[0]?.outcome).toBe('fixed');
			expect(reopened.note.history[0]?.reason).toContain('CSV and PDF');
			expect(reopened.note.history[0]?.evidence?.revision).toBe('4f2c9a1');
			expect(reopened.note.history[1]?.change).toBe('reopened');

			// Step 7: Reopening open note -> NOTE_NOT_RESOLVED
			const reopenAgain = await expectSpecimenError(
				bench.noteReopen({ id: 'note-9v4b7n2k5m1c', reason: 'Again' })
			);
			expect(reopenAgain.code).toBe('NOTE_NOT_RESOLVED');
			expect(reopenAgain.suggestion).toContain('specimen-note-resolve');
		});

		it('observes specimen removal on a warm bench and resolves slotted elements via collectTexts', async () => {
			await clearNotes();

			// Warm bench refreshes specimen.config.json when a specimen is removed on disk
			const configPath = join(root, 'specimen.config.json');
			const originalConfig = await readFile(configPath, 'utf8');
			const parsedConfig = JSON.parse(originalConfig) as {
				manifest: string;
				specimens: Array<{ id: string }>;
			};

			// First add a note against a slotted light-DOM element inside a custom container
			await writeFile(
				join(root, 'src', 'slotted.specimens.js'),
				`if (!customElements.get('example-slot-card')) {
	class ExampleSlotCard extends HTMLElement {
		constructor() {
			super();
			this.attachShadow({ mode: 'open' }).innerHTML = '<section><slot></slot></section>';
		}
	}
	customElements.define('example-slot-card', ExampleSlotCard);
}
export const SlottedCard = {
	render() {
		const card = document.createElement('example-slot-card');
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.textContent = 'Save draft';
		card.append(btn);
		return card;
	},
};
`
			);
			const withSlotted = {
				...parsedConfig,
				specimens: [
					...parsedConfig.specimens,
					{
						id: 'example-slotted',
						title: 'SlottedCard',
						module: './src/slotted.specimens.js',
						exportName: 'SlottedCard',
					},
				],
			};
			await writeFile(configPath, JSON.stringify(withSlotted, null, 2));
			try {
				const slottedPoint = await bench.point({
					id: 'example-slotted',
					context: { theme: 'dark', viewport: '1280x800' },
					target: { role: 'button', name: 'Save draft' },
				});
				const slottedNote = await bench.noteAdd({
					point: slottedPoint.point.id,
					text: 'Keep slotted button aligned',
				});
				const slottedCheck = await bench.noteCheck({ specimen: 'example-slotted' });
				expect(slottedCheck).toEqual({
					checked: 1,
					orphaned: [],
					weakened: [],
					unchecked: [],
					restored: [],
				});

				// Now remove example-slotted from specimen.config.json without restarting the warm bench
				await writeFile(configPath, originalConfig);
				const removedCheck = await bench.noteCheck({ specimen: 'example-slotted' });
				expect(removedCheck).toEqual({
					checked: 0,
					orphaned: [],
					weakened: [],
					unchecked: [
						{
							specimen: 'example-slotted',
							reason: 'specimen-missing',
							notes: [slottedNote.note.id],
						},
					],
					restored: [],
				});
			} finally {
				await writeFile(configPath, originalConfig);
				await rm(join(root, 'src', 'slotted.specimens.js'), { force: true });
			}
		});
	}
);
