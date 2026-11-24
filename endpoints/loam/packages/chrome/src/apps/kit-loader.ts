/**
 * @fileoverview `kit.define` (phase 1 specification, 5.2 and 5.4): each kit element loads through a
 * dynamic deep import, and its FAST definition is defined in the app's registry. The element's own
 * shadow root stays on the global registry, where its module also defined it and its inner elements.
 */

import { FASTElementDefinition } from '@lushly-dev/fast-element';
import type { KitElementNameV1, KitV1 } from '@lushly-dev/loam-sdk';

type Loader = () => Promise<unknown>;

/** The shell has defined it already, and a dynamic import of it would split the first-paint chunk. */
const loaded: Loader = () => Promise.resolve();

const LOADERS: Readonly<Record<KitElementNameV1, Loader>> = {
	'violet-badge': () => import('@lushly-dev/violet-elements/badge/define'),
	'violet-button': () => import('@lushly-dev/violet-elements/button/define'),
	'violet-checkbox': () => import('@lushly-dev/violet-elements/checkbox/define'),
	'violet-divider': () => import('@lushly-dev/violet-elements/divider/define'),
	'violet-empty-state': loaded,
	'violet-icon': loaded,
	'violet-option': () => import('@lushly-dev/violet-elements/option/define'),
	'violet-select': () => import('@lushly-dev/violet-elements/select/define'),
	'violet-switch': () => import('@lushly-dev/violet-elements/switch/define'),
	'violet-text-area': () => import('@lushly-dev/violet-elements/text-area/define'),
	'violet-text-field': () => import('@lushly-dev/violet-elements/text-field/define'),
	'loam-list': loaded,
	'loam-status-item': loaded,
	// A chunk of its own, loaded by the first editor that embeds (documents specification, 9.2).
	'loam-embed': () => import('../editor/embed.js').then((module) => module.defined),
};

/** Define one kit element in `registry`, which is idempotent per registry. */
async function defineKitElement(name: KitElementNameV1, registry: CustomElementRegistry) {
	const loader = LOADERS[name];
	if (!loader) throw new TypeError(`'${String(name)}' is not a kit element of SDK 1`);
	await loader();
	// Each module also defines its element globally, where its own shadow root looks.
	const type = customElements.get(name);
	const definition = type && FASTElementDefinition.getByType(type);
	if (!definition) throw new TypeError(`The kit element '${name}' has no definition`);
	definition.define(registry);
}

export function createKit(registry: CustomElementRegistry): KitV1 {
	return {
		async define(names) {
			await Promise.all(names.map((name) => defineKitElement(name, registry)));
		},
	};
}
