/**
 * `notes-editor`'s fixtures (documents specification, D10): the editor with a draft, and with "This note
 * changed elsewhere" after another write, each comfortable and compact. Specimen renders each in the light,
 * dark and high-contrast contexts. Here, not in the chrome's fixtures, since no file of the chrome names a
 * type (D2). The editor's client is a stub answering the type's own read and write.
 */

import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
import type { SpecimenDefinition } from '@lushly-dev/specimen';
import '@lushly-dev/violet-elements/dist/button/violet-button.js';
import '@lushly-dev/violet-elements/dist/text-area/violet-text-area.js';
import type { AppContextV1, DocumentRefV1 } from '@lushly-dev/loam-sdk';
import { defineNotesElements, type NotesEditor } from '../src/notes-editor.js';

type Density = 'comfortable' | 'compact';

/** The theme the media choose, as the shell resolves `system` (phase 0 specification, 6.3). */
function mediaTheme(): 'light' | 'dark' | 'high-contrast' {
	if (matchMedia('(forced-colors: active)').matches) return 'high-contrast';
	if (matchMedia('(prefers-contrast: more)').matches) return 'high-contrast';
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let themed = false;
function theme(density: Density): void {
	if (!themed) {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(themeCss);
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
		themed = true;
	}
	const root = document.documentElement;
	root.dataset.loamTheme = mediaTheme();
	if (density === 'compact') root.dataset.loamDensity = 'compact';
	else delete root.dataset.loamDensity;
}

const REFERENCE: DocumentRefV1 = {
	id: 'doc_fixture00001',
	type: 'notes',
	title: 'Roadmap',
	scope: { workspace: 'personal' },
	contentVersion: 1,
	binding: {
		model: 'command',
		selection: 'text-range',
		locator: 'text-range',
		conflict: 'last-writer-wins',
	},
	readOnly: false,
};

/** A context whose client answers `notes-content-get` with what the store holds now. */
function contextOver(held: { text: string }): AppContextV1 {
	return {
		instance: 'notes',
		app: 'notes',
		version: '0.1.0',
		config: {},
		registry: customElements,
		kit: { define: async () => {} },
		overlays: {} as AppContextV1['overlays'],
		client: {
			call: async (name: string) =>
				name === 'notes-content-get'
					? ({ success: true, data: { text: held.text, embeds: [] } } as never)
					: ({ success: true, data: {} } as never),
		},
	};
}

function fixture(density: Density, conflict: boolean): SpecimenDefinition {
	return {
		render: () => {
			const wrapper = document.createElement('div');
			wrapper.dataset.fixture = 'notes-editor';
			wrapper.style.setProperty('inline-size', '640px');
			wrapper.style.setProperty('block-size', '360px');
			return {
				element: wrapper,
				ready: (async () => {
					theme(density);
					const held = { text: 'Ship the editor area.' };
					const context = contextOver(held);
					if (!customElements.get('notes-editor')) await defineNotesElements(context);
					const editor = document.createElement('notes-editor') as NotesEditor;
					editor.context = context;
					editor.document = REFERENCE;
					wrapper.append(editor);
					await new Promise((resolve) => setTimeout(resolve, 50));
					editor.area.value = 'Ship the editor area, then the documents section.';
					editor.area.dispatchEvent(
						new CustomEvent('input', { detail: { value: editor.area.value } })
					);
					if (conflict) {
						held.text = 'Ship the editor area next week.';
						editor.documentChanged({ document: REFERENCE.id, command: 'notes-content-set' });
						await new Promise((resolve) => setTimeout(resolve, 50));
					}
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				})(),
			};
		},
	};
}

export const [Editor, EditorCompact] = [fixture('comfortable', false), fixture('compact', false)];
export const [EditorConflict, EditorConflictCompact] = [
	fixture('comfortable', true),
	fixture('compact', true),
];
