/**
 * @fileoverview `loam-mount`: the mount contract (phase 1 specification, 5.4). A global element whose
 * shadow root uses one app's scoped registry, with inherited styles reset and tokens left to flow. It
 * is a plain `HTMLElement`, because FAST fixes a shadow root's options per definition, and each mount
 * has its app's registry. D54 applies: this keeps an app's selectors out of the chrome by contract,
 * since an app can walk the DOM.
 */

import { css } from '@lushly-dev/fast-element';
import type { AppContextV1, LoamSurfaceElementV1, ScopeV1 } from '@lushly-dev/loam-sdk';

const styles = css`
	:host {
		all: initial;
		display: block;
		box-sizing: border-box;
		block-size: 100%;
		overflow: auto;
		contain: content;
		color: var(--violet-color-text-primary);
		font-family: var(--violet-font-family-body);
		font-size: var(--violet-type-body-size);
		line-height: var(--violet-type-body-line);
		font-weight: var(--violet-type-body-weight);
	}
	:host([hidden]) {
		display: none;
	}
	h3 {
		margin-block: 0 var(--violet-space-stack-group);
		font-size: var(--violet-type-label-size);
		line-height: var(--violet-type-label-line);
		font-weight: var(--violet-weight-semibold);
		color: var(--violet-color-text-secondary);
	}
	.undefined {
		margin: 0;
		color: var(--violet-color-state-danger-text);
	}
	@media (forced-colors: active) {
		:host,
		h3,
		.undefined {
			color: CanvasText;
		}
	}
`;

export interface MountOptions {
	registry: CustomElementRegistry;
	/** The surface's element, as the manifest names it. */
	element: string;
	context: AppContextV1;
	selection?: string | null;
	selectionLevel?: 'workspace' | 'project';
	/** The scope the surface is created in, fixed for its life, and the app's route (phase 2 specification, 7.6). */
	scope?: ScopeV1;
	route?: string;
	/** A title above the element, for a panel's view. */
	label?: string;
	/** An editor's document (documents specification, 5.6), assigned before it connects. */
	document?: unknown;
}

/** The `@webcomponents` polyfill has no `customElementRegistry` option on `document.createElement`. */
const usesPolyfill = (): boolean =>
	(globalThis as { __scopedRegistryPolyfillApplied?: boolean }).__scopedRegistryPolyfillApplied ===
	true;

export class LoamMount extends HTMLElement {
	#options: MountOptions | null = null;
	#surface: LoamSurfaceElementV1 | null = null;

	/** Give the mount its app before it connects. */
	configure(options: MountOptions): void {
		this.#options = options;
	}

	get surface(): LoamSurfaceElementV1 | null {
		return this.#surface;
	}

	set selection(id: string | null) {
		if (this.#options) this.#options.selection = id;
		if (this.#surface) this.#surface.selection = id;
	}

	set selectionLevel(level: 'workspace' | 'project') {
		if (this.#options) this.#options.selectionLevel = level;
		if (this.#surface) this.#surface.selectionLevel = level;
	}

	/** The app's own sections changed (phase 4 specification, 3.8): its element hears it, if it listens. */
	settingsChanged(sections: string[]): void {
		this.#surface?.settingsChanged?.(sections);
	}

	/** A change of route is a property change: it recreates nothing (7.6). */
	set route(route: string) {
		if (this.#options) this.#options.route = route;
		if (this.#surface) this.#surface.route = route;
	}

	connectedCallback(): void {
		if (this.shadowRoot || !this.#options) return;
		const {
			registry,
			element,
			context,
			selection,
			selectionLevel,
			scope,
			route,
			label,
			document: ref,
		} = this.#options;
		const root = this.attachShadow({
			mode: 'open',
			customElementRegistry: registry,
			registry,
			customElements: registry,
		} as ShadowRootInit);
		styles.addStylesTo(root);
		if (label !== undefined) {
			const heading = document.createElement('h3');
			heading.textContent = label;
			root.append(heading);
		}
		if (!registry.get(element)) {
			this.#undefinedElement(root, element);
			return;
		}
		const surface = (
			usesPolyfill()
				? (root as unknown as { createElement(name: string): HTMLElement }).createElement(element)
				: document.createElement(element, {
						customElementRegistry: registry,
					} as ElementCreationOptions)
		) as LoamSurfaceElementV1;
		surface.context = context;
		// Before it connects, so it reads them when it is created (7.6).
		if (scope) surface.scope = scope;
		if (route !== undefined) surface.route = route;
		if (ref !== undefined) (surface as { document?: unknown }).document = ref;
		if (selectionLevel) surface.selectionLevel = selectionLevel;
		surface.selection = selection ?? null;
		this.#surface = surface;
		root.append(surface);
	}

	#undefinedElement(root: ShadowRoot, element: string): void {
		const message = document.createElement('p');
		message.className = 'undefined';
		message.setAttribute('role', 'alert');
		message.dataset.code = 'APP_ELEMENT_UNDEFINED';
		message.textContent = `This surface names the element ${element}, which the app did not define. Define it in activate, in context.registry. (APP_ELEMENT_UNDEFINED)`;
		root.append(message);
	}
}
