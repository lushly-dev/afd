/**
 * @fileoverview `loam-status-action`: a status item with a command (phase 1 specification, 9.3), a
 * button that shows the same muted label and value `loam-status-item` does. A press is an event, and
 * the shell runs the command.
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';

export const STATUS_ACTION_EVENT = 'loam-status-action';

const template = html<LoamStatusAction>`
	<button
		class="action"
		type="button"
		aria-disabled="${(x) => (x.disabled ? 'true' : null)}"
		@click="${(x) => x.press()}"
	>
		<span class="label">${(x) => x.label}</span>
		<span class="value"><slot></slot></span>
	</button>
`;

const styles = css`
	:host {
		display: inline-flex;
	}
	:host([hidden]) {
		display: none;
	}
	.action {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		gap: var(--size-space-sm);
		min-block-size: var(--size-target-compact);
		padding-block: 0;
		padding-inline: var(--space-inline-sm);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: var(--type-caption-xs-size);
		line-height: var(--type-caption-xs-line);
		font-weight: var(--type-caption-xs-weight);
		white-space: nowrap;
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--easing-standard);
	}
	.label {
		color: var(--color-text-muted);
	}
	.action:hover {
		background: var(--color-action-secondary-hover);
		color: var(--color-text-primary);
	}
	.action:hover .label,
	.action:active .label {
		color: var(--color-text-secondary);
	}
	.action:active {
		background: var(--color-action-secondary-pressed);
		color: var(--color-text-primary);
	}
	.action:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
	}
	.action[aria-disabled='true'] {
		opacity: 0.55;
		cursor: not-allowed;
		background: transparent;
	}
	@media (forced-colors: active) {
		.action,
		.label {
			color: ButtonText;
		}
		.action {
			border-color: ButtonText;
			background: ButtonFace;
		}
		.action:hover,
		.action:active {
			border-color: Highlight;
			background: Highlight;
			color: HighlightText;
		}
		.action:hover .label,
		.action:active .label {
			color: HighlightText;
		}
		.action:focus-visible {
			outline-color: Highlight;
		}
		.action[aria-disabled='true'],
		.action[aria-disabled='true'] .label {
			border-color: GrayText;
			color: GrayText;
		}
	}
`;

export class LoamStatusAction extends FASTElement {
	declare label: string;
	declare command: string;
	declare disabled: boolean;

	constructor() {
		super();
		this.label = '';
		this.command = '';
		this.disabled = false;
	}

	press(): void {
		if (this.disabled) return;
		this.dispatchEvent(
			new CustomEvent(STATUS_ACTION_EVENT, {
				detail: { command: this.command },
				bubbles: true,
				composed: true,
			})
		);
	}
}
attr(LoamStatusAction.prototype, 'label');
attr(LoamStatusAction.prototype, 'command');
attr({ mode: 'boolean' })(LoamStatusAction.prototype, 'disabled');

export const statusActionDefinition = {
	name: 'loam-status-action',
	template,
	styles,
} as const;
