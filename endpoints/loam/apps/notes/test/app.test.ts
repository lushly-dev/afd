/** Notes' scenario through the test kit: a note's record, its content, undo, export and import, and replay. */

import { fileURLToPath } from 'node:url';
import { appCheck, readAppManifest } from '@lushly-dev/loam-cli';
import { createAppTestKernel } from '@lushly-dev/loam-testing';
import { describe, expect, it } from 'vitest';
import { linkChanges, linkToken, parseLinks } from '../src/links.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const kernelIn = async (project?: string) =>
	createAppTestKernel({
		manifest: await readAppManifest(ROOT),
		definition: () => import('../src/native.js'),
		...(project !== undefined ? { scope: { project } } : {}),
	});

describe('notes', () => {
	it('creates a note from its template, saves with an undo, and replays', async () => {
		const { kernel, replay } = await kernelIn();
		const created = await kernel.call<{ id: string; type: string; title: string }>(
			'document-create',
			{ type: 'notes', title: 'Roadmap' }
		);
		expect(created.data).toMatchObject({ type: 'notes', title: 'Roadmap' });
		const document = created.data?.id as string;
		expect((await kernel.call('notes-content-get', { document })).data).toEqual({
			text: '',
			embeds: [],
		});
		const saved = await kernel.call('notes-content-set', { document, text: 'First line' });
		expect(saved.success).toBe(true);
		expect(saved.undoCommand).toBe('notes-content-set');
		expect(saved.undoArgs).toEqual({ document, text: '', embeds: [] });
		await kernel.call('notes-content-set', { document, text: 'Second line' });
		await kernel.call('notes-content-set', { document, text: 'First line', embeds: [] });
		expect((await kernel.agent.call('notes-content-get', { document })).data).toMatchObject({
			text: 'First line',
		});
		const { report } = await replay();
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('exports and imports a note through the shell, refusing content off its shape', async () => {
		const { kernel } = await kernelIn('atlas');
		const created = await kernel.call<{ id: string }>('document-create', {
			type: 'notes',
			title: 'Draft',
		});
		const document = created.data?.id as string;
		await kernel.call('notes-content-set', { document, text: 'Exported text' });
		const envelope = await kernel.call<Record<string, unknown>>('document-export', { document });
		expect(envelope.data).toMatchObject({
			loam_document: 1,
			type: 'notes',
			content_version: 1,
			title: 'Draft',
			content: { text: 'Exported text' },
		});
		const imported = await kernel.call<{
			id: string;
			next: { command: string; input: { document: string; content: unknown } };
		}>('document-import', { type: 'notes', envelope: envelope.data });
		expect(imported.data?.next.command).toBe('notes-import');
		const next = imported.data?.next;
		expect((await kernel.call(next?.command as string, next?.input)).success).toBe(true);
		expect(
			(await kernel.call('notes-content-get', { document: imported.data?.id })).data
		).toMatchObject({ text: 'Exported text' });
		// Called on a note that has content, it replaces it, and its undo brings it back.
		const replaced = await kernel.call('notes-import', {
			document,
			content: { text: 'Imported over' },
		});
		expect(replaced.undoCommand).toBe('notes-content-set');
		expect(replaced.undoArgs).toEqual({ document, text: 'Exported text', embeds: [] });
		await kernel.call(replaced.undoCommand as string, replaced.undoArgs);
		expect((await kernel.call('notes-content-get', { document })).data).toMatchObject({
			text: 'Exported text',
		});
		const refused = await kernel.call('notes-import', {
			document: imported.data?.id,
			content: { text: 7 },
		});
		expect(refused.error?.code).toBe('NOTE_CONTENT_INVALID');
	});

	it('opens a note in the editor area, at the scope it is in', async () => {
		const { kernel } = await kernelIn();
		const created = await kernel.call<{ id: string }>('document-create', { type: 'notes' });
		const document = created.data?.id as string;
		const opened = await kernel.call<{ tab: string; group: string }>('document-open', { document });
		expect(opened.data).toEqual({ tab: 't1', group: 'g1' });
		expect((await kernel.call('section-get')).data).toMatchObject({
			section: 'documents',
			path: document,
			active: null,
		});
		const editor = await kernel.call<{ groups: Array<{ tabs: Array<{ document: string }> }> }>(
			'editor-get'
		);
		expect(editor.data?.groups[0]?.tabs.map((tab) => tab.document)).toEqual([document]);
	});

	it('P2-D10: refuses a save over 256 KiB as DOCUMENT_CONTENT_TOO_LARGE, journaled without its input', async () => {
		const { kernel, journal } = await kernelIn();
		const created = await kernel.call<{ id: string }>('document-create', { type: 'notes' });
		const document = created.data?.id as string;
		// 100,000 characters, under the schema's 200,000, and 300,000 bytes of JSON, over the kernel's bound.
		const refused = await kernel.call('notes-content-set', { document, text: '€'.repeat(100_000) });
		expect(refused.error?.code).toBe('DOCUMENT_CONTENT_TOO_LARGE');
		const entry = (await journal.read()).at(-1);
		expect(entry?.command).toBe('notes-content-set');
		expect(entry?.input).toEqual({ document });
		expect((await kernel.call('notes-content-get', { document })).data).toMatchObject({ text: '' });
	});

	it('P2-D10: measures the journal’s growth for a 10,000-character note saved 30 times, which is recorded and not limited', async () => {
		const { kernel, journal } = await kernelIn();
		const created = await kernel.call<{ id: string }>('document-create', { type: 'notes' });
		const document = created.data?.id as string;
		const before = JSON.stringify(await journal.read()).length;
		for (let save = 0; save < 30; save++) {
			const text = `${String(save).padStart(2, '0')}${'n'.repeat(9_998)}`;
			expect((await kernel.call('notes-content-set', { document, text })).success).toBe(true);
		}
		const growth = JSON.stringify(await journal.read()).length - before;
		// Each save journals its whole text, its undo's previous text and its result's: about three copies.
		expect(growth).toBeGreaterThan(30 * 10_000 * 3);
		expect(growth).toBeLessThan(30 * 10_000 * 3.2);
		console.info(
			`P2-D10: 30 saves of a 10,000-character note grew the journal by ${growth} bytes of JSON`
		);
	});

	it('passes app check as a version 2 manifest with one document type, its embed and inspector, and no rail', async () => {
		const manifest = await readAppManifest(ROOT);
		expect(manifest.manifest_version).toBe(2);
		expect(manifest.ui?.documents?.map((type) => type.id)).toEqual(['notes']);
		expect(manifest.ui?.surfaces).toBeUndefined();
		expect(manifest.ui?.documents?.[0]).toMatchObject({
			embed: { element: 'notes-embed' },
			inspector: { element: 'notes-inspector' },
		});
		expect(manifest.grants?.map((grant) => grant.name)).toEqual(['store', 'clock', 'documents']);
		const report = await appCheck({ dir: ROOT });
		expect(report.refusals).toEqual([]);
		expect(report.trust?.code).toBe('TRUSTED_NOT_SANDBOXED');
	});

	it('P2-D9: reminds a caller whose saved text names a document it has not linked, and stops once it is', async () => {
		const { kernel } = await kernelIn();
		const made = async (title: string) =>
			(await kernel.call<{ id: string }>('document-create', { type: 'notes', title })).data
				?.id as string;
		const a = await made('A');
		const b = await made('B');
		const text = `See ${linkToken(b, 'B')}`;
		const first = await kernel.call('notes-content-set', { document: a, text });
		expect(first.warnings).toEqual([
			{ code: 'NOTE_LINKS_SEPARATE', message: 'links are separate: document-link-add' },
		]);
		await kernel.call('document-link-add', { from: a, to: b });
		const second = await kernel.call('notes-content-set', { document: a, text });
		expect(second.warnings).toBeUndefined();
		// Text with no link needs none.
		expect(
			(await kernel.call('notes-content-set', { document: b, text: 'Plain' })).warnings
		).toBeUndefined();
	});
});

describe("P2-D9: a note's links", () => {
	it('parses each link token of the text, with its id, its title and where it is', () => {
		const token = linkToken('doc_abc123def456', 'Road]map');
		expect(token).toBe('[[doc_abc123def456|Road)map]]');
		const text = `Start ${token} and [[doc_x|X]], not [[no id]] or [[a b|c]].`;
		expect(parseLinks(text)).toEqual([
			{ document: 'doc_abc123def456', title: 'Road)map', start: 6, end: 6 + token.length },
			{
				document: 'doc_x',
				title: 'X',
				start: text.indexOf('[[doc_x'),
				end: text.indexOf('[[doc_x') + '[[doc_x|X]]'.length,
			},
		]);
		expect(parseLinks('')).toEqual([]);
	});

	it('diffs what the text links and embeds against the links held, one of each kind and document', () => {
		const held = [
			{ id: 'l1', to: 'doc_b', kind: 'reference' },
			{ id: 'l2', to: 'doc_gone', kind: 'reference' },
			{ id: 'l3', to: 'doc_b', kind: 'reference' },
			{ id: 'l4', to: 'doc_e', kind: 'embed' },
			{ id: 'l5', to: 'doc_q', kind: 'quote' },
		];
		const text = `${linkToken('doc_b', 'B')} ${linkToken('doc_c', 'C')} ${linkToken('doc_b', 'B again')}`;
		expect(linkChanges(text, ['doc_e', 'doc_f'], held)).toEqual({
			add: [
				{ to: 'doc_c', kind: 'reference' },
				{ to: 'doc_f', kind: 'embed' },
			],
			// A second link of the same kind and document goes, and another kind is left alone.
			remove: ['l2', 'l3'],
		});
		expect(linkChanges('', [], held).remove).toEqual(['l1', 'l2', 'l3', 'l4']);
	});
});
