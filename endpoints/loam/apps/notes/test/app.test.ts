/** Notes' scenario through the test kit: a note's record, its content, undo, export and import, and replay. */

import { fileURLToPath } from 'node:url';
import { appCheck, readAppManifest } from '@lushly-dev/loam-cli';
import { createAppTestKernel } from '@lushly-dev/loam-testing';
import { describe, expect, it } from 'vitest';

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

	it('passes app check as a version 2 manifest with one document type and no rail', async () => {
		const manifest = await readAppManifest(ROOT);
		expect(manifest.manifest_version).toBe(2);
		expect(manifest.ui?.documents?.map((type) => type.id)).toEqual(['notes']);
		expect(manifest.ui?.surfaces).toBeUndefined();
		const report = await appCheck({ dir: ROOT });
		expect(report.refusals).toEqual([]);
		expect(report.trust?.code).toBe('TRUSTED_NOT_SANDBOXED');
	});
});
