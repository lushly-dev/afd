/** @fileoverview `loam-projects-section`'s styles (phase 2 specification, 7.7; design.md's component list). */

import { css } from '@lushly-dev/fast-element';

export const styles = css`
	:host {
		display: block;
		color: var(--violet-color-text-primary);
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
	}
	.section {
		display: grid;
		gap: var(--violet-space-stack-section);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--violet-space-inline-group);
	}
	h1 {
		margin: 0;
		font-size: var(--violet-type-heading-page-size);
		line-height: var(--violet-type-heading-page-line);
		font-weight: var(--violet-type-heading-page-weight);
		overflow-wrap: anywhere;
	}
	h1:focus-visible,
	a:focus-visible,
	input:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-space-inline-hairline);
	}
	h1:focus:not(:focus-visible) {
		outline: none;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: var(--violet-space-inline-tight);
		margin: 0;
		font-size: var(--violet-type-heading-section-size);
		line-height: var(--violet-type-heading-section-line);
		font-weight: var(--violet-type-heading-section-weight);
		overflow-wrap: anywhere;
	}
	h3 {
		margin: 0;
		font-size: var(--violet-type-label-size);
		line-height: var(--violet-type-label-line);
		font-weight: var(--violet-type-label-weight);
		color: var(--violet-color-text-secondary);
	}
	p {
		margin: 0;
	}
	a {
		color: var(--violet-color-text-primary);
		text-decoration: underline;
		text-underline-offset: var(--violet-space-inline-hairline);
		border-radius: var(--violet-radius-inset);
		overflow-wrap: anywhere;
	}
	a:hover {
		text-decoration-thickness: var(--violet-space-inline-hairline);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--violet-space-inline-tight);
	}
	.form {
		display: grid;
		gap: var(--violet-space-stack-group);
		padding: var(--violet-space-layout-panel);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-surface-card);
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--violet-space-inline-group);
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: var(--violet-space-inline-tight);
		min-block-size: var(--violet-size-target-natural);
	}
	.check input {
		inline-size: var(--violet-size-target-compact);
		block-size: var(--violet-size-target-compact);
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
		padding-block: var(--violet-space-stack-tight);
		padding-inline: var(--violet-space-inline-tight);
		border-block-end: 1px solid var(--violet-color-border-subtle);
		text-align: start;
		vertical-align: top;
	}
	th {
		font-size: var(--violet-type-label-size);
		line-height: var(--violet-type-label-line);
		font-weight: var(--violet-type-label-weight);
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
		gap: var(--violet-space-stack-tight);
	}
	.facts div {
		display: flex;
		flex-wrap: wrap;
		gap: var(--violet-space-inline-tight);
	}
	.facts dt,
	.counts dt {
		color: var(--violet-color-text-secondary);
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--violet-shell-size-main-min)), 1fr));
		gap: var(--violet-space-layout-panel);
	}
	.card {
		display: grid;
		align-content: start;
		gap: var(--violet-space-stack-group);
		padding: var(--violet-space-layout-panel);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-control);
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
		gap: var(--violet-space-inline-group);
	}
	.counts > div {
		min-inline-size: 0;
	}
	.counts dd {
		font-size: var(--violet-type-heading-section-size);
		line-height: var(--violet-type-heading-section-line);
		font-weight: var(--violet-weight-semibold);
	}
	ul {
		display: grid;
		gap: var(--violet-space-stack-tight);
		margin: 0;
		padding-inline-start: var(--violet-space-inline-group);
	}
	.read-failure:not([hidden]) {
		margin-block-start: var(--violet-space-stack-section);
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
