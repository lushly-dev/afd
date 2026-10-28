import type { MountHandle, SpecimenDefinition } from '../src/types.js';

class ProbeButton extends HTMLElement {
	constructor() {
		super();
		const root = this.attachShadow({ mode: 'open' });
		root.innerHTML = '<button type="button">Save</button>';
		const sheet = new CSSStyleSheet();
		sheet.replaceSync('button { padding: 8px; color: black; background: white; }');
		root.adoptedStyleSheets = [sheet];
	}

	setPadding(value: number): void {
		this.shadowRoot?.adoptedStyleSheets[0]?.replaceSync(
			`button { padding: ${value}px; color: black; background: white; }`
		);
	}
}
customElements.define('specimen-probe', ProbeButton);

class ClosedProbe extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'closed' }).innerHTML = '<button>Hidden internals</button>';
	}
}
customElements.define('specimen-closed-probe', ClosedProbe);

export default { component: 'specimen-probe' };

function paddedButton(padding: number): HTMLElement {
	const element = document.createElement('specimen-probe') as ProbeButton;
	element.setPadding(padding);
	return element;
}

export const Baseline = { render: () => paddedButton(8) } satisfies SpecimenDefinition;
export const Padded = { render: () => paddedButton(40) } satisfies SpecimenDefinition;

function checkbox(checked: boolean): HTMLElement {
	const element = document.createElement('input');
	element.type = 'checkbox';
	element.setAttribute('aria-label', 'Enabled');
	element.checked = checked;
	return element;
}

export const Unchecked = { render: () => checkbox(false) } satisfies SpecimenDefinition;
export const Checked = { render: () => checkbox(true) } satisfies SpecimenDefinition;
export const Activated = {
	render: () => checkbox(false),
	targets: { control: { selector: 'input' } },
	scenario: [{ action: { click: 'control' } }, { capture: 'checked' }],
} satisfies SpecimenDefinition;

function namedButton(name: string): HTMLElement {
	const element = document.createElement('button');
	element.textContent = 'Action';
	element.setAttribute('aria-label', name);
	return element;
}

export const Named = { render: () => namedButton('Save') } satisfies SpecimenDefinition;
export const Renamed = { render: () => namedButton('Delete') } satisfies SpecimenDefinition;

function labeledInput(id: string, target = id): HTMLElement {
	const container = document.createElement('div');
	const label = document.createElement('label');
	label.htmlFor = target;
	label.textContent = 'Account';
	const input = document.createElement('input');
	input.id = id;
	container.append(label, input);
	return container;
}

export const GeneratedOne = {
	render: () => labeledInput('specimen-generated-41'),
} satisfies SpecimenDefinition;
export const GeneratedTwo = {
	render: () => labeledInput('specimen-generated-82'),
} satisfies SpecimenDefinition;
export const BrokenRelationship = {
	render: () => labeledInput('specimen-generated-82', 'missing-target'),
} satisfies SpecimenDefinition;

function overflow(width: number): HTMLElement {
	const container = document.createElement('div');
	container.dataset.probe = 'clip';
	container.style.cssText = `width: ${width}px; overflow: hidden;`;
	const content = document.createElement('div');
	content.style.cssText = 'width: 200px; white-space: nowrap;';
	content.textContent = 'Content which needs two hundred pixels';
	container.append(content);
	return container;
}

export const Spacious = { render: () => overflow(240) } satisfies SpecimenDefinition;
export const Clipped = { render: () => overflow(40) } satisfies SpecimenDefinition;

function interactiveButton(): HTMLElement {
	const container = document.createElement('div');
	const style = document.createElement('style');
	style.textContent =
		'.checkpoint-button { color: rgb(0, 0, 0); } .checkpoint-button:hover { color: rgb(255, 0, 0); } .checkpoint-button:focus { outline: 4px solid rgb(0, 0, 255); }';
	const button = document.createElement('button');
	button.className = 'checkpoint-button';
	button.textContent = 'Interact';
	container.append(style, button);
	return container;
}

export const Interactive = {
	render: interactiveButton,
	targets: { control: { selector: 'button' } },
	scenario: [
		{ action: { hover: 'control' } },
		{ capture: 'hovered' },
		{ action: { focus: 'control' } },
		{ capture: 'focused' },
	],
} satisfies SpecimenDefinition;

export const Viewport = {
	render: () => {
		const container = document.createElement('div');
		const style = document.createElement('style');
		style.textContent =
			'.viewport-button { width: 50vw; color: rgb(0, 0, 0); } @media (max-width: 600px) { .viewport-button { color: rgb(255, 0, 0); } }';
		const button = document.createElement('button');
		button.className = 'viewport-button';
		button.dataset.windowWidth = String(window.innerWidth);
		button.dataset.mobile = String(matchMedia('(max-width: 600px)').matches);
		button.textContent = 'Viewport';
		container.append(style, button);
		return container;
	},
} satisfies SpecimenDefinition;

export const Canvas = {
	render: () => {
		const canvas = document.createElement('canvas');
		canvas.width = 80;
		canvas.height = 40;
		const context = canvas.getContext('2d');
		if (context) {
			context.fillStyle = 'red';
			context.fillRect(0, 0, 80, 40);
		}
		return canvas;
	},
} satisfies SpecimenDefinition;
export const Closed = {
	render: () => document.createElement('specimen-closed-probe'),
} satisfies SpecimenDefinition;

export const AsyncReady = {
	render: (): MountHandle => {
		const element = document.createElement('p');
		element.textContent = 'Loading';
		return {
			element,
			ready: new Promise<void>((resolve) => {
				setTimeout(() => {
					element.textContent = 'Ready';
					resolve();
				}, 20);
			}),
		};
	},
} satisfies SpecimenDefinition;
export const ReadinessFailure = {
	render: (): MountHandle => ({
		element: document.createElement('p'),
		ready: Promise.reject(new Error('readiness-marker')),
	}),
} satisfies SpecimenDefinition;
export const ReadinessTimeout = {
	render: (): MountHandle => ({
		element: document.createElement('p'),
		ready: new Promise<void>(() => {}),
	}),
} satisfies SpecimenDefinition;
export const DisposalFailure = {
	render: (): MountHandle => ({
		element: document.createElement('p'),
		dispose: () => {
			throw new Error('disposal-marker');
		},
	}),
} satisfies SpecimenDefinition;

export const Animated = {
	render: () => {
		const container = document.createElement('div');
		const style = document.createElement('style');
		style.textContent =
			'@keyframes specimen-motion { from { transform: translateX(0); } to { transform: translateX(120px); } } .animated-probe { animation: specimen-motion 2s linear infinite; width: 40px; height: 20px; background: red; }';
		const animated = document.createElement('div');
		animated.className = 'animated-probe';
		container.append(style, animated);
		return container;
	},
} satisfies SpecimenDefinition;

export const UnsupportedPlay = {
	render: () => document.createElement('button'),
	play: () => {
		throw new Error('unsupported-play-executed');
	},
};

export const UnsupportedSlots = {
	render: () => document.createElement('button'),
	slots: { default: 'Must not disappear silently' },
};

function rejectPartialScenario(): MountHandle {
	const element = document.createElement('button');
	element.textContent = 'Do not activate';
	let clicked = false;
	element.addEventListener('click', () => {
		clicked = true;
	});
	return {
		element,
		dispose: () => {
			if (clicked) throw new Error('action-executed-before-validation');
		},
	};
}

export const UnsupportedExpectation = {
	render: rejectPartialScenario,
	targets: { control: { selector: 'button' } },
	scenario: [{ action: { click: 'control' } }, { expect: { event: 'click' } }],
};

export const UnsupportedCommand = {
	render: rejectPartialScenario,
	targets: { control: { selector: 'button' } },
	scenario: [{ action: { click: 'control' } }, { command: { runner: 'afd', name: 'todo-list' } }],
};

function animatedAncestor(target: HTMLElement): MountHandle {
	const style = document.createElement('style');
	style.textContent =
		'@keyframes specimen-ancestor-motion { from { transform: translateX(0); } to { transform: translateX(120px); } }';
	document.head.append(style);
	const previous = target.style.getPropertyValue('animation');
	const priority = target.style.getPropertyPriority('animation');
	target.style.animation = 'specimen-ancestor-motion 2s linear infinite';
	const element = document.createElement('button');
	element.textContent = 'Ancestor animation';
	return {
		element,
		dispose: () => {
			target.style.setProperty('animation', previous, priority);
			style.remove();
		},
	};
}

export const BodyAnimated = {
	render: () => animatedAncestor(document.body),
} satisfies SpecimenDefinition;
export const HtmlAnimated = {
	render: () => animatedAncestor(document.documentElement),
} satisfies SpecimenDefinition;

export const DeclarativeClosed = {
	render: () => {
		const element = document.createElement('section') as HTMLElement & {
			setHTMLUnsafe(html: string): void;
		};
		if (typeof element.setHTMLUnsafe !== 'function') {
			throw new Error('Native declarative shadow DOM API unavailable');
		}
		element.setHTMLUnsafe(
			'<div><template shadowrootmode="closed"><button>Opaque declarative internals</button></template></div>'
		);
		return element;
	},
} satisfies SpecimenDefinition;
