// The example library's select and its options. A select is a combobox named by its label.
class ExampleOption extends HTMLElement {
	#internals = this.attachInternals();
	constructor() {
		super();
		this.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot>';
		this.#internals.role = 'option';
	}
	get disabled() {
		return this.hasAttribute('disabled');
	}
	get selected() {
		return this.hasAttribute('selected');
	}
}
if (!customElements.get('example-option')) customElements.define('example-option', ExampleOption);

class ExampleSelect extends HTMLElement {
	static formAssociated = true;
	static observedAttributes = ['label', 'open', 'value'];
	#internals = this.attachInternals();
	constructor() {
		super();
		// The options sit in a group of their own, so they are read as options and not as the control's text.
		this.attachShadow({ mode: 'open' }).innerHTML = '<div role="group"><slot></slot></div>';
		this.#internals.role = 'combobox';
		this.addEventListener('click', () => {
			if (this.disabled) return;
			this.toggleAttribute('open');
			this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true }));
		});
	}
	attributeChangedCallback() {
		this.#internals.ariaLabel = this.getAttribute('label');
		this.#internals.ariaExpanded = this.open ? 'true' : 'false';
		this.#internals.setFormValue(this.value);
	}
	get disabled() {
		return this.hasAttribute('disabled');
	}
	get open() {
		return this.hasAttribute('open');
	}
	get required() {
		return this.hasAttribute('required');
	}
	get value() {
		return this.getAttribute('value') ?? '';
	}
}
if (!customElements.get('example-select')) customElements.define('example-select', ExampleSelect);
