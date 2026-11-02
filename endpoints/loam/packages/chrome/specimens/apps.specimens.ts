/**
 * The fixtures of what apps add to the chrome (phase 1 specification, 9.3 and section 14's E11): each
 * element on its own, comfortable and compact. Specimen renders each in the light, dark and
 * high-contrast contexts.
 */

import type { SpecimenDefinition } from '@lushly-dev/specimen';
import {
	defineAppElements,
	type LoamAppEntry,
	type LoamList,
	type LoamModal,
	type LoamMount,
	type LoamPartHeader,
	type LoamToast,
} from '../dist/apps/index.js';
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
	// Specimen waits on the global registry for each tag it finds, and a name defined only in a scoped
	// registry would hold it to its deadline (a follow-up in the phase 1 specification). So the name is
	// here too, and the mount's own element is still the scoped class.
	if (!customElements.get('sample-surface')) {
		customElements.define('sample-surface', class extends HTMLElement {});
	}
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

const nav = (variant: 'rail' | 'tabbar') => (wrapper: HTMLElement) => {
	const part = document.createElement(`loam-${variant}`);
	part.append(
		entry(variant, 'hello', 'Hello', 'ready', true),
		entry(variant, 'counter', 'Counter', 'ready'),
		entry(variant, 'tray', 'Tray', 'refused'),
		entry(variant, 'work', 'Work', 'loading')
	);
	wrapper.append(part);
};

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
