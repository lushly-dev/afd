// The example library's text field: form-associated, named by its label attribute.
class ExampleField extends HTMLElement {
	static formAssociated = true;
	static observedAttributes = ['label', 'invalid', 'value', 'disabled', 'required', 'readonly'];
	#internals = this.attachInternals();
	#value = '';
	#accessibleName;
	constructor() {
		super();
		this.attachShadow({ mode: 'open', delegatesFocus: true }).innerHTML =
			'<style>:host { display: inline-flex; flex-direction: column; min-height: 36px; max-width: 100%; box-sizing: border-box; margin: 0; } [part="value"] { display: inline-block; min-height: 20px; min-width: 4ch; max-width: 100%; outline: none; white-space: pre-wrap; overflow-wrap: anywhere; }</style><span part="value" contenteditable="plaintext-only" tabindex="0"></span><slot name="hint"></slot>';
		this.#internals.role = 'textbox';
		const shown = this.shadowRoot?.querySelector('[part="value"]');
		if (shown) {
			shown.addEventListener('input', () => {
				if (this.disabled || this.readOnly) {
					shown.textContent = this.#value;
					return;
				}
				const next = shown.textContent ?? '';
				this.#value = next;
				this.#syncInternals();
				this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
				this.dispatchEvent(
					new CustomEvent('change', { detail: this.#value, bubbles: true, composed: true })
				);
			});
			shown.addEventListener('keydown', (event) => {
				if (this.disabled || this.readOnly) return;
				if (event.key === 'Enter') {
					event.preventDefault();
					this.dispatchEvent(
						new CustomEvent('change', { detail: this.#value, bubbles: true, composed: true })
					);
				}
			});
		}
		this.addEventListener('click', () => {
			if (this.disabled) return;
			this.dispatchEvent(
				new CustomEvent('change', { detail: this.value, bubbles: true, composed: true })
			);
		});
	}
	connectedCallback() {
		if (this.hasAttribute('value')) this.#value = this.getAttribute('value') ?? '';
		this.#sync();
	}
	attributeChangedCallback(name, _oldValue, newValue) {
		if (name === 'value') this.#value = newValue ?? '';
		this.#sync();
	}
	#syncInternals() {
		this.#internals.ariaLabel =
			this.#accessibleName !== undefined ? this.#accessibleName : this.getAttribute('label');
		this.#internals.ariaInvalid = this.invalid ? 'true' : null;
		this.#internals.ariaDisabled = this.disabled ? 'true' : null;
		this.#internals.ariaRequired = this.required ? 'true' : null;
		this.#internals.ariaReadOnly = this.readOnly ? 'true' : null;
		this.#internals.setFormValue(this.disabled ? null : this.#value);
		if (this.required && !this.disabled && this.#value === '') {
			this.#internals.setValidity({ valueMissing: true }, 'Please fill out this field.');
		} else {
			this.#internals.setValidity({});
		}
	}
	#sync() {
		this.#syncInternals();
		const shown = this.shadowRoot?.querySelector('[part="value"]');
		if (shown) {
			if (shown.textContent !== this.#value) shown.textContent = this.#value;
			shown.contentEditable = this.disabled || this.readOnly ? 'false' : 'plaintext-only';
			shown.tabIndex = this.disabled ? -1 : 0;
		}
	}
	/** A name given by a property, in place of the label: markup cannot carry it. */
	set accessibleName(value) {
		this.#accessibleName = value;
		this.#internals.ariaLabel = value;
	}
	get form() {
		return this.#internals.form;
	}
	checkValidity() {
		this.#syncInternals();
		return this.#internals.checkValidity();
	}
	reportValidity() {
		this.#syncInternals();
		return this.#internals.reportValidity();
	}
	get disabled() {
		return this.hasAttribute('disabled');
	}
	set disabled(value) {
		this.toggleAttribute('disabled', Boolean(value));
	}
	get invalid() {
		return this.hasAttribute('invalid');
	}
	set invalid(value) {
		this.toggleAttribute('invalid', Boolean(value));
	}
	get required() {
		return this.hasAttribute('required');
	}
	set required(value) {
		this.toggleAttribute('required', Boolean(value));
	}
	get readOnly() {
		return this.hasAttribute('readonly');
	}
	set readOnly(value) {
		this.toggleAttribute('readonly', Boolean(value));
	}
	get size() {
		return this.getAttribute('size') ?? 'medium';
	}
	get value() {
		return this.#value;
	}
	set value(next) {
		this.#value = next == null ? '' : String(next);
		this.#sync();
	}
}
if (!customElements.get('example-field')) customElements.define('example-field', ExampleField);
