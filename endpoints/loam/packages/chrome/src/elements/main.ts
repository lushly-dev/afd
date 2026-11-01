/**
 * @fileoverview `loam-main`: `main`. With no app installed it shows the empty-shell landing, "No
 * apps yet" and the palette shortcut; any path but `/` shows "Nothing here" with a link home
 * (5.1, section 7).
 */

import { attr, css, FASTElement, html, when } from '@lushly-dev/fast-element';
import type { RouteV0 } from '../router.js';
import { partHost } from './styles.js';

const template = html<LoamMain>`
	${when(
		(x) => x.route !== 'not-found',
		html<LoamMain>`
			<section class="landing" aria-labelledby="landing-heading">
				<h1 id="landing-heading">No apps yet</h1>
				<p>
					Press <kbd>${(x) => x.shortcut}</kbd> to open the command palette and run a shell
					command.
				</p>
			</section>
		`
	)}
	${when(
		(x) => x.route === 'not-found',
		html<LoamMain>`
			<section class="landing" aria-labelledby="landing-heading">
				<h1 id="landing-heading">Nothing here</h1>
				<p>This address has no page in Loam yet.</p>
				<p><a href="${(x) => x.home}">Go to the start page</a></p>
			</section>
		`
	)}
	<slot></slot>
`;

const styles = [
	partHost,
	css`
		:host {
			display: block;
			overflow: auto;
			padding: var(--space-layout-md);
			background: var(--color-surface-page);
			color: var(--color-text-primary);
		}
		.landing {
			display: grid;
			gap: var(--space-stack-sm);
			max-inline-size: var(--shell-size-main-min);
			margin-inline: auto;
			margin-block-start: var(--space-layout-md);
		}
		h1 {
			margin: 0;
			font-size: var(--type-title-md-size);
			line-height: var(--type-title-md-line);
			font-weight: var(--type-title-md-weight);
		}
		p {
			margin: 0;
			color: var(--color-text-secondary);
			font-size: var(--type-body-md-size);
			line-height: var(--type-body-md-line);
		}
		kbd {
			font: inherit;
			font-weight: var(--weight-semibold);
			color: var(--color-text-primary);
		}
		a {
			color: var(--color-text-primary);
			text-decoration: underline;
			text-underline-offset: var(--size-space-xs);
			border-radius: var(--radius-sm);
		}
		a:hover {
			text-decoration-thickness: var(--size-space-xs);
		}
		a:focus-visible {
			outline: var(--shell-size-focus) solid var(--color-focus-ring);
			outline-offset: var(--size-space-xs);
		}
		@media (forced-colors: active) {
			:host,
			p,
			kbd {
				background: Canvas;
				color: CanvasText;
			}
			a {
				color: LinkText;
			}
			a:focus-visible {
				outline-color: Highlight;
			}
		}
	`,
];

export class LoamMain extends FASTElement {
	declare route: RouteV0;
	declare shortcut: string;
	declare home: string;

	constructor() {
		super();
		this.route = 'home';
		this.shortcut = 'Ctrl+K';
		this.home = './';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'main');
	}
}
attr(LoamMain.prototype, 'route');
attr(LoamMain.prototype, 'shortcut');
attr(LoamMain.prototype, 'home');

export const mainDefinition = { name: 'loam-main', template, styles } as const;
