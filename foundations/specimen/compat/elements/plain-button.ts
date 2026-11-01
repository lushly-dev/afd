/** A plain custom element with no framework: a labelled button. */
export class PlainButton extends HTMLElement {
	#label = 'Button';
	#button: HTMLButtonElement;

	constructor() {
		super();
		const root = this.attachShadow({ mode: 'open' });
		this.#button = document.createElement('button');
		this.#button.type = 'button';
		this.#button.textContent = this.#label;
		root.append(this.#button);
	}

	get label(): string {
		return this.#label;
	}

	set label(value: string) {
		this.#label = value;
		this.#button.textContent = value;
	}
}

if (!customElements.get('plain-button')) customElements.define('plain-button', PlainButton);
