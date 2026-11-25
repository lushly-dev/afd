/**
 * @fileoverview `loam-status-item`: one item of the status bar, its label read before its value
 * (design.md, component list). It is no control itself, and does not animate; its value may hold one, as the
 * project's item holds a button to the project's home.
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';

const template = html<LoamStatusItem>`
	<span class="label" ?hidden="${(x) => !x.label}">${(x) => x.label}</span>
	<span class="value"><slot></slot></span>
`;

// `.value` ends in an ellipsis, so it clips at its own box: a slotted control's focus ring must sit
// inside it (the project's button draws its ring at -2px). A comment in the CSS would ship with it.
const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: var(--violet-space-inline-tight);
		min-block-size: var(--violet-size-target-compact);
		padding-inline: var(--violet-space-inline-tight);
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-caption-size);
		line-height: var(--violet-type-caption-line);
		font-weight: var(--violet-type-caption-weight);
		white-space: nowrap;
	}
	:host([hidden]) {
		display: none;
	}
	.label {
		color: var(--violet-color-text-muted);
	}
	.value {
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.label[hidden] {
		display: none;
	}
	@media (forced-colors: active) {
		:host,
		.label {
			color: CanvasText;
		}
	}
`;

export class LoamStatusItem extends FASTElement {
	declare label: string;

	constructor() {
		super();
		this.label = '';
	}
}
attr(LoamStatusItem.prototype, 'label');

export const statusItemDefinition = { name: 'loam-status-item', template, styles } as const;
