/** @fileoverview `loam-projects-section`'s styles (phase 2 specification, 7.7; design.md's component list). */

import { css } from '@lushly-dev/fast-element';

export const styles = css`
	:host {
		display: block;
		color: var(--violet-color-text-primary);
		font-size: var(--violet-type-body-md-size);
		line-height: var(--violet-type-body-md-line);
	}
	.section {
		display: grid;
		gap: var(--violet-space-stack-md);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--violet-space-inline-md);
	}
	h1 {
		margin: 0;
		font-size: var(--violet-type-title-md-size);
		line-height: var(--violet-type-title-md-line);
		font-weight: var(--violet-type-title-md-weight);
		overflow-wrap: anywhere;
	}
	h1:focus-visible,
	a:focus-visible,
	input:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-size-space-xs);
	}
	h1:focus:not(:focus-visible) {
		outline: none;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: var(--violet-space-inline-sm);
		margin: 0;
		font-size: var(--violet-type-title-sm-size);
		line-height: var(--violet-type-title-sm-line);
		font-weight: var(--violet-type-title-sm-weight);
		overflow-wrap: anywhere;
	}
	h3 {
		margin: 0;
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
		font-weight: var(--violet-type-label-sm-weight);
		color: var(--violet-color-text-secondary);
	}
	p {
		margin: 0;
	}
	a {
		color: var(--violet-color-text-primary);
		text-decoration: underline;
		text-underline-offset: var(--violet-size-space-xs);
		border-radius: var(--violet-radius-sm);
		overflow-wrap: anywhere;
	}
	a:hover {
		text-decoration-thickness: var(--violet-size-space-xs);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--violet-space-inline-sm);
	}
	.form {
		display: grid;
		gap: var(--violet-space-stack-sm);
		padding: var(--violet-space-layout-sm);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-md);
		background: var(--violet-color-surface-card);
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--violet-space-inline-md);
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: var(--violet-space-inline-sm);
		min-block-size: var(--violet-size-target-natural);
	}
	.check input {
		inline-size: var(--violet-size-space-xl);
		block-size: var(--violet-size-space-xl);
		margin: 0;
		accent-color: var(--violet-color-control-selected-background);
	}
	violet-text-field[invalid]::part(error-message),
	.failure {
		color: var(--violet-color-state-danger-text);
	}
	violet-text-field::part(label),
	violet-text-field::part(supporting-text),
	violet-text-field::part(error-message) {
		overflow-wrap: anywhere;
	}
	table {
		inline-size: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding-block: var(--violet-space-stack-xs);
		padding-inline: var(--violet-space-inline-sm);
		border-block-end: 1px solid var(--violet-color-border-subtle);
		text-align: start;
		vertical-align: top;
	}
	th {
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
		font-weight: var(--violet-type-label-sm-weight);
		color: var(--violet-color-text-secondary);
	}
	/* A standalone link is a 24 px target (design.md). */
	td a,
	.all a,
	ul a {
		display: inline-block;
		min-block-size: var(--violet-size-target-compact);
	}
	.empty,
	.muted {
		color: var(--violet-color-text-secondary);
	}
	dl {
		margin: 0;
	}
	dd {
		margin: 0;
	}
	.facts {
		display: grid;
		gap: var(--violet-space-stack-xs);
	}
	.facts div {
		display: flex;
		flex-wrap: wrap;
		gap: var(--violet-space-inline-sm);
	}
	.facts dt,
	.counts dt {
		color: var(--violet-color-text-secondary);
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--violet-shell-size-main-min)), 1fr));
		gap: var(--violet-space-layout-sm);
	}
	.card {
		display: grid;
		align-content: start;
		gap: var(--violet-space-stack-sm);
		padding: var(--violet-space-layout-sm);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-md);
		background: var(--violet-color-surface-card);
		min-inline-size: 0;
		/* Any text within 7.7's bounds wraps at 320 CSS px (WCAG 1.4.10), and a stack of combining marks paints
		   inside its own card, never over a neighbour's. */
		overflow-wrap: anywhere;
		overflow: clip;
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--violet-space-inline-md);
	}
	.counts > div {
		min-inline-size: 0;
	}
	.counts dd {
		font-size: var(--violet-type-title-sm-size);
		line-height: var(--violet-type-title-sm-line);
		font-weight: var(--violet-weight-semibold);
	}
	ul {
		display: grid;
		gap: var(--violet-space-stack-xs);
		margin: 0;
		padding-inline-start: var(--violet-space-inline-md);
	}
	.read-failure:not([hidden]) {
		margin-block-start: var(--violet-space-stack-md);
	}
	.said {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@media (forced-colors: active) {
		:host,
		.form,
		.card {
			background: Canvas;
			color: CanvasText;
			border-color: CanvasText;
		}
		a {
			color: LinkText;
		}
		h1:focus-visible,
		a:focus-visible,
		input:focus-visible {
			outline-color: Highlight;
		}
		.empty,
		.muted,
		.failure,
		th,
		h3,
		.facts dt,
		.counts dt,
		violet-text-field[invalid]::part(error-message) {
			color: CanvasText;
		}
	}
`;
