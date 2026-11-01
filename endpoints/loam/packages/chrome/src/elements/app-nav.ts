/**
 * @fileoverview `loam-rail` and `loam-tabbar`: `navigation`, "Apps". With no app installed they
 * hold only the settings entry, disabled with the tooltip "Settings arrive in phase 4" (5.1). The
 * entry stays focusable (`aria-disabled`) so the tooltip can be read; Escape dismisses it.
 */

import { css, FASTElement, html } from '@lushly-dev/fast-element';
import { registerChromeIcons } from './icons.js';
import { partHost, visuallyHidden } from './styles.js';

export const SETTINGS_TOOLTIP = 'Settings arrive in phase 4';

const template = html<LoamAppNav>`
	<ul class="entries">
		<li class="entry-item">
			<button
				class="entry"
				type="button"
				aria-disabled="true"
				aria-describedby="settings-tip"
				@keydown="${(x, c) => x.handleKeydown(c.event as KeyboardEvent)}"
				@blur="${(x) => x.resetTip()}"
				@mouseleave="${(x) => x.resetTip()}"
			>
				<violet-icon icon="system/settings" decorative></violet-icon>
				<span class="label">Settings</span>
			</button>
			<span id="settings-tip" class="tip" role="tooltip">${() => SETTINGS_TOOLTIP}</span>
		</li>
	</ul>
`;

const entryStyles = css`
	.entries {
		display: flex;
		margin: 0;
		padding: 0;
		list-style: none;
		gap: var(--space-inline-sm);
	}
	.entry-item {
		position: relative;
	}
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
		opacity: 0.55;
		cursor: not-allowed;
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
		box-shadow: var(--shadow-floating);
		color: var(--color-text-primary);
		font-size: var(--type-label-sm-size);
		line-height: var(--type-label-sm-line);
		white-space: nowrap;
		pointer-events: none;
	}
	.entry:hover + .tip,
	.entry:focus-visible + .tip {
		display: block;
	}
	.entry[data-tip='dismissed'] + .tip {
		display: none;
	}
	@media (forced-colors: active) {
		.entry {
			color: GrayText;
			border-color: GrayText;
		}
		.entry:focus-visible {
			outline-color: Highlight;
		}
		.tip {
			border: 1px solid CanvasText;
			background: Canvas;
			color: CanvasText;
		}
	}
`;

export class LoamAppNav extends FASTElement {
	constructor() {
		super();
		registerChromeIcons();
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'navigation');
		this.setAttribute('aria-label', 'Apps');
	}

	handleKeydown(event: KeyboardEvent): boolean {
		if (event.key === 'Escape') {
			const entry = event.currentTarget as HTMLElement;
			if (entry.dataset.tip !== 'dismissed') {
				entry.dataset.tip = 'dismissed';
				event.stopPropagation();
				return false;
			}
		}
		return true;
	}

	resetTip(): void {
		const entry = this.shadowRoot?.querySelector<HTMLElement>('.entry');
		if (entry) delete entry.dataset.tip;
	}
}

export class LoamRail extends LoamAppNav {}
export class LoamTabbar extends LoamAppNav {}

export const railDefinition = {
	name: 'loam-rail',
	template,
	styles: [
		partHost,
		visuallyHidden,
		entryStyles,
		css`
			:host {
				display: block;
				inline-size: var(--shell-size-rail);
				padding-block: var(--space-stack-sm);
				background: var(--color-surface-subtle);
				border-inline-end: 1px solid var(--color-border-subtle);
			}
			.entries {
				flex-direction: column;
				align-items: center;
			}
			.entry {
				inline-size: var(--size-target-comfortable);
			}
			.label {
				position: absolute;
				inline-size: 1px;
				block-size: 1px;
				overflow: hidden;
				clip-path: inset(50%);
				white-space: nowrap;
			}
			.tip {
				inset-block-start: 0;
				inset-inline-start: calc(100% + var(--size-space-sm));
			}
			@media (forced-colors: active) {
				:host {
					background: Canvas;
					border-inline-end-color: CanvasText;
				}
			}
		`,
	],
} as const;

export const tabbarDefinition = {
	name: 'loam-tabbar',
	template,
	styles: [
		partHost,
		entryStyles,
		css`
			:host {
				display: flex;
				align-items: center;
				justify-content: center;
				block-size: var(--shell-size-tabbar);
				padding-inline: var(--space-inline-md);
				background: var(--color-surface-subtle);
				border-block-start: 1px solid var(--color-border-subtle);
			}
			.entry {
				flex-direction: column;
			}
			.tip {
				inset-block-end: calc(100% + var(--size-space-sm));
				inset-inline-start: 0;
			}
			@media (forced-colors: active) {
				:host {
					background: Canvas;
					border-block-start-color: CanvasText;
				}
			}
		`,
	],
} as const;
