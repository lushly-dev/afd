/**
 * @fileoverview `loam-part-header`: main's header surface (phase 1 specification, 4.2 and 9.3): a title
 * and up to three actions, the first primary. Its title is not a heading, since an app's main holds its
 * own `h1`. A press is an event, and the shell runs the command. From phase 2 it shows breadcrumbs too, as
 * `violet-breadcrumb` (phase 2 specification, 7.4): the workspace, the project, the app, then each segment
 * of the route, as text, each ancestor a link by the URL scheme, which the router turns into commands.
 */

import { attr, css, FASTElement, html, observable, repeat } from '@lushly-dev/fast-element';
import '@lushly-dev/violet-elements/dist/breadcrumb/violet-breadcrumb.js';
import { actionButton } from '../apps/action-styles.js';

/** One breadcrumb: its text, and where an ancestor links. The last has no link. */
export interface PartHeaderCrumb {
	label: string;
	href?: string;
}

export interface PartHeaderAction {
	command: string;
	label: string;
	/** The command needs input, so a press cannot run it. */
	disabled?: boolean;
}

export const PART_ACTION_EVENT = 'loam-part-action';

const actionTemplate = html<PartHeaderAction, LoamPartHeader>`
	<button
		class="${(x, c) => (c.parent.actions[0] === x ? 'action primary' : 'action')}"
		type="button"
		data-command="${(x) => x.command}"
		aria-disabled="${(x) => (x.disabled ? 'true' : null)}"
		title="${(x) => (x.disabled ? 'This command needs input; run it from its own form' : null)}"
		@click="${(x, c) => c.parent.press(x)}"
	>
		${(x) => x.label}
	</button>
`;

const crumbTemplate = html<PartHeaderCrumb>`
	<violet-breadcrumb-item href="${(x) => x.href ?? ''}" ?current="${(x) => x.href === undefined}"
		>${(x) => x.label}</violet-breadcrumb-item
	>
`;

const template = html<LoamPartHeader>`
	<violet-breadcrumb class="crumbs" label="Location" ?hidden="${(x) => x.crumbs.length === 0}">
		${repeat((x) => x.crumbs, crumbTemplate)}
	</violet-breadcrumb>
	<span class="title" ?hidden="${(x) => x.crumbs.at(-1)?.label === x.heading}"
		>${(x) => x.heading}</span
	>
	<span class="actions">${repeat((x) => x.actions, actionTemplate)}</span>
`;

const styles = [
	actionButton,
	css`
		:host {
			display: flex;
			flex: none;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-inline-sm);
			min-block-size: var(--shell-size-titlebar);
			padding-block: var(--space-stack-xs);
			padding-inline: var(--space-layout-sm);
			border-block-end: 1px solid var(--color-border-subtle);
			background: var(--color-surface-card);
			color: var(--color-text-primary);
		}
		:host([hidden]) {
			display: none;
		}
		.title {
			flex: 1;
			min-inline-size: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: var(--type-label-sm-size);
			line-height: var(--type-label-sm-line);
			font-weight: var(--weight-semibold);
		}
		.crumbs {
			flex-basis: 100%;
			font-size: var(--type-label-sm-size);
			line-height: var(--type-label-sm-line);
		}
		.crumbs[hidden] {
			display: none;
		}
		/* Each ancestor a target of 24 pixels at least (WCAG 2.5.8). */
		violet-breadcrumb-item::part(link) {
			display: inline-flex;
			align-items: center;
			min-block-size: var(--size-target-compact);
		}
		.actions {
			display: inline-flex;
			flex-wrap: wrap;
			gap: var(--space-inline-sm);
		}
		@media (forced-colors: active) {
			:host {
				border-block-end-color: CanvasText;
				background: Canvas;
				color: CanvasText;
			}
		}
	`,
];

export class LoamPartHeader extends FASTElement {
	declare heading: string;
	declare actions: PartHeaderAction[];
	/** Where the app is (phase 2 specification, 7.4); empty, none. */
	declare crumbs: PartHeaderCrumb[];

	constructor() {
		super();
		this.heading = '';
		this.actions = [];
		this.crumbs = [];
	}

	press(action: PartHeaderAction): void {
		if (action.disabled) return;
		this.dispatchEvent(
			new CustomEvent(PART_ACTION_EVENT, {
				detail: { command: action.command },
				bubbles: true,
				composed: true,
			})
		);
	}
}
attr(LoamPartHeader.prototype, 'heading');
observable(LoamPartHeader.prototype, 'actions');
observable(LoamPartHeader.prototype, 'crumbs');

export const partHeaderDefinition = { name: 'loam-part-header', template, styles } as const;
