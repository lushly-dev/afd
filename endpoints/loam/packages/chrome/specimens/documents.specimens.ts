/**
 * The documents section's and New's fixtures (documents specification, 7, 8 and D10, step 11): `loam-tree`
 * as the section's sidebar, with its row menu open, and as an app's tree; the section's list, its trash and
 * its empty state; and the New menu with a heading per plugin. Each comfortable and compact; Specimen renders
 * each in the light, dark and high-contrast contexts. A stub kernel answers the reads, so no app is loaded.
 */

import type { SpecimenDefinition } from '@lushly-dev/specimen';
import { openNew } from '../dist/new/new-menu.js';
import {
	documentsSectionDefinition,
	type LoamDocumentsSection,
	LoamDocumentsSection as Section,
} from '../dist/sections/documents-section.js';
import {
	documentsSidebarDefinition,
	type LoamDocumentsSidebar,
	LoamDocumentsSidebar as Sidebar,
} from '../dist/sections/documents-sidebar.js';
import { defineTree, type LoamTree } from '../dist/sections/tree.js';
import { type Density, themePart } from './support.js';

type Box = { inline: string; block: string };

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 8, 12);

const record = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
	id,
	workspace: 'personal',
	type: 'notes',
	instance: 'notes',
	title,
	scope: { workspace: 'personal' },
	scopeKey: 'w',
	owner: 'local',
	tags: [],
	status: 'active',
	trashedAt: null,
	trashedFrom: null,
	contentVersion: 1,
	binding: {
		model: 'command',
		selection: 'text-range',
		locator: 'text-range',
		conflict: 'last-writer-wins',
	},
	epoch: 0,
	createdAt: NOW - 3 * DAY,
	updatedAt: NOW - DAY,
	createdBy: 'local',
	updatedBy: 'local',
	...extra,
});

const NOTES = {
	id: 'notes',
	title: 'Note',
	icon: 'system/document',
	instance: 'notes',
	app: 'notes',
	scopeLevels: ['workspace', 'project'],
	templates: [{ id: 'blank', title: 'Blank note' }],
};

/** A kernel that answers each read the section, its sidebar and New make, and changes nothing. */
function stubKernel(answers: Record<string, (input: Record<string, unknown>) => unknown>) {
	return {
		subscribe: () => () => {},
		listCommands: () => [],
		async call(name: string, input: Record<string, unknown> = {}) {
			const answer = answers[name];
			return answer ? { success: true, data: answer(input) } : { success: true, data: {} };
		},
	} as never;
}

const DOCUMENTS = [
	record('doc_roadmap', 'Roadmap', { tags: ['plans'] }),
	record('doc_hostile', '<img src=x onerror=alert(1)>', { owner: 'mock-user-person@example.com' }),
	record('doc_ideas', 'Ideas for the quarter, with a title long enough to wrap at 260 CSS px'),
];

const READS = {
	'document-type-list': () => ({ types: [NOTES] }),
	'document-list': (input: Record<string, unknown>) =>
		input.status === 'trashed'
			? {
					documents: [
						record('doc_old', 'Old plan', { status: 'trashed', trashedAt: NOW - 2 * DAY }),
					],
					total: 1,
				}
			: { documents: DOCUMENTS, total: DOCUMENTS.length },
	'workspace-get': () => ({ trashDays: 30 }),
	'new-list': () => ({
		items: [
			{
				kind: 'document',
				type: 'notes',
				template: 'blank',
				title: 'Blank note',
				icon: 'system/document',
				recent: true,
			},
			{
				kind: 'creator',
				instance: 'tasks',
				command: 'tasks-add-blank',
				title: 'Task',
				icon: 'system/checkmark',
			},
		],
	}),
	'app-list': () => ({
		apps: [
			{ instance: 'notes', title: 'Notes' },
			{ instance: 'tasks', title: 'Tasks' },
		],
	}),
	'scope-get': () => ({ scope: { workspace: 'personal' } }),
};

async function defineAll(): Promise<void> {
	await defineTree();
	if (!customElements.get(documentsSectionDefinition.name))
		await Section.define(documentsSectionDefinition);
	if (!customElements.get(documentsSidebarDefinition.name))
		await Sidebar.define(documentsSidebarDefinition);
}

function fixture(
	name: string,
	density: Density,
	render: (wrapper: HTMLElement) => void | Promise<void>,
	box: Box
): SpecimenDefinition {
	return {
		render: () => {
			const wrapper = document.createElement('div');
			wrapper.dataset.fixture = name;
			wrapper.style.setProperty('inline-size', box.inline);
			wrapper.style.setProperty('block-size', box.block);
			wrapper.style.setProperty('display', 'flex');
			wrapper.style.setProperty('flex-direction', 'column');
			return {
				element: wrapper,
				ready: (async () => {
					await themePart(density);
					await defineAll();
					await render(wrapper);
					for (let frame = 0; frame < 3; frame++) {
						await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
					}
				})(),
			};
		},
	};
}

const both = (
	name: string,
	render: (wrapper: HTMLElement) => void | Promise<void>,
	box: Box
): [SpecimenDefinition, SpecimenDefinition] => [
	fixture(name, 'comfortable', render, box),
	fixture(name, 'compact', render, box),
];

const SIDE: Box = { inline: '260px', block: '420px' };

async function sidebar(wrapper: HTMLElement, trash = false): Promise<LoamDocumentsSidebar> {
	const element = document.createElement(documentsSidebarDefinition.name) as LoamDocumentsSidebar;
	element.kernel = stubKernel(READS);
	wrapper.append(element);
	if (trash) element.tree.expanded.add('trash');
	element.tree.expanded.add('type:notes');
	await element.show('personal ');
	return element;
}

/** The section's sidebar: Recent, Notes and Trash open, a row selected. */
export const [DocumentsTree, DocumentsTreeCompact] = both(
	'loam-documents-sidebar',
	async (wrapper) => {
		const element = await sidebar(wrapper, true);
		element.tree.selected = 'notes:doc_roadmap';
	},
	SIDE
);

/** A row's menu, opened from the keyboard. */
export const [DocumentsTreeMenu, DocumentsTreeMenuCompact] = both(
	'loam-documents-sidebar',
	async (wrapper) => {
		const element = await sidebar(wrapper);
		const tree = element.tree;
		const row = tree.shadowRoot?.querySelector<HTMLElement>(
			'violet-tree-item[data-id="recent:doc_roadmap"]'
		);
		if (row) tree.openMenu('recent:doc_roadmap', row, true);
	},
	{ inline: '320px', block: '420px' }
);

/** An app's `tree` sidebar, three levels deep, with a description. */
export const [AppTree, AppTreeCompact] = both(
	'loam-tree',
	(wrapper) => {
		const element = document.createElement('loam-tree') as LoamTree;
		element.label = 'Guides';
		element.expanded.add('guides');
		element.expanded.add('start');
		element.items = [
			{
				id: 'guides',
				title: 'Guides',
				children: [
					{
						id: 'start',
						title: 'Getting started',
						children: [{ id: 'install', title: 'Install', description: 'Five minutes' }],
					},
				],
			},
			{ id: 'reference', title: 'Reference' },
		];
		element.selected = 'install';
		wrapper.append(element);
	},
	SIDE
);

const MAIN: Box = { inline: '720px', block: '480px' };

async function section(
	wrapper: HTMLElement,
	configure?: (element: LoamDocumentsSection) => void
): Promise<void> {
	const element = document.createElement(documentsSectionDefinition.name) as LoamDocumentsSection;
	element.kernel = stubKernel(READS);
	element.workspace = 'personal';
	element.base = `${location.origin}/`;
	configure?.(element);
	wrapper.append(element);
	await element.read();
}

/** The list, a hostile title among its rows, which renders as text (D8). */
export const [DocumentsSection, DocumentsSectionCompact] = both(
	'loam-documents-section',
	(wrapper) => section(wrapper),
	MAIN
);

/** The trash, with Restore and its dates. */
export const [DocumentsSectionTrash, DocumentsSectionTrashCompact] = both(
	'loam-documents-section',
	(wrapper) =>
		section(wrapper, (element) => {
			element.status = 'trashed';
		}),
	MAIN
);

/** Nothing yet: what New creates, inline. */
export const [DocumentsSectionEmpty, DocumentsSectionEmptyCompact] = both(
	'loam-documents-section',
	(wrapper) =>
		section(wrapper, (element) => {
			element.kernel = stubKernel({
				...READS,
				'document-list': () => ({ documents: [], total: 0 }),
			});
			element.host = { kernel: element.kernel, shadowRoot: null, ownerDocument: document };
		}),
	MAIN
);

/** The New menu, open from its button, with a heading per plugin. */
export const [NewMenu, NewMenuCompact] = both(
	'loam-new-menu',
	async (wrapper) => {
		// A stand-in for the title bar: the button the menu opens from, in a shadow root as the shell's is.
		const host = document.createElement('div');
		const root = host.attachShadow({ mode: 'open' });
		const titlebar = document.createElement('loam-titlebar-stand-in');
		const bar = titlebar.attachShadow({ mode: 'open' });
		const holder = document.createElement('span');
		holder.className = 'new';
		holder.style.setProperty('position', 'relative');
		holder.style.setProperty('display', 'inline-block');
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = 'New';
		button.setAttribute('aria-haspopup', 'menu');
		holder.append(button);
		bar.append(holder);
		titlebar.setAttribute('data-stand-in', 'loam-titlebar');
		root.append(titlebar);
		wrapper.append(host);
		// `openNew` finds the title bar by its name in the shell's shadow root.
		Object.defineProperty(root, 'querySelector', {
			value: (selector: string) =>
				selector === 'loam-titlebar'
					? titlebar
					: ShadowRoot.prototype.querySelector.call(root, selector),
		});
		await openNew({ kernel: stubKernel(READS), shadowRoot: root, ownerDocument: document });
	},
	{ inline: '360px', block: '260px' }
);
