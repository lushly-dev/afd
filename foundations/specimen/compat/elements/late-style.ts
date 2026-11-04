/**
 * A component shaped like a FAST element that applies its args on its next frame: its text
 * starts dark and dims once it has drawn. With `disabled`, it says so as a custom element must
 * for axe to see it, through `aria-disabled`.
 */
export class LateStyle extends HTMLElement {
	connectedCallback(): void {
		this.textContent = 'Fixture text';
		this.style.color = '#1b1d22';
		void Promise.resolve().then(() => {
			requestAnimationFrame(() => {
				this.style.color = '#b4b4b4';
				if (this.hasAttribute('disabled')) this.setAttribute('aria-disabled', 'true');
			});
		});
	}
}

customElements.define('late-style', LateStyle);
