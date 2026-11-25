/**
 * The editor area's fixtures (documents specification, 5.8, 9.2 and D10): the area with two groups of tabs,
 * pinned, preview and unsaved among them, a frame's failure (the area with none open is hidden, and the
 * documents section's list takes main: `documents.specimens.ts`), and `loam-embed` in its unavailable, link,
 * ready, depth-stop and cycle-stop states, each comfortable and compact. Specimen renders each in the light,
 * dark and high-contrast contexts. No app is loaded: the frames show their own states, and the embed fixtures
 * use a stub shell and a scoped fixture element.
 */

import type { DocumentRefV1 } from '@lushly-dev/loam-sdk';
import type { SpecimenDefinition } from '@lushly-dev/specimen';
import { createKit, defineAppElements, type LoamMount } from '../dist/apps/index.js';
import { defineEditorElements } from '../dist/editor/editor.js';
import type { LoamEditorArea } from '../dist/editor/editor-area.js';
import type { LoamEditorFrame } from '../dist/editor/editor-frame.js';
import type { EditorTabView, LoamEditorGroup } from '../dist/editor/editor-group.js';
import type { LoamEmbed } from '../dist/editor/embed.js';
import type { LoamShell } from '../dist/index.js';
import { type Density, themePart, until } from './support.js';

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

/**
 * `loam-embed` (documents specification, 9.2): with no shell around it there is no reader, so it is `Not
 * available`, as a refused or missing target is; and a target whose type has no embed, its title as a link.
 */
async function embed(wrapper: HTMLElement, link: boolean): Promise<void> {
	await (await import('../dist/editor/embed.js')).defined;
	const element = document.createElement('loam-embed') as LoamEmbed;
	element.document = 'doc_fixture00001';
	wrapper.append(element);
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	if (link) {
		element.heading = 'Roadmap';
		element.url = '/personal/~/documents/doc_fixture00001';
		element.state = 'link';
	}
}

export const [EmbedUnavailable, EmbedUnavailableCompact] = both(
	(wrapper) => embed(wrapper, false),
	{
		inline: '480px',
		block: '120px',
	}
);

export const [EmbedLink, EmbedLinkCompact] = both((wrapper) => embed(wrapper, true), {
	inline: '480px',
	block: '120px',
});

interface FixtureDocument {
	id: string;
	title: string;
	body: string;
	child?: string;
}

/** A stub document type element in its own scoped registry, rendering read-only body text and an optional nested embed. */
class FixtureEmbedBody extends HTMLElement {
	document?: DocumentRefV1;
	bodies?: Readonly<Record<string, FixtureDocument>>;
	scopedRegistry?: CustomElementRegistry;

	connectedCallback(): void {
		const spec = this.document ? this.bodies?.[this.document.id] : undefined;
		this.replaceChildren();
		const text = document.createElement('p');
		text.textContent = spec?.body ?? '';
		this.append(text);
		if (spec?.child) {
			const nested = (
				this.scopedRegistry
					? document.createElement('loam-embed', {
							customElementRegistry: this.scopedRegistry,
						} as ElementCreationOptions)
					: document.createElement('loam-embed')
			) as LoamEmbed;
			nested.document = spec.child;
			this.append(nested);
		}
	}
}

const EMBED_TYPE = {
	id: 'jots',
	title: 'Jot',
	icon: 'system/document',
	instance: 'jots',
	app: 'jots',
	editorKind: 'native',
	scopeLevels: ['workspace', 'project'],
	templates: [],
};

function embedRecord(spec: FixtureDocument) {
	return {
		id: spec.id,
		workspace: 'personal',
		type: 'jots',
		instance: 'jots',
		title: spec.title,
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
		createdAt: 1,
		updatedAt: 1,
		createdBy: 'local',
		updatedBy: 'local',
	};
}

/** Collect every `loam-embed` under `root`, piercing shadow roots. */
function embedsIn(root: ParentNode | null | undefined): LoamEmbed[] {
	const found: LoamEmbed[] = [];
	const walk = (node: ParentNode | null | undefined) => {
		for (const each of node?.querySelectorAll('*') ?? []) {
			if (each.localName === 'loam-embed') found.push(each as LoamEmbed);
			walk(each.shadowRoot);
		}
	};
	walk(root);
	return found;
}

/**
 * `loam-embed` hosted inside an unbooted `loam-shell` (documents specification, 9.2; #868), so `#around()`
 * finds a shell, `#render()` reads the target through the kernel and mounts the type's read-only embed in a
 * scoped registry, and depth/cycle stops render through the real path.
 */
async function hostedEmbed(
	wrapper: HTMLElement,
	rootId: string,
	documents: readonly FixtureDocument[],
	expectedStates: readonly string[]
): Promise<void> {
	await (await import('../dist/editor/embed.js')).defined;
	const byId = Object.fromEntries(documents.map((each) => [each.id, each]));
	const registry = new CustomElementRegistry();
	await createKit(registry).define(['loam-embed']);
	registry.define(
		'jots-embed',
		class extends FixtureEmbedBody {
			override bodies = byId;
			override scopedRegistry = registry;
		}
	);
	const shell = document.createElement('loam-shell') as LoamShell;
	shell.style.setProperty('display', 'block');
	shell.style.setProperty('block-size', 'auto');
	shell.style.setProperty('inline-size', '100%');
	wrapper.append(shell);
	shell.base = 'https://loam.example/';
	shell.kernel = {
		subscribe: () => () => {},
		appPort: () => ({
			manifest: { ui: { documents: [{ id: 'jots', embed: { element: 'jots-embed' } }] } },
		}),
		call: async (name: string, input: Record<string, unknown> = {}) => {
			if (name === 'document-get') {
				const found = byId[String(input.document ?? '')];
				return found
					? { success: true, data: embedRecord(found) }
					: { success: false, error: { code: 'DOCUMENT_NOT_FOUND', message: 'Not found' } };
			}
			if (name === 'document-type-list') return { success: true, data: { types: [EMBED_TYPE] } };
			if (name === 'project-list') return { success: true, data: { projects: [] } };
			return { success: true, data: {} };
		},
	} as never;
	shell.apps = {
		host: () => ({
			ensureActivated: async () => {},
			createMount: (_instance: string, element: string, options: { document?: DocumentRefV1 }) => {
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
	const root = document.createElement('loam-embed') as LoamEmbed;
	root.document = rootId;
	shell.shadowRoot?.append(root);
	const target = [...expectedStates].sort().join(',');
	await until(
		() =>
			embedsIn(shell.shadowRoot)
				.map((each) => each.state)
				.sort()
				.join(',') === target
	);
}

/** A ready embed with a body mounted in a scoped registry. */
export const [EmbedReady, EmbedReadyCompact] = both(
	(wrapper) =>
		hostedEmbed(
			wrapper,
			'doc_roadmap',
			[
				{
					id: 'doc_roadmap',
					title: 'Roadmap',
					body: 'Plans for the quarter, and what ships first.',
				},
			],
			['ready']
		),
	{ inline: '480px', block: '160px' }
);

/** Four nested embeds: the fourth exceeds `EMBED_DEPTH_MAX` (3) and stops with `EMBED_DEPTH_EXCEEDED`. */
export const [EmbedDepth, EmbedDepthCompact] = both(
	(wrapper) =>
		hostedEmbed(
			wrapper,
			'doc_d1',
			[
				{ id: 'doc_d1', title: 'Level one', body: 'First embed.', child: 'doc_d2' },
				{ id: 'doc_d2', title: 'Level two', body: 'Second embed.', child: 'doc_d3' },
				{ id: 'doc_d3', title: 'Level three', body: 'Third embed.', child: 'doc_d4' },
				{ id: 'doc_d4', title: 'Deep jot', body: 'Should not render.' },
			],
			['ready', 'ready', 'ready', 'deep']
		),
	{ inline: '560px', block: '360px' }
);

/** A self-embedding document: the first repeat stops with `EMBED_DEPTH_EXCEEDED`. */
export const [EmbedCycle, EmbedCycleCompact] = both(
	(wrapper) =>
		hostedEmbed(
			wrapper,
			'doc_cycle',
			[{ id: 'doc_cycle', title: 'Loop jot', body: 'Embeds itself.', child: 'doc_cycle' }],
			['ready', 'deep']
		),
	{ inline: '520px', block: '240px' }
);
