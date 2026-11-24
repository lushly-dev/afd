/**
 * @fileoverview What a rail or tab bar entry's button shares: `loam-app-entry`, `loam-section-entry` and
 * `loam-project-switcher`. One fragment, since all are in first paint (phase 2 specification, 2.4). Each
 * element adds its own rules after it; the tooltip is `loam-tooltip`'s (7.5).
 */

import { css } from '@lushly-dev/fast-element';

export const entryBase = css`
	:host {
		display: block;
		flex: none;
	}
	:host([variant='rail']) .label {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	:host([variant='tabbar']) .entry {
		flex-direction: column;
	}
	.entry:not([aria-disabled]):hover {
		background: var(--violet-color-action-secondary-hover);
		color: var(--violet-color-text-primary);
	}
	.entry {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--violet-size-space-xs);
		min-inline-size: var(--violet-size-target-comfortable);
		min-block-size: var(--violet-size-target-comfortable);
		padding: var(--violet-size-space-xs);
		border: 1px solid transparent;
		border-radius: var(--violet-radius-md);
		background: transparent;
		color: var(--violet-color-text-secondary);
		font: inherit;
		font-size: var(--violet-type-label-sm-size);
		line-height: var(--violet-type-label-sm-line);
		font-weight: var(--violet-type-label-sm-weight);
	}
	.entry violet-icon {
		--violet-icon-size: var(--violet-size-line-md);
	}
	.entry:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: calc(-1 * var(--violet-shell-size-focus));
	}
	@media (forced-colors: active) {
		.entry {
			color: ButtonText;
		}
		.entry:focus-visible {
			outline-color: Highlight;
		}
	}
`;
