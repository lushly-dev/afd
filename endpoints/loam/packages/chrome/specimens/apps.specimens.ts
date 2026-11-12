/**
 * The fixtures of what apps add to the chrome (phase 1 specification, 9.3 and section 14's E11): each
 * element on its own, comfortable and compact. Specimen renders each in the light, dark and
 * high-contrast contexts.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { SpecimenDefinition } from '@lushly-dev/specimen';
import { consoleRegistry } from '../dist/apps/console.js';
import {
	defineAppElements,
	type LoamAppEntry,
	type LoamList,
	type LoamModal,
	type LoamMount,
	type LoamPartHeader,
	type LoamToast,
} from '../dist/apps/index.js';
import type { LoamAppNav } from '../dist/elements/app-nav.js';
import type { LoamProjectSwitcher } from '../dist/elements/project-switcher.js';
import { attachTooltip } from '../dist/elements/tooltip.js';
import type { LoamShell } from '../dist/index.js';
import { openSwitcher } from '../dist/rail/switcher.js';
import {
	LoamProjectsSection,
	projectsSectionDefinition,
} from '../dist/sections/projects-section.js';
import { defineViewFrame, type LoamViewFrame } from '../dist/view/view.js';
import { type Density, themePart } from './support.js';

type Box = { inline: string; block: string };

/** One element, or a few, in a box, in `density`. */
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
			return {
				element: wrapper,
				ready: (async () => {
					await themePart(density);
					await defineAppElements();
					await render(wrapper);
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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

class SampleSurface extends HTMLElement {
	connectedCallback(): void {
		this.textContent = 'An app surface, in its own registry';
	}
}

const mount = (wrapper: HTMLElement, element: string) => {
	const registry = new CustomElementRegistry();
	registry.define('sample-surface', class extends SampleSurface {});
	const created = document.createElement('loam-mount') as LoamMount;
	created.configure({
		registry,
		element,
		context: {} as never,
		label: 'Output',
	});
	wrapper.append(created);
};

const list = (setup: (element: LoamList) => void) => (wrapper: HTMLElement) => {
	const element = document.createElement('loam-list') as LoamList;
	element.label = 'Greetings';
	setup(element);
	wrapper.append(element);
};

const entry = (
	variant: 'rail' | 'tabbar',
	instance: string,
	label: string,
	state: string,
	current = false
) => {
	const element = document.createElement('loam-app-entry') as LoamAppEntry;
	element.variant = variant;
	element.instance = instance;
	element.label = label;
	element.icon = 'system/document';
	element.state = state;
	element.current = current;
	return element;
};

/**
 * The rail or tab bar with its bands (phase 2 specification, 7.1): a project-only app dimmed at the top
 * with no project, and the rest at the bottom, as `RailBands` places them.
 */
const nav = (variant: 'rail' | 'tabbar') => (wrapper: HTMLElement) => {
	const part = document.createElement(`loam-${variant}`) as LoamAppNav;
	wrapper.append(part);
	const dimmed = entry(variant, 'tracker', 'Tracker', 'ready');
	dimmed.dimmed = true;
	dimmed.tip = 'Choose a project to open Tracker';
	part.band('top').append(dimmed);
	part
		.band('bottom')
		.append(
			entry(variant, 'hello', 'Hello', 'ready', true),
			entry(variant, 'counter', 'Counter', 'ready'),
			entry(variant, 'tray', 'Tray', 'refused'),
			entry(variant, 'work', 'Work', 'loading')
		);
};

/** A rail in a project: the switcher on the selected colors, Projects current, a project app at the top. */
const railInProject = async (wrapper: HTMLElement) => {
	const part = document.createElement('loam-rail') as LoamAppNav;
	wrapper.append(part);
	const root = part.shadowRoot as ShadowRoot;
	const switcher = root.querySelector('loam-project-switcher') as LoamProjectSwitcher;
	switcher.project = 'Atlas';
	const projects = root.querySelector('loam-section-entry') as LoamAppEntry;
	projects.current = true;
	part.band('top').append(entry('rail', 'tracker', 'Tracker', 'ready'));
	part.band('bottom').append(entry('rail', 'counter', 'Counter', 'ready'));
	return part;
};

/** A stand-in for the shell the switcher's list reads through: two projects, Atlas active. */
const switcherShell = (): LoamShell =>
	({
		ownerDocument: document,
		rail: { showIcons() {} },
		kernel: {
			subscribe: () => () => {},
			call: async (name: string) =>
				name === 'project-list'
					? {
							success: true,
							data: {
								projects: [
									{ id: 'prj_atlas', name: 'Atlas', icon: 'system/folder' },
									{ id: 'prj_beacon', name: 'Beacon', icon: 'system/document' },
								],
							},
						}
					: { success: true, data: { scope: { workspace: 'personal', project: 'prj_atlas' } } },
		},
	}) as unknown as LoamShell;

const toast = (tone: LoamToast['tone'], message: string, id: string) => {
	const element = document.createElement('loam-toast') as LoamToast;
	element.overlayId = id;
	element.tone = tone;
	element.message = message;
	return element;
};

export const [Mount, MountCompact] = both(
	'loam-mount',
	(wrapper) => mount(wrapper, 'sample-surface'),
	{
		inline: '480px',
		block: '200px',
	}
);
export const [MountUndefined, MountUndefinedCompact] = both(
	'loam-mount',
	(wrapper) => mount(wrapper, 'hello-gone'),
	{ inline: '480px', block: '200px' }
);
export const [List, ListCompact] = both(
	'loam-list',
	list((element) => {
		element.items = [
			{ id: 'ada', title: 'Ada', description: 'Greeted this morning' },
			{ id: 'bo', title: 'Bo' },
		];
		element.selected = 'ada';
	}),
	{ inline: '260px', block: '320px' }
);
export const [ListEmpty, ListEmptyCompact] = both(
	'loam-list',
	list(() => {}),
	{ inline: '260px', block: 'auto' }
);
export const [ListFailed, ListFailedCompact] = both(
	'loam-list',
	list((element) => {
		element.failure = {
			message: 'The list could not be read',
			suggestion: 'Reload the page, or read the app',
		};
	}),
	{ inline: '260px', block: 'auto' }
);
export const [PartHeader, PartHeaderCompact] = both(
	'loam-part-header',
	(wrapper) => {
		const element = document.createElement('loam-part-header') as LoamPartHeader;
		element.heading = 'Hello';
		element.actions = [
			{ command: 'hello-greet', label: 'Greet' },
			{ command: 'hello-forget', label: 'Forget', disabled: true },
		];
		wrapper.append(element);
	},
	{ inline: '640px', block: 'auto' }
);
export const [RailApps, RailAppsCompact] = both('loam-rail', nav('rail'), {
	inline: 'auto',
	block: '360px',
});
export const [TabbarApps, TabbarAppsCompact] = both('loam-tabbar', nav('tabbar'), {
	inline: '390px',
	block: 'auto',
});
export const [RailProject, RailProjectCompact] = both(
	'loam-section-entry',
	async (wrapper) => {
		await railInProject(wrapper);
	},
	{ inline: 'auto', block: '360px' }
);
export const [RailTooltip, RailTooltipCompact] = both(
	'loam-tooltip',
	async (wrapper) => {
		const part = await railInProject(wrapper);
		const tip = await attachTooltip(part);
		const target = part.band('top').querySelector('loam-app-entry') as LoamAppEntry;
		target.tip = 'Tracker';
		tip.handle('pointerover', [target]);
	},
	{ inline: '320px', block: '360px' }
);
export const [ProjectSwitcherList, ProjectSwitcherListCompact] = both(
	'loam-project-switcher',
	async (wrapper) => {
		const part = await railInProject(wrapper);
		const switcher = part.shadowRoot?.querySelector('loam-project-switcher') as LoamProjectSwitcher;
		await openSwitcher(switcherShell(), switcher);
	},
	{ inline: '360px', block: '360px' }
);
export const [ProjectSwitcherDialog, ProjectSwitcherDialogCompact] = both(
	'loam-project-list',
	async (wrapper) => {
		// The compact class's tab bar: the list is a modal dialog, as the palette's list is (7.2).
		const part = document.createElement('loam-tabbar') as LoamAppNav;
		wrapper.append(part);
		const switcher = part.shadowRoot?.querySelector('loam-project-switcher') as LoamProjectSwitcher;
		await openSwitcher(switcherShell(), switcher);
	},
	{ inline: '390px', block: '480px' }
);
export const [ListDual, ListDualCompact] = both(
	'loam-list',
	(wrapper) => {
		for (const [heading, items] of [
			['In Atlas', [{ id: 'ada', title: 'Ada' }]],
			['In Personal', [{ id: 'grace', title: 'Grace', description: 'Selected' }]],
		] as const) {
			const element = document.createElement('loam-list') as LoamList;
			element.label = 'Greetings';
			element.heading = heading;
			element.items = [...items];
			if (heading === 'In Personal') element.selected = 'grace';
			wrapper.append(element);
		}
	},
	{ inline: '260px', block: 'auto' }
);
export const [PartHeaderCrumbs, PartHeaderCrumbsCompact] = both(
	'loam-part-header',
	(wrapper) => {
		const element = document.createElement('loam-part-header') as LoamPartHeader;
		element.heading = 'Hello';
		element.crumbs = [
			{ label: 'Personal', href: '/personal' },
			{ label: 'Atlas', href: '/personal/p/atlas' },
			{ label: 'Hello', href: '/personal/p/atlas/hello' },
			{ label: 'items' },
		];
		element.actions = [{ command: 'hello-greet', label: 'Greet' }];
		wrapper.append(element);
	},
	{ inline: '640px', block: 'auto' }
);
export const [StatusAction, StatusActionCompact] = both(
	'loam-status-action',
	(wrapper) => {
		const element = document.createElement('loam-status-action') as HTMLElement & {
			label: string;
			command: string;
		};
		element.label = 'Total';
		element.command = 'counter-add';
		element.textContent = '3';
		wrapper.append(element);
	},
	{ inline: 'auto', block: 'auto' }
);
export const [Toasts, ToastsCompact] = both(
	'loam-toast',
	(wrapper) => {
		const region = document.createElement('loam-toast-region');
		region.append(
			toast('info', 'A note', 'ovl-1'),
			toast('success', 'It worked', 'ovl-2'),
			toast('warning', 'Look at this', 'ovl-3'),
			toast('danger', 'It failed', 'ovl-4')
		);
		wrapper.append(region);
	},
	{ inline: '640px', block: '360px' }
);
export const [Modal, ModalCompact] = both(
	'loam-modal',
	async (wrapper) => {
		const element = document.createElement('loam-modal') as LoamModal;
		wrapper.append(element);
		await element.show('ovl-1', {
			title: 'Say hello?',
			body: 'This modal comes from an app, and an app switch cancels it.',
		});
	},
	{ inline: '640px', block: '360px' }
);
export const [ModalDanger, ModalDangerCompact] = both(
	'loam-modal',
	async (wrapper) => {
		const element = document.createElement('loam-modal') as LoamModal;
		wrapper.append(element);
		await element.show('ovl-1', {
			title: 'Delete this?',
			body: 'It is gone for good.',
			confirmLabel: 'Delete',
			danger: true,
		});
	},
	{ inline: '640px', block: '360px' }
);
export const [NoticeEmbedded, NoticeEmbeddedCompact] = both(
	'loam-notice',
	(wrapper) => {
		const element = document.createElement('loam-notice');
		element.toggleAttribute('embedded', true);
		element.setAttribute('heading', 'Hello');
		element.setAttribute('message', 'The manifest declares the unknown surface tray.');
		element.setAttribute('suggestion', 'Use one of the surfaces of the catalog.');
		wrapper.append(element);
	},
	{ inline: '640px', block: 'auto' }
);

/** With no second origin here, a view frame's own states: an open view is E2's, in real frames. */
const viewFrame = (render: (element: LoamViewFrame) => void) => async (wrapper: HTMLElement) => {
	await defineViewFrame();
	const element = document.createElement('loam-view-frame') as LoamViewFrame;
	element.heading = 'Hello';
	render(element);
	wrapper.append(element);
};

export const [ViewFrameLoading, ViewFrameLoadingCompact] = both(
	'loam-view-frame',
	viewFrame(() => {}),
	{ inline: '640px', block: '240px' }
);
export const [ViewFrameFailed, ViewFrameFailedCompact] = both(
	'loam-view-frame',
	viewFrame((element) => {
		element.failure = {
			code: 'VIEW_READY_TIMEOUT',
			message: 'Hello did not start in time.',
			suggestion: 'Reopen it, and check that the view calls ui/initialize.',
		};
		element.state = 'failed';
	}),
	{ inline: '640px', block: '240px' }
);

/** What the kernel answers a console, in a fixture's fixed state. */
function fakeClient(answers: Record<string, unknown>) {
	return {
		call: async <T>(name: string): Promise<CommandResult<T>> =>
			(name in answers
				? { success: true, data: answers[name] as T }
				: {
						success: false,
						error: {
							code: 'PROBE_REFUSED',
							message: 'It refused',
							suggestion: 'Ask it again nicely',
						},
						metadata: {
							'dev.loam/trust': 'untrusted',
							'dev.loam/instance': 'work',
							'dev.loam/replay': 'recorded',
							'dev.loam/seq': 12,
						},
					}) as CommandResult<T>,
	};
}

const CONSOLE_COMMANDS = [
	{
		name: 'demo-greet',
		title: 'Greet someone',
		description: 'Greets someone and remembers the name.',
		mutation: true,
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string', title: 'Name', description: 'Who to greet', minLength: 2 },
				tone: { type: 'string', enum: ['warm', 'cold'] },
				loud: { type: 'boolean', description: 'In capitals' },
				count: { type: 'integer', minimum: 1 },
				tags: { type: 'array', items: { type: 'string' } },
				extra: { type: 'object' },
			},
			required: ['name'],
		},
	},
	{ name: 'demo-ping', title: 'Ping Demo', description: 'Answers a pong.' },
	{ name: 'demo-clear', description: 'Forgets every name.', mutation: true, destructive: true },
];

const consoleIn = async (wrapper: HTMLElement, answers: Record<string, unknown>) => {
	const registry = await consoleRegistry();
	const created = document.createElement('loam-mount') as LoamMount;
	created.configure({
		registry,
		element: 'loam-console',
		context: { instance: 'demo', client: fakeClient(answers) } as never,
	});
	wrapper.append(created);
	const surface = () =>
		created.shadowRoot?.querySelector('loam-console') as HTMLElement & {
			load(): Promise<void>;
			run(): Promise<void>;
		};
	await surface().load();
	await new Promise((resolve) => requestAnimationFrame(resolve));
	return surface();
};

const CONSOLE_APP = {
	title: 'Demo',
	kind: 'native',
	state: 'ready',
	trustLine: "Trusted, not sandboxed. Native apps share the shell's page.",
	notices: [],
};

const CONSOLE_BOX: Box = { inline: '960px', block: '720px' };

export const [Console, ConsoleCompact] = both(
	'loam-console',
	async (wrapper) => {
		await consoleIn(wrapper, {
			'app-get': CONSOLE_APP,
			'app-command-list': { commands: CONSOLE_COMMANDS, hidden: 0 },
		});
	},
	CONSOLE_BOX
);
/** The console's first read, held: a kernel that never answers, so it stays loading. */
export const [ConsoleLoading, ConsoleLoadingCompact] = both(
	'loam-console',
	async (wrapper) => {
		const registry = await consoleRegistry();
		const created = document.createElement('loam-mount') as LoamMount;
		created.configure({
			registry,
			element: 'loam-console',
			context: { instance: 'demo', client: { call: () => new Promise(() => {}) } } as never,
		});
		wrapper.append(created);
	},
	CONSOLE_BOX
);
export const [ConsoleInvalid, ConsoleInvalidCompact] = both(
	'loam-console',
	async (wrapper) => {
		const surface = await consoleIn(wrapper, {
			'app-get': CONSOLE_APP,
			'app-command-list': { commands: CONSOLE_COMMANDS, hidden: 0 },
		});
		await surface.run();
	},
	CONSOLE_BOX
);
export const [ConsoleResult, ConsoleResultCompact] = both(
	'loam-console',
	async (wrapper) => {
		const surface = await consoleIn(wrapper, {
			'app-get': CONSOLE_APP,
			'app-command-list': { commands: [CONSOLE_COMMANDS[1]], hidden: 0 },
		});
		await surface.run();
	},
	CONSOLE_BOX
);
export const [ConsoleMounted, ConsoleMountedCompact] = both(
	'loam-console',
	async (wrapper) => {
		await consoleIn(wrapper, {
			'app-get': {
				...CONSOLE_APP,
				title: 'Work knowledge',
				kind: 'mounted',
				state: 'failed',
				trustLine: 'External: its results are labeled untrusted.',
				notices: [
					{
						code: 'TEAM_INSTANCE_SINGLE_PRINCIPAL',
						message:
							'A team instance is mounted only where every member of its projects may read all of it.',
					},
				],
			},
			'app-command-list': { commands: [], hidden: 0 },
			'app-instance-list': {
				instances: [
					{
						instance: 'demo',
						transport: 'http',
						state: 'failed',
						commands: 0,
						hidden: 2,
						error: {
							code: 'MOUNT_UNREACHABLE',
							message: 'The instance did not answer.',
							suggestion:
								'Is the instance running? A browser reaches it through the hosted server.',
						},
					},
				],
			},
		});
	},
	CONSOLE_BOX
);

// ─── The projects section (phase 2 specification, 7.7) ─────────────────────────────

const AT = Date.UTC(2026, 10, 3, 12);
const SECTION_PROJECTS = [
	{
		id: 'prj_atlas',
		slug: 'atlas',
		name: 'Atlas',
		icon: 'system/folder',
		status: 'active',
		updatedAt: AT,
	},
	{
		id: 'prj_beacon',
		slug: 'beacon',
		name: 'Beacon',
		icon: 'system/folder',
		status: 'active',
		updatedAt: AT,
	},
	{
		id: 'prj_cove',
		slug: 'cove',
		name: 'Cove',
		icon: 'system/folder',
		status: 'archived',
		updatedAt: AT,
	},
].map((project) => ({
	workspace: 'personal',
	access: { mode: 'workspace' },
	memberEpoch: 0,
	createdAt: AT,
	createdBy: 'local',
	updatedBy: 'local',
	...project,
}));
const ATLAS_SCOPE = { workspace: 'personal', project: 'prj_atlas' };
/** A home's rows: an app with counts, an app whose text is markup rendered as text, one that timed out, one trimmed. */
const SECTION_SUMMARIES = [
	{
		instance: 'plans',
		title: 'Plans',
		icon: 'system/checkmark',
		summary: {
			counts: [
				{ label: 'Open', value: 3 },
				{ label: 'Done', value: 2 },
			],
			recent: [{ title: 'Review the plan', updatedAt: AT }, { title: 'Book the room' }],
		},
	},
	{
		instance: 'board',
		title: 'Board',
		icon: 'system/calendar',
		summary: {
			recent: [
				{
					title: '<b>Not bold</b>',
					link: { kind: 'app', instance: 'board', route: 'card/7', scope: ATLAS_SCOPE },
				},
			],
			links: [
				{ label: 'Open the board', link: { kind: 'app', instance: 'board', scope: ATLAS_SCOPE } },
			],
		},
	},
	{
		instance: 'slow',
		title: 'Slow',
		icon: 'system/clock',
		error: {
			code: 'PROJECT_SUMMARY_TIMEOUT',
			message: 'Slow did not answer within 2 seconds',
			suggestion: "Report this to the app's owner",
		},
	},
	{
		instance: 'wide',
		title: 'Wide',
		icon: 'system/document',
		summary: { counts: [{ label: 'Items', value: 8 }] },
		dropped: 4,
	},
];

/** A section over a kernel that answers the list and the home, and refuses a taken slug. */
const section =
	(
		view: 'list' | 'home',
		projects: unknown[],
		prepare?: (element: LoamProjectsSection) => Promise<void>,
		summaries: unknown[] = SECTION_SUMMARIES,
		/** What other reads answer, by command: the home's Documents card's, for one. */
		answers: Record<string, unknown> = {}
	) =>
	async (wrapper: HTMLElement) => {
		if (!customElements.get(projectsSectionDefinition.name)) {
			await LoamProjectsSection.define(projectsSectionDefinition);
		}
		const element = document.createElement('loam-projects-section') as LoamProjectsSection;
		element.kernel = {
			subscribe: () => () => {},
			call: async (name: string): Promise<CommandResult> =>
				name in answers
					? { success: true, data: answers[name] }
					: name === 'project-list'
						? { success: true, data: { projects, total: projects.length } }
						: name === 'project-summary-get'
							? { success: true, data: { project: projects[0], summaries } }
							: {
									success: false,
									error: {
										code: 'PROJECT_SLUG_TAKEN',
										message: "A project already has the slug 'atlas'",
										suggestion: 'Choose another slug; a slug cannot change once created',
									},
								},
		} as never;
		element.base = 'https://loam.example/';
		wrapper.append(element);
		await element.show(view, view === 'home' ? (projects[0] as never) : null, 'personal');
		await element.read();
		await prepare?.(element);
	};

const SECTION_BOX: Box = { inline: '960px', block: '720px' };
export const [ProjectsSection, ProjectsSectionCompact] = both(
	'loam-projects-section',
	section('list', SECTION_PROJECTS),
	SECTION_BOX
);
export const [ProjectsSectionForm, ProjectsSectionFormCompact] = both(
	'loam-projects-section',
	section('list', SECTION_PROJECTS, async (element) => {
		// A refused slug, beside its field.
		await element.openForm();
		const name = element.shadowRoot?.querySelector('[data-ref="nameField"]') as {
			value: string;
		} | null;
		if (name) name.value = 'Atlas';
		await element.create();
	}),
	SECTION_BOX
);
export const [ProjectsSectionEmpty, ProjectsSectionEmptyCompact] = both(
	'loam-projects-section',
	// The form opens itself on the first read that finds no projects (7.7, A3).
	section('list', []),
	SECTION_BOX
);
export const [ProjectsSectionHome, ProjectsSectionHomeCompact] = both(
	'loam-projects-section',
	section('home', SECTION_PROJECTS),
	SECTION_BOX
);

/** At 320 CSS px: text at 7.7's bounds, an empty summary and right-to-left text, each wrapping in its card (A2). */
const SECTION_LONG = [
	{
		instance: 'plans',
		title: 'Plans',
		icon: 'system/checkmark',
		summary: {
			counts: [{ label: 'L'.repeat(40), value: 1234567 }],
			recent: [{ title: 'T'.repeat(120), updatedAt: AT }],
			links: [
				{ label: 'K'.repeat(40), link: { kind: 'app', instance: 'plans', scope: ATLAS_SCOPE } },
			],
		},
	},
	{ instance: 'board', title: 'Board', icon: 'system/calendar', summary: {} },
	{
		instance: 'ledger',
		title: 'دفتر',
		icon: 'system/document',
		summary: { counts: [{ label: 'مفتوح', value: 3 }], recent: [{ title: 'مراجعة الخطة' }] },
	},
];
/** A home's Documents card, the shell's own after the apps' summaries (documents specification, 8.3). */
export const [ProjectsSectionDocuments, ProjectsSectionDocumentsCompact] = both(
	'loam-projects-section',
	section('home', SECTION_PROJECTS, undefined, SECTION_SUMMARIES, {
		'document-type-list': {
			types: [
				{
					id: 'jots',
					title: 'Jot',
					icon: 'system/document',
					scopeLevels: ['project'],
					templates: [],
				},
			],
		},
		'document-list': {
			documents: [
				{ id: 'doc_plan', title: 'Plan', scope: ATLAS_SCOPE, updatedAt: AT },
				{ id: 'doc_risk', title: '<b>Risks</b>', scope: ATLAS_SCOPE, updatedAt: AT },
			],
			total: 7,
		},
	}),
	SECTION_BOX
);
export const [ProjectsSectionLong, ProjectsSectionLongCompact] = both(
	'loam-projects-section',
	section('home', SECTION_PROJECTS, undefined, SECTION_LONG),
	{ inline: '320px', block: '900px' }
);
