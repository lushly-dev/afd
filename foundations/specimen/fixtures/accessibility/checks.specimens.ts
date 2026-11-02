import type { SpecimenDefinition } from '../../src/types.js';

// What `specimen-a11y` reports on a native specimen: violations, what axe cannot decide, and
// exceptions that must say why and where.

const DOT = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

function image(): HTMLImageElement {
	const element = document.createElement('img');
	element.src = DOT;
	element.width = 10;
	element.height = 10;
	return element;
}

/** Two images without `alt`, one inside `[data-legacy]`. */
function legacyAndNew(): HTMLElement {
	const wrapper = document.createElement('div');
	const legacy = document.createElement('section');
	legacy.dataset.legacy = 'true';
	legacy.append(image());
	wrapper.append(legacy, image());
	return wrapper;
}

function legacyOnly(): HTMLElement {
	const legacy = document.createElement('section');
	legacy.dataset.legacy = 'true';
	legacy.append(image());
	return legacy;
}

const legacyException = {
	rule: 'image-alt',
	target: '[data-legacy]',
	reason: 'Legacy artwork, replaced in the next release.',
};

export const Clean: SpecimenDefinition = {
	render: () => {
		const paragraph = document.createElement('p');
		paragraph.textContent = 'Nothing to find here.';
		return paragraph;
	},
};

export const Violating: SpecimenDefinition = { render: image };

export const Excepted: SpecimenDefinition = {
	render: legacyOnly,
	a11y: { exceptions: [legacyException] },
};

/** An exception excuses its target, so the same rule elsewhere still fails. */
export const PartlyExcepted: SpecimenDefinition = {
	render: legacyAndNew,
	a11y: { exceptions: [legacyException] },
};

/** An exception excuses its rule, so another rule on its target still fails. */
export const OtherRule: SpecimenDefinition = {
	render: legacyOnly,
	a11y: { exceptions: [{ ...legacyException, rule: 'button-name' }] },
};

/** A target outside a shadow root covers what is inside it. */
export const InShadow: SpecimenDefinition = {
	render: () => {
		const host = document.createElement('section');
		host.dataset.legacy = 'true';
		host.attachShadow({ mode: 'open' }).append(image());
		return host;
	},
	a11y: { exceptions: [legacyException] },
};

export const StaleException: SpecimenDefinition = {
	render: Clean.render,
	a11y: { exceptions: [legacyException] },
};

export const Disabled: SpecimenDefinition = {
	render: image,
	a11y: { disabled: { reason: 'A fixture of the broken state itself.' } },
};

export const NoReason = {
	render: image,
	a11y: { exceptions: [{ rule: 'image-alt', target: 'img' }] },
} as unknown as SpecimenDefinition;

export const NoTarget = {
	render: image,
	a11y: { exceptions: [{ rule: 'image-alt', reason: 'Everywhere.' }] },
} as unknown as SpecimenDefinition;

/** Text over an image: axe cannot compute the contrast, and says so rather than passing it. */
export const Undecided: SpecimenDefinition = {
	render: () => {
		const paragraph = document.createElement('p');
		paragraph.textContent = 'Text over a picture';
		paragraph.style.backgroundImage = `url(${DOT})`;
		return paragraph;
	},
};

/** Accessible at mount; the scenario's click adds what is not. */
export const AfterScenario: SpecimenDefinition = {
	render: () => {
		const wrapper = document.createElement('div');
		const button = document.createElement('button');
		button.textContent = 'Add picture';
		button.addEventListener('click', () => wrapper.append(image()));
		wrapper.append(button);
		return wrapper;
	},
	targets: { add: { role: 'button', name: 'Add picture' } },
	scenario: [{ action: { click: 'add' } }],
};
