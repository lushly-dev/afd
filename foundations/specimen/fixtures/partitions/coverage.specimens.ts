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
