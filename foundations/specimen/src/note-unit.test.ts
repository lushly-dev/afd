import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultContext } from './config.js';
import type { SpecimenHostError } from './host.js';
import {
	buildNoteSubjectFromPoint,
	createNoteRecord,
	evaluateNoteResolution,
	generateNoteId,
	listNotes,
	MAX_NOTE_FILE_BYTES,
	NOTE_ID_PATTERN,
	NOTES_DIR,
	readAllNoteFiles,
	readNoteFile,
	reopenNote,
	requireNoteReason,
	requireNoteText,
	resolveNotes,
	writeNoteFile,
} from './note.js';
import { runNoteCheck } from './note-run.js';
import { CROCKFORD_BASE32 } from './point.js';
import {
	noteCheckResultSchema,
	noteListResultSchema,
	noteResolveResultSchema,
	noteSchema,
} from './schema.js';
import type { ElementObservation, Note, Observation, Point } from './types.js';

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
	const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
	dirs.push(dir);
	return dir;
}

async function expectNoteError(promise: Promise<unknown>): Promise<SpecimenHostError> {
	const error = await promise.then(
		() => {
			throw new Error('Expected operation to fail');
		},
		(value: unknown) => value
	);
	expect(error).toBeInstanceOf(Error);
	return error as SpecimenHostError;
}

function el(
	ref: string,
	tag: string,
	options: {
		attributes?: Record<string, string>;
		accessibility?: { role: string; name: string };
	} = {}
): ElementObservation {
	return {
		ref,
		tag,
		attributes: options.attributes ?? {},
		box: { x: 10, y: 20, width: 100, height: 32 },
		scroll: { width: 100, height: 32, clientWidth: 100, clientHeight: 32 },
		styles: { color: 'rgb(0, 0, 0)' },
		state: { focused: false },
		...(options.accessibility ? { accessibility: options.accessibility } : {}),
	};
}

function makeObservation(elements: ElementObservation[]): Observation {
	const channel = { status: 'complete' as const, scope: 'test', reasons: [] };
	return {
		manifest: {
			captureVersion: '0.10',
			normalizationVersion: '0.2',
			specimenId: 'example-toolbar',
			capturedUtc: '2026-11-24T00:00:00.000Z',
			bench: { name: '@lushly-dev/specimen', version: '2.2.0', plugins: [] },
			driver: { name: 'host', emulates: [] },
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				ready: { steps: ['upgrade', 'fonts', 'frame'], outcome: 'ready', deadlineMs: 10_000 },
				baseline: { clock: 'real', random: { source: 'seeded', seed: 1 }, storage: 'empty' },
			},
			source: { revision: 'a1b2c3d', digest: 'agg', dirty: false },
			dependencies: 'lock',
			browser: { name: 'chromium', version: '1', platform: 'linux-x64', build: null },
			context: {
				...defaultContext,
				theme: 'dark',
				viewport: { width: 1280, height: 800 },
				pixelRatio: 1,
				observed: {
					width: 1280,
					height: 800,
					media: false,
					colorScheme: 'dark',
					contrast: 'no-preference',
					reducedMotion: 'no-preference',
					language: 'en-US',
					devicePixelRatio: 1,
				},
				resources: { fonts: [], remote: [] },
			},
		},
		channels: {
			dom: {
				raw: '<example-toolbar></example-toolbar>',
				normalized: '<example-toolbar></example-toolbar>',
			},
			a11y: { snapshot: '- toolbar', axe: 'not-run' },
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
			dom: channel,
			a11y: channel,
			layout: channel,
			styles: channel,
			tokens: { ...channel, status: 'unsupported' },
			events: { ...channel, status: 'not-requested' },
			visual: { ...channel, status: 'not-requested' },
		},
	};
}

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
	return {
		id,
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
		state: 'open',
		orphaned: false,
		history: [],
		...overrides,
	};
}

describe('Pointing Slice 2 unit helpers (note.ts)', () => {
	it('generates Crockford base-32 note ids', () => {
		const id = generateNoteId();
		expect(id).toMatch(NOTE_ID_PATTERN);
		expect(id.slice('note-'.length)).not.toMatch(/[ilou]/);
		const deterministic = generateNoteId(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 31]));
		expect(deterministic).toBe(`note-${CROCKFORD_BASE32.slice(0, 11)}z`);
	});

	it('validates text and reason with NOTE_EMPTY and REASON_REQUIRED', () => {
		expect(requireNoteText('  Fix contrast  ')).toBe('Fix contrast');
		expect(() => requireNoteText('')).toThrowError(/empty/i);
		try {
			requireNoteText('   ');
		} catch (error) {
			const structured = error as SpecimenHostError;
			expect(structured.code).toBe('NOTE_EMPTY');
			expect(structured.suggestion).toContain('what');
		}

		expect(requireNoteReason('  Done  ', 'resolving a note')).toBe('Done');
		for (const bad of [undefined, '', '   ']) {
			try {
				requireNoteReason(bad, 'resolving a note');
				expect.unreachable();
			} catch (error) {
				const structured = error as SpecimenHostError;
				expect(structured.code).toBe('REASON_REQUIRED');
				expect(structured.suggestion).toContain('reason');
			}
		}
	});

	it('builds a NoteSubject from a Point and creates valid open notes', () => {
		const point: Point = {
			id: 'pt-5r8k2w9m4c1x',
			specimen: 'example-toolbar',
			checkpoint: 'menu-open',
			context: { theme: 'dark', viewport: '1280x800' },
			element: {
				ref: 'root/example-toolbar:1/shadow/example-button:2',
				tag: 'example-button',
				text: 'Export',
				box: { x: 0, y: 0, width: 80, height: 32 },
			},
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
			source: {
				specimen: { module: 'src/toolbar.specimens.ts', exportName: 'Toolbar' },
				digests: {},
			},
			ancestors: [],
			neighbourhood: {
				pageData: true,
				siblings: [],
				children: [],
				omitted: { siblings: 0, children: 0 },
			},
			pin: { x: 0.4, y: 0.6 },
			check: { command: 'specimen-point-check', when: 'before editing source for this point' },
		};
		const subject = buildNoteSubjectFromPoint(point);
		expect(subject).toEqual({
			specimen: 'example-toolbar',
			checkpoint: 'menu-open',
			context: { theme: 'dark', viewport: '1280x800' },
			accessible: point.accessible,
			identity: point.identity,
		});
		const note = createNoteRecord({
			text: 'Export should offer CSV and PDF',
			subject,
			pin: point.pin,
			assignee: 'agent',
		});
		expect(noteSchema.safeParse(note).success).toBe(true);
		expect(note.state).toBe('open');
		expect(note.orphaned).toBe(false);
		expect(note.pin).toEqual({ x: 0.4, y: 0.6 });
		expect(note.assignee).toBe('agent');
	});

	it('classifies note resolution as intact, weakened, or orphaned across all identity layers', () => {
		const toolbarObs = makeObservation([
			el('root', 'div'),
			el('root/example-toolbar:1', 'example-toolbar', {
				accessibility: { role: 'toolbar', name: '' },
			}),
			el('root/example-toolbar:1/shadow/example-button:1', 'example-button'),
			el('root/example-toolbar:1/shadow/example-button:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Share link' },
			}),
			el('root/example-toolbar:1/shadow/example-button:2', 'example-button'),
			el('root/example-toolbar:1/shadow/example-button:2/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Export' },
			}),
		]);

		// Unique role-name match -> intact
		const intactNote = makeNote('note-111111111111');
		expect(evaluateNoteResolution(intactNote, toolbarObs)).toBe('intact');

		// Renamed "Share" -> "Share link": role-name gone, component-position matches -> weakened
		const weakenedNote = makeNote('note-3hd8w2c5n0vp', {
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
		});
		expect(evaluateNoteResolution(weakenedNote, toolbarObs)).toBe('weakened');

		// Removed 3rd button -> orphaned
		const missingNote = makeNote('note-7k2m9q4x1r8t', {
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
		});
		expect(evaluateNoteResolution(missingNote, toolbarObs)).toBe('orphaned');

		// Ambiguous role-name (two Export buttons) -> orphaned, never guessed
		const duplicateObs = makeObservation([
			el('root', 'div'),
			el('root/example-toolbar:1', 'example-toolbar'),
			el('root/example-toolbar:1/shadow/example-button:1', 'example-button'),
			el('root/example-toolbar:1/shadow/example-button:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Export' },
			}),
			el('root/example-toolbar:1/shadow/example-button:2', 'example-button'),
			el('root/example-toolbar:1/shadow/example-button:2/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Export' },
			}),
		]);
		expect(evaluateNoteResolution(intactNote, duplicateObs)).toBe('orphaned');

		// Strongest = component-position intact vs weakened-to-ref vs orphaned
		const compPosNote = makeNote('note-222222222222', {
			subject: {
				specimen: 'example-toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				accessible: {},
				identity: {
					strongest: 'component-position',
					componentPosition: { tag: 'example-button', index: 2 },
					ref: 'root/example-toolbar:1/shadow/example-button:2',
				},
			},
		});
		expect(evaluateNoteResolution(compPosNote, toolbarObs)).toBe('intact');

		// Strongest = ref intact vs orphaned
		const refOnlyNote = makeNote('note-333333333333', {
			subject: {
				specimen: 'example-toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				accessible: {},
				identity: {
					strongest: 'ref',
					ref: 'root/example-toolbar:1/shadow/example-button:2/shadow/button:1',
				},
			},
		});
		expect(evaluateNoteResolution(refOnlyNote, toolbarObs)).toBe('intact');
		const refMissing = makeNote('note-444444444444', {
			subject: {
				specimen: 'example-toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				accessible: {},
				identity: {
					strongest: 'ref',
					ref: 'root/example-toolbar:1/shadow/example-button:9',
				},
			},
		});
		expect(evaluateNoteResolution(refMissing, toolbarObs)).toBe('orphaned');
	});

	it('reads and writes committed notes under specimens/notes/ and refuses symlink escapes and invalid ids', async () => {
		const root = await tempDir('specimen-note-io-');
		const note = makeNote('note-9v4b7n2k5m1c');
		const writtenPath = await writeNoteFile(root, note);
		expect(writtenPath).toBe(join(root, NOTES_DIR, 'note-9v4b7n2k5m1c.json'));
		expect(JSON.parse(await readFile(writtenPath, 'utf8'))).toEqual(note);
		expect(await readNoteFile(root, note.id)).toEqual(note);
		expect(await readAllNoteFiles(root)).toEqual([note]);

		const badId = await expectNoteError(readNoteFile(root, '../escape'));
		expect(badId.code).toBe('NOTE_NOT_FOUND');
		expect(badId.suggestion).toContain('specimen-note-list');

		const missing = await expectNoteError(readNoteFile(root, 'note-000000000000'));
		expect(missing.code).toBe('NOTE_NOT_FOUND');

		// Corrupt note JSON raises an explicit error rather than silently disappearing
		await writeFile(join(root, NOTES_DIR, 'note-aaaaaaaaaaaa.json'), '{not-json');
		await expect(readNoteFile(root, 'note-aaaaaaaaaaaa')).rejects.toThrow(/invalid JSON/i);
		await rm(join(root, NOTES_DIR, 'note-aaaaaaaaaaaa.json'));

		// Symlink escaping root is refused
		const outside = await tempDir('specimen-note-outside-');
		const linkRoot = await tempDir('specimen-note-symlink-');
		await mkdir(join(linkRoot, 'specimens'), { recursive: true });
		try {
			await symlink(outside, join(linkRoot, 'specimens', 'notes'), 'junction');
			await expect(writeNoteFile(linkRoot, note)).rejects.toThrow(/real directory|escapes/i);
			await expect(readAllNoteFiles(linkRoot)).rejects.toThrow(/real directory|escapes/i);
		} catch (error) {
			// Skip symlink assertion only if OS blocks symlink creation without privileges
			if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
		}
	});

	it('lists notes with default open filter, multi-axis filters, and cursor paging without next on the last page', async () => {
		const root = await tempDir('specimen-note-list-');
		expect(await listNotes(root)).toEqual({ notes: [] });

		const n1 = makeNote('note-100000000001', { assignee: 'agent', orphaned: false });
		const n2 = makeNote('note-100000000002', { assignee: 'agent', orphaned: true });
		const n3 = makeNote('note-100000000003', {
			assignee: 'alex',
			orphaned: true,
			subject: { ...makeNote('note-100000000003').subject, specimen: 'example-inbox' },
		});
		const n4 = makeNote('note-100000000004', {
			state: 'resolved',
			resolution: { outcome: 'fixed', reason: 'Done' },
			history: [{ change: 'resolved', outcome: 'fixed', reason: 'Done' }],
		});
		for (const note of [n3, n1, n4, n2]) await writeNoteFile(root, note);

		const defaultOpen = await listNotes(root);
		expect(noteListResultSchema.safeParse(defaultOpen).success).toBe(true);
		expect(defaultOpen.notes.map((n) => n.id)).toEqual([
			'note-100000000001',
			'note-100000000002',
			'note-100000000003',
		]);
		expect('next' in defaultOpen).toBe(false);

		const page1 = await listNotes(root, { limit: 2 });
		expect(page1.notes.map((n) => n.id)).toEqual(['note-100000000001', 'note-100000000002']);
		expect(page1.next).toBe('note-100000000002');

		const page2 = await listNotes(root, { limit: 2, after: page1.next });
		expect(page2.notes.map((n) => n.id)).toEqual(['note-100000000003']);
		expect('next' in page2).toBe(false);

		expect((await listNotes(root, { assignee: 'agent' })).notes.map((n) => n.id)).toEqual([
			'note-100000000001',
			'note-100000000002',
		]);
		expect((await listNotes(root, { orphaned: true })).notes.map((n) => n.id)).toEqual([
			'note-100000000002',
			'note-100000000003',
		]);
		expect((await listNotes(root, { specimen: 'example-inbox' })).notes.map((n) => n.id)).toEqual([
			'note-100000000003',
		]);
		expect((await listNotes(root, { state: 'resolved' })).notes.map((n) => n.id)).toEqual([
			'note-100000000004',
		]);
		expect((await listNotes(root, { state: 'all' })).notes).toHaveLength(4);
	});

	it('resolves single and bulk notes, reopens with preserved history, and enforces error codes', async () => {
		const root = await tempDir('specimen-note-lifecycle-');
		const n1 = makeNote('note-9v4b7n2k5m1c', { assignee: 'agent' });
		const n2 = makeNote('note-q4z1m6t9b2xe', { orphaned: true });
		const n3 = makeNote('note-w8c3r5y0k7aj', { orphaned: true });
		for (const note of [n1, n2, n3]) await writeNoteFile(root, note);

		// Missing reason -> REASON_REQUIRED
		const noReason = await expectNoteError(resolveNotes(root, { id: n1.id, outcome: 'fixed' }));
		expect(noReason.code).toBe('REASON_REQUIRED');
		expect(noReason.suggestion).toContain('reason');

		// Single resolve with evidence
		const resolved = await resolveNotes(root, {
			id: n1.id,
			outcome: 'fixed',
			reason: 'Export now opens a menu with CSV and PDF',
			evidence: { revision: '4f2c9a1' },
		});
		expect(noteResolveResultSchema.safeParse(resolved).success).toBe(true);
		expect(resolved.resolved).toHaveLength(1);
		expect(resolved.skipped).toEqual([]);
		expect(resolved.resolved[0]?.state).toBe('resolved');
		expect(resolved.resolved[0]?.resolution).toEqual({
			outcome: 'fixed',
			reason: 'Export now opens a menu with CSV and PDF',
			evidence: { revision: '4f2c9a1' },
		});

		// Re-resolving single id -> NOTE_ALREADY_RESOLVED
		const already = await expectNoteError(
			resolveNotes(root, { id: n1.id, outcome: 'fixed', reason: 'Done' })
		);
		expect(already.code).toBe('NOTE_ALREADY_RESOLVED');
		expect(already.suggestion).toContain('specimen-note-reopen');

		// Single missing id -> NOTE_NOT_FOUND
		const missing = await expectNoteError(
			resolveNotes(root, { id: 'note-000000000000', outcome: 'withdrawn', reason: 'Never mind' })
		);
		expect(missing.code).toBe('NOTE_NOT_FOUND');
		expect(missing.suggestion).toContain('specimen-note-list');

		// Bulk resolve: resolves open notes and records already-resolved + missing in skipped
		const bulk = await resolveNotes(root, {
			ids: [n2.id, n1.id, 'note-000000000000', n3.id, n2.id],
			outcome: 'obsolete',
			reason: 'The filter bar was removed',
		});
		expect(noteResolveResultSchema.safeParse(bulk).success).toBe(true);
		expect(bulk.resolved.map((n) => n.id)).toEqual([n2.id, n3.id]);
		expect(bulk.skipped).toEqual([
			{ id: n1.id, code: 'NOTE_ALREADY_RESOLVED', reason: expect.stringContaining(n1.id) },
			{
				id: 'note-000000000000',
				code: 'NOTE_NOT_FOUND',
				reason: expect.stringContaining('note-000000000000'),
			},
			{ id: n2.id, code: 'NOTE_ALREADY_RESOLVED', reason: expect.stringContaining(n2.id) },
		]);

		// Reopen requires reason
		const reopenNoReason = await expectNoteError(reopenNote(root, { id: n1.id }));
		expect(reopenNoReason.code).toBe('REASON_REQUIRED');

		// Reopen preserves prior resolution in history[0] and appends reopened at history[1]
		const reopened = await reopenNote(root, {
			id: n1.id,
			reason: 'PDF export fails for long reports',
		});
		expect(reopened.note.state).toBe('open');
		expect(reopened.note.resolution).toBeUndefined();
		expect(reopened.note.history).toHaveLength(2);
		expect(reopened.note.history[0]).toMatchObject({
			change: 'resolved',
			outcome: 'fixed',
			reason: 'Export now opens a menu with CSV and PDF',
			evidence: { revision: '4f2c9a1' },
		});
		expect(reopened.note.history[1]).toMatchObject({
			change: 'reopened',
			reason: 'PDF export fails for long reports',
		});

		// Reopening an open note -> NOTE_NOT_RESOLVED
		const notResolved = await expectNoteError(reopenNote(root, { id: n1.id, reason: 'Again' }));
		expect(notResolved.code).toBe('NOTE_NOT_RESOLVED');
		expect(notResolved.suggestion).toContain('specimen-note-resolve');

		// Hand-crafted resolved note with empty history still preserves resolution when reopened
		const handcrafted = makeNote('note-555555555555', {
			state: 'resolved',
			resolution: { outcome: 'declined', reason: 'By design' },
			history: [],
		});
		await writeNoteFile(root, handcrafted);
		const reopenedHandcrafted = await reopenNote(root, {
			id: handcrafted.id,
			reason: 'Reconsidering',
		});
		expect(reopenedHandcrafted.note.history).toHaveLength(2);
		expect(reopenedHandcrafted.note.history[0]).toMatchObject({
			change: 'resolved',
			outcome: 'declined',
			reason: 'By design',
		});
		expect(reopenedHandcrafted.note.history[1]).toMatchObject({
			change: 'reopened',
			reason: 'Reconsidering',
		});

		// Sanity-check NoteCheckResult schema shape
		expect(
			noteCheckResultSchema.safeParse({
				checked: 4,
				orphaned: ['note-7k2m9q4x1r8t'],
				weakened: ['note-3hd8w2c5n0vp'],
				unchecked: [
					{ specimen: 'example-legacy', reason: 'specimen-missing', notes: ['note-f5n2p8v1d6gs'] },
				],
				restored: [],
			}).success
		).toBe(true);
	});

	it('hardens stored note validation, symlink/size containment, bounded paging, history chronology, and note-check concurrency/errors', async () => {
		const root = await tempDir('specimen-note-hardening-');

		// 1. Malformed history ([null]) is rejected before any mutation occurs
		const badHistory = { ...makeNote('note-666666666666'), history: [null] };
		await mkdir(join(root, NOTES_DIR), { recursive: true });
		const badHistoryPath = join(root, NOTES_DIR, 'note-666666666666.json');
		await writeFile(badHistoryPath, JSON.stringify(badHistory));
		await expect(readNoteFile(root, 'note-666666666666')).rejects.toThrow(
			/does not match the Specimen note schema/i
		);
		await expect(
			resolveNotes(root, { id: 'note-666666666666', outcome: 'fixed', reason: 'Should fail' })
		).rejects.toThrow(/does not match the Specimen note schema/i);
		expect(JSON.parse(await readFile(badHistoryPath, 'utf8')).state).toBe('open');
		await rm(badHistoryPath);

		// 2. Oversized note file is refused
		const hugePath = join(root, NOTES_DIR, 'note-777777777777.json');
		await writeFile(hugePath, ' '.repeat(MAX_NOTE_FILE_BYTES + 64));
		await expect(readNoteFile(root, 'note-777777777777')).rejects.toThrow(/maximum size/i);
		await rm(hugePath);

		// 3. In-project symlink file is refused on read
		const targetFile = join(root, 'other.json');
		await writeFile(targetFile, JSON.stringify(makeNote('note-888888888888')));
		const linkPath = join(root, NOTES_DIR, 'note-888888888888.json');
		try {
			await symlink(targetFile, linkPath);
			await expect(readNoteFile(root, 'note-888888888888')).rejects.toThrow(/regular file/i);
			await rm(linkPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
		}

		// 4. Bounded cursor paging stops at limit + 1 and skips corrupt notes outside the requested page
		const p1 = makeNote('note-100000000001');
		const p2 = makeNote('note-100000000002');
		await writeNoteFile(root, p1);
		await writeNoteFile(root, p2);
		const corruptLater = join(root, NOTES_DIR, 'note-999999999999.json');
		await writeFile(corruptLater, '{corrupt');
		const firstPage = await listNotes(root, { limit: 1 });
		expect(firstPage.notes.map((n) => n.id)).toEqual(['note-100000000001']);
		expect(firstPage.next).toBe('note-100000000001');
		await rm(corruptLater);

		// 5. resolve -> move -> reopen does not duplicate the resolved history entry
		const movedResolved = makeNote('note-a1a2a3a4a5a6', {
			state: 'resolved',
			resolution: { outcome: 'fixed', reason: 'Initial fix', evidence: { revision: 'abc1234' } },
			history: [
				{
					change: 'resolved',
					outcome: 'fixed',
					reason: 'Initial fix',
					evidence: { revision: 'abc1234' },
				},
				{ change: 'moved', reason: 'Moved while resolved' },
			],
		});
		await writeNoteFile(root, movedResolved);
		const reopenedMoved = await reopenNote(root, {
			id: movedResolved.id,
			reason: 'Regression observed',
		});
		expect(reopenedMoved.note.history.map((entry) => entry.change)).toEqual([
			'resolved',
			'moved',
			'reopened',
		]);

		// 6. Concurrent resolve during runNoteCheck is not overwritten by a stale check write
		const raceRoot = await tempDir('specimen-note-race-');
		const raceNote = makeNote('note-c1c2c3c4c5c6');
		await writeNoteFile(raceRoot, raceNote);
		const emptyObs = makeObservation([el('root', 'div')]);
		const raceHost = {
			config: {
				root: raceRoot,
				entries: [
					{
						id: 'example-toolbar',
						title: 'Toolbar',
						module: 'src/toolbar.specimens.js',
						exportName: 'Toolbar',
					},
				],
			},
			async capture() {
				await resolveNotes(raceRoot, {
					id: raceNote.id,
					outcome: 'fixed',
					reason: 'Resolved while note-check was rendering',
				});
				return {
					observation: emptyObs,
					outcome: { status: 'passed' },
					pointMeta: { elementTexts: {}, slottedParents: {} },
				};
			},
		};
		const raceCheck = await runNoteCheck(raceHost as never, {});
		expect(raceCheck).toEqual({
			checked: 0,
			orphaned: [],
			weakened: [],
			unchecked: [],
			restored: [],
		});
		const afterRace = await readNoteFile(raceRoot, raceNote.id);
		expect(afterRace.state).toBe('resolved');
		expect(afterRace.orphaned).toBe(false);

		// 7. Failed checkpoint outcome reports render-failed instead of falsely orphaning
		const failRoot = await tempDir('specimen-note-fail-');
		const failNote = makeNote('note-d1d2d3d4d5d6');
		await writeNoteFile(failRoot, failNote);
		const failHost = {
			config: {
				root: failRoot,
				entries: [
					{
						id: 'example-toolbar',
						title: 'Toolbar',
						module: 'src/toolbar.specimens.js',
						exportName: 'Toolbar',
					},
				],
			},
			async capture() {
				return {
					observation: emptyObs,
					outcome: { status: 'failed' },
					pointMeta: { elementTexts: {}, slottedParents: {} },
				};
			},
		};
		const failCheck = await runNoteCheck(failHost as never, {});
		expect(failCheck).toEqual({
			checked: 0,
			orphaned: [],
			weakened: [],
			unchecked: [
				{ specimen: 'example-toolbar', reason: 'render-failed', notes: ['note-d1d2d3d4d5d6'] },
			],
			restored: [],
		});
		expect((await readNoteFile(failRoot, failNote.id)).orphaned).toBe(false);

		// 8. Host infrastructure errors (e.g. BROWSER_UNAVAILABLE) propagate instead of reporting render-failed
		const infraHost = {
			config: failHost.config,
			async capture() {
				const err: SpecimenHostError = new Error('Chromium headless shell is missing');
				err.code = 'BROWSER_UNAVAILABLE';
				throw err;
			},
		};
		const infraErr = await expectNoteError(runNoteCheck(infraHost as never, {}));
		expect(infraErr.code).toBe('BROWSER_UNAVAILABLE');

		// 9. evaluateNoteResolution climbs through slottedParents for slotted elements
		const slottedObs = makeObservation([
			el('root', 'div'),
			el('root/example-toolbar:1', 'example-toolbar'),
			el('root/example-toolbar:1/example-button:1', 'example-button'),
			el('root/example-toolbar:1/example-button:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Export' },
			}),
			el('root/example-toolbar:1/shadow/slot:1', 'slot'),
		]);
		const slottedNote = makeNote('note-e1e2e3e4e5e6', {
			subject: {
				specimen: 'example-toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				accessible: { role: 'button', name: 'Export' },
				identity: {
					strongest: 'role-name',
					roleName: { role: 'button', name: 'Export' },
					componentPosition: { tag: 'example-button', index: 1 },
					ref: 'root/example-toolbar:1/example-button:1',
				},
			},
		});
		expect(
			evaluateNoteResolution(slottedNote, slottedObs, {
				'root/example-toolbar:1/example-button:1': 'root/example-toolbar:1/shadow/slot:1',
			})
		).toBe('intact');
	});
});
