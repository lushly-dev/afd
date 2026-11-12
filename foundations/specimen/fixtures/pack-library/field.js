// The example library's text field: form-associated, named by its label attribute.
class ExampleField extends HTMLElement {
	static formAssociated = true;
	static observedAttributes = ['label', 'invalid', 'value'];
	#internals = this.attachInternals();
	constructor() {
		super();
		this.attachShadow({ mode: 'open' }).innerHTML =
			'<span part="value"></span><slot name="hint"></slot>';
		this.#internals.role = 'textbox';
		this.addEventListener('click', () => {
			if (this.disabled) return;
			this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true }));
		});
	}
	attributeChangedCallback() {
		this.#internals.ariaLabel = this.getAttribute('label');
		this.#internals.ariaInvalid = this.invalid ? 'true' : null;
		this.#internals.setFormValue(this.value);
		const shown = this.shadowRoot?.querySelector('span');
		if (shown) shown.textContent = this.value;
	}
	/** A name given by a property, in place of the label: markup cannot carry it. */
	set accessibleName(value) {
		this.#internals.ariaLabel = value;
	}
	get disabled() {
		return this.hasAttribute('disabled');
	}
	get invalid() {
		return this.hasAttribute('invalid');
	}
	get size() {
		return this.getAttribute('size') ?? 'medium';
	}
	get value() {
		return this.getAttribute('value') ?? '';
	}
}
if (!customElements.get('example-field')) customElements.define('example-field', ExampleField);
