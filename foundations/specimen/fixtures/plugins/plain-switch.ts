/** A plain custom element with an operation a command runner can call. */
export class PlainSwitch extends HTMLElement {
	#button: HTMLButtonElement;

	constructor() {
		super();
		const root = this.attachShadow({ mode: 'open' });
		this.#button = document.createElement('button');
		this.#button.type = 'button';
		this.#button.setAttribute('role', 'switch');
		this.#button.textContent = 'Watering';
		this.#button.setAttribute('aria-checked', 'false');
		root.append(this.#button);
	}

	get checked(): boolean {
		return this.#button.getAttribute('aria-checked') === 'true';
	}

	set checked(value: boolean) {
		this.#button.setAttribute('aria-checked', String(value));
		this.toggleAttribute('checked', value);
	}

	toggle(): void {
		this.checked = !this.checked;
	}
}

if (!customElements.get('plain-switch')) customElements.define('plain-switch', PlainSwitch);
