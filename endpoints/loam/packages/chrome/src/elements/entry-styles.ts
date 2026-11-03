/**
 * @fileoverview What a rail or tab bar entry's button and tooltip share: the settings entry of
 * `loam-rail` and `loam-app-entry`. One fragment, since both are in first paint (phase 2 specification,
 * 2.4). Each element adds its own rules after it.
 */

import { css } from '@lushly-dev/fast-element';

export const entryBase = css`
	.entry {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--size-space-xs);
		min-inline-size: var(--size-target-comfortable);
		min-block-size: var(--size-target-comfortable);
		padding: var(--size-space-xs);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		font-weight: var(--type-label-sm-weight);
	}
	.entry violet-icon {
		--violet-icon-size: var(--size-line-md);
	}
	.entry:focus-visible {
		outline: var(--shell-size-focus) solid var(--color-focus-ring);
		outline-offset: calc(-1 * var(--shell-size-focus));
	}
	.tip {
		position: absolute;
		z-index: var(--z-index-popover);
		display: none;
		padding-block: var(--size-space-sm);
		padding-inline: var(--size-space-md);
		border-radius: var(--radius-md);
		background: var(--color-surface-floating);
		background-clip: padding-box;
		box-shadow: var(--shadow-floating);
		color: var(--color-text-primary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		white-space: nowrap;
	}
`;
