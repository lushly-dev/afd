/**
 * A component shaped like a FAST element: its state settles from a promise chain, and its DOM
 * follows on the next frame.
 */
export class DeferredStatus extends HTMLElement {
	status = 'loading';

	connectedCallback(): void {
		void Promise.resolve()
			.then(() => undefined)
			.then(() => {
				this.status = 'ready';
				requestAnimationFrame(() => {
					this.textContent = this.status;
				});
			});
	}
}

customElements.define('deferred-status', DeferredStatus);
