/**
 * @fileoverview Lightweight desktop empty-model notice inside `loam-panel` (phase 5 no-terminal
 * amendment, section 8.3). Loaded lazily ONLY when the panel opens on a fresh desktop install with
 * zero configured copilot providers, keeping first-paint and copilot chunk budgets unaffected.
 */

import { css, FASTElement, html } from '@lushly-dev/fast-element';

const EMPTY_MODEL_MESSAGE =
	'Open Loam → Copilot Models… (or click Configure model…) to add a model provider.';

const template = html<LoamDesktopModelEmpty>`
	<section class="empty-model" aria-label="Copilot setup" data-copilot-empty="desktop">
		<p class="message">${() => EMPTY_MODEL_MESSAGE}</p>
		<button
			class="configure"
			type="button"
			@click="${(x) => x.onConfigureModel?.()}"
		>
			Configure model…
		</button>
	</section>
`;

const styles = css`
	:host {
		display: block;
		box-sizing: border-box;
	}
	.empty-model {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--violet-space-stack-group);
		padding: var(--violet-space-layout-panel);
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
		color: var(--violet-color-text-secondary);
	}
	.message {
		margin: 0;
	}
	.configure {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-block-size: var(--violet-size-target-natural);
		padding-block: 0;
		padding-inline: var(--violet-space-inline-group);
		border: 1px solid var(--violet-color-border-subtle);
		border-radius: var(--violet-radius-control);
		background: var(--violet-color-surface-card);
		color: var(--violet-color-text-primary);
		font: inherit;
		font-size: var(--violet-type-label-size);
		line-height: var(--violet-type-label-line);
		font-weight: var(--violet-type-label-weight);
		cursor: pointer;
	}
	.configure:hover {
		background: var(--violet-color-action-secondary-hover);
	}
	.configure:focus-visible {
		outline: var(--violet-shell-size-focus) solid var(--violet-color-focus-ring);
		outline-offset: var(--violet-space-inline-hairline);
	}
	@media (forced-colors: active) {
		.configure {
			border-color: ButtonText;
			background: ButtonFace;
			color: ButtonText;
		}
		.configure:focus-visible {
			outline-color: Highlight;
		}
	}
`;

export class LoamDesktopModelEmpty extends FASTElement {
	onConfigureModel: (() => void) | null = null;
}

export const DESKTOP_MODEL_EMPTY_DEFINITION = {
	name: 'loam-desktop-model-empty',
	template,
	styles,
} as const;

/** Mount the desktop empty-model notice inside `loam-panel`, hiding its generic empty state. */
export async function mountDesktopEmptyModel(
	part: HTMLElement,
	onConfigureModel: () => void
): Promise<LoamDesktopModelEmpty> {
	if (!customElements.get(DESKTOP_MODEL_EMPTY_DEFINITION.name)) {
		await (LoamDesktopModelEmpty as unknown as typeof FASTElement).define(
			DESKTOP_MODEL_EMPTY_DEFINITION
		);
	}
	const existing = part.querySelector<LoamDesktopModelEmpty>(
		`:scope > ${DESKTOP_MODEL_EMPTY_DEFINITION.name}`
	);
	if (existing) {
		existing.onConfigureModel = onConfigureModel;
		return existing;
	}
	const notice = part.ownerDocument.createElement(
		DESKTOP_MODEL_EMPTY_DEFINITION.name
	) as LoamDesktopModelEmpty;
	notice.onConfigureModel = onConfigureModel;
	for (const empty of part.querySelectorAll(':scope > loam-empty-state'))
		empty.setAttribute('hidden', '');
	part.append(notice);
	return notice;
}
