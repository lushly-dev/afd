/**
 * @fileoverview `loam-rail` and `loam-tabbar`: `navigation`, "Apps", with two bands and a divider (phase 2
 * specification, 7.1 and 7.2). The top band, "Project apps", holds Projects, the project switcher,
 * Documents, then the apps that belong under a project; the bottom band, "Workspace apps", the apps with
 * no project now. Settings is last, outside the bands, `aria-disabled` and focusable with "Settings arrive
 * in phase 4". `RailBands` (`../rail/rail-bands.ts`) owns the app entries; no slot takes them. The bands
 * scroll, and one `loam-tooltip` in this shadow root serves every entry, in the top layer, so no list
 * clips it (7.5, #709). Its chunk loads on the first hover, focus or press here, which it is then given.
 */

import { css, FASTElement, html } from '@lushly-dev/fast-element';
import { registerChromeIcons } from './icons.js';
import { partHost } from './styles.js';

export const SETTINGS_TOOLTIP = 'Settings arrive in phase 4';

const template = html<LoamAppNav>`
	<div class="bands">
		<ul class="band top" aria-label="Project apps">
			<loam-section-entry
				section="projects"
				label="Projects"
				icon="system/folder"
				variant="${(x) => x.variant}"
			></loam-section-entry>
			<loam-project-switcher variant="${(x) => x.variant}"></loam-project-switcher>
			<loam-section-entry
				section="documents"
				label="Documents"
				icon="system/document"
				variant="${(x) => x.variant}"
			></loam-section-entry>
		</ul>
		<hr class="divider" aria-hidden="true" />
		<ul class="band bottom" aria-label="Workspace apps"></ul>
	</div>
	<ul class="end" aria-label="Settings">
		<loam-section-entry
			class="settings"
			label="Settings"
			icon="system/settings"
			dimmed
			tip="Settings arrive in phase 4"
			variant="${(x) => x.variant}"
		></loam-section-entry>
	</ul>
`;

const navStyles = css`
	.bands,
	.band,
	.end {
		display: flex;
		align-items: center;
		margin: 0;
		padding: 0;
		list-style: none;
		gap: var(--space-inline-sm);
	}
	.bands {
		min-block-size: 0;
		min-inline-size: 0;
		overflow: auto;
		scrollbar-width: thin;
	}
	.divider {
		flex: none;
		margin: 0;
		border: 0;
		background: var(--color-border-subtle);
	}
	.bottom:empty,
	.divider:has(+ .bottom:empty) {
		display: none;
	}
	@media (forced-colors: active) {
		.divider {
			background: CanvasText;
		}
	}
`;

export abstract class LoamAppNav extends FASTElement {
	abstract readonly variant: 'rail' | 'tabbar';

	constructor() {
		super();
		registerChromeIcons();
	}

	#tooltip: Promise<{ handle(type: string, path: EventTarget[], replayed: boolean): void }> | null =
		null;

	override connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute('role', 'navigation');
		this.setAttribute('aria-label', 'Apps');
		this.#wakeOn('addEventListener');
	}

	#wakeOn(method: 'addEventListener' | 'removeEventListener'): void {
		for (const type of ['pointerover', 'focusin', 'click'])
			this.shadowRoot?.[method](type, this.#wake);
	}

	/**
	 * The first event that needs the tooltip loads it, and is handed to it if it still holds: the pointer
	 * still over its target, focus still on it (phase 2 specification, 7.5). A failed load is tried again.
	 */
	#wake = (event: Event): void => {
		const path = event.composedPath();
		const { type } = event;
		this.#tooltip ??= import('./tooltip.js')
			.then(({ attachTooltip }) => attachTooltip(this))
			.then((tip) => {
				this.#wakeOn('removeEventListener');
				return tip;
			})
			.catch((cause: unknown) => {
				this.#tooltip = null;
				throw cause;
			});
		void this.#tooltip.then((tip) => tip.handle(type, path, true)).catch(reportError);
	};

	/** A band's list, which `RailBands` fills. */
	band(band: 'top' | 'bottom'): HTMLUListElement {
		return this.shadowRoot?.querySelector(`.${band}`) as HTMLUListElement;
	}
}

export class LoamRail extends LoamAppNav {
	readonly variant = 'rail';
}
export class LoamTabbar extends LoamAppNav {
	readonly variant = 'tabbar';
}

export const railDefinition = {
	name: 'loam-rail',
	template,
	styles: [
		partHost,
		navStyles,
		css`
			:host {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: var(--space-inline-sm);
				inline-size: var(--shell-size-rail);
				padding-block: var(--space-stack-sm);
				background: var(--color-surface-subtle);
				border-inline-end: 1px solid var(--color-border-subtle);
			}
			.bands,
			.band,
			.end {
				flex-direction: column;
			}
			.bands {
				align-self: stretch;
			}
			.divider {
				inline-size: var(--size-target-compact);
				block-size: 1px;
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
		navStyles,
		css`
			:host {
				display: flex;
				align-items: center;
				justify-content: safe center;
				gap: var(--space-inline-sm);
				block-size: var(--shell-size-tabbar);
				padding-inline: var(--space-inline-md);
				background: var(--color-surface-subtle);
				border-block-start: 1px solid var(--color-border-subtle);
			}
			.divider {
				inline-size: 1px;
				block-size: var(--size-target-compact);
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
