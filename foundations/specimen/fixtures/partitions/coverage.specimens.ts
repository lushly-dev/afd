// A component with each kind of required partition, shown in only some of its states.

class FixturePanel extends HTMLElement {
	static formAssociated = true;
	mode = 'a';
	get broken(): boolean {
		throw new Error('Not readable.');
	}
	constructor() {
		super();
		this.attachShadow({ mode: 'open' }).innerHTML = `<slot></slot><slot name="after"></slot>`;
	}
}
if (!customElements.get('fixture-panel')) customElements.define('fixture-panel', FixturePanel);

function panel(attributes: Record<string, string> = {}, ...children: (Node | string)[]) {
	const element = document.createElement('fixture-panel');
	for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
	element.append(...children);
	return element;
}

export const Default = { render: () => panel() };

export const Disabled = { render: () => panel({ disabled: '' }, 'Label') };

/** Both slots filled, the default one with text only, and `large`. */
export const Filled = {
	render: () => {
		const after = document.createElement('span');
		after.slot = 'after';
		return panel({ size: 'large' }, 'Label', after);
	},
};

export const Changed = {
	render: () => {
		const element = panel({ style: 'display:block;height:20px' });
		element.addEventListener('click', () => element.dispatchEvent(new CustomEvent('changed')));
		return element;
	},
	targets: { control: { selector: 'fixture-panel' } },
	events: [{ type: 'changed', target: 'control' }],
	scenario: [{ id: 'activate', action: { click: 'control' } }, { capture: 'after-click' }],
};

/** A failing case proves nothing: its `small` slot here must not count. */
export const Broken = {
	render: () => panel({ 'data-broken': '' }),
	targets: { missing: { selector: 'no-such-element' } },
	scenario: [{ id: 'never', action: { click: 'missing' } }, { capture: 'after-click' }],
};

class FixtureSimple extends HTMLElement {
	connectedCallback(): void {
		this.style.display = 'block';
		this.style.height = '20px';
	}
}
if (!customElements.get('fixture-simple')) customElements.define('fixture-simple', FixtureSimple);

function simple(open: boolean) {
	const element = document.createElement('fixture-simple');
	if (open) element.setAttribute('open', '');
	return element;
}
const onSimple = { simple: { selector: 'fixture-simple' } };

/** Both of its states verified: the expectation is about this target, in this state. */
export const ClaimedOpen = {
	render: () => simple(true),
	targets: onSimple,
	scenario: [
		{ id: 'is-open', expect: { target: 'simple', state: { attribute: 'open', equals: '' } } },
		{ capture: 'open' },
	],
	coverage: [
		{
			target: 'simple',
			obligation: 'property:open=true',
			checkpoint: 'open',
			expectations: ['is-open'],
		},
	],
};
export const ClaimedClosed = {
	render: () => simple(false),
	targets: onSimple,
	scenario: [
		{ id: 'is-closed', expect: { target: 'simple', state: { attribute: 'open', equals: null } } },
		{ capture: 'closed' },
	],
	coverage: [
		{
			target: 'simple',
			obligation: 'property:open=false',
			checkpoint: 'closed',
			expectations: ['is-closed'],
		},
	],
};

/** It ran and held, but it is about another element: this proves nothing of the panel's size. */
export const ClaimedOtherTarget = {
	render: () => {
		const box = document.createElement('div');
		box.append(panel({ size: 'large' }), simple(true));
		return box;
	},
	targets: { panel: { selector: 'fixture-panel' }, ...onSimple },
	scenario: [
		{ id: 'about-simple', expect: { target: 'simple', state: { attribute: 'open', equals: '' } } },
		{ id: 'panel-exists', expect: { target: 'panel', state: { property: 'mode', equals: 'a' } } },
	],
	coverage: [
		{
			target: 'panel',
			obligation: 'property:size=large',
			checkpoint: 'after-run',
			expectations: ['about-simple'],
		},
	],
};

/** Its expectation is about the target, but the target is not in the state claimed. */
export const ClaimedWrongState = {
	render: () => panel(),
	targets: { panel: { selector: 'fixture-panel' } },
	scenario: [{ id: 'mode', expect: { target: 'panel', state: { property: 'mode', equals: 'a' } } }],
	coverage: [
		{
			target: 'panel',
			obligation: 'property:disabled=true',
			checkpoint: 'after-run',
			expectations: ['mode'],
		},
	],
};

/** A form-associated element: its form obligations come only from real FormData and validity. */
class FixtureClaimedField extends HTMLElement {
	static formAssociated = true;
	readonly #internals = this.attachInternals();
	connectedCallback(): void {
		this.style.display = 'block';
		this.#internals.setFormValue('Water');
		this.#internals.setValidity({ valueMissing: true }, 'Needed.');
	}
	get form() {
		return this.#internals.form;
	}
	checkValidity() {
		return this.#internals.checkValidity();
	}
}
if (!customElements.get('fixture-claimed-field'))
	customElements.define('fixture-claimed-field', FixtureClaimedField);

export const InForm = {
	render: () => {
		const form = document.createElement('form');
		const field = document.createElement('fixture-claimed-field');
		field.setAttribute('name', 'crop');
		form.append(field);
		return form;
	},
	targets: { field: { selector: 'fixture-claimed-field' } },
	scenario: [
		{ id: 'submits', expect: { target: 'field', form: { name: 'crop', value: 'Water' } } },
		{ id: 'invalid', expect: { target: 'field', validity: { valid: false } } },
	],
	coverage: [
		{
			target: 'field',
			obligation: 'form:participation',
			checkpoint: 'after-run',
			expectations: ['submits'],
		},
		// Validity evidence does not prove participation, so this one reads the right expectation.
		{
			target: 'field',
			obligation: 'form:validity',
			checkpoint: 'after-run',
			expectations: ['invalid'],
		},
	],
};

/** Names an obligation this component does not have. */
export const BadClaim = {
	render: () => simple(false),
	targets: onSimple,
	scenario: [
		{ id: 'closed', expect: { target: 'simple', state: { attribute: 'open', equals: null } } },
	],
	coverage: [
		{
			target: 'simple',
			obligation: 'property:nope=1',
			checkpoint: 'after-run',
			expectations: ['closed'],
		},
	],
};
