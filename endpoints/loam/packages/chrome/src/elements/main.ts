/**
 * @fileoverview `loam-main`: `main`. With no app active it shows the landing, "No apps yet" or the
 * app surfaces' "Choose an app", and the palette shortcut; a URL that names nothing here shows "Nothing here" with a link home
 * (5.1, section 7). `busy` hides the landing and sets `aria-busy` while a persisted owner's surface is
 * on its way, so no landing flashes before an app (phase 2 specification, 2.2).
 */

import { attr, css, FASTElement, html, when } from '@lushly-dev/fast-element';
import { dispatchAction } from './events.js';
import { partHost, quietButton } from './styles.js';

/** What a `provider` deployment's main shows in place of the landing (phase 3 specification, 2.1, 2.3). */
const GATES = {
	'sign-in': ['Sign in to %', 'This workspace is for the members of %.'],
	'not-member': ['You are not a member of %', 'Ask an owner of % to invite you.'],
	binding: [
		'This workspace is not set up',
		'% is not bound on the server; an owner fixes it there.',
	],
} as const;
// A gate cleared while its view is still bound (an invitation accepted) reads as nothing until the view goes.
const gate = (x: LoamMain, line: 0 | 1) =>
	(GATES[x.gate as keyof typeof GATES]?.[line] ?? '').replace('%', x.organization);

const template = html<LoamMain>`
	${when(
		(x) => x.gate !== '',
		// Written tight: a template's whitespace is first paint's bytes (13).
		html<LoamMain>`<section class="landing" aria-labelledby="landing-heading"><h1 id="landing-heading">${(
			x
		) => gate(x, 0)}</h1><p>${(x) => gate(x, 1)}</p>${when(
			(x) => x.gate !== 'binding',
			html<LoamMain>`<p><button class="quiet sign-in" type="button" @click="${(x) =>
				dispatchAction(x, {
					action: x.gate === 'sign-in' ? 'sign-in' : 'invitations',
				})}">${(x) => (x.gate === 'sign-in' ? 'Sign in' : 'Show your invitations')}</button></p>`
		)}</section>`
	)}
	${when(
		(x) => x.route !== 'not-found' && x.gate === '',
		html<LoamMain>`
			<section class="landing" aria-labelledby="landing-heading">
				<h1 id="landing-heading">${(x) => x.landing}</h1>
				<p>
					Press <kbd>${(x) => x.shortcut}</kbd> to open the command palette and run a shell
					command.
				</p>
				${when((x) => x.notice !== '', html<LoamMain>`<p role="note">${(x) => x.notice}</p>`)}
			</section>
		`
	)}
	${when(
		(x) => x.route === 'not-found' && x.gate === '',
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
	quietButton,
	css`
		.sign-in {
			border-color: var(--color-action-secondary-border);
		}
		:host {
			display: block;
			overflow: auto;
			padding: var(--space-layout-md);
			background: var(--color-surface-page);
			color: var(--color-text-primary);
		}
		:host([busy]) .landing {
			display: none;
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
	/** `not-found` when the URL names nothing this person can open (phase 2 specification, 6.1). */
	declare route: 'home' | 'not-found';
	declare shortcut: string;
	declare home: string;
	declare landing: string;
	declare busy: boolean;
	/**
	 * In a `provider` deployment, what main shows in place of the landing (phase 3 specification, 2.1, 2.3, 15):
	 * `sign-in` signed out, `not-member` signed in with no membership, `binding` with no organization bound.
	 */
	declare gate: '' | keyof typeof GATES;
	/** The bound organization's slug, as the deployment names it, for display. */
	declare organization: string;
	/** A line under the landing: an owner's binding notice (2.3). */
	declare notice: string;

	constructor() {
		super();
		this.landing = 'No apps yet';
		this.route = 'home';
		this.shortcut = 'Ctrl+K';
		this.home = './';
		this.busy = false;
		this.gate = '';
		this.organization = '';
		this.notice = '';
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'main');
		this.busyChanged();
	}

	busyChanged(): void {
		// An element may not gain an attribute in its constructor; `connectedCallback` sets it.
		if (!this.$fastController?.isConnected) return;
		if (this.busy) this.setAttribute('aria-busy', 'true');
		else if (this.dataset.app === undefined) this.removeAttribute('aria-busy');
	}
}
attr(LoamMain.prototype, 'route');
attr(LoamMain.prototype, 'shortcut');
attr(LoamMain.prototype, 'home');
attr(LoamMain.prototype, 'landing');
attr({ mode: 'boolean' })(LoamMain.prototype, 'busy');
attr(LoamMain.prototype, 'gate');
attr(LoamMain.prototype, 'organization');
attr(LoamMain.prototype, 'notice');

export const mainDefinition = { name: 'loam-main', template, styles } as const;
