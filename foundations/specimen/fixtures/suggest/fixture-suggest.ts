/** A component with each kind of obligation, for specimen-suggest to propose cases for. */
class FixtureSuggest extends HTMLElement {
	static formAssociated = true;
	mode = 'a';
	#internals = this.attachInternals();
	connectedCallback(): void {
		this.style.display = 'block';
		this.style.minHeight = '20px';
		this.#internals.setFormValue('Water');
		if (!this.shadowRoot)
			this.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot><slot name="after"></slot>';
		this.addEventListener('click', () => this.dispatchEvent(new CustomEvent('changed')));
	}
	get form(): HTMLFormElement | null {
		return this.#internals.form;
	}
	checkValidity(): boolean {
		return this.#internals.checkValidity();
	}
}
if (!customElements.get('fixture-suggest'))
	customElements.define('fixture-suggest', FixtureSuggest);
