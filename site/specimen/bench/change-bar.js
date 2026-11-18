/**
 * <change-bar>: the component the Specimen pages observe.
 *
 * A bar that says some changes are waiting, with a way to save them, discard
 * them or put the bar away. It is small on purpose, and built the way a real
 * one is: an open shadow root, styles in an adopted stylesheet, spacing and
 * corners read from custom properties, a role of its own and three events.
 *
 * Attributes: `label` (the main button's text), `save-disabled`, and
 * `dismiss-label` (the icon button's accessible name; an empty value leaves it
 * unnamed). Events: `save`, `discard` and `dismiss`.
 *
 * `disabled` is how the bar was first written, and it is kept so the pages can
 * show what Specimen found: it disables Save and nothing else, yet Chromium
 * reports every button in a shadow root as disabled when the host carries a
 * `disabled` attribute. `save-disabled` is the fix.
 */

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
	:host {
		display: block;
		color: light-dark(#17120f, #f3ede2);
		font: 500 14px/20px system-ui, sans-serif;
	}
	/* The AFD site's Refined look: a rounded bar that floats, keys instead of outlines. */
	.bar {
		display: flex;
		align-items: center;
		gap: var(--bar-gap, 8px);
		padding: var(--bar-pad, 12px);
		border: 1px solid light-dark(rgb(23 18 15 / 0.12), rgb(243 237 226 / 0.16));
		border-radius: calc(var(--bar-radius, 8px) + 4px);
		background: light-dark(#fffaf0, #211b17);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 8px 20px -10px rgb(0 0 0 / 0.3);
	}
	p {
		flex: 1;
		margin: 0;
	}
	button {
		min-height: 32px;
		padding: 5px 12px;
		border: 1px solid transparent;
		border-radius: var(--bar-radius, 8px);
		background: light-dark(rgb(23 18 15 / 0.07), rgb(243 237 226 / 0.1));
		color: inherit;
		font: inherit;
	}
	.keep {
		background: light-dark(#17120f, #f3ede2);
		color: light-dark(#fffaf0, #211b17);
		box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.14), 0 1px 0 rgb(0 0 0 / 0.16), 0 2px 5px -1px rgb(0 0 0 / 0.24);
	}
	.keep:disabled {
		opacity: 0.4;
		box-shadow: none;
	}
	.away {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
	}
	svg {
		width: 16px;
		height: 16px;
	}
	@media (prefers-contrast: more) {
		.bar {
			border: 2px solid currentColor;
			background: #fff;
			box-shadow: none;
		}
		:host {
			color: #000;
		}
		button {
			border-color: currentColor;
		}
	}
	@media (forced-colors: active) {
		.bar,
		button {
			border-color: CanvasText;
		}
	}
`);

/** Which event each button sends. */
const EVENTS = { keep: 'save', drop: 'discard', away: 'dismiss' };

class ChangeBar extends HTMLElement {
	static observedAttributes = ['label', 'disabled', 'save-disabled', 'dismiss-label'];

	constructor() {
		super();
		this.attachInternals().role = 'group';
		const root = this.attachShadow({ mode: 'open' });
		root.adoptedStyleSheets = [sheet];
		root.innerHTML = [
			'<div class="bar">',
			'<p><slot></slot></p>',
			'<button class="drop" type="button">Discard</button>',
			'<button class="keep" type="button">Save</button>',
			'<button class="away" type="button" aria-label="Dismiss">',
			'<svg viewBox="0 0 16 16" aria-hidden="true">',
			'<path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="1.5"/>',
			'</svg>',
			'</button>',
			'</div>',
		].join('');
		root.addEventListener('click', (event) => {
			const button = event.target.closest('button');
			if (button) this.dispatchEvent(new CustomEvent(EVENTS[button.className], { bubbles: true, composed: true }));
		});
	}

	attributeChangedCallback() {
		const keep = this.shadowRoot.querySelector('.keep');
		const away = this.shadowRoot.querySelector('.away');
		keep.textContent = this.label;
		keep.disabled = this.disabled || this.saveDisabled;
		if (this.dismissLabel) away.setAttribute('aria-label', this.dismissLabel);
		else away.removeAttribute('aria-label');
	}

	get label() {
		return this.getAttribute('label') ?? 'Save';
	}

	get saveDisabled() {
		return this.hasAttribute('save-disabled');
	}

	get dismissLabel() {
		return this.getAttribute('dismiss-label') ?? 'Dismiss';
	}

	get disabled() {
		return this.hasAttribute('disabled');
	}
}

if (!customElements.get('change-bar')) customElements.define('change-bar', ChangeBar);
