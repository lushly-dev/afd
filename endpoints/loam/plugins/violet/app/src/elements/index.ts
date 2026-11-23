/**
 * @fileoverview Defines `token-tree-main`, `token-tree-editor`, and `token-tree-inspector` in the
 * app's scoped `CustomElementRegistry` (never the global `customElements`, spec §3.1, F21).
 */
import { FASTElement } from '@lushly-dev/fast-element';
import type { AppContextV1 } from '@lushly-dev/loam-sdk';
import { TokenTreeEditor, tokenTreeEditorDefinition } from './token-tree-editor.js';
import { TokenTreeInspector, tokenTreeInspectorDefinition } from './token-tree-inspector.js';
import { TokenTreeMain, tokenTreeMainDefinition } from './token-tree-main.js';

export { TokenTreeEditor, TokenTreeInspector, TokenTreeMain };

export async function defineVioletElements(context: AppContextV1): Promise<void> {
	const { registry } = context;
	const shadowOptions = { mode: 'open' as const, customElementRegistry: registry };
	await Promise.all([
		FASTElement.define(TokenTreeMain, { ...tokenTreeMainDefinition, registry, shadowOptions }),
		FASTElement.define(TokenTreeEditor, { ...tokenTreeEditorDefinition, registry, shadowOptions }),
		FASTElement.define(TokenTreeInspector, {
			...tokenTreeInspectorDefinition,
			registry,
			shadowOptions,
		}),
	]);
}
