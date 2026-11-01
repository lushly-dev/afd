/**
 * @fileoverview `loam-status-item`: one item of the status bar, its label read before its value
 * (design.md, component list). It is text, not a control, and does not animate.
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';

const template = html<LoamStatusItem>`
	<span class="label" ?hidden="${(x) => !x.label}">${(x) => x.label}</span>
	<span class="value"><slot></slot></span>
`;

const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: var(--size-space-sm);
		min-block-size: var(--size-target-compact);
		padding-inline: var(--space-inline-sm);
		color: var(--color-text-secondary);
		font-size: var(--type-caption-xs-size);
		line-height: var(--type-caption-xs-line);
		font-weight: var(--type-caption-xs-weight);
		white-space: nowrap;
	}
	:host([hidden]) {
		display: none;
	}
	.label {
		color: var(--color-text-muted);
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
