/**
 * The documents section's and New's fixtures (documents specification, 7, 8, 10 and D10, steps 11 and 12):
 * `loam-tree` as the section's sidebar, with its row menu and Rename/Links dialogs open, and as an app's tree;
 * the documents inspector mounted in its `loam-inspector` shell part; the section's list, its trash and its
 * empty state; and the New menu with a heading per plugin. Each comfortable and compact; Specimen renders each
 * in the light, dark and high-contrast contexts. A stub kernel answers the reads, so no app is loaded.
 */

import type { DocumentRefV1 } from '@lushly-dev/loam-sdk';
import type { SpecimenDefinition } from '@lushly-dev/specimen';
import { defineAppElements, type LoamMount } from '../dist/apps/index.js';
import type { LoamShell } from '../dist/index.js';
import { LoamNewMenu, newMenuDefinition } from '../dist/new/new-menu.js';
import { syncInspector } from '../dist/sections/documents-inspector.js';
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
import { defineTree, type LoamTree, TREE_ACTION_EVENT } from '../dist/sections/tree.js';
import { type Density, themePart, until } from './support.js';

type Box = { inline: string; block: string };

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 8, 12);

const record = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
	id,
	workspace: 'personal',
	type: 'jots',
	instance: 'jots',
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

const JOTS = {
	id: 'jots',
	title: 'Jot',
	icon: 'system/document',
	instance: 'jots',
	app: 'jots',
	editorKind: 'native',
	scopeLevels: ['workspace', 'project'],
	templates: [{ id: 'blank', title: 'Blank jot' }],
};

/** A kernel that answers each read the section, its sidebar, its inspector and New make, and changes nothing. */
function stubKernel(
	answers: Record<string, (input: Record<string, unknown>) => unknown>,
	manifests: Record<string, unknown> = {}
) {
	return {
		subscribe: () => () => {},
		listCommands: () => [],
		appPort: (instance: string) => ({ manifest: manifests[instance] ?? {} }),
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
	'document-type-list': () => ({ types: [JOTS] }),
	'document-get': (input: Record<string, unknown>) =>
		DOCUMENTS.find((each) => each.id === input.document) ?? DOCUMENTS[0],
	'document-list': (input: Record<string, unknown>) =>
		input.status === 'trashed'
			? {
					documents: [
						record('doc_old', 'Old plan', { status: 'trashed', trashedAt: NOW - 2 * DAY }),
					],
					total: 1,
				}
			: { documents: DOCUMENTS, total: DOCUMENTS.length },
	'document-link-list': () => ({
		out: [
			{
				link: { id: 'lnk_1' },
				document: {
					id: 'doc_ideas',
					title: 'Ideas for the quarter',
					type: 'jots',
					status: 'active',
				},
			},
		],
		in: [
			{
				link: { id: 'lnk_2' },
				document: { id: 'doc_old', title: 'Old plan', type: 'jots', status: 'trashed' },
			},
		],
	}),
	'editor-get': () => ({
		activeGroup: 'g1',
		groups: [{ id: 'g1', active: 't1', tabs: [{ id: 't1', document: 'doc_roadmap' }] }],
	}),
	'workspace-get': () => ({ trashDays: 30 }),
	'new-list': () => ({
		items: [
			{
				kind: 'document',
				type: 'jots',
				template: 'blank',
				title: 'Blank jot',
				icon: 'system/document',
				recent: true,
			},
			{
				kind: 'creator',
				instance: 'chores',
				command: 'chores-add-blank',
				title: 'Chore',
				icon: 'system/checkmark',
			},
		],
	}),
	'app-list': () => ({
		apps: [
			{ instance: 'jots', title: 'Jots' },
			{ instance: 'chores', title: 'Chores' },
		],
	}),
	'scope-get': () => ({ scope: { workspace: 'personal' } }),
};

async function defineAll(): Promise<void> {
	await defineAppElements();
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
	await element.show('personal ');
	// Opened once the scope is shown, which starts with Recent alone open.
	element.tree.expanded.add('type:jots');
	if (trash) element.tree.expanded.add('trash');
	await element.read();
	return element;
}

/** The section's sidebar: Recent, Jots and Trash open, a row selected. */
export const [DocumentsTree, DocumentsTreeCompact] = both(
	'loam-documents-sidebar',
	async (wrapper) => {
		const element = await sidebar(wrapper, true);
		element.tree.selected = 'jots:doc_roadmap';
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

/** Open the sidebar's Rename or Links modal dialog for Roadmap (#873). */
async function openSidebarDialog(wrapper: HTMLElement, action: 'rename' | 'links'): Promise<void> {
	const element = await sidebar(wrapper);
	element.tree.dispatchEvent(
		new CustomEvent(TREE_ACTION_EVENT, {
			detail: { id: 'recent:doc_roadmap', action },
			bubbles: true,
			composed: true,
		})
	);
	await until(() => {
		const dialog = element.shadowRoot?.querySelector('dialog');
		if (!dialog?.matches(':modal')) return false;
		if (action === 'rename') {
			return (
				(dialog.querySelector<HTMLInputElement>('[data-ref="title"]')?.value ?? '') === 'Roadmap'
			);
		}
		return Boolean(dialog.querySelector('table[data-ref="links"] tbody tr'));
	});
}

const DIALOG_BOX: Box = { inline: '640px', block: '420px' };

/** The documents sidebar's Rename modal dialog, open on Roadmap (#873). */
export const [DocumentsTreeRename, DocumentsTreeRenameCompact] = both(
	'loam-documents-sidebar',
	(wrapper) => openSidebarDialog(wrapper, 'rename'),
	DIALOG_BOX
);

/** The documents sidebar's Links modal dialog, open on Roadmap with active and trashed rows (#873). */
export const [DocumentsTreeLinks, DocumentsTreeLinksCompact] = both(
	'loam-documents-sidebar',
	(wrapper) => openSidebarDialog(wrapper, 'links'),
	DIALOG_BOX
);

/** A stub document type inspector element mounted in its own scoped registry for `DocumentsInspector` (#868). */
class FixtureDocumentInspector extends HTMLElement {
	document?: DocumentRefV1;

	connectedCallback(): void {
		this.replaceChildren();
		const links = document.createElement('section');
		links.setAttribute('aria-label', 'Links');
		const linksHeading = document.createElement('h3');
		linksHeading.textContent = 'Links';
		const outLink = document.createElement('p');
		outLink.textContent = `Outgoing from ${this.document?.title ?? 'Document'}: Ideas for the quarter`;
		links.append(linksHeading, outLink);
		const backlinks = document.createElement('section');
		backlinks.setAttribute('aria-label', 'Backlinks');
		const backlinksHeading = document.createElement('h3');
		backlinksHeading.textContent = 'Backlinks';
		const inLink = document.createElement('p');
		inLink.textContent = 'Old plan (In trash)';
		backlinks.append(backlinksHeading, inLink);
		this.append(links, backlinks);
	}
}

/** The documents inspector mounted in the shell's `loam-inspector` part via `syncInspector` (#868). */
export const [DocumentsInspector, DocumentsInspectorCompact] = both(
	'loam-inspector',
	async (wrapper) => {
		const registry = new CustomElementRegistry();
		registry.define('jots-inspector', class extends FixtureDocumentInspector {});
		const shell = document.createElement('loam-shell') as LoamShell;
		shell.style.setProperty('display', 'block');
		shell.style.setProperty('inline-size', '100%');
		shell.style.setProperty('block-size', '100%');
		wrapper.append(shell);
		const part = document.createElement('loam-inspector');
		part.setAttribute('heading', 'Inspector');
		part.style.setProperty('inline-size', '100%');
		part.style.setProperty('block-size', '100%');
		const empty = document.createElement('loam-empty-state');
		empty.setAttribute('message', 'Properties of the selection will appear here.');
		part.append(empty);
		shell.shadowRoot?.append(part);
		shell.kernel = stubKernel(READS, {
			jots: { ui: { documents: [{ id: 'jots', inspector: { element: 'jots-inspector' } }] } },
		});
		shell.apps = {
			host: () => ({
				ensureActivated: async () => {},
				createMount: (
					_instance: string,
					element: string,
					options: { document?: DocumentRefV1 }
				) => {
					const mount = document.createElement('loam-mount') as LoamMount;
					mount.configure({
						registry,
						element,
						context: {} as never,
						...(options.document ? { document: options.document } : {}),
					});
					return mount;
				},
			}),
		} as never;
		const shown = await syncInspector(shell, true, () => {});
		if (!shown) throw new Error('DocumentsInspector fixture: syncInspector did not mount');
		await until(
			() =>
				part.getAttribute('heading') === 'Jot details' &&
				Boolean(part.querySelector('loam-mount')?.shadowRoot?.querySelector('jots-inspector'))
		);
	},
	{ inline: '300px', block: '480px' }
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
	// These fixture links are inspected, so keep their origin stable across capture servers.
	element.base = 'https://loam.example/';
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

/** While its first read is under way: "Loading…" (A-N3). */
export const [DocumentsSectionLoading, DocumentsSectionLoadingCompact] = both(
	'loam-documents-section',
	(wrapper) => {
		const element = document.createElement(documentsSectionDefinition.name) as LoamDocumentsSection;
		element.kernel = { subscribe: () => () => {}, call: () => new Promise(() => {}) } as never;
		wrapper.append(element);
		void element.read();
	},
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
		if (!customElements.get(newMenuDefinition.name)) await LoamNewMenu.define(newMenuDefinition);
		// A stand-in for the title bar's New button, which the menu opens from.
		const holder = document.createElement('span');
		holder.style.setProperty('position', 'relative');
		holder.style.setProperty('display', 'inline-block');
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = 'New';
		button.setAttribute('aria-haspopup', 'menu');
		holder.append(button);
		wrapper.append(holder);
		const menu = document.createElement(newMenuDefinition.name) as LoamNewMenu;
		menu.host = { kernel: stubKernel(READS), shadowRoot: null, ownerDocument: document };
		menu.watch(button);
		holder.append(menu);
		await menu.open();
	},
	{ inline: '360px', block: '260px' }
);
