/**
 * The chrome's fixtures (component checklist item 5): the whole shell, and each part on its own.
 * Specimen renders each in the light, dark and high-contrast contexts (D53); the web package's
 * Chromium suite captures them (E4).
 */

import type { SpecimenDefinition } from '@lushly-dev/specimen';
import { type Density, mediaKernel, shellFixture, themePart, until } from './support.js';

const allOpen = [
	{ interface: 'palette', name: 'layout-set', input: { inspector: { open: true } } },
	{ interface: 'palette', name: 'layout-set', input: { panel: { open: true } } },
] as const;

function shell(density: Density): SpecimenDefinition {
	return {
		render: () =>
			shellFixture(async () => {
				const { kernel } = await mediaKernel();
				await kernel.call('appearance-set', { density });
				return { kernel, calls: allOpen };
			}),
	};
}

/** The whole shell with every part present, comfortable density. */
export const Shell = shell('comfortable');
/** The whole shell with every part present, compact density. */
export const ShellCompactDensity = shell('compact');

/** The shell with the command palette open on a query. */
export const ShellPalette = {
	render: () =>
		shellFixture(
			async () => ({ kernel: (await mediaKernel()).kernel }),
			async (shell) => {
				await shell.openPalette('layout');
				await until(() => shell.palette.isOpen && shell.palette.results.length > 0);
			}
		),
} satisfies SpecimenDefinition;

/** A part on its own, in a box of the given size. */
function part(
	tag: string,
	setup: (element: HTMLElement) => void,
	box: { inline: string; block: string }
): SpecimenDefinition {
	return {
		render: () => {
			const wrapper = document.createElement('div');
			wrapper.dataset.fixture = tag;
			wrapper.style.setProperty('display', 'grid');
			wrapper.style.setProperty('inline-size', box.inline);
			wrapper.style.setProperty('block-size', box.block);
			const element = document.createElement(tag);
			setup(element);
			wrapper.append(element);
			return {
				element: wrapper,
				ready: themePart().then(
					() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
				),
			};
		},
	};
}

const emptyState = (message: string) => {
	const state = document.createElement('loam-empty-state');
	state.setAttribute('message', message);
	return state;
};

export const Titlebar = part(
	'loam-titlebar',
	(element) => {
		element.setAttribute('shown-parts', 'sidebar panel');
	},
	{ inline: '960px', block: 'auto' }
);
export const TitlebarSignedIn = part(
	'loam-titlebar',
	(element) => {
		element.setAttribute('account', 'person');
	},
	{ inline: '960px', block: 'auto' }
);
export const Rail = part('loam-rail', () => {}, { inline: 'auto', block: '320px' });
export const Tabbar = part('loam-tabbar', () => {}, { inline: '390px', block: 'auto' });
export const Sidebar = part(
	'loam-sidebar',
	(element) => {
		element.setAttribute('heading', 'Sidebar');
		element.append(emptyState("The active app's navigation will appear here."));
	},
	{ inline: '260px', block: '480px' }
);
export const Inspector = part(
	'loam-inspector',
	(element) => {
		element.setAttribute('heading', 'Inspector');
		element.append(emptyState('Properties of the selection will appear here.'));
	},
	{ inline: '300px', block: '480px' }
);
export const InspectorOverlay = part(
	'loam-inspector',
	(element) => {
		element.setAttribute('heading', 'Inspector');
		element.setAttribute('mode', 'overlay');
		element.append(emptyState('Properties of the selection will appear here.'));
	},
	{ inline: '300px', block: '480px' }
);
export const Main = part('loam-main', () => {}, { inline: '640px', block: '360px' });
export const MainNotFound = part(
	'loam-main',
	(element) => {
		element.setAttribute('route', 'not-found');
	},
	{ inline: '640px', block: '360px' }
);
export const Panel = part(
	'loam-panel',
	(element) => {
		element.append(emptyState('Output and logs will appear here.'));
	},
	{ inline: '640px', block: '240px' }
);
export const Statusbar = part(
	'loam-statusbar',
	(element) => {
		const actor = document.createElement('loam-status-item');
		actor.slot = 'start';
		actor.textContent = 'Signed in as person';
		const seq = document.createElement('loam-status-item');
		seq.slot = 'end';
		seq.setAttribute('label', 'Journal');
		seq.textContent = '42';
		element.append(actor, seq);
	},
	{ inline: '960px', block: 'auto' }
);
export const ResizeHandle = part(
	'loam-resize-handle',
	(element) => {
		for (const [name, value] of Object.entries({
			growth: 'end',
			label: 'Resize sidebar',
			value: '260',
			min: '200',
			max: '480',
			preset: '260',
		}))
			element.setAttribute(name, value);
	},
	{ inline: '24px', block: '240px' }
);
export const EmptyState = part(
	'loam-empty-state',
	(element) => {
		element.setAttribute('message', 'Output and logs will appear here.');
	},
	{ inline: '320px', block: 'auto' }
);
export const StatusItem = part(
	'loam-status-item',
	(element) => {
		element.setAttribute('label', 'Journal');
		element.textContent = '42';
	},
	{ inline: 'auto', block: 'auto' }
);
export const Notice = part(
	'loam-notice',
	(element) => {
		element.setAttribute('heading', 'Loam is open in another tab');
		element.setAttribute(
			'message',
			'Loam keeps one journal per browser profile. Use the other tab, or close it and reload this one.'
		);
	},
	{ inline: '100%', block: 'auto' }
);
