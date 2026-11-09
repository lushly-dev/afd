/**
 * Step 12's fixture view type, `sheet` (documents specification, 5.6, 9.2 and 15): a `view` plugin whose
 * documents open in a sandboxed editor and embed in a sandboxed frame, written as `deployment write` carries a
 * package: a raw version 2 manifest, its handlers' page and its view, each on the SDK's real code
 * (`pages/sheet-view.ts`, `pages/sheet-handlers.ts`). Step 13's `checklist` is the real view type; this proves
 * the shell's half first.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundlePage } from '../bundle';

const DOCUMENT_INPUT = {
	type: 'object',
	properties: { document: { type: 'string', minLength: 1, maxLength: 128 } },
	required: ['document'],
	additionalProperties: false,
};

const command = (name: string, effects: string[], input: object, extra: object = {}) => ({
	name,
	title: `Run ${name}`,
	description: `The sheet fixture's ${name}, for a test of a view's documents.`,
	category: 'sheet',
	effects,
	input_schema: input,
	...extra,
});

export const SHEET_MANIFEST = {
	manifest_version: 2,
	protocol: 1,
	afd_contract: '1.0',
	plugin: {
		id: 'sheet',
		title: 'Sheet',
		version: '0.1.0',
		description: 'A view document type that holds a draft, for a test of view editors and embeds.',
		kind: 'view',
		domains: ['sheet'],
		license: 'MIT',
	},
	view: { handlers: 'handlers.html' },
	app: { scope_levels: ['workspace', 'project'] },
	grants: [{ name: 'store', reason: "Keeps each sheet's text." }],
	commands: [
		command('sheet-read', ['inspect'], DOCUMENT_INPUT),
		command(
			'sheet-write',
			['store-write'],
			{
				type: 'object',
				properties: {
					document: { type: 'string', minLength: 1, maxLength: 128 },
					text: { type: 'string', maxLength: 10000 },
				},
				required: ['document', 'text'],
				additionalProperties: false,
			},
			{ undoable: true }
		),
		command('sheet-peek-write', ['inspect'], DOCUMENT_INPUT),
	],
	ui: {
		resources: [
			{ uri: 'ui://sheet/editor', path: 'view.html' },
			{ uri: 'ui://sheet/embed', path: 'view.html' },
		],
		documents: [
			{
				id: 'sheet',
				title: 'Sheet',
				icon: 'system/document',
				content_schema: {
					type: 'object',
					properties: { text: { type: 'string', maxLength: 10000 } },
					required: ['text'],
					additionalProperties: false,
				},
				content_version: 1,
				instance_commands: ['sheet-read', 'sheet-write', 'sheet-peek-write'],
				editor: { resource: 'ui://sheet/editor' },
				embed: { resource: 'ui://sheet/embed' },
				binding: {
					model: 'command',
					selection: 'text-range',
					locator: 'text-range',
					conflict: 'last-writer-wins',
				},
				templates: [{ id: 'blank', title: 'Blank sheet', content: { text: '' } }],
			},
		],
	},
};

const page = (title: string, script: string) =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${title}</title></head><body><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`;

/** The sheet package, in a directory of its own, for `deploymentEntry`. */
export async function sheetPackage(): Promise<string> {
	const directory = join(await mkdtemp(join(tmpdir(), 'loam-sheet-')), 'sheet');
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, 'app-manifest.json'), JSON.stringify(SHEET_MANIFEST));
	await writeFile(
		join(directory, 'handlers.html'),
		page('Handlers', await bundlePage('sheet-handlers'))
	);
	await writeFile(join(directory, 'view.html'), page('Sheet', await bundlePage('sheet-view')));
	return directory;
}
