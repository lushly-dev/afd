/**
 * The editor area's fixtures (documents specification, 5.8 and D10): the area with two groups of tabs,
 * pinned, preview and unsaved among them, the area with none open, and a frame's failure, each comfortable
 * and compact. Specimen renders each in the light, dark and high-contrast contexts. No app is loaded, so the
 * frames show their own states: the area's look is the shell's, whatever an editor draws.
 */

import type { SpecimenDefinition } from '@lushly-dev/specimen';
import { defineAppElements } from '../dist/apps/index.js';
import { defineEditorElements } from '../dist/editor/editor.js';
import type { LoamEditorArea } from '../dist/editor/editor-area.js';
import type { LoamEditorFrame } from '../dist/editor/editor-frame.js';
import type { EditorTabView, LoamEditorGroup } from '../dist/editor/editor-group.js';
import { type Density, themePart } from './support.js';

type Box = { inline: string; block: string };

function fixture(
	density: Density,
	render: (wrapper: HTMLElement) => void | Promise<void>,
	box: Box
): SpecimenDefinition {
	return {
		render: () => {
			const wrapper = document.createElement('div');
			wrapper.dataset.fixture = 'loam-editor-area';
			wrapper.style.setProperty('inline-size', box.inline);
			wrapper.style.setProperty('block-size', box.block);
			wrapper.style.setProperty('display', 'flex');
			return {
				element: wrapper,
				ready: (async () => {
					await themePart(density);
					await defineAppElements();
					await defineEditorElements();
					await render(wrapper);
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				})(),
			};
		},
	};
}

const both = (
	render: (wrapper: HTMLElement) => void | Promise<void>,
	box: Box
): [SpecimenDefinition, SpecimenDefinition] => [
	fixture('comfortable', render, box),
	fixture('compact', render, box),
];

const tab = (id: string, title: string, extra: Partial<EditorTabView> = {}): EditorTabView => ({
	id,
	document: `doc_${id}`,
	title,
	dirty: false,
	pinned: false,
	preview: false,
	active: false,
	...extra,
});

/** A frame in one of its own states: opening, or failed with a code. */
function frame(tabId: string, title: string, failed?: { code: string; message: string }) {
	const element = document.createElement('loam-editor-frame') as LoamEditorFrame;
	element.tab = tabId;
	element.title = title;
	if (failed) {
		requestAnimationFrame(() =>
			element.fail({ ...failed, suggestion: 'List the apps with app-list; the document is kept.' })
		);
	}
	return element;
}

function group(id: string, label: string, tabs: EditorTabView[], child: LoamEditorFrame) {
	const element = document.createElement('loam-editor-group') as LoamEditorGroup;
	element.group = id;
	element.label = label;
	element.tabs = tabs;
	element.append(child);
	return element;
}

function area(wrapper: HTMLElement, heading: string, groups: LoamEditorGroup[]) {
	const element = document.createElement('loam-editor-area') as LoamEditorArea;
	element.heading = heading;
	element.empty = groups.length === 0;
	element.append(...groups);
	wrapper.append(element);
}

const BOX = { inline: '960px', block: '420px' };

export const [EditorArea, EditorAreaCompact] = both(
	(wrapper) =>
		area(wrapper, 'Roadmap', [
			group(
				'g1',
				'Documents, group 1',
				[
					tab('t1', 'Plan', { pinned: true }),
					tab('t2', 'Ideas', { preview: true }),
					tab('t3', 'Roadmap', { dirty: true, active: true }),
				],
				frame('t3', 'Roadmap')
			),
			group(
				'g2',
				'Documents, group 2',
				[tab('t4', 'Archive', { active: true })],
				frame('t4', 'Archive', {
					code: 'DOCUMENT_TYPE_UNAVAILABLE',
					message: "No app this workspace runs provides the document type 'ledger'",
				})
			),
		]),
	BOX
);

export const [EditorAreaEmpty, EditorAreaEmptyCompact] = both(
	(wrapper) => area(wrapper, '', []),
	BOX
);
