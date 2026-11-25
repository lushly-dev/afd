/**
 * @fileoverview `loam-empty-state`: `violet-empty-state` as parts use it, one sentence saying
 * what will appear there, with no heading of its own (design.md, component list).
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';
import '@lushly-dev/violet-elements/empty-state/define';

const template = html<LoamEmptyState>`
	<violet-empty-state message="${(x) => x.message}"></violet-empty-state>
`;

const styles = css`
	:host {
		display: block;
		padding-block: var(--violet-space-layout-panel);
		color: var(--violet-color-text-secondary);
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
	}
	:host([hidden]) {
		display: none;
	}
`;

export class LoamEmptyState extends FASTElement {
	declare message: string;

	constructor() {
		super();
		this.message = '';
	}
}
attr(LoamEmptyState.prototype, 'message');

export const emptyStateDefinition = { name: 'loam-empty-state', template, styles } as const;
