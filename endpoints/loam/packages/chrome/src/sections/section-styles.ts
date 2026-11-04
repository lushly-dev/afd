/** @fileoverview `loam-projects-section`'s styles (phase 2 specification, 7.7; design.md's component list). */

import { css } from '@lushly-dev/fast-element';

export const styles = css`
	:host {
		display: block;
		color: var(--color-text-primary);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	.section {
		display: grid;
		gap: var(--space-stack-md);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-inline-md);
	}
	h1 {
		margin: 0;
		font-size: var(--type-title-md-size);
		line-height: var(--type-title-md-line);
		font-weight: var(--type-title-md-weight);
		overflow-wrap: anywhere;
	}
	h1:focus-visible,
	a:focus-visible,
	input:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: var(--size-space-xs);
	}
	h1:focus:not(:focus-visible) {
		outline: none;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: var(--space-inline-sm);
		margin: 0;
		font-size: var(--type-title-sm-size);
		line-height: var(--type-title-sm-line);
		font-weight: var(--type-title-sm-weight);
		overflow-wrap: anywhere;
	}
	h3 {
		margin: 0;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		color: var(--color-text-secondary);
	}
	p {
		margin: 0;
	}
	a {
		color: var(--color-text-primary);
		text-decoration: underline;
		text-underline-offset: var(--size-space-xs);
		border-radius: var(--radius-sm);
		overflow-wrap: anywhere;
	}
	a:hover {
		text-decoration-thickness: var(--size-space-xs);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-inline-sm);
	}
	.form {
		display: grid;
		gap: var(--space-stack-sm);
		padding: var(--space-layout-sm);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-card);
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-inline-md);
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: var(--space-inline-sm);
		min-block-size: var(--size-target-natural);
	}
	.check input {
		inline-size: var(--size-space-xl);
		block-size: var(--size-space-xl);
		margin: 0;
		accent-color: var(--color-control-selected-background);
	}
	violet-text-field[invalid]::part(supporting-text),
	.failure {
		color: var(--color-state-danger-text);
	}
	violet-text-field::part(label),
	violet-text-field::part(supporting-text) {
		overflow-wrap: anywhere;
	}
	table {
		inline-size: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding-block: var(--space-stack-xs);
		padding-inline: var(--space-inline-sm);
		border-block-end: 1px solid var(--color-border-subtle);
		text-align: start;
		vertical-align: top;
	}
	th {
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
		color: var(--color-text-secondary);
	}
	/* A standalone link is a 24 px target (design.md). */
	td a,
	.all a,
	ul a {
		display: inline-block;
		min-block-size: var(--size-target-compact);
	}
	.empty,
	.muted {
		color: var(--color-text-secondary);
	}
	dl {
		margin: 0;
	}
	dd {
		margin: 0;
	}
	.facts {
		display: grid;
		gap: var(--space-stack-xs);
	}
	.facts div {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-inline-sm);
	}
	.facts dt,
	.counts dt {
		color: var(--color-text-secondary);
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--shell-size-main-min)), 1fr));
		gap: var(--space-layout-sm);
	}
	.card {
		display: grid;
		align-content: start;
		gap: var(--space-stack-sm);
		padding: var(--space-layout-sm);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-card);
		min-inline-size: 0;
		/* Any text within 7.7's bounds wraps at 320 CSS px (WCAG 1.4.10), and a stack of combining marks paints
		   inside its own card, never over a neighbour's. */
		overflow-wrap: anywhere;
		overflow: clip;
	}
	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-inline-md);
	}
	.counts > div {
		min-inline-size: 0;
	}
	.counts dd {
		font-size: var(--type-title-sm-size);
		line-height: var(--type-title-sm-line);
		font-weight: var(--weight-semibold);
	}
	ul {
		display: grid;
		gap: var(--space-stack-xs);
		margin: 0;
		padding-inline-start: var(--space-inline-md);
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
		violet-text-field[invalid]::part(supporting-text) {
			color: CanvasText;
		}
	}
`;
