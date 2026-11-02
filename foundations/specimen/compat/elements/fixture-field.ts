/** A form-associated custom element: its value takes part in the owning form's data. */
export class FixtureField extends HTMLElement {
	static formAssociated = true;
	#internals = this.attachInternals();
	#input: HTMLInputElement;

	constructor() {
		super();
		const root = this.attachShadow({ mode: 'open', delegatesFocus: true });
		const label = document.createElement('label');
		label.textContent = 'Plant name';
		this.#input = document.createElement('input');
		this.#input.addEventListener('input', () => this.#sync());
		label.append(this.#input);
		root.append(label);
	}

	get value(): string {
		return this.#input.value;
	}

	set value(value: string) {
		this.#input.value = value;
		this.#sync();
	}

	#sync(): void {
		this.#internals.setFormValue(this.#input.value);
	}
}

if (!customElements.get('fixture-field')) customElements.define('fixture-field', FixtureField);
