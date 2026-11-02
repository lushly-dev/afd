// Components for the story contract's fixtures: each story file below breaks one rule.

class Plain extends HTMLElement {
	static observedAttributes = ['disabled'];
	connectedCallback(): void {
		if (!this.shadowRoot) this.attachShadow({ mode: 'open' }).innerHTML = '<button>Press</button>';
	}
}
for (const tag of [
	'x-good',
	'x-no-autodocs',
	'x-no-play',
	'x-no-docs',
	'x-no-baseline',
	'x-no-state',
	'x-a11y-off',
	'x-a11y-documented',
	'x-no-export',
	'x-no-story',
	'x-state-cleared',
	'x-state-derived',
])
	if (!customElements.get(tag)) customElements.define(tag, class extends Plain {});

/** Takes part in forms: its rules want real FormData and validity evidence. */
class Field extends HTMLElement {
	static formAssociated = true;
	#internals = this.attachInternals();
	connectedCallback(): void {
		this.#internals.setFormValue('Water');
		this.#internals.setValidity({ valueMissing: true }, 'Needed.');
		if (!this.shadowRoot)
			this.attachShadow({ mode: 'open' }).innerHTML = '<input aria-label="Name">';
	}
	get form(): HTMLFormElement | null {
		return this.#internals.form;
	}
	checkValidity(): boolean {
		return this.#internals.checkValidity();
	}
}
for (const tag of ['x-form-good', 'x-form-silent', 'x-form-text-only'])
	if (!customElements.get(tag)) customElements.define(tag, class extends Field {});
