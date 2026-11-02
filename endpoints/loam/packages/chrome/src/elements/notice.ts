/**
 * @fileoverview `loam-notice`: the full-page notice the host renders in place of the shell, when
 * Loam is open in another tab (6.6) or the kernel's interface version does not match (6.2). With
 * `embedded`, it is main's explanation of a refused or failed app (phase 1 specification, 5.5), so it
 * is a region inside main and not a `main` of its own. It loads when one is needed, since few pages
 * ever show it.
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';

const template = html<LoamNotice>`
	<div
		class="notice"
		role="${(x) => (x.embedded ? 'region' : 'main')}"
		aria-labelledby="notice-heading"
	>
		<h1 id="notice-heading">${(x) => x.heading}</h1>
		<p>${(x) => x.message}</p>
		<p class="suggestion" ?hidden="${(x) => !x.suggestion}">${(x) => x.suggestion}</p>
	</div>
`;

const styles = css`
	:host {
		display: grid;
		place-items: center;
		min-block-size: 100dvh;
		box-sizing: border-box;
		padding: var(--space-layout-md);
		background: var(--color-surface-page);
		color: var(--color-text-primary);
		font-family: 'Montserrat', 'Segoe UI', sans-serif;
	}
	:host([embedded]) {
		display: block;
		min-block-size: 0;
	}
	[hidden] {
		display: none;
	}
	.suggestion {
		margin-block-start: var(--space-stack-sm);
	}
	.notice {
		max-inline-size: calc(var(--shell-size-main-min) * 1.6);
	}
	h1 {
		margin-block: 0 var(--space-stack-md);
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
	@media (forced-colors: active) {
		:host,
		p {
			background: Canvas;
			color: CanvasText;
		}
	}
`;

export class LoamNotice extends FASTElement {
	declare heading: string;
	declare message: string;
	declare suggestion: string;
	declare embedded: boolean;

	constructor() {
		super();
		this.heading = '';
		this.message = '';
		this.suggestion = '';
		this.embedded = false;
	}
}
attr(LoamNotice.prototype, 'heading');
attr(LoamNotice.prototype, 'message');
attr(LoamNotice.prototype, 'suggestion');
attr({ mode: 'boolean' })(LoamNotice.prototype, 'embedded');

export const noticeDefinition = { name: 'loam-notice', template, styles } as const;
