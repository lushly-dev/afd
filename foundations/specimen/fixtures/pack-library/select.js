// The example library's select and its options. A select is a combobox named by its label.
class ExampleOption extends HTMLElement {
	static observedAttributes = ['disabled', 'selected', 'value'];
	#internals = this.attachInternals();
	constructor() {
		super();
		this.attachShadow({ mode: 'open' }).innerHTML =
			'<style>:host { display: block; padding: 2px 6px; }</style><slot></slot>';
		this.#internals.role = 'option';
	}
	connectedCallback() {
		this.#sync();
	}
	attributeChangedCallback() {
		this.#sync();
	}
	#sync() {
		this.#internals.ariaDisabled = this.disabled ? 'true' : null;
		this.#internals.ariaSelected = this.selected ? 'true' : 'false';
	}
	get disabled() {
		return this.hasAttribute('disabled');
	}
	set disabled(value) {
		this.toggleAttribute('disabled', Boolean(value));
	}
	get selected() {
		return this.hasAttribute('selected');
	}
	set selected(value) {
		this.toggleAttribute('selected', Boolean(value));
	}
	get value() {
		return this.getAttribute('value') ?? '';
	}
	set value(next) {
		if (next == null) this.removeAttribute('value');
		else this.setAttribute('value', String(next));
	}
}
if (!customElements.get('example-option')) customElements.define('example-option', ExampleOption);

class ExampleSelect extends HTMLElement {
	static formAssociated = true;
	static observedAttributes = ['label', 'open', 'value', 'disabled', 'required'];
	#internals = this.attachInternals();
	#activeIndex = -1;
	constructor() {
		super();
		// The options sit in a group of their own, so they are read as options and not as the control's text.
		this.attachShadow({ mode: 'open', delegatesFocus: true }).innerHTML =
			'<style>:host { display: inline-flex; flex-direction: column; min-height: 36px; max-width: 100%; box-sizing: border-box; margin: 0; } [part="value"] { display: inline-flex; align-items: center; min-height: 20px; outline: none; } [role="group"] { display: flex; flex-direction: column; }</style><span part="value" tabindex="0"></span><div role="group"><slot></slot></div>';
		this.#internals.role = 'combobox';
		this.addEventListener('click', (event) => {
			if (this.disabled) return;
			const option =
				event.target instanceof Element ? event.target.closest('example-option') : null;
			if (this.open && option && this.contains(option)) {
				if (option.disabled) return;
				this.#commitOption(option);
				this.focus();
				return;
			}
			this.toggleAttribute('open');
			if (this.open) this.#syncActiveToSelected();
			this.focus();
			this.dispatchEvent(
				new CustomEvent('change', { detail: this.value, bubbles: true, composed: true })
			);
		});
		this.addEventListener('keydown', (event) => {
			if (this.disabled) return;
			const enabled = this.#enabledOptions();
			switch (event.key) {
				case 'ArrowDown':
					event.preventDefault();
					if (!this.open) {
						this.setAttribute('open', '');
						this.#setActiveIndex(this.#selectedEnabledIndex(enabled), enabled);
					} else if (enabled.length > 0) {
						this.#setActiveIndex((this.#activeIndex + 1) % enabled.length, enabled);
					}
					break;
				case 'ArrowUp':
					event.preventDefault();
					if (!this.open) {
						this.setAttribute('open', '');
						const selectedIdx = this.#selectedEnabledIndex(enabled);
						this.#setActiveIndex(selectedIdx >= 0 ? selectedIdx : enabled.length - 1, enabled);
					} else if (enabled.length > 0) {
						const prev = this.#activeIndex <= 0 ? enabled.length - 1 : this.#activeIndex - 1;
						this.#setActiveIndex(prev, enabled);
					}
					break;
				case 'Home':
					if (this.open && enabled.length > 0) {
						event.preventDefault();
						this.#setActiveIndex(0, enabled);
					}
					break;
				case 'End':
					if (this.open && enabled.length > 0) {
						event.preventDefault();
						this.#setActiveIndex(enabled.length - 1, enabled);
					}
					break;
				case 'Enter':
				case ' ':
					event.preventDefault();
					if (!this.open) {
						this.setAttribute('open', '');
						this.#syncActiveToSelected();
					} else {
						const current = enabled[this.#activeIndex] ?? enabled[0];
						if (current) this.#commitOption(current);
						else this.removeAttribute('open');
					}
					break;
				case 'Escape':
					if (this.open) {
						event.preventDefault();
						this.removeAttribute('open');
						this.#activeIndex = -1;
						this.focus();
					}
					break;
			}
		});
	}
	connectedCallback() {
		this.#sync();
	}
	attributeChangedCallback() {
		this.#sync();
	}
	#options() {
		return Array.from(this.querySelectorAll('example-option'));
	}
	#enabledOptions() {
		return this.#options().filter((option) => !option.disabled);
	}
	#selectedEnabledIndex(enabled) {
		const idx = enabled.findIndex(
			(option) => option.selected || (this.value !== '' && option.value === this.value)
		);
		return Math.max(idx, 0);
	}
	#syncActiveToSelected() {
		const enabled = this.#enabledOptions();
		this.#setActiveIndex(enabled.length > 0 ? this.#selectedEnabledIndex(enabled) : -1, enabled);
	}
	#setActiveIndex(index, enabled) {
		if (!enabled.length || index < 0 || index >= enabled.length) {
			this.#activeIndex = -1;
			return;
		}
		this.#activeIndex = index;
		const active = enabled[index];
		for (const option of this.#options()) {
			option.dataset.active = option === active ? 'true' : 'false';
		}
	}
	#commitOption(option) {
		for (const item of this.#options()) {
			item.toggleAttribute('selected', item === option);
		}
		this.setAttribute('value', option.value);
		this.removeAttribute('open');
		this.#activeIndex = -1;
		this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		this.dispatchEvent(
			new CustomEvent('change', { detail: this.value, bubbles: true, composed: true })
		);
	}
	#sync() {
		this.#internals.ariaLabel = this.getAttribute('label');
		this.#internals.ariaExpanded = this.open ? 'true' : 'false';
		this.#internals.ariaDisabled = this.disabled ? 'true' : null;
		this.#internals.ariaRequired = this.required ? 'true' : null;
		this.#internals.setFormValue(this.disabled ? null : this.value);
		const trigger = this.shadowRoot?.querySelector('[part="value"]');
		if (trigger) {
			trigger.tabIndex = this.disabled ? -1 : 0;
		}
		if (this.required && !this.disabled && this.value === '') {
			this.#internals.setValidity({ valueMissing: true }, 'Please select an option.');
		} else {
			this.#internals.setValidity({});
		}
	}
	get form() {
		return this.#internals.form;
	}
	checkValidity() {
		this.#sync();
		return this.#internals.checkValidity();
	}
	reportValidity() {
		this.#sync();
		return this.#internals.reportValidity();
	}
	get disabled() {
		return this.hasAttribute('disabled');
	}
	set disabled(value) {
		this.toggleAttribute('disabled', Boolean(value));
	}
	get open() {
		return this.hasAttribute('open');
	}
	set open(value) {
		this.toggleAttribute('open', Boolean(value));
	}
	get required() {
		return this.hasAttribute('required');
	}
	set required(value) {
		this.toggleAttribute('required', Boolean(value));
	}
	get value() {
		return this.getAttribute('value') ?? '';
	}
	set value(next) {
		if (next == null) this.removeAttribute('value');
		else this.setAttribute('value', String(next));
	}
}
if (!customElements.get('example-select')) customElements.define('example-select', ExampleSelect);
