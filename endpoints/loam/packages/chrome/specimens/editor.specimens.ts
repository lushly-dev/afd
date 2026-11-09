/**
 * The editor area's fixtures (documents specification, 5.8 and D10): the area with two groups of tabs,
 * pinned, preview and unsaved among them, and a frame's failure (the area with none open is hidden, and the
 * documents section's list takes main: `documents.specimens.ts`), each comfortable
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

const GROUP_TABS = (): EditorTabView[] => [
	tab('t1', 'Plan', { pinned: true }),
	tab('t2', 'Ideas', { preview: true }),
	tab('t3', 'Roadmap', { dirty: true, active: true }),
];

/** A group alone: its strip, its tab panel and an opening frame. */
export const [EditorGroup, EditorGroupCompact] = both(
	(wrapper) => {
		wrapper.append(group('g1', 'Documents', GROUP_TABS(), frame('t3', 'Roadmap')));
	},
	{ inline: '640px', block: '320px' }
);

/** The group's tab menu, open on its active tab, as Shift+F10 opens it. */
export const [EditorMenu, EditorMenuCompact] = both(
	async (wrapper) => {
		const element = group('g1', 'Documents', GROUP_TABS(), frame('t3', 'Roadmap'));
		wrapper.append(element);
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		const active = element.tabs.find((each) => each.active) as EditorTabView;
		element.openMenu(active, new KeyboardEvent('keydown', { key: 'F10', shiftKey: true }));
	},
	{ inline: '640px', block: '360px' }
);

/** A frame on its own: opening, and failed with its notice and Close. */
export const [EditorFrameLoading, EditorFrameLoadingCompact] = both(
	(wrapper) => {
		wrapper.append(frame('t1', 'Roadmap'));
	},
	{ inline: '480px', block: '200px' }
);

export const [EditorFrameFailed, EditorFrameFailedCompact] = both(
	(wrapper) => {
		wrapper.append(
			frame('t1', 'Ledger', {
				code: 'DOCUMENT_CONTENT_VERSION_NEWER',
				message:
					"This document was written by a newer version of 'ledger', so it is not opened here",
			})
		);
	},
	{ inline: '480px', block: '320px' }
);
