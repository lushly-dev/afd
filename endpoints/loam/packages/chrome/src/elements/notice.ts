/**
 * @fileoverview `loam-notice`: the full-page notice the host renders in place of the shell, when
 * Loam is open in another tab (6.6) or the kernel's interface version does not match (6.2).
 */

import { attr, css, FASTElement, html } from '@lushly-dev/fast-element';

const template = html<LoamNotice>`
	<main class="notice" aria-labelledby="notice-heading">
		<h1 id="notice-heading">${(x) => x.heading}</h1>
		<p>${(x) => x.message}</p>
	</main>
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

	constructor() {
		super();
		this.heading = '';
		this.message = '';
	}
}
attr(LoamNotice.prototype, 'heading');
attr(LoamNotice.prototype, 'message');

export const noticeDefinition = { name: 'loam-notice', template, styles } as const;
