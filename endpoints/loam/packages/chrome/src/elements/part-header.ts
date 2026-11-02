/**
 * @fileoverview `loam-part-header`: main's header surface (phase 1 specification, 4.2 and 9.3): a title
 * and up to three actions, the first primary. Its title is not a heading, since an app's main holds its
 * own `h1`. A press is an event, and the shell runs the command.
 */

import { attr, css, FASTElement, html, observable, repeat } from '@lushly-dev/fast-element';
import { actionButton } from '../apps/action-styles.js';

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

const template = html<LoamPartHeader>`
	<span class="title">${(x) => x.heading}</span>
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

	constructor() {
		super();
		this.heading = '';
		this.actions = [];
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

export const partHeaderDefinition = { name: 'loam-part-header', template, styles } as const;
