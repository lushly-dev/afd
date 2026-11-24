/**
 * Browser-safe representation of `loam-app.toml` with the real JSON schemas from `../schemas/`,
 * used by job specimens so they boot the real `notes` app in `loam-shell` without Node file I/O.
 * `test/notes-conflict.scenario.test.ts` asserts equality with `readAppManifest(ROOT)` so this
 * never drifts from `loam-app.toml`.
 */

import type { ManifestV2 } from '@lushly-dev/loam-sdk';
import noteContentSchema from '../schemas/note.content.json' with { type: 'json' };
import notesContentSetSchema from '../schemas/notes-content-set.input.json' with { type: 'json' };
import notesDocumentSchema from '../schemas/notes-document.input.json' with { type: 'json' };
import notesImportSchema from '../schemas/notes-import.input.json' with { type: 'json' };

export const NOTES_MANIFEST = {
	manifest_version: 2,
	protocol: 1,
	afd_contract: '1.0',
	plugin: {
		id: 'notes',
		title: 'Notes',
		version: '0.1.0',
		description:
			'Notes: text a person writes in the editor area, at workspace level or in a project.',
		kind: 'native',
		domains: ['notes'],
		license: 'MIT',
	},
	native: {
		entry: 'dist/native.js',
	},
	app: {
		scope_levels: ['workspace', 'project'],
	},
	grants: [
		{ name: 'store', reason: "Keeps each note's text." },
		{ name: 'clock', reason: 'Stamps when each note was last saved.' },
		{
			name: 'documents',
			reason: 'Lists the documents a note can link to and embed, and its links and backlinks.',
		},
	],
	commands: [
		{
			name: 'notes-content-get',
			title: 'Read a note',
			description: "Read a note's text and embeds, and when it was last saved.",
			category: 'notes',
			effects: ['inspect'],
			input_schema: notesDocumentSchema,
		},
		{
			name: 'notes-content-set',
			title: 'Save a note',
			description:
				"Replace a note's whole text, and its embeds when given. Links are separate: document-link-add.",
			category: 'notes',
			effects: ['store-write'],
			input_schema: notesContentSetSchema,
			undoable: true,
		},
		{
			name: 'notes-export',
			title: 'Export a note',
			description: "Answer a note's content as { content }, for document-export.",
			category: 'notes',
			effects: ['inspect'],
			input_schema: notesDocumentSchema,
		},
		{
			name: 'notes-import',
			title: 'Import a note',
			description:
				"Write exported content into a note, as document-import's data.next asks for a new one; it replaces what the note held, which its undo restores.",
			category: 'notes',
			effects: ['store-write'],
			input_schema: notesImportSchema,
			undoable: true,
		},
	],
	ui: {
		documents: [
			{
				id: 'notes',
				title: 'Note',
				icon: 'system/document',
				content_schema: noteContentSchema,
				content_version: 1,
				autosave_ms: 2000,
				instance_commands: [
					'notes-content-get',
					'notes-content-set',
					'notes-export',
					'notes-import',
				],
				export_command: 'notes-export',
				import_command: 'notes-import',
				editor: { element: 'notes-editor' },
				embed: { element: 'notes-embed' },
				inspector: { element: 'notes-inspector' },
				binding: {
					model: 'command',
					selection: 'text-range',
					locator: 'text-range',
					conflict: 'last-writer-wins',
				},
				templates: [
					{
						id: 'blank',
						title: 'Blank note',
						content: { text: '' },
					},
				],
			},
		],
	},
} as unknown as ManifestV2;
