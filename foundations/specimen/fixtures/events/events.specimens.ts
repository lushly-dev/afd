// Declared events and `expect` steps, and the context matrix.

function button(text: string): HTMLButtonElement {
	const element = document.createElement('button');
	element.textContent = text;
	return element;
}

const save = { control: { role: 'button', name: 'Save' } };

export const Clicked = {
	render: () => button('Save'),
	targets: save,
	events: [{ type: 'click', target: 'control' }],
	scenario: [
		{ id: 'activate', action: { click: 'control' } },
		{ id: 'clicked', expect: { event: 'click', since: 'activate' } },
		{ capture: 'after-click' },
	],
};

/** A non-composed event never leaves its shadow root, so a document listener could not see it. */
class FixtureToggle extends HTMLElement {
	connectedCallback(): void {
		const inner = button('Toggle');
		inner.addEventListener('click', () =>
			inner.dispatchEvent(new CustomEvent('toggled', { detail: { on: true, node: inner } }))
		);
		this.attachShadow({ mode: 'open' }).append(inner);
	}
}
customElements.define('fixture-toggle', FixtureToggle);

export const NonComposed = {
	render: () => document.createElement('fixture-toggle'),
	targets: {
		host: { selector: 'fixture-toggle' },
		inner: { role: 'button', name: 'Toggle' },
	},
	events: [{ type: 'toggled', target: 'host' }],
	scenario: [
		{ id: 'toggle', action: { click: 'inner' } },
		{ expect: { event: 'toggled', target: 'host', since: 'toggle' } },
	],
};

/** Fires as it is inserted, so its event belongs to no step and cannot satisfy one that follows. */
class FixtureAnnouncer extends HTMLElement {
	connectedCallback(): void {
		this.append(button('Save'));
		this.dispatchEvent(new Event('announce', { bubbles: true }));
	}
}
customElements.define('fixture-announcer', FixtureAnnouncer);

export const Earlier = {
	render: () => document.createElement('fixture-announcer'),
	targets: save,
	events: [{ type: 'announce' }],
	scenario: [
		{ id: 'activate', action: { click: 'control' } },
		{ expect: { event: 'announce', since: 'activate', timeoutMs: 50 } },
	],
};

/** A click, but not on the target the expectation names. */
export const OtherTarget = {
	render: () => {
		const wrapper = document.createElement('div');
		wrapper.append(button('Save'), button('Cancel'));
		return wrapper;
	},
	targets: { ...save, cancel: { role: 'button', name: 'Cancel' } },
	events: [
		{ type: 'click', target: 'control' },
		{ type: 'click', target: 'cancel' },
	],
	scenario: [
		{ id: 'dismiss', action: { click: 'cancel' } },
		{ expect: { event: 'click', target: 'control', since: 'dismiss', timeoutMs: 50 } },
	],
};

export const Never = {
	render: () => button('Save'),
	targets: save,
	events: [{ type: 'submit-ish', target: 'control' }],
	scenario: [
		{ id: 'activate', action: { click: 'control' } },
		{ expect: { event: 'submit-ish', since: 'activate', timeoutMs: 50 } },
	],
};

export const Undeclared = {
	render: () => button('Save'),
	targets: save,
	scenario: [
		{ id: 'activate', action: { click: 'control' } },
		{ expect: { event: 'click', since: 'activate' } },
	],
};

export const NoInterval = {
	render: () => button('Save'),
	targets: save,
	events: [{ type: 'click' }],
	scenario: [{ id: 'activate', action: { click: 'control' } }, { expect: { event: 'click' } }],
};

export const UnknownStep = {
	render: () => button('Save'),
	targets: save,
	events: [{ type: 'click' }],
	scenario: [
		{ expect: { event: 'click', since: 'activate' } },
		{ id: 'activate', action: { click: 'control' } },
	],
};

/** The declared target appears only after the first step, and its events still count. */
export const LaterTarget = {
	render: () => {
		const wrapper = document.createElement('div');
		const open = button('Open');
		open.addEventListener('click', () => wrapper.append(button('Save')));
		wrapper.append(open);
		return wrapper;
	},
	targets: { ...save, open: { role: 'button', name: 'Open' } },
	events: [{ type: 'click', target: 'control' }],
	scenario: [
		{ id: 'open', action: { click: 'open' } },
		{ id: 'activate', action: { click: 'control' } },
		{ expect: { event: 'click', target: 'control', since: 'activate' } },
	],
};

export const MissingTarget = {
	render: () => button('Save'),
	targets: { ...save, gone: { selector: '.never-rendered' } },
	events: [
		{ type: 'click', target: 'control' },
		{ type: 'click', target: 'gone' },
	],
};

export const Plain = { render: () => button('Save') };

/** The viewport changes its text; the theme changes only its styles, not its markup. */
export const Responsive = {
	render: () => {
		const wrapper = document.createElement('div');
		const style = document.createElement('style');
		style.textContent =
			'p { color: rgb(20, 20, 20); } @media (prefers-color-scheme: dark) { p { color: rgb(240, 240, 240); } }';
		const element = document.createElement('p');
		element.textContent = matchMedia('(max-width: 600px)').matches ? 'Narrow' : 'Wide';
		wrapper.append(style, element);
		return wrapper;
	},
};

/** Not available in one locale, so that cell has no capture. */
export const LocaleLimited = {
	render: () => {
		if (document.documentElement.lang === 'de') throw new Error('No German strings yet.');
		const element = document.createElement('p');
		element.textContent = 'Hello';
		return element;
	},
};

/** A disabled button does not click: being disabled is one claim, and staying inert another. */
export const StaysInert = {
	render: () => {
		const element = button('Save');
		element.disabled = true;
		return element;
	},
	targets: { control: { selector: 'button' } },
	events: [{ type: 'click', target: 'control' }],
	scenario: [
		{ id: 'focused', action: { focus: 'control' } },
		{ id: 'inert', expect: { event: 'click', target: 'control', since: 'focused', absent: true } },
	],
};

/** The same claim on a button that does click must fail. */
export const NotInert = {
	render: () => button('Save'),
	targets: save,
	events: [{ type: 'click', target: 'control' }],
	scenario: [
		{ id: 'activate', action: { click: 'control' } },
		{ id: 'inert', expect: { event: 'click', target: 'control', since: 'activate', absent: true } },
	],
};
