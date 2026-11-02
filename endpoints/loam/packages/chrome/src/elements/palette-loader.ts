/**
 * @fileoverview The palette loads after first paint: its module, with `violet-dialog`,
 * `violet-listbox` and `violet-option`, is a chunk of its own that the shell imports when idle or
 * on the first Mod+K, whichever comes first (decided by step 7 for the bundle budget, 8.1). The
 * resize handles load with it: until then a part has its border, and nothing to drag (phase 1
 * specification, 9.5).
 */

let loading: Promise<void> | null = null;

export function definePalette(): Promise<void> {
	loading ??= Promise.all([import('./palette.js'), import('./resize-handle.js')]).then(
		async ([{ LoamPalette, paletteDefinition }, { LoamResizeHandle, resizeHandleDefinition }]) => {
			if (!customElements.get(paletteDefinition.name)) await LoamPalette.define(paletteDefinition);
			if (!customElements.get(resizeHandleDefinition.name)) {
				await LoamResizeHandle.define(resizeHandleDefinition);
			}
		}
	);
	return loading;
}

/**
 * Run `task` when the page is idle, after the frame that paints it, or soon where
 * `requestIdleCallback` is missing.
 */
export function whenIdle(view: Window, task: () => void): void {
	const idle = (view as { requestIdleCallback?: (callback: () => void) => number })
		.requestIdleCallback;
	view.requestAnimationFrame(() =>
		view.requestAnimationFrame(() => {
			if (idle) idle.call(view, task);
			else view.setTimeout(task, 1);
		})
	);
}
